'use strict';

const { Pool } = require('pg');

const DERIVED_PW_MARKER = 'DERIVED';

function materiasPgConfig() {
  const host = process.env.MATERIAS_HOST;
  const database = process.env.MATERIAS_DATABASE;
  if (host || database) {
    return {
      host: host || process.env.DATABASE_HOST,
      port: Number(process.env.MATERIAS_PORT || 5432),
      database: database || 'eduit',
      user: process.env.MATERIAS_USER || process.env.MATRICULADOS_USER || process.env.DATABASE_USER,
      password: process.env.MATERIAS_PASSWORD || process.env.MATRICULADOS_PASSWORD || process.env.DATABASE_PASSWORD,
      ssl: process.env.MATERIAS_SSL === 'true',
    };
  }
  if (process.env.DATABASE_NAME === 'eduit') {
    return {
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT || 5432),
      database: 'eduit',
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      ssl: process.env.DATABASE_SSL === 'true',
    };
  }
  throw new Error('MATERIAS_HOST/MATERIAS_DATABASE não configurado (Postgres eduit).');
}

function createMateriasPool() {
  const cfg = materiasPgConfig();
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });
  pool.on('error', (err) => {
    console.error('Erro inesperado no pool de matérias:', err.code || '', err.message);
  });
  return pool;
}

function parseNome(aluno, rgm) {
  const raw = String(aluno || '').trim();
  const digits = String(rgm || '').replace(/\D/g, '');
  if (!raw) return '';
  const match = raw.match(/^\d+\s*-\s*(.+)$/);
  if (match) return match[1].trim();
  if (digits && raw.replace(/\D/g, '') === digits) return '';
  return raw;
}

function placeholderEmail(rgm) {
  return `rgm.${String(rgm).replace(/\D/g, '')}@materias.portal`;
}

function needsNomeUpdate(nome, rgm) {
  const value = String(nome || '').trim();
  if (!value) return true;
  const digits = String(rgm || '').replace(/\D/g, '');
  if (digits && value.replace(/\D/g, '') === digits) return true;
  return false;
}

async function fetchAllFromPostgres() {
  const table = String(process.env.MATERIAS_TABLE || 'materias_alunos').replace(/[^\w]/g, '') || 'materias_alunos';
  const since = String(process.env.MATERIAS_SINCE || '').trim();
  const source = createMateriasPool();
  try {
    const result = since
      ? await source.query(
        `SELECT rgm, aluno, materias, qtd_materias, consultado_em
         FROM ${table}
         WHERE consultado_em >= $1::timestamptz
         ORDER BY rgm ASC`,
        [since],
      )
      : await source.query(
        `SELECT rgm, aluno, materias, qtd_materias, consultado_em
         FROM ${table}
         ORDER BY rgm ASC`,
      );
    return result.rows;
  } finally {
    await source.end();
  }
}

async function ensureAlunoForMaterias(pool, { rgm, nome }) {
  const cleanRgm = String(rgm || '').trim();
  const cleanNome = String(nome || '').trim() || `Aluno ${cleanRgm}`;
  const existing = await pool.query(
    `SELECT id, email, rgm, nome, ativo
     FROM csu_alunos
     WHERE rgm = $1
        OR regexp_replace(rgm, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
     LIMIT 1`,
    [cleanRgm],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (needsNomeUpdate(row.nome, cleanRgm) && cleanNome) {
      await pool.query(`UPDATE csu_alunos SET nome = $2 WHERE id = $1`, [row.id, cleanNome]);
      return { id: row.id, created: false, nomeUpdated: true };
    }
    return { id: row.id, created: false, nomeUpdated: false };
  }

  const email = placeholderEmail(cleanRgm);
  const inserted = await pool.query(
    `INSERT INTO csu_alunos (email, rgm, nome, pw_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [email, cleanRgm, cleanNome, DERIVED_PW_MARKER],
  );
  return { id: inserted.rows[0].id, created: true, nomeUpdated: false };
}

async function syncFromPostgres(pool) {
  const rows = await fetchAllFromPostgres();
  let synced = 0;
  let linked = 0;
  let created = 0;
  let namesUpdated = 0;

  for (const row of rows) {
    const rgm = String(row.rgm || '').trim();
    if (!rgm) continue;
    const materias = Array.isArray(row.materias) ? row.materias : [];
    const alunoNome = parseNome(row.aluno, rgm);
    const alunoInfo = await ensureAlunoForMaterias(pool, { rgm, nome: alunoNome });
    if (alunoInfo.created) created += 1;
    if (alunoInfo.nomeUpdated) namesUpdated += 1;
    if (alunoInfo.id) linked += 1;

    await pool.query(
      `INSERT INTO csu_materias_alunos
        (rgm, aluno_label, aluno_nome, materias, qtd_materias, consultado_em, aluno_id, synced_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, now(), now())
       ON CONFLICT (rgm) DO UPDATE SET
         aluno_label = EXCLUDED.aluno_label,
         aluno_nome = COALESCE(NULLIF(EXCLUDED.aluno_nome, ''), csu_materias_alunos.aluno_nome),
         materias = EXCLUDED.materias,
         qtd_materias = EXCLUDED.qtd_materias,
         consultado_em = EXCLUDED.consultado_em,
         aluno_id = COALESCE(EXCLUDED.aluno_id, csu_materias_alunos.aluno_id),
         synced_at = now(),
         updated_at = now()`,
      [
        rgm,
        String(row.aluno || '').trim() || null,
        alunoNome || null,
        JSON.stringify(materias),
        Number(row.qtd_materias) || materias.length,
        row.consultado_em || null,
        alunoInfo.id,
      ],
    );
    synced += 1;
  }

  return { synced, linked, created, namesUpdated, total: rows.length };
}

module.exports = {
  parseNome,
  fetchAllFromPostgres,
  syncFromPostgres,
  syncFromSupabase: syncFromPostgres,
  ensureAlunoForMaterias,
};
