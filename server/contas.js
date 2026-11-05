'use strict';

// Contas do portal pelas 3 vias de criação:
//   1. oficial    — relatório de matriculados D-1 (origem 'sync'; NULL = primeiro acesso, polo ou anterior)
//   2. provisoria — aceite da venda pelo webhook (origem 'webhook'; confirmado_em quando o RGM chega no D-1)
//   3. teste      — criada na mão no admin (origem 'teste'), com as áreas do portal escolhidas
//                   uma a uma (csu_alunos.permissoes, ver server/permissoes.js).
// A sincronização do relatório de matriculados não desativa nem reativa essas contas.
// Senha: a informada pelo admin; em branco = senha inicial de sempre (primeiro nome + 123@).

const bcrypt = require('bcryptjs');
const db = require('./db');
const matriculados = require('./matriculados');
const permissoes = require('./permissoes');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BCRYPT_ROUNDS = 10;

function texto(v, max) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max || 160);
}

function idValido(v) {
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// novo = true exige nome e e-mail; na edição a senha em branco mantém a atual.
function validar(body, novo) {
  const nome = texto(body && body.nome, 120);
  const email = texto(body && body.email, 160).toLowerCase();
  const rgm = String((body && body.rgm) ?? '').replace(/\D+/g, '');
  const curso = texto(body && body.curso, 160);
  const unidade = texto(body && body.unidade, 160);
  const senha = String((body && body.senha) ?? '');
  const errors = {};
  if (!nome || !matriculados.derivedPassword(nome)) errors.nome = 'Informe o nome completo.';
  if (!EMAIL_RE.test(email)) errors.email = 'Informe um e-mail válido (o usuário entra com ele).';
  if (rgm && (rgm.length < 4 || rgm.length > 20)) errors.rgm = 'Digite só os números do RGM (ou deixe em branco).';
  if (senha && senha.length < 6) errors.senha = 'A senha precisa de pelo menos 6 caracteres.';
  return {
    ok: !Object.keys(errors).length,
    errors,
    dados: {
      nome,
      email,
      rgm: rgm || null,
      curso: curso || null,
      unidade: unidade || null,
      senha,
      ativo: body && Object.prototype.hasOwnProperty.call(body, 'ativo') ? Boolean(body.ativo) : true,
      permissoes: permissoes.normalizar(body && body.permissoes),
    },
    novo,
  };
}

const CAMPOS = `id, nome, email, rgm, curso, unidade, ativo, permissoes, created_at, ultimo_login_em,
  (pw_hash <> '${db.DERIVED_PW_MARKER}') AS senha_propria`;

async function listar(pool) {
  const r = await pool.query(
    `SELECT ${CAMPOS} FROM csu_alunos WHERE origem = 'teste' ORDER BY created_at DESC LIMIT 500`,
  );
  return r.rows;
}

const VIA_SQL = `CASE WHEN origem = 'teste' THEN 'teste'
  WHEN origem = 'webhook' THEN 'provisoria' ELSE 'oficial' END`;

const DETALHE_SQL = `CASE
  WHEN origem = 'teste' THEN 'Criada no admin'
  WHEN origem = 'webhook' AND confirmado_em IS NULL THEN 'Aguardando o relatório D-1'
  WHEN origem = 'webhook' THEN 'Confirmada no relatório D-1'
  WHEN origem = 'sync' THEN 'Relatório D-1'
  WHEN rgm IS NULL THEN 'Em preparação (polo)'
  ELSE 'Primeiro acesso ou anterior' END`;

const VIAS = ['oficial', 'provisoria', 'teste'];
const POR_PAGINA = 50;

// Tabela de contas: filtro por via, busca (nome, e-mail, RGM) e situação; contagem por via.
async function listarContas(pool, query) {
  const via = VIAS.includes(query.via) ? query.via : '';
  const q = texto(query.q, 120).toLowerCase();
  const digitos = q.replace(/\D+/g, '');
  const situacao = ['ativas', 'inativas'].includes(query.situacao) ? query.situacao : '';
  const pagina = Math.max(1, Number.parseInt(query.pagina, 10) || 1);

  const filtros = [];
  const params = [];
  if (q) {
    params.push(q, digitos);
    filtros.push(`(lower(nome) LIKE '%' || $1 || '%' OR lower(email) LIKE '%' || $1 || '%'
      OR ($2 <> '' AND regexp_replace(COALESCE(rgm, ''), '\\D', '', 'g') LIKE '%' || $2 || '%'))`);
  }
  if (situacao) filtros.push(situacao === 'ativas' ? 'ativo = TRUE' : 'ativo = FALSE');
  const baseWhere = filtros.length ? 'WHERE ' + filtros.join(' AND ') : '';

  const contagem = await pool.query(
    `SELECT ${VIA_SQL} AS via, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ativo)::int AS ativas
     FROM csu_alunos ${baseWhere} GROUP BY 1`,
    params,
  );
  const totais = VIAS.reduce((m, v) => { m[v] = { total: 0, ativas: 0 }; return m; }, {});
  contagem.rows.forEach((r) => { totais[r.via] = { total: r.total, ativas: r.ativas }; });

  const where = via
    ? (baseWhere ? baseWhere + ' AND ' : 'WHERE ') + `${VIA_SQL} = $${params.length + 1}`
    : baseWhere;
  const listaParams = via ? [...params, via] : [...params];
  listaParams.push(POR_PAGINA, (pagina - 1) * POR_PAGINA);
  const r = await pool.query(
    `SELECT id, nome, email, rgm, curso, unidade, ativo, created_at, ultimo_login_em, confirmado_em,
       ${VIA_SQL} AS via, ${DETALHE_SQL} AS detalhe
     FROM csu_alunos ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${listaParams.length - 1} OFFSET $${listaParams.length}`,
    listaParams,
  );
  const total = via ? totais[via].total : VIAS.reduce((n, v) => n + totais[v].total, 0);
  return { totais, contas: r.rows, pagina, por_pagina: POR_PAGINA, total };
}

async function conflito(pool, { email, rgm }, exceptId) {
  const r = await pool.query(
    `SELECT id, nome, email, rgm FROM csu_alunos
     WHERE id <> $3 AND (lower(email) = lower($1)
        OR ($2::text IS NOT NULL AND regexp_replace(COALESCE(rgm, ''), '\\D', '', 'g') = $2))
     LIMIT 1`,
    [email, rgm, exceptId || 0],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (String(row.email).toLowerCase() === email) return { email: `Esse e-mail já é da conta de ${row.nome}.` };
  return { rgm: `Esse RGM já é da conta de ${row.nome}.` };
}

function registrar(app, { pool, requireAdmin }) {
  function semBanco(res) {
    return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
  }

  app.get('/api/admin/contas', requireAdmin, async (req, res) => {
    if (!pool) return semBanco(res);
    try {
      await db.ensureSchema(pool);
      return res.json({ success: true, ...(await listarContas(pool, req.query || {})) });
    } catch (err) {
      console.error('Falha ao listar contas:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível carregar as contas.' });
    }
  });

  app.get('/api/admin/contas-teste', requireAdmin, async (req, res) => {
    if (!pool) return semBanco(res);
    try {
      await db.ensureSchema(pool);
      return res.json({ success: true, catalogo: permissoes.CATALOGO, usuarios: await listar(pool) });
    } catch (err) {
      console.error('Falha ao listar usuários manuais:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível carregar a lista.' });
    }
  });

  app.post('/api/admin/contas-teste', requireAdmin, async (req, res) => {
    if (!pool) return semBanco(res);
    const v = validar(req.body, true);
    if (!v.ok) return res.status(422).json({ success: false, message: 'Dados inválidos.', errors: v.errors });
    const d = v.dados;
    try {
      await db.ensureSchema(pool);
      const dup = await conflito(pool, d);
      if (dup) return res.status(409).json({ success: false, message: 'Já existe conta com esses dados.', errors: dup });
      const pwHash = d.senha ? await bcrypt.hash(d.senha, BCRYPT_ROUNDS) : db.DERIVED_PW_MARKER;
      const r = await pool.query(
        `INSERT INTO csu_alunos (email, rgm, nome, pw_hash, curso, unidade, ativo, origem, permissoes, confirmado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'teste', $8::jsonb, now())
         RETURNING ${CAMPOS}`,
        [d.email, d.rgm, d.nome, pwHash, d.curso, d.unidade, d.ativo, JSON.stringify(d.permissoes)],
      );
      return res.status(201).json({
        success: true,
        usuario: r.rows[0],
        senha_inicial: d.senha ? null : matriculados.derivedPassword(d.nome),
      });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ success: false, message: 'Já existe conta com esse e-mail ou RGM.' });
      console.error('Falha ao criar conta teste:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível criar o usuário.' });
    }
  });

  app.put('/api/admin/contas-teste/:id', requireAdmin, async (req, res) => {
    if (!pool) return semBanco(res);
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Usuário inválido.' });
    const v = validar(req.body, false);
    if (!v.ok) return res.status(422).json({ success: false, message: 'Dados inválidos.', errors: v.errors });
    const d = v.dados;
    try {
      const dup = await conflito(pool, d, id);
      if (dup) return res.status(409).json({ success: false, message: 'Já existe conta com esses dados.', errors: dup });
      const pwHash = d.senha ? await bcrypt.hash(d.senha, BCRYPT_ROUNDS) : null;
      const r = await pool.query(
        `UPDATE csu_alunos
         SET nome = $2, email = $3, rgm = $4, curso = $5, unidade = $6, ativo = $7, permissoes = $8::jsonb,
             pw_hash = COALESCE($9, pw_hash)
         WHERE id = $1 AND origem = 'teste'
         RETURNING ${CAMPOS}`,
        [id, d.nome, d.email, d.rgm, d.curso, d.unidade, d.ativo, JSON.stringify(d.permissoes), pwHash],
      );
      if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Conta teste não encontrado.' });
      // Desativado ou com senha nova: derruba as sessões abertas.
      if (!d.ativo || pwHash) await pool.query('DELETE FROM csu_sessoes WHERE aluno_id = $1', [id]);
      return res.json({ success: true, usuario: r.rows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ success: false, message: 'Já existe conta com esse e-mail ou RGM.' });
      console.error('Falha ao editar conta teste:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível salvar.' });
    }
  });

  // Volta a senha para a inicial (primeiro nome + 123@).
  app.post('/api/admin/contas-teste/:id/senha-inicial', requireAdmin, async (req, res) => {
    if (!pool) return semBanco(res);
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Usuário inválido.' });
    try {
      const r = await pool.query(
        `UPDATE csu_alunos SET pw_hash = $2 WHERE id = $1 AND origem = 'teste' RETURNING nome`,
        [id, db.DERIVED_PW_MARKER],
      );
      if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Conta teste não encontrado.' });
      await pool.query('DELETE FROM csu_sessoes WHERE aluno_id = $1', [id]);
      return res.json({ success: true, senha_inicial: matriculados.derivedPassword(r.rows[0].nome) });
    } catch (err) {
      console.error('Falha ao voltar a senha inicial:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível voltar a senha.' });
    }
  });
}

module.exports = { registrar, validar, listarContas };
