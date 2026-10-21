'use strict';

// Avaliação "joinha pra cima / pra baixo" dos conteúdos da Central de ajuda e da Aula Inaugural.
// Um voto por aluno (RGM) por conteúdo: upsert; voto 0 apaga. Grava o RGM e, só no 👎, um comentário
// opcional do aluno ("o que não ficou bom"). Trocar o voto para 👍 ou desfazer apaga o comentário.
// O admin vê o placar por conteúdo (mais negativos primeiro) e os comentários, sem o RGM.
//
// Contrato:
//   POST /api/avaliacoes {tipo, id, voto}                -> 200 {ok:true, voto} | 400 {error:'invalido'}
//   POST /api/avaliacoes/comentario {tipo, id, comentario} -> 200 {ok:true} | 400 invalido | 409 {error:'sem_voto_negativo'}
//   GET  /api/avaliacoes/minhas            -> {votos: {"video:tut_11": 1, ...}, comentarios: {"aula:modulo-4": "texto"}}
//   GET  /api/avaliacoes/totais?tipo=video -> {totais: {"tut_11": 3, ...}}  (só 👍; público p/ aluno logado)
//   GET  /api/admin/avaliacoes             -> {itens: [{tipo,id,titulo,positivos,negativos,total,pct_positivo,ultimo_voto_em,comentarios:[{texto,em}]}]}

const fs = require('node:fs');
const path = require('node:path');

