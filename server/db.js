'use strict';

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;
const DERIVED_PW_MARKER = 'DERIVED';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

function createPool() {
  const required = ['DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Variáveis de banco ausentes: ${missing.join(', ')}`);
  }

  const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 8,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });
  pool.on('error', (err) => {
    console.error('Erro inesperado no pool Postgres:', err.code || '', err.message);
  });
  return pool;
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS csu_alunos (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      rgm TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      pw_hash TEXT NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS csu_sessoes (
      token TEXT PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS csu_certificados (
      id SERIAL PRIMARY KEY,
      certificate_id TEXT NOT NULL UNIQUE,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id),
      email TEXT NOT NULL,
      nome TEXT NOT NULL,
      rgm TEXT NOT NULL,
      data_aula_inaugural DATE NOT NULL,
      curso TEXT NOT NULL,
      unidade TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_csu_alunos_email_lower ON csu_alunos (lower(email));
    CREATE INDEX IF NOT EXISTS idx_csu_alunos_rgm ON csu_alunos (rgm);
    CREATE INDEX IF NOT EXISTS idx_csu_sessoes_expires ON csu_sessoes (expires_at);
    CREATE INDEX IF NOT EXISTS idx_csu_certificados_rgm ON csu_certificados (rgm);
  `);
}

function normalizeIdentifier(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function seedAlunoIfEmpty(pool) {
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM csu_alunos');
  if (count.rows[0].n > 0) return false;

  const email = normalizeIdentifier(process.env.SEED_ALUNO_EMAIL).toLowerCase();
  const rgm = normalizeIdentifier(process.env.SEED_ALUNO_RGM);
  const nome = normalizeIdentifier(process.env.SEED_ALUNO_NOME) || 'Aluno';
  const password = String(process.env.SEED_ALUNO_PASSWORD || '');

  if (!email || !rgm || !password) {
    console.warn('Tabela csu_alunos vazia e SEED_ALUNO_* não configurado. Nenhum aluno de teste criado.');
    return false;
  }

  const pwHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await pool.query(
    `INSERT INTO csu_alunos (email, rgm, nome, pw_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [email, rgm, nome, pwHash],
  );
  console.log('Aluno inicial criado em csu_alunos (SEED_ALUNO_*).');
  return true;
}

async function upsertAlunoFromMatricula(pool, { email, rgm, nome, password }) {
  const existing = await pool.query(
    `SELECT id, email, rgm, nome, pw_hash, ativo
     FROM csu_alunos
     WHERE rgm = $1 OR lower(email) = lower($2)
     ORDER BY CASE WHEN rgm = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [rgm, email],
  );

  if (existing.rows[0]) {
    const row = existing.rows[0];
    await pool.query(
      `UPDATE csu_alunos
       SET email = $1, rgm = $2, nome = $3
       WHERE id = $4`,
      [email, rgm, nome, row.id],
    );
    return { id: row.id, email, rgm, nome, ativo: row.ativo };
  }

  const pwHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const inserted = await pool.query(
    `INSERT INTO csu_alunos (email, rgm, nome, pw_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, rgm, nome, ativo`,
    [email, rgm, nome, pwHash],
  );
  return inserted.rows[0];
}

async function upsertAcessoDerived(pool, { email, rgm, nome }) {
  const existing = await pool.query(
    `SELECT id, email, rgm, nome, pw_hash, ativo
     FROM csu_alunos
     WHERE rgm = $1 OR lower(email) = lower($2)
     ORDER BY CASE WHEN rgm = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [rgm, email],
  );

  if (existing.rows[0]) {
    const row = existing.rows[0];
    await pool.query(
      `UPDATE csu_alunos
       SET email = $1, rgm = $2, nome = $3
       WHERE id = $4`,
      [email, rgm, nome, row.id],
    );
    return { id: row.id, email, rgm, nome, ativo: row.ativo, created: false };
  }

  const inserted = await pool.query(
    `INSERT INTO csu_alunos (email, rgm, nome, pw_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, rgm, nome, ativo`,
    [email, rgm, nome, DERIVED_PW_MARKER],
  );
  return { ...inserted.rows[0], created: true };
}

async function findAlunoByIdentifier(pool, identifier) {
  const id = normalizeIdentifier(identifier);
  if (!id) return null;
  const result = await pool.query(
    `SELECT id, email, rgm, nome, pw_hash, ativo
     FROM csu_alunos
     WHERE lower(email) = lower($1)
        OR rgm = $1
        OR regexp_replace(rgm, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
     LIMIT 1`,
    [id],
  );
  return result.rows[0] || null;
}

const DUMMY_HASH = bcrypt.hashSync('not-a-real-user', 4);

async function verifyPassword(aluno, password) {
  try {
    const ok = await bcrypt.compare(String(password ?? ''), (aluno && aluno.pw_hash) || DUMMY_HASH);
    return Boolean(aluno) && ok;
  } catch {
    return false;
  }
}

async function createSession(pool, alunoId, token) {
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await pool.query(
    'INSERT INTO csu_sessoes (token, aluno_id, expires_at) VALUES ($1, $2, $3)',
    [token, alunoId, expiresAt],
  );
  return expiresAt;
}

async function getSessionAluno(pool, token) {
  if (!token) return null;
  const result = await pool.query(
    `SELECT a.id, a.email, a.rgm, a.nome, a.ativo, s.expires_at
     FROM csu_sessoes s
     JOIN csu_alunos a ON a.id = s.aluno_id
     WHERE s.token = $1
     LIMIT 1`,
    [token],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (!row.ativo || new Date(row.expires_at).getTime() <= Date.now()) {
    await pool.query('DELETE FROM csu_sessoes WHERE token = $1', [token]);
    return null;
  }
  return { id: row.id, email: row.email, rgm: row.rgm, nome: row.nome };
}

async function deleteSession(pool, token) {
  await pool.query('DELETE FROM csu_sessoes WHERE token = $1', [token]);
}

async function createAluno(pool, data) {
  const email = normalizeIdentifier(data.email).toLowerCase();
  const rgm = normalizeIdentifier(data.rgm);
  const nome = normalizeIdentifier(data.nome);
  const password = String(data.password ?? '');

  const existing = await pool.query(
    `SELECT email, rgm FROM csu_alunos
     WHERE lower(email) = lower($1) OR rgm = $2
     LIMIT 1`,
    [email, rgm],
  );
  if (existing.rows[0]) {
    const err = new Error('Aluno já cadastrado.');
    err.code = 'DUPLICATE';
    err.field = existing.rows[0].rgm === rgm ? 'rgm' : 'email';
    throw err;
  }

  const pwHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = await pool.query(
    `INSERT INTO csu_alunos (email, rgm, nome, pw_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, rgm, nome, ativo`,
    [email, rgm, nome, pwHash],
  );
  return result.rows[0];
}

async function insertCertificate(pool, alunoId, record) {
  await pool.query(
    `INSERT INTO csu_certificados
      (certificate_id, aluno_id, email, nome, rgm, data_aula_inaugural, curso, unidade, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      record.certificate_id,
      alunoId,
      record.email,
      record.nome,
      record.rgm,
      record.data_aula_inaugural,
      record.curso,
      record.unidade,
      record.created_at,
    ],
  );
}

module.exports = {
  TOKEN_TTL_MS,
  createPool,
  ensureSchema,
  seedAlunoIfEmpty,
  upsertAlunoFromMatricula,
  upsertAcessoDerived,
  findAlunoByIdentifier,
  verifyPassword,
  createSession,
  getSessionAluno,
  deleteSession,
  createAluno,
  insertCertificate,
};
