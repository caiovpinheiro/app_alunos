'use strict';

function todayPartsSaoPaulo(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  const iso = `${get('year')}-${get('month')}-${get('day')}`;
  return { iso, day: Number(get('day')) };
}

async function getAlunoAlvo(pool, alunoId) {
  const result = await pool.query(
    `SELECT curso, unidade
     FROM csu_certificados
     WHERE aluno_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [alunoId],
  );
  const row = result.rows[0];
  return {
    curso: row ? String(row.curso || '').trim() || null : null,
    polo: row ? String(row.unidade || '').trim() || null : null,
  };
}

function visibilitySql() {
  return `
    a.ativo = TRUE
    AND a.data_inicio <= $2::date
    AND a.data_fim >= $2::date
    AND (
      a.publico = 'todos'
      OR (a.publico = 'polo' AND $4::text IS NOT NULL AND lower(a.polo) = lower($4))
      OR (a.publico = 'curso' AND $5::text IS NOT NULL AND lower(a.curso) = lower($5))
    )
    AND (
      a.recorrente = FALSE
      OR (
        a.dia_recorrente IS NOT NULL
        AND $3::int BETWEEN GREATEST(1, a.dia_recorrente - 7) AND a.dia_recorrente
      )
    )
  `;
}

async function listAvisosForAluno(pool, alunoId) {
  const { iso, day } = todayPartsSaoPaulo();
  const alvo = await getAlunoAlvo(pool, alunoId);
  const result = await pool.query(
    `SELECT
        a.id,
        a.titulo,
        a.descricao,
        a.categoria,
        a.prioridade,
        a.data_inicio,
        a.data_fim,
        a.publico,
        a.polo,
        a.curso,
        a.recorrente,
        a.dia_recorrente,
        (l.aviso_id IS NOT NULL) AS lida
     FROM csu_avisos a
     LEFT JOIN csu_aviso_leituras l
       ON l.aviso_id = a.id AND l.aluno_id = $1
     WHERE ${visibilitySql()}
     ORDER BY
       CASE a.prioridade WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
       a.data_fim ASC,
       a.id DESC`,
    [alunoId, iso, day, alvo.polo, alvo.curso],
  );
  return result.rows.map(mapAviso);
}

function mapAviso(row) {
  return {
    id: row.id,
    titulo: row.titulo,
    descricao: row.descricao,
    categoria: row.categoria,
    prioridade: row.prioridade,
    data_inicio: row.data_inicio,
    data_fim: row.data_fim,
    publico: row.publico,
    polo: row.polo,
    curso: row.curso,
    recorrente: row.recorrente,
    dia_recorrente: row.dia_recorrente,
    lida: Boolean(row.lida),
  };
}

async function countUnread(pool, alunoId) {
  const { iso, day } = todayPartsSaoPaulo();
  const alvo = await getAlunoAlvo(pool, alunoId);
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM csu_avisos a
     LEFT JOIN csu_aviso_leituras l
       ON l.aviso_id = a.id AND l.aluno_id = $1
     WHERE ${visibilitySql()}
       AND l.aviso_id IS NULL`,
    [alunoId, iso, day, alvo.polo, alvo.curso],
  );
  return result.rows[0].n;
}

async function markRead(pool, alunoId, avisoId) {
  const avisos = await listAvisosForAluno(pool, alunoId);
  const visible = avisos.some((item) => Number(item.id) === Number(avisoId));
  if (!visible) return false;
  await pool.query(
    `INSERT INTO csu_aviso_leituras (aviso_id, aluno_id)
     VALUES ($1, $2)
     ON CONFLICT (aviso_id, aluno_id) DO NOTHING`,
    [avisoId, alunoId],
  );
  return true;
}

const CATEGORIAS_AVISO = ['Geral', 'Acadêmico', 'Financeiro', 'Provas', 'Atividades'];
const PRIORIDADES = ['baixa', 'media', 'alta'];
const PUBLICOS = ['todos', 'polo', 'curso'];

function isoDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function validateAdminAviso(body) {
  const errors = {};
  const titulo = String(body.titulo ?? '').replace(/\s+/g, ' ').trim();
  const descricao = String(body.descricao ?? '').replace(/\s+/g, ' ').trim();
  const categoria = String(body.categoria ?? '').trim();
  const prioridade = String(body.prioridade ?? '').trim();
  const dataInicio = isoDate(body.data_inicio);
  const dataFim = isoDate(body.data_fim);
  const publico = String(body.publico ?? 'todos').trim();
  const polo = String(body.polo ?? '').replace(/\s+/g, ' ').trim() || null;
  const curso = String(body.curso ?? '').replace(/\s+/g, ' ').trim() || null;
  const recorrente = Boolean(body.recorrente);
  const dia = body.dia_recorrente === '' || body.dia_recorrente == null ? null : Number(body.dia_recorrente);
  const ativo = body.ativo === undefined ? true : Boolean(body.ativo);

  if (!titulo) errors.titulo = 'Título é obrigatório.';
  if (!descricao) errors.descricao = 'Descrição é obrigatória.';
  if (!CATEGORIAS_AVISO.includes(categoria)) errors.categoria = 'Categoria inválida.';
  if (!PRIORIDADES.includes(prioridade)) errors.prioridade = 'Prioridade inválida.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) errors.data_inicio = 'Data inicial inválida.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataFim)) errors.data_fim = 'Data final inválida.';
  if (!PUBLICOS.includes(publico)) errors.publico = 'Público inválido.';
  if (publico === 'polo' && !polo) errors.polo = 'Informe o polo.';
  if (publico === 'curso' && !curso) errors.curso = 'Informe o curso.';
  if (recorrente && !(Number.isInteger(dia) && dia >= 1 && dia <= 31)) {
    errors.dia_recorrente = 'Dia recorrente deve ser entre 1 e 31.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    sanitized: {
      titulo,
      descricao,
      categoria,
      prioridade,
      data_inicio: dataInicio,
      data_fim: dataFim,
      ativo,
      publico,
      polo: publico === 'polo' ? polo : null,
      curso: publico === 'curso' ? curso : null,
      recorrente,
      dia_recorrente: recorrente ? dia : null,
    },
  };
}

function mapAdminAviso(row) {
  return {
    id: row.id,
    titulo: row.titulo,
    descricao: row.descricao,
    categoria: row.categoria,
    prioridade: row.prioridade,
    data_inicio: isoDate(row.data_inicio),
    data_fim: isoDate(row.data_fim),
    ativo: Boolean(row.ativo),
    publico: row.publico,
    polo: row.polo,
    curso: row.curso,
    recorrente: Boolean(row.recorrente),
    dia_recorrente: row.dia_recorrente,
  };
}

async function listAll(pool) {
  const result = await pool.query(
    `SELECT id, titulo, descricao, categoria, prioridade, data_inicio, data_fim, ativo, publico, polo, curso, recorrente, dia_recorrente
     FROM csu_avisos
     ORDER BY id DESC`,
  );
  return result.rows.map(mapAdminAviso);
}

async function create(pool, data) {
  const result = await pool.query(
    `INSERT INTO csu_avisos
      (titulo, descricao, categoria, prioridade, data_inicio, data_fim, ativo, publico, polo, curso, recorrente, dia_recorrente)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, titulo, descricao, categoria, prioridade, data_inicio, data_fim, ativo, publico, polo, curso, recorrente, dia_recorrente`,
    [
      data.titulo, data.descricao, data.categoria, data.prioridade, data.data_inicio, data.data_fim,
      data.ativo, data.publico, data.polo, data.curso, data.recorrente, data.dia_recorrente,
    ],
  );
  return mapAdminAviso(result.rows[0]);
}

async function update(pool, id, data) {
  const result = await pool.query(
    `UPDATE csu_avisos SET
        titulo=$2, descricao=$3, categoria=$4, prioridade=$5, data_inicio=$6, data_fim=$7,
        ativo=$8, publico=$9, polo=$10, curso=$11, recorrente=$12, dia_recorrente=$13
     WHERE id=$1
     RETURNING id, titulo, descricao, categoria, prioridade, data_inicio, data_fim, ativo, publico, polo, curso, recorrente, dia_recorrente`,
    [
      id, data.titulo, data.descricao, data.categoria, data.prioridade, data.data_inicio, data.data_fim,
      data.ativo, data.publico, data.polo, data.curso, data.recorrente, data.dia_recorrente,
    ],
  );
  return result.rows[0] ? mapAdminAviso(result.rows[0]) : null;
}

async function setAtivo(pool, id, ativo) {
  const result = await pool.query(
    `UPDATE csu_avisos SET ativo=$2 WHERE id=$1
     RETURNING id, titulo, descricao, categoria, prioridade, data_inicio, data_fim, ativo, publico, polo, curso, recorrente, dia_recorrente`,
    [id, ativo],
  );
  return result.rows[0] ? mapAdminAviso(result.rows[0]) : null;
}

async function remove(pool, id) {
  const result = await pool.query('DELETE FROM csu_avisos WHERE id=$1 RETURNING id', [id]);
  return Boolean(result.rows[0]);
}

module.exports = {
  listAvisosForAluno,
  countUnread,
  markRead,
  validateAdminAviso,
  listAll,
  create,
  update,
  setAtivo,
  remove,
};
