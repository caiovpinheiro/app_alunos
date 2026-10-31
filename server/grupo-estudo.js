'use strict';

// Grupo de estudo do curso, moderado por IA (desenho em docs/grupo-estudo.md).
//
// Um grupo por curso (csu_alunos.curso normalizado). Cada mensagem passa pela moderação
// (server/grupo-moderacao.js) ANTES de aparecer: publicada, bloqueada (o autor vê a explicação) ou retida
// (vai para a fila do admin). Os outros alunos só veem "Maria S." e o texto; nunca RGM, e-mail ou id.
// Denúncias e decisões da equipe vão para csu_eventos (só metadados, sem o texto).
//
// Liga só para GRUPO_ESTUDO_ATIVA_PARA (RGM ou e-mail; "*" = todos; vazio = ninguém). Desligado,
// /api/grupos/* e /api/admin/grupos/* respondem 404 e a tela não aparece. Sem integração com o CRM.
//
// Tudo entra no app por montar(app, deps), chamado uma vez em server/index.js.

const { envValue } = require('./env');
const moderacao = require('./grupo-moderacao');

const MAX_TEXTO = 500;
const MAX_POR_MINUTO = 6;
const DENUNCIAS_PARA_OCULTAR = 3;
const MOTIVOS_DENUNCIA = {
  fraude: 'Prova, gabarito ou trabalho pronto',
  ofensa: 'Ofensa ou assédio',
  odio: 'Preconceito ou ódio',
  dados: 'Dados pessoais ou contato',
  spam: 'Propaganda ou link',
  outro: 'Outro motivo',
};
const REGRAS = [
  'Aqui é para estudar junto: dúvidas, dicas, materiais e apoio.',
  'Prova, gabarito, cola e trabalho pronto não entram. Isso pode anular a sua prova.',
  'Sem telefone, e-mail ou @: converse por aqui, com segurança.',
  'Respeito sempre. Toda mensagem passa por um moderador antes de aparecer.',
];

