'use strict';

// Acesso em preparação: o polo dá acesso ao app antes de a faculdade criar o RGM e o
// e-mail acadêmico do aluno. A conta nasce sem RGM (NULL), entra com o e-mail pessoal e a
// senha inicial de sempre (primeiro nome + 123@) e é levada à Aula Inaugural.
// Quando o RGM sai, o polo informa aqui; a sincronização de matriculados também completa
// a conta sozinha quando o e-mail pessoal do relatório é o mesmo.

const db = require('./db');
const matriculados = require('./matriculados');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function texto(v, max) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max || 160);
}

function validar(body) {
  const nome = texto(body && body.nome, 120);
  const email = texto(body && body.email, 160).toLowerCase();
  const curso = texto(body && body.curso, 160);
  const errors = {};
  if (!nome || !matriculados.derivedPassword(nome)) errors.nome = 'Informe o nome completo do aluno.';
  if (!EMAIL_RE.test(email)) errors.email = 'Informe um e-mail pessoal válido (é com ele que o aluno entra).';
  return { ok: !Object.keys(errors).length, errors, dados: { nome, email, curso: curso || null } };
}

function idValido(v) {
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function listar(pool) {
  const base = `SELECT a.id, a.nome, a.email, a.curso, a.ativo, a.created_at`;
  try {
    const r = await pool.query(
      `${base},
         (SELECT COUNT(*)::int FROM csu_trilha_progresso p WHERE p.aluno_id = a.id AND p.concluido_em IS NOT NULL) AS modulos
       FROM csu_alunos a WHERE a.rgm IS NULL ORDER BY a.created_at DESC LIMIT 500`,
    );
    return r.rows;
  } catch (err) {
    // Sem a tabela da Aula Inaugural ainda: lista sem o progresso.
    const r = await pool.query(`${base} FROM csu_alunos a WHERE a.rgm IS NULL ORDER BY a.created_at DESC LIMIT 500`);
    return r.rows.map((row) => ({ ...row, modulos: 0 }));
  }
}

async function emailEmUso(pool, email, exceptId) {
  const r = await pool.query(
    'SELECT id FROM csu_alunos WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1',
    [email, exceptId || 0],
  );
  return Boolean(r.rows[0]);
}

function registrar(app, { pool, requireAdmin }) {
  function semBanco(res) {
    return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
  }

  app.get('/api/admin/preparo', requireAdmin, async (req, res) => {
    if (!pool) return semBanco(res);
    try {
      await db.ensureSchema(pool);
      return res.json({ success: true, alunos: await listar(pool) });
    } catch (err) {
      console.error('Falha ao listar acessos em preparação:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível carregar a lista.' });
    }
  });

  app.post('/api/admin/preparo', requireAdmin, async (req, res) => {
    if (!pool) return semBanco(res);
    const v = validar(req.body);
    if (!v.ok) return res.status(422).json({ success: false, message: 'Dados inválidos.', errors: v.errors });
    try {
      await db.ensureSchema(pool);
      if (await emailEmUso(pool, v.dados.email)) {
        return res.status(409).json({ success: false, message: 'Esse e-mail já tem acesso no app.', errors: { email: 'Esse e-mail já tem acesso no app. Busque o aluno no acompanhamento.' } });
      }
      const r = await pool.query(
        `INSERT INTO csu_alunos (email, rgm, nome, pw_hash, curso)
         VALUES ($1, NULL, $2, $3, $4)
         RETURNING id, nome, email, curso, created_at`,
        [v.dados.email, v.dados.nome, db.DERIVED_PW_MARKER, v.dados.curso],
      );
      return res.status(201).json({ success: true, aluno: r.rows[0], senha_inicial: matriculados.derivedPassword(v.dados.nome) });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ success: false, message: 'Esse e-mail já tem acesso no app.' });
      console.error('Falha ao criar acesso em preparação:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível criar o acesso.' });
    }
  });

  // Corrige nome, e-mail ou curso de uma conta que ainda está sem RGM.
  app.put('/api/admin/preparo/:id', requireAdmin, async (req, res) => {
    if (!pool) return semBanco(res);
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Aluno inválido.' });
    const v = validar(req.body);
    if (!v.ok) return res.status(422).json({ success: false, message: 'Dados inválidos.', errors: v.errors });
    try {
      if (await emailEmUso(pool, v.dados.email, id)) {
        return res.status(409).json({ success: false, message: 'Esse e-mail já tem acesso no app.', errors: { email: 'Esse e-mail já é de outra conta.' } });
      }
      const r = await pool.query(
        `UPDATE csu_alunos SET nome = $2, email = $3, curso = $4
         WHERE id = $1 AND rgm IS NULL
         RETURNING id, nome, email, curso, created_at`,
        [id, v.dados.nome, v.dados.email, v.dados.curso],
      );
      if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Acesso em preparação não encontrado.' });
      return res.json({ success: true, aluno: r.rows[0], senha_inicial: matriculados.derivedPassword(v.dados.nome) });
    } catch (err) {
      console.error('Falha ao editar acesso em preparação:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível salvar.' });
    }
  });

  // O RGM saiu: liga à conta (progresso da Aula Inaugural continua o mesmo).
  app.put('/api/admin/preparo/:id/rgm', requireAdmin, async (req, res) => {
    if (!pool) return semBanco(res);
    const id = idValido(req.params.id);
    const rgm = String(req.body?.rgm ?? '').replace(/\D+/g, '');
    if (!id) return res.status(400).json({ success: false, message: 'Aluno inválido.' });
    if (rgm.length < 4 || rgm.length > 20) {
      return res.status(422).json({ success: false, message: 'RGM inválido.', errors: { rgm: 'Digite só os números do RGM.' } });
    }
    try {
      const dono = await pool.query(
        `SELECT id, nome FROM csu_alunos
         WHERE id <> $1 AND (rgm = $2 OR regexp_replace(rgm, '\\D', '', 'g') = $2) LIMIT 1`,
        [id, rgm],
      );
      if (dono.rows[0]) {
        return res.status(409).json({
          success: false,
          message: 'RGM já usado.',
          errors: { rgm: `Esse RGM já tem outra conta no app (${dono.rows[0].nome}). Peça ao aluno para entrar com o RGM; o progresso desta conta fica nela.` },
        });
      }
      const r = await pool.query(
        'UPDATE csu_alunos SET rgm = $2 WHERE id = $1 AND rgm IS NULL RETURNING id, nome, rgm',
        [id, rgm],
      );
      if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Acesso em preparação não encontrado.' });
      return res.json({ success: true, aluno: r.rows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ success: false, message: 'RGM já usado.', errors: { rgm: 'Esse RGM já tem outra conta no app.' } });
      console.error('Falha ao informar RGM:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível salvar o RGM.' });
    }
  });
}

module.exports = { registrar };
