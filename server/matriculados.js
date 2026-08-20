'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');

const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const SITUACAO_ATIVA = 'EM CURSO';

let cachedSnapshot = { id: null, at: 0 };

function createPool() {
  const required = ['DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_USER', 'DATABASE_PASSWORD'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Variáveis de banco ausentes: ${missing.join(', ')}`);
  }

  return new Pool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    database: process.env.MATRICULADOS_DATABASE || 'disparos',
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 8,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });
}

function normalizeRgm(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

function derivedPassword(nome) {
  const first = String(nome ?? '').trim().split(/\s+/).filter(Boolean)[0];
  if (!first) return null;
  const titled =
    first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1).toLocaleLowerCase('pt-BR');
  return `${titled}123@`;
}

function passwordMatches(expected, given) {
  if (!expected) return false;
  const left = Buffer.from(String(given ?? ''), 'utf8');
  const right = Buffer.from(String(expected), 'utf8');
  if (left.length !== right.length) {
    crypto.timingSafeEqual(right, right);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function mapRow(data) {
  const nome = String(data?.Nome ?? '').replace(/\s+/g, ' ').trim();
  const rgm = normalizeRgm(data?.RGM);
  const email = String(data?.Email ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const emailAcad = String(data?.['Email acadêmico'] ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const situacao = String(data?.['Situação Matrícula'] ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  return {
    nome,
    rgm,
    email: email || emailAcad,
    situacao,
  };
}

async function getLatestSnapshotId(pool) {
  if (cachedSnapshot.id && Date.now() - cachedSnapshot.at < SNAPSHOT_TTL_MS) {
    return cachedSnapshot.id;
  }
  const result = await pool.query(`
    SELECT id
    FROM public.matriculados_snapshots
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const id = result.rows[0]?.id || null;
  cachedSnapshot = { id, at: Date.now() };
  return id;
}

async function findByIdentifier(pool, identifier) {
  const raw = String(identifier ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  const snapshotId = await getLatestSnapshotId(pool);
  if (!snapshotId) return null;

  const isEmail = raw.includes('@');
  const email = isEmail ? raw.toLowerCase() : '';
  const rgm = isEmail ? '' : normalizeRgm(raw);
  if (!email && !rgm) return null;

  const result = await pool.query(
    `
    SELECT data
    FROM public.matriculados_rows
    WHERE snapshot_id = $1
      AND (
        ($2::text <> '' AND (
          lower(btrim(COALESCE(data->>'Email', ''))) = $2
          OR lower(btrim(COALESCE(data->>'Email acadêmico', ''))) = $2
        ))
        OR ($3::text <> '' AND regexp_replace(COALESCE(data->>'RGM', ''), '\\D', '', 'g') = $3)
      )
    ORDER BY CASE
      WHEN upper(btrim(COALESCE(data->>'Situação Matrícula', ''))) = 'EM CURSO' THEN 0
      ELSE 1
    END
    LIMIT 1
    `,
    [snapshotId, email, rgm],
  );

  const aluno = mapRow(result.rows[0]?.data);
  if (!aluno.nome || !aluno.rgm || !aluno.email || aluno.situacao !== SITUACAO_ATIVA) return null;
  return aluno;
}

module.exports = {
  createPool,
  derivedPassword,
  passwordMatches,
  findByIdentifier,
};