const TIPOS = new Set(['video', 'faq', 'aula']);
const ID_VALIDO = /^[\w:-]{1,80}$/;
const LIMITE_POR_MINUTO = 60;

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS csu_avaliacoes (
      rgm TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('video', 'faq', 'aula')),
      conteudo_id TEXT NOT NULL,
      voto SMALLINT NOT NULL CHECK (voto IN (1, -1)),
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (rgm, tipo, conteudo_id)
    );
    CREATE INDEX IF NOT EXISTS idx_csu_avaliacoes_conteudo ON csu_avaliacoes (tipo, conteudo_id);
    ALTER TABLE csu_avaliacoes ADD COLUMN IF NOT EXISTS comentario TEXT;
    ALTER TABLE csu_avaliacoes ADD COLUMN IF NOT EXISTS comentario_em TIMESTAMPTZ;
  `);
}

// ---------- validação ----------

function rgmDe(aluno) {
  const rgm = String((aluno && aluno.rgm) || '').trim();
  // Acesso em preparação (sem RGM): o voto fica guardado pela conta até o RGM chegar.
  if (!rgm && aluno && aluno.id) return `sem-rgm-${aluno.id}`;
  return rgm && rgm.length <= 40 ? rgm : null;
}

function lerVoto(v) {
  if (typeof v === 'string' && /^-?[01]$/.test(v.trim())) v = Number(v);
  return v === 1 || v === -1 || v === 0 ? v : null;
}

function validar(body) {
  const tipo = body && typeof body.tipo === 'string' ? body.tipo : '';
  const id = body && typeof body.id === 'string' ? body.id : '';
  const voto = lerVoto(body && body.voto);
  if (!TIPOS.has(tipo) || !ID_VALIDO.test(id) || voto === null) return null;
  return { tipo, id, voto };
}

const COMENTARIO_MAX = 500;
// Texto livre do aluno: sem caracteres de controle (mantém quebra de linha), espaços aparados, 1 a 500 caracteres.
function validarComentario(body) {
  const tipo = body && typeof body.tipo === 'string' ? body.tipo : '';
  const id = body && typeof body.id === 'string' ? body.id : '';
  const bruto = body && typeof body.comentario === 'string' ? body.comentario : '';
  // eslint-disable-next-line no-control-regex
  const comentario = bruto.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!TIPOS.has(tipo) || !ID_VALIDO.test(id) || !comentario || comentario.length > COMENTARIO_MAX) return null;
  return { tipo, id, comentario };
}

// Limite simples em memória por aluno (o projeto não tem utilitário de rate-limit).
const janelas = new Map();
function dentroDoLimite(rgm) {
  const agora = Date.now();
  const j = janelas.get(rgm);
  if (!j || j.reinicia <= agora) {
    if (janelas.size > 5000) {
      janelas.forEach((x, k) => { if (x.reinicia <= agora) janelas.delete(k); });
    }
    janelas.set(rgm, { n: 1, reinicia: agora + 60000 });
    return true;
  }
  j.n += 1;
  return j.n <= LIMITE_POR_MINUTO;
}

// ---------- queries ----------

async function votar(pool, rgm, { tipo, id, voto }) {
  if (voto === 0) {
    await pool.query('DELETE FROM csu_avaliacoes WHERE rgm = $1 AND tipo = $2 AND conteudo_id = $3', [rgm, tipo, id]);
    return 0;
  }
  await pool.query(
    `INSERT INTO csu_avaliacoes (rgm, tipo, conteudo_id, voto)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (rgm, tipo, conteudo_id) DO UPDATE SET
       voto = EXCLUDED.voto,
       comentario = CASE WHEN EXCLUDED.voto = -1 THEN csu_avaliacoes.comentario END,
       comentario_em = CASE WHEN EXCLUDED.voto = -1 THEN csu_avaliacoes.comentario_em END,
       atualizado_em = now()`,
    [rgm, tipo, id, voto],
  );
  return voto;
}

// O comentário só vale para um 👎 já gravado. Devolve false quando não há 👎 desse aluno no conteúdo.
async function comentar(pool, rgm, { tipo, id, comentario }) {
  const r = await pool.query(
    `UPDATE csu_avaliacoes SET comentario = $4, comentario_em = now()
     WHERE rgm = $1 AND tipo = $2 AND conteudo_id = $3 AND voto = -1`,
    [rgm, tipo, id, comentario],
  );
  return r.rowCount > 0;
}

async function minhas(pool, rgm) {
  const r = await pool.query('SELECT tipo, conteudo_id, voto, comentario FROM csu_avaliacoes WHERE rgm = $1', [rgm]);
  const votos = {};
  const comentarios = {};
  r.rows.forEach((x) => {
    const k = x.tipo + ':' + x.conteudo_id;
    votos[k] = Number(x.voto);
    if (x.comentario) comentarios[k] = x.comentario;
  });
  return { votos, comentarios };
}

// Só positivos por conteúdo, sem rgm nem negativos (a Central mostra na capa e ordena por likes).
// Cache de 60 s por tipo; um voto novo daquele tipo limpa o cache.
const CACHE_TOTAIS_MS = 60000;
const cacheTotais = new Map();

async function totaisPositivos(pool, tipo) {
  const c = cacheTotais.get(tipo);
  if (c && Date.now() - c.em < CACHE_TOTAIS_MS) return c.totais;
  const r = await pool.query(
    `SELECT conteudo_id, count(*)::int AS n FROM csu_avaliacoes
     WHERE tipo = $1 AND voto = 1 GROUP BY conteudo_id`,
    [tipo],
  );
  const totais = {};
  r.rows.forEach((x) => { totais[x.conteudo_id] = x.n; });
  cacheTotais.set(tipo, { em: Date.now(), totais });
  return totais;
}

async function placar(pool) {
  const r = await pool.query(`
    SELECT tipo, conteudo_id,
           count(*) FILTER (WHERE voto = 1)::int AS positivos,
           count(*) FILTER (WHERE voto = -1)::int AS negativos,
           count(*)::int AS total,
           max(atualizado_em) AS ultimo_voto_em
    FROM csu_avaliacoes
    GROUP BY tipo, conteudo_id
  `);
  // Comentários dos 👎, mais novos primeiro, sem o RGM (até 50 por conteúdo).
  const c = await pool.query(`
    SELECT tipo, conteudo_id, comentario, comentario_em FROM (
      SELECT tipo, conteudo_id, comentario, comentario_em,
             row_number() OVER (PARTITION BY tipo, conteudo_id ORDER BY comentario_em DESC) AS n
      FROM csu_avaliacoes WHERE voto = -1 AND comentario IS NOT NULL
    ) t WHERE n <= 50 ORDER BY comentario_em DESC
  `);
  const comentarios = new Map();
  c.rows.forEach((x) => {
    const k = x.tipo + ':' + x.conteudo_id;
    if (!comentarios.has(k)) comentarios.set(k, []);
    comentarios.get(k).push({ texto: x.comentario, em: x.comentario_em });
  });
  const titulos = carregarTitulos();
  return r.rows
    .map((x) => ({
      comentarios: comentarios.get(x.tipo + ':' + x.conteudo_id) || [],
      tipo: x.tipo,
      id: x.conteudo_id,
      titulo: tituloDe(titulos, x.tipo, x.conteudo_id),
      positivos: x.positivos,
      negativos: x.negativos,
      total: x.total,
      pct_positivo: x.total ? Math.round((100 * x.positivos) / x.total) : 0,
      ultimo_voto_em: x.ultimo_voto_em,
    }))
    .sort((a, b) => b.negativos - a.negativos
      || a.pct_positivo - b.pct_positivo
      || b.total - a.total
      || new Date(b.ultimo_voto_em) - new Date(a.ultimo_voto_em));
}

// ---------- títulos (dos JSONs de conteúdo; senão o próprio id) ----------

const ASSETS = path.join(__dirname, 'assets');
let cacheTitulos = null;
let cacheEm = 0;

function lerJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ASSETS, rel), 'utf8'));
  } catch (err) {
    return null;
  }
}

// Relido no máximo a cada 5 min (os JSONs mudam por commit; não precisa reiniciar para o admin ver).
function carregarTitulos() {
  if (cacheTitulos && Date.now() - cacheEm < 5 * 60000) return cacheTitulos;
  const videos = new Map();
  const faq = new Map();
  const capitulos = [];
  const modulos = [];
  const v = lerJson('central/videos.json');
  ((v && v.videos) || []).forEach((x) => { if (x && x.id) videos.set(String(x.id), x.titulo || x.id); });
  const f = lerJson('central/faq.json');
  ((f && f.grupos) || []).forEach((g) => {
    if (g && g.id) faq.set(String(g.id), 'Assunto: ' + (g.titulo || g.id));
    ((g && g.perguntas) || []).forEach((p) => { if (p && p.id) faq.set(String(p.id), p.q || p.id); });
  });
  const a = lerJson('central/aula-inaugural.json');
  ((a && a.capitulos) || []).forEach((c, i) => { capitulos[i] = c && c.titulo; });
  const t = lerJson('trilha.json');
  ((t && t.niveis) || []).forEach((n, i) => { modulos[i + 1] = n && n.t; });
  cacheTitulos = { videos, faq, capitulos, modulos };
  cacheEm = Date.now();
  return cacheTitulos;
}

function tituloDe(t, tipo, id) {
  let m = /^aula-cap-(\d+)$/.exec(id);
  if (m && t.capitulos[Number(m[1])]) return 'Aula Inaugural · ' + t.capitulos[Number(m[1])];
  m = /^modulo-(\d+)$/.exec(id);
  if (m && t.modulos[Number(m[1])]) return 'Módulo ' + m[1] + ' · ' + t.modulos[Number(m[1])];
  if (id === 'boasvindas') return 'Aula Inaugural · Boas-vindas (abertura)';
  if (tipo === 'video' && t.videos.has(id)) return t.videos.get(id);
  if (tipo === 'faq' && t.faq.has(id)) return t.faq.get(id);
  return t.videos.get(id) || t.faq.get(id) || id;
}

// ---------- rotas ----------

function registrarRotas(app, { getPool, authMiddleware, requireAdmin }) {
  let schemaPronto = null;
  function garantir(pool) {
    if (!schemaPronto) {
      schemaPronto = ensureSchema(pool).catch((err) => { schemaPronto = null; throw err; });
    }
    return schemaPronto;
  }
  const semBanco = (res) => res.status(503).json({ error: 'indisponivel' });

  app.post('/api/avaliacoes', authMiddleware, async (req, res) => {
    const pool = getPool();
    if (!pool) return semBanco(res);
    const rgm = rgmDe(req.aluno);
    const dados = validar(req.body);
    if (!rgm || !dados) return res.status(400).json({ error: 'invalido' });
    if (!dentroDoLimite(rgm)) return res.status(429).json({ error: 'limite' });
    try {
      await garantir(pool);
      const voto = await votar(pool, rgm, dados);
      cacheTotais.delete(dados.tipo);
      return res.json({ ok: true, voto });
    } catch (err) {
      console.error('Falha ao gravar avaliação:', err.message);
      return res.status(500).json({ error: 'interno' });
    }
  });

  app.post('/api/avaliacoes/comentario', authMiddleware, async (req, res) => {
    const pool = getPool();
    if (!pool) return semBanco(res);
    const rgm = rgmDe(req.aluno);
    const dados = validarComentario(req.body);
    if (!rgm || !dados) return res.status(400).json({ error: 'invalido' });
    if (!dentroDoLimite(rgm)) return res.status(429).json({ error: 'limite' });
    try {
      await garantir(pool);
      if (!(await comentar(pool, rgm, dados))) return res.status(409).json({ error: 'sem_voto_negativo' });
      return res.json({ ok: true });
    } catch (err) {
      console.error('Falha ao gravar comentário da avaliação:', err.message);
      return res.status(500).json({ error: 'interno' });
    }
  });

  app.get('/api/avaliacoes/minhas', authMiddleware, async (req, res) => {
    const pool = getPool();
    if (!pool) return semBanco(res);
    const rgm = rgmDe(req.aluno);
    if (!rgm) return res.json({ votos: {} });
    try {
      await garantir(pool);
      return res.json(await minhas(pool, rgm));
    } catch (err) {
      console.error('Falha ao ler avaliações do aluno:', err.message);
      return res.status(500).json({ error: 'interno' });
    }
  });

  app.get('/api/avaliacoes/totais', authMiddleware, async (req, res) => {
    const tipo = typeof req.query.tipo === 'string' ? req.query.tipo : '';
    if (!TIPOS.has(tipo)) return res.status(400).json({ error: 'invalido' });
    const pool = getPool();
    if (!pool) return res.json({ totais: {} });
    try {
      await garantir(pool);
      return res.json({ totais: await totaisPositivos(pool, tipo) });
    } catch (err) {
      if (err.code === '42P01') return res.json({ totais: {} });
      console.error('Falha nos totais de avaliações:', err.message);
      return res.status(500).json({ error: 'interno' });
    }
  });

  app.get('/api/admin/avaliacoes', requireAdmin, async (req, res) => {
    const pool = getPool();
    if (!pool) return semBanco(res);
    try {
      await garantir(pool);
      return res.json({ itens: await placar(pool) });
    } catch (err) {
      console.error('Falha no placar de avaliações:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível carregar as avaliações.' });
    }
  });

  // Corpo que não é JSON (o express.json global falha antes da rota): mantém o contrato do 400.
  app.use('/api/avaliacoes', (err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
      return res.status(400).json({ error: 'invalido' });
    }
    return next(err);
  });
}

module.exports = { ensureSchema, registrarRotas, validar, validarComentario, tituloDe, carregarTitulos };
