'use strict';

const youtube = require('./youtube');

const CATEGORIAS = [
  'Primeiros passos',
  'Área do Aluno',
  'Blackboard',
  'Provas',
  'Atividades',
  'Financeiro',
  'Documentos',
];

const SEED = [
  ['Como acessar a Área do Aluno', 'Primeiro acesso ao portal: login, senha e telas iniciais.', 'Área do Aluno', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', '4:20', 1],
  ['Primeiros passos', 'O que fazer no primeiro dia: cadastro, certificado e atalhos do dashboard.', 'Primeiros passos', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', '5:10', 2],
  ['Como acessar Blackboard', 'Entrar no AVA, localizar disciplinas e materiais.', 'Blackboard', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', '6:00', 3],
  ['Como realizar provas', 'Onde encontrar avaliações, prazos e regras de envio.', 'Provas', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', '4:45', 4],
  ['Como acessar atividades', 'Abrir, responder e enviar atividades no ambiente virtual.', 'Atividades', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', '3:50', 5],
  ['Como consultar notas', 'Acompanhar notas e feedbacks no Blackboard.', 'Blackboard', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', '3:15', 6],
  ['Como emitir boleto', 'Gerar boleto e conferir vencimentos no financeiro.', 'Financeiro', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', '4:05', 7],
  ['Como enviar documentos', 'Anexar documentos solicitados pela secretaria.', 'Documentos', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', '3:40', 8],
  ['Como abrir solicitações', 'Abrir protocolos e acompanhar o andamento.', 'Área do Aluno', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', '4:30', 9],
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
  return result.rows.map(youtube.publicTutorial);
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

async function seedIfEmpty(pool) {
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM csu_tutoriais');
  if (count.rows[0].n > 0) return false;
  for (const item of SEED) {
    const [titulo, descricao, categoria, videoUrl, duracao, ordem] = item;
    await pool.query(
      `INSERT INTO csu_tutoriais (titulo, descricao, categoria, video_url, duracao, ativo, ordem)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
      [titulo, descricao, categoria, videoUrl, duracao, ordem],
    );
  }
  console.log('Tutoriais de exemplo criados em csu_tutoriais.');
  return true;
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
  seedIfEmpty,
};
