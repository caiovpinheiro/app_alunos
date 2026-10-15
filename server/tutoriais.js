'use strict';

const youtube = require('./youtube');
const { guiaTrilha } = require('./trilha');

const CATEGORIAS = [
  'Primeiros passos',
  'Área do Aluno',
  'Blackboard',
  'Provas',
  'Atividades',
  'Financeiro',
  'Documentos',
];

// Tutoriais de exemplo que vinham no boot (todos com o mesmo vídeo de teste).
// A trilha EaD para Iniciantes substituiu esse conteúdo; eles são desligados no boot, não apagados.
const EXEMPLO_VIDEO_URL = 'https://www.youtube.com/watch?v=M7lc1UVf-VE';
const EXEMPLO_TITULOS = [
  'Como acessar a Área do Aluno',
  'Primeiros passos',
  'Como acessar Blackboard',
  'Como realizar provas',
  'Como acessar atividades',
  'Como consultar notas',
  'Como emitir boleto',
  'Como enviar documentos',
  'Como abrir solicitações',
];

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function validatePayload(body, { partial = false } = {}) {
  const errors = {};
  const titulo = normalizeText(body.titulo);
  const descricao = normalizeText(body.descricao);
  const categoria = normalizeText(body.categoria);
  const videoUrl = normalizeText(body.video_url);
  const thumbnailUrl = normalizeText(body.thumbnail_url);
  const duracao = normalizeText(body.duracao);
  const ordemRaw = body.ordem;
  const ativo = body.ativo === undefined ? true : Boolean(body.ativo);

  if (!partial || body.titulo !== undefined) {
    if (!titulo) errors.titulo = 'Título é obrigatório.';
  }
  if (!partial || body.descricao !== undefined) {
    if (!descricao) errors.descricao = 'Descrição é obrigatória.';
  }
  if (!partial || body.categoria !== undefined) {
    if (!CATEGORIAS.includes(categoria)) errors.categoria = 'Categoria inválida.';
  }
  if (!partial || body.video_url !== undefined) {
    if (!youtube.extractYoutubeId(videoUrl)) errors.video_url = 'Informe uma URL válida do YouTube.';
  }
  let ordem = 0;
  if (!partial || body.ordem !== undefined) {
    ordem = Number(ordemRaw);
    if (!Number.isInteger(ordem)) errors.ordem = 'Ordem inválida.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    sanitized: {
      titulo,
      descricao,
      categoria,
      video_url: videoUrl,
      thumbnail_url: thumbnailUrl || null,
      duracao: duracao || null,
      ordem,
      ativo,
    },
  };
}

async function listPublic(pool) {
  const result = await pool.query(
    `SELECT id, titulo, descricao, categoria, video_url, thumbnail_url, duracao, ativo, ordem
     FROM csu_tutoriais
     WHERE ativo = TRUE
     ORDER BY ordem ASC, id ASC`,
  );
  return result.rows.map((row) => ({ ...youtube.publicTutorial(row), trilha: guiaTrilha(row.categoria) }));
}

async function listAll(pool) {
  const result = await pool.query(
    `SELECT id, titulo, descricao, categoria, video_url, thumbnail_url, duracao, ativo, ordem, created_at
     FROM csu_tutoriais
     ORDER BY ordem ASC, id ASC`,
  );
  return result.rows.map(youtube.publicTutorial);
}

async function getPublicById(pool, id) {
  const result = await pool.query(
    `SELECT id, titulo, descricao, categoria, video_url, thumbnail_url, duracao, ativo, ordem
     FROM csu_tutoriais
     WHERE id = $1 AND ativo = TRUE
     LIMIT 1`,
    [id],
  );
  return result.rows[0] ? youtube.publicTutorial(result.rows[0]) : null;
}

async function create(pool, data) {
  const result = await pool.query(
    `INSERT INTO csu_tutoriais
      (titulo, descricao, categoria, video_url, thumbnail_url, duracao, ativo, ordem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, titulo, descricao, categoria, video_url, thumbnail_url, duracao, ativo, ordem`,
    [data.titulo, data.descricao, data.categoria, data.video_url, data.thumbnail_url, data.duracao, data.ativo, data.ordem],
  );
  return youtube.publicTutorial(result.rows[0]);
}

async function update(pool, id, data) {
  const result = await pool.query(
    `UPDATE csu_tutoriais SET
        titulo = $2,
        descricao = $3,
        categoria = $4,
        video_url = $5,
        thumbnail_url = $6,
        duracao = $7,
        ativo = $8,
        ordem = $9
     WHERE id = $1
     RETURNING id, titulo, descricao, categoria, video_url, thumbnail_url, duracao, ativo, ordem`,
    [id, data.titulo, data.descricao, data.categoria, data.video_url, data.thumbnail_url, data.duracao, data.ativo, data.ordem],
  );
  return result.rows[0] ? youtube.publicTutorial(result.rows[0]) : null;
}

async function setAtivo(pool, id, ativo) {
  const result = await pool.query(
    `UPDATE csu_tutoriais SET ativo = $2 WHERE id = $1
     RETURNING id, titulo, descricao, categoria, video_url, thumbnail_url, duracao, ativo, ordem`,
    [id, ativo],
  );
  return result.rows[0] ? youtube.publicTutorial(result.rows[0]) : null;
}

async function remove(pool, id) {
  const result = await pool.query('DELETE FROM csu_tutoriais WHERE id = $1 RETURNING id', [id]);
  return Boolean(result.rows[0]);
}

// Desliga (ativo = FALSE) os tutoriais de exemplo ainda no ar. Só mexe em linhas com o
// título E o vídeo de teste originais: tutorial editado pelo admin com vídeo real fica intacto.
async function retirarExemplos(pool) {
  const result = await pool.query(
    `UPDATE csu_tutoriais SET ativo = FALSE
     WHERE ativo = TRUE AND video_url = $1 AND titulo = ANY($2::text[])
     RETURNING id`,
    [EXEMPLO_VIDEO_URL, EXEMPLO_TITULOS],
  );
  if (result.rowCount) console.log(`Tutoriais de exemplo desligados: ${result.rowCount}.`);
  return result.rowCount;
}

module.exports = {
  CATEGORIAS,
  validatePayload,
  listPublic,
  listAll,
  getPublicById,
  create,
  update,
  setAtivo,
  remove,
  retirarExemplos,
};