// ---------- Flag ----------
function lista() {
  return envValue('GRUPO_ESTUDO_ATIVA_PARA').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

function ligado() {
  return lista().length > 0;
}

function liberadoPara(aluno) {
  const l = lista();
  if (!l.length) return false;
  if (l.includes('*')) return true;
  if (!aluno) return false;
  const rgm = String(aluno.rgm || '').replace(/\D+/g, '');
  const email = String(aluno.email || '').trim().toLowerCase();
  return Boolean((rgm && l.map((x) => x.replace(/\D+/g, '')).includes(rgm)) || (email && l.includes(email)));
}

// ---------- Schema ----------
async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS csu_grupos (
      id SERIAL PRIMARY KEY,
      chave TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS csu_grupo_membros (
      grupo_id INTEGER NOT NULL REFERENCES csu_grupos(id) ON DELETE CASCADE,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      silenciado_ate TIMESTAMPTZ,
      entrou_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      visto_em TIMESTAMPTZ,
      PRIMARY KEY (grupo_id, aluno_id)
    );
    CREATE TABLE IF NOT EXISTS csu_grupo_mensagens (
      id BIGSERIAL PRIMARY KEY,
      grupo_id INTEGER NOT NULL REFERENCES csu_grupos(id) ON DELETE CASCADE,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      texto TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('publicada', 'bloqueada', 'retida', 'removida')),
      categoria TEXT NOT NULL DEFAULT 'ok',
      confianca TEXT,
      motivo TEXT,
      moderador TEXT NOT NULL,
      sinais TEXT[] NOT NULL DEFAULT '{}',
      revisar BOOLEAN NOT NULL DEFAULT FALSE,
      denuncias INTEGER NOT NULL DEFAULT 0,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      publicada_em TIMESTAMPTZ,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      revisado_em TIMESTAMPTZ,
      revisado_por INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_csu_grupo_msg_grupo ON csu_grupo_mensagens (grupo_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_csu_grupo_msg_atualizado ON csu_grupo_mensagens (grupo_id, atualizado_em);
    CREATE INDEX IF NOT EXISTS idx_csu_grupo_msg_autor ON csu_grupo_mensagens (aluno_id, criado_em DESC);
    CREATE INDEX IF NOT EXISTS idx_csu_grupo_msg_fila ON csu_grupo_mensagens (status, revisar, criado_em);
    CREATE TABLE IF NOT EXISTS csu_grupo_denuncias (
      id SERIAL PRIMARY KEY,
      mensagem_id BIGINT NOT NULL REFERENCES csu_grupo_mensagens(id) ON DELETE CASCADE,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      motivo TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolvida_em TIMESTAMPTZ,
      UNIQUE (mensagem_id, aluno_id)
    );
  `);
  const dias = Math.max(30, Number(envValue('RASTREIO_RETENCAO_DIAS', '180')) || 180);
  await pool.query(`DELETE FROM csu_grupo_mensagens WHERE criado_em < now() - ($1::int * interval '1 day')`, [dias]);
}

// ---------- Utilidades ----------
function chaveCurso(curso) {
  return String(curso || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
// "MARIA DA SILVA SANTOS" → "Maria S.". Nunca mostra o nome completo para os colegas.
function nomeExibido(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter((p) => p && !PARTICULAS.has(p.toLowerCase()));
  if (!partes.length) return 'Colega';
  const cap = (p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  return partes.length > 1 ? `${cap(partes[0])} ${partes[partes.length - 1].charAt(0).toUpperCase()}.` : cap(partes[0]);
}

async function evento(pool, alunoId, nome, dados) {
  try {
    await pool.query(
      `INSERT INTO csu_eventos (aluno_id, sessao, nome, tela, dados) VALUES ($1, NULL, $2, 'grupo', $3::jsonb)`,
      [alunoId, nome, JSON.stringify(dados || {})],
    );
  } catch (err) {
    console.error('Grupo de estudo: falha ao registrar evento:', err.message);
  }
}

// Grupo do aluno (cria o grupo e a filiação na primeira vez). null se o aluno ainda não tem curso.
async function grupoDoAluno(pool, alunoId) {
  const r = await pool.query('SELECT nome, curso FROM csu_alunos WHERE id = $1', [alunoId]);
  const aluno = r.rows[0];
  const chave = chaveCurso(aluno && aluno.curso);
  if (!chave) return null;
  const g = await pool.query(
    `INSERT INTO csu_grupos (chave, nome) VALUES ($1, $2)
     ON CONFLICT (chave) DO UPDATE SET chave = EXCLUDED.chave
     RETURNING id, nome`,
    [chave, String(aluno.curso).replace(/\s+/g, ' ').trim()],
  );
  const grupo = g.rows[0];
  const m = await pool.query(
    `INSERT INTO csu_grupo_membros (grupo_id, aluno_id) VALUES ($1, $2)
     ON CONFLICT (grupo_id, aluno_id) DO UPDATE SET visto_em = now()
     RETURNING silenciado_ate`,
    [grupo.id, alunoId],
  );
  return { id: grupo.id, nome: grupo.nome, silenciado_ate: m.rows[0].silenciado_ate, eu: nomeExibido(aluno.nome) };
}

// Mensagem como o aluno vê: dos outros, só publicada (texto + "Maria S."); as próprias, com status e explicação.
function paraAluno(row, alunoId) {
  const minha = row.aluno_id === alunoId;
  if (row.status !== 'publicada' && !minha) return { id: Number(row.id), oculta: true };
  const out = {
    id: Number(row.id),
    autor: nomeExibido(row.nome),
    minha,
    texto: row.texto,
    criado_em: row.criado_em,
    status: row.status,
  };
  if (minha && row.status !== 'publicada') {
    out.explicacao = row.status === 'removida'
      ? 'A equipe removeu esta mensagem por não seguir as regras do grupo.'
      : row.status === 'retida' ? moderacao.EXPLICACAO.retida : (moderacao.EXPLICACAO[row.categoria] || moderacao.EXPLICACAO.retida);
  }
  if (row.denunciada_por_mim) out.denunciada = true;
  return out;
}

const SELECT_MSG = `SELECT m.id, m.aluno_id, m.texto, m.status, m.categoria, m.criado_em, a.nome,
    EXISTS (SELECT 1 FROM csu_grupo_denuncias d WHERE d.mensagem_id = m.id AND d.aluno_id = $2) AS denunciada_por_mim
  FROM csu_grupo_mensagens m JOIN csu_alunos a ON a.id = m.aluno_id`;

// Primeira carga: últimas 60 publicadas + as minhas não publicadas no mesmo período.
// Depois (?desde=cursor): tudo que mudou no grupo desde o cursor (novas, aprovadas, removidas, ocultadas).
async function listar(pool, grupoId, alunoId, desde) {
  const agora = (await pool.query('SELECT now() AS t')).rows[0].t;
  let rows;
  if (desde) {
    const d = new Date(desde);
    if (Number.isNaN(d.getTime())) return null;
    rows = (await pool.query(
      `${SELECT_MSG} WHERE m.grupo_id = $1 AND m.atualizado_em >= $3::timestamptz - interval '2 seconds'
       ORDER BY m.id LIMIT 200`,
      [grupoId, alunoId, d.toISOString()],
    )).rows;
  } else {
    rows = (await pool.query(
      `${SELECT_MSG} WHERE m.grupo_id = $1 AND (m.status = 'publicada' OR (m.aluno_id = $2 AND m.criado_em > now() - interval '7 days'))
       ORDER BY m.id DESC LIMIT 80`,
      [grupoId, alunoId],
    )).rows.reverse();
  }
  const mensagens = rows.map((x) => paraAluno(x, alunoId));
  return { mensagens: desde ? mensagens : mensagens.filter((x) => !x.oculta), cursor: agora };
}

// ---------- Rotas ----------
function montar(app, deps) {
  const { pool, authMiddleware, requireAdmin, ensureAcompanhamento, enviarIndex } = deps;
  let schemaPronto = null;
  function ensure() {
    if (!schemaPronto) {
      schemaPronto = ensureAcompanhamento().then(() => ensureSchema(pool)).catch((err) => {
        schemaPronto = null;
        throw err;
      });
    }
    return schemaPronto;
  }
  const naoEncontrado = (res) => res.status(404).json({ success: false, message: 'Recurso não encontrado.' });

  // Endereço da tela (a SPA decide o que mostrar; a API é que libera ou não).
  app.get('/grupo', enviarIndex);

  // Aluno: flag desligada ou conta fora da lista → 404 (como se a área não existisse).
  app.use('/api/grupos', (req, res, next) => (ligado() ? next() : naoEncontrado(res)), authMiddleware, (req, res, next) => {
    if (!pool) return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
    return liberadoPara(req.aluno) ? next() : naoEncontrado(res);
  });

  app.get('/api/grupos/meu', async (req, res) => {
    try {
      await ensure();
      const g = await grupoDoAluno(pool, req.aluno.id);
      if (!g) return res.json({ success: true, grupo: null, motivo: 'sem_curso', regras: REGRAS });
      const n = await pool.query('SELECT count(*)::int AS n FROM csu_grupo_membros WHERE grupo_id = $1', [g.id]);
      return res.json({
        success: true,
        grupo: { nome: g.nome, membros: n.rows[0].n },
        eu: { nome: g.eu, silenciado_ate: g.silenciado_ate && new Date(g.silenciado_ate) > new Date() ? g.silenciado_ate : null },
        regras: REGRAS,
        motivos_denuncia: MOTIVOS_DENUNCIA,
        max_texto: MAX_TEXTO,
      });
    } catch (err) {
      console.error('Grupo de estudo: falha ao abrir o grupo:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível abrir o grupo agora.' });
    }
  });

  app.get('/api/grupos/meu/mensagens', async (req, res) => {
    try {
      await ensure();
      const g = await grupoDoAluno(pool, req.aluno.id);
      if (!g) return res.json({ success: true, mensagens: [], cursor: null });
      const r = await listar(pool, g.id, req.aluno.id, req.query.desde);
      if (!r) return res.status(400).json({ success: false, message: 'Cursor inválido.' });
      return res.json({ success: true, ...r });
    } catch (err) {
      console.error('Grupo de estudo: falha ao listar mensagens:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível carregar as mensagens.' });
    }
  });

  app.post('/api/grupos/meu/mensagens', async (req, res) => {
    const texto = String((req.body && req.body.texto) || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!texto) return res.status(400).json({ success: false, message: 'Escreva a mensagem.' });
    if (texto.length > MAX_TEXTO) return res.status(400).json({ success: false, message: `A mensagem pode ter até ${MAX_TEXTO} caracteres.` });
    try {
      await ensure();
      const g = await grupoDoAluno(pool, req.aluno.id);
      if (!g) return res.status(409).json({ success: false, message: 'Seu curso ainda não chegou ao portal, então ainda não há grupo para você.' });
      if (g.silenciado_ate && new Date(g.silenciado_ate) > new Date()) {
        const ate = new Date(g.silenciado_ate).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return res.status(403).json({ success: false, message: `A equipe pausou seus envios no grupo até ${ate}. Você continua podendo ler.` });
      }
      const lim = await pool.query(
        `SELECT count(*) FILTER (WHERE criado_em > now() - interval '1 minute')::int AS minuto,
                count(*) FILTER (WHERE texto = $2 AND criado_em > now() - interval '10 minutes')::int AS repetida
         FROM csu_grupo_mensagens WHERE aluno_id = $1 AND criado_em > now() - interval '10 minutes'`,
        [req.aluno.id, texto],
      );
      if (lim.rows[0].minuto >= MAX_POR_MINUTO) return res.status(429).json({ success: false, message: 'Calma! Espere um minutinho antes de mandar mais mensagens.' });
      if (lim.rows[0].repetida > 0) return res.status(409).json({ success: false, message: 'Você já enviou essa mensagem há pouco.' });

      const d = await moderacao.moderar(texto, { log: (m) => console.warn('Grupo de estudo:', m) });
      const ins = await pool.query(
        `INSERT INTO csu_grupo_mensagens (grupo_id, aluno_id, texto, status, categoria, confianca, motivo, moderador, sinais, revisar, publicada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $4 = 'publicada' THEN now() END)
         RETURNING id, aluno_id, texto, status, categoria, criado_em`,
        [g.id, req.aluno.id, texto, d.status, d.categoria || 'ok', d.confianca, d.motivo, d.moderador, d.sinais || [], d.revisar],
      );
      const row = { ...ins.rows[0], nome: (await pool.query('SELECT nome FROM csu_alunos WHERE id = $1', [req.aluno.id])).rows[0].nome };
      if (d.status !== 'publicada' || d.moderador === 'fallback') {
        await evento(pool, req.aluno.id, 'grupo_mensagem_moderada', {
          mensagem_id: Number(row.id), status: d.status, categoria: d.categoria, origem: d.moderador, revisar: d.revisar,
        });
      }
      return res.json({ success: true, mensagem: paraAluno(row, req.aluno.id) });
    } catch (err) {
      console.error('Grupo de estudo: falha ao enviar mensagem:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível enviar agora. Tente de novo.' });
    }
  });

  app.post('/api/grupos/mensagens/:id/denuncia', async (req, res) => {
    const id = Number(req.params.id);
    const motivo = String((req.body && req.body.motivo) || '');
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'Mensagem inválida.' });
    if (!MOTIVOS_DENUNCIA[motivo]) return res.status(400).json({ success: false, message: 'Escolha o motivo.' });
    try {
      await ensure();
      const g = await grupoDoAluno(pool, req.aluno.id);
      const m = g && (await pool.query(`SELECT id, aluno_id, status FROM csu_grupo_mensagens WHERE id = $1 AND grupo_id = $2`, [id, g.id])).rows[0];
      if (!m || m.status !== 'publicada') return res.status(404).json({ success: false, message: 'Mensagem não encontrada.' });
      if (m.aluno_id === req.aluno.id) return res.status(400).json({ success: false, message: 'Não dá para denunciar a própria mensagem.' });
      const ins = await pool.query(
        `INSERT INTO csu_grupo_denuncias (mensagem_id, aluno_id, motivo) VALUES ($1, $2, $3)
         ON CONFLICT (mensagem_id, aluno_id) DO NOTHING RETURNING id`,
        [id, req.aluno.id, motivo],
      );
      let ocultada = false;
      if (ins.rowCount) {
        const up = await pool.query(
          `UPDATE csu_grupo_mensagens SET denuncias = denuncias + 1,
             status = CASE WHEN denuncias + 1 >= $2 THEN 'retida' ELSE status END,
             revisar = CASE WHEN denuncias + 1 >= $2 THEN TRUE ELSE revisar END,
             atualizado_em = CASE WHEN denuncias + 1 >= $2 THEN now() ELSE atualizado_em END
           WHERE id = $1 RETURNING status`,
          [id, DENUNCIAS_PARA_OCULTAR],
        );
        ocultada = up.rows[0].status === 'retida';
        await evento(pool, m.aluno_id, 'grupo_moderacao', { acao: 'denuncia', mensagem_id: id, motivo, origem: 'denuncia', ocultada });
      }
      return res.json({ success: true, message: 'Obrigado! A equipe vai olhar essa mensagem.' });
    } catch (err) {
      console.error('Grupo de estudo: falha ao denunciar:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível registrar a denúncia agora.' });
    }
  });

  // ---------- Admin: fila de moderação ----------
  app.use('/api/admin/grupos', (req, res, next) => (ligado() ? next() : naoEncontrado(res)), requireAdmin, (req, res, next) => {
    if (!pool) return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
    return next();
  });

  const SELECT_ADMIN = `SELECT m.id, m.texto, m.status, m.categoria, m.confianca, m.motivo, m.moderador, m.sinais, m.revisar,
      m.denuncias, m.criado_em, m.revisado_em, m.aluno_id, a.nome, a.rgm, g.nome AS grupo,
      mem.silenciado_ate,
      (SELECT json_agg(json_build_object('motivo', d.motivo, 'em', d.criado_em) ORDER BY d.criado_em)
         FROM csu_grupo_denuncias d WHERE d.mensagem_id = m.id AND d.resolvida_em IS NULL) AS denuncias_abertas
    FROM csu_grupo_mensagens m
    JOIN csu_alunos a ON a.id = m.aluno_id
    JOIN csu_grupos g ON g.id = m.grupo_id
    LEFT JOIN csu_grupo_membros mem ON mem.grupo_id = m.grupo_id AND mem.aluno_id = m.aluno_id`;

  app.get('/api/admin/grupos/fila', async (req, res) => {
    try {
      await ensure();
      const [pendentes, denunciadas, bloqueadas, semIa, resumo] = await Promise.all([
        pool.query(`${SELECT_ADMIN} WHERE m.status = 'retida' OR (m.status = 'bloqueada' AND m.revisar) ORDER BY m.criado_em LIMIT 100`),
        pool.query(`${SELECT_ADMIN} WHERE m.status = 'publicada' AND EXISTS (SELECT 1 FROM csu_grupo_denuncias d WHERE d.mensagem_id = m.id AND d.resolvida_em IS NULL) ORDER BY m.denuncias DESC, m.criado_em LIMIT 100`),
        pool.query(`${SELECT_ADMIN} WHERE m.status = 'bloqueada' AND NOT m.revisar AND m.criado_em > now() - interval '7 days' ORDER BY m.criado_em DESC LIMIT 30`),
        pool.query(`${SELECT_ADMIN} WHERE m.status = 'publicada' AND m.moderador = 'fallback' AND m.revisado_em IS NULL AND m.criado_em > now() - interval '7 days' ORDER BY m.criado_em DESC LIMIT 30`),
        pool.query(`SELECT count(DISTINCT g.id)::int AS grupos,
            count(m.id) FILTER (WHERE m.criado_em > now() - interval '7 days')::int AS mensagens_7d,
            count(m.id) FILTER (WHERE m.criado_em > now() - interval '7 days' AND m.status = 'bloqueada')::int AS bloqueadas_7d
          FROM csu_grupos g LEFT JOIN csu_grupo_mensagens m ON m.grupo_id = g.id`),
      ]);
      const prov = moderacao.provedor();
      const ids = (rows) => rows.map((x) => ({ ...x, id: Number(x.id) })); // BIGSERIAL vem como texto do pg
      return res.json({
        success: true,
        pendentes: ids(pendentes.rows),
        denunciadas: ids(denunciadas.rows),
        bloqueadas: ids(bloqueadas.rows),
        sem_ia: ids(semIa.rows),
        resumo: resumo.rows[0],
        provedor: prov.nome,
        provedor_aviso: prov.aviso || null,
        motivos_denuncia: MOTIVOS_DENUNCIA,
      });
    } catch (err) {
      console.error('Grupo de estudo: falha ao carregar a fila:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível carregar a fila de moderação.' });
    }
  });

  const ACOES = ['publicar', 'remover', 'manter_bloqueada', 'descartar_denuncias', 'silenciar', 'conferida'];
  app.post('/api/admin/grupos/mensagens/:id/acao', async (req, res) => {
    const id = Number(req.params.id);
    const acao = String((req.body && req.body.acao) || '');
    const horas = Number(req.body && req.body.horas) === 168 ? 168 : 24;
    if (!Number.isSafeInteger(id) || id <= 0 || !ACOES.includes(acao)) return res.status(400).json({ success: false, message: 'Ação inválida.' });
    const adminId = req.admin && req.admin.id;
    try {
      await ensure();
      const m = (await pool.query('SELECT id, grupo_id, aluno_id, status, categoria FROM csu_grupo_mensagens WHERE id = $1', [id])).rows[0];
      if (!m) return res.status(404).json({ success: false, message: 'Mensagem não encontrada.' });
      const resolverDenuncias = () => pool.query('UPDATE csu_grupo_denuncias SET resolvida_em = now() WHERE mensagem_id = $1 AND resolvida_em IS NULL', [id]);
      const revisada = `revisar = FALSE, revisado_em = now(), revisado_por = $2, atualizado_em = now()`;
      if (acao === 'publicar') {
        await pool.query(`UPDATE csu_grupo_mensagens SET status = 'publicada', publicada_em = COALESCE(publicada_em, now()), denuncias = 0, ${revisada} WHERE id = $1`, [id, adminId]);
        await resolverDenuncias();
      } else if (acao === 'remover') {
        await pool.query(`UPDATE csu_grupo_mensagens SET status = 'removida', ${revisada} WHERE id = $1`, [id, adminId]);
        await resolverDenuncias();
      } else if (acao === 'manter_bloqueada') {
        await pool.query(`UPDATE csu_grupo_mensagens SET status = 'bloqueada', ${revisada} WHERE id = $1`, [id, adminId]);
      } else if (acao === 'descartar_denuncias') {
        await pool.query(`UPDATE csu_grupo_mensagens SET denuncias = 0,
            status = CASE WHEN status = 'retida' AND publicada_em IS NOT NULL THEN 'publicada' ELSE status END, ${revisada} WHERE id = $1`, [id, adminId]);
        await resolverDenuncias();
      } else if (acao === 'conferida') {
        await pool.query(`UPDATE csu_grupo_mensagens SET revisado_em = now(), revisado_por = $2 WHERE id = $1`, [id, adminId]);
      } else if (acao === 'silenciar') {
        await pool.query(
          `UPDATE csu_grupo_membros SET silenciado_ate = now() + ($3::int * interval '1 hour') WHERE grupo_id = $1 AND aluno_id = $2`,
          [m.grupo_id, m.aluno_id, horas],
        );
        if (req.body && req.body.remover && m.status !== 'removida') {
          await pool.query(`UPDATE csu_grupo_mensagens SET status = 'removida', ${revisada} WHERE id = $1`, [id, adminId]);
          await resolverDenuncias();
        }
      }
      await evento(pool, m.aluno_id, 'grupo_moderacao', {
        acao, mensagem_id: id, categoria: m.categoria, status_antes: m.status, admin_id: adminId || null, origem: 'humano',
        ...(acao === 'silenciar' ? { horas, removida: Boolean(req.body && req.body.remover) } : {}),
      });
      return res.json({ success: true });
    } catch (err) {
      console.error('Grupo de estudo: falha na ação de moderação:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível salvar a decisão.' });
    }
  });
}

module.exports = { montar, liberadoPara, ligado, nomeExibido, chaveCurso, ensureSchema };
