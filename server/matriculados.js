'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');

const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const SITUACAO_ATIVA = 'EM CURSO';

let cachedSnapshot = { id: null, at: 0 };

function isConfigured() {
  return Boolean(process.env.MATRICULADOS_HOST || process.env.MATRICULADOS_DATABASE);
}

function createPool() {
  if (!isConfigured()) {
    throw new Error('MATRICULADOS_HOST ou MATRICULADOS_DATABASE não configurado');
  }

  const pool = new Pool({
    host: process.env.MATRICULADOS_HOST || process.env.DATABASE_HOST,
    port: Number(process.env.MATRICULADOS_PORT || process.env.DATABASE_PORT || 5432),
    database: process.env.MATRICULADOS_DATABASE || 'disparos',
    user: process.env.MATRICULADOS_USER || process.env.DATABASE_USER,
    password: process.env.MATRICULADOS_PASSWORD || process.env.DATABASE_PASSWORD,
    ssl: (process.env.MATRICULADOS_SSL || process.env.DATABASE_SSL) === 'true'
      ? { rejectUnauthorized: false }
      : false,
    max: 8,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });
  pool.on('error', (err) => {
    console.error('Erro inesperado no pool de matriculados:', err.code || '', err.message);
  });
  return pool;
}

function normalizeRgm(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

const TITLE_PARTICLES = new Set([
  'a', 'as', 'o', 'os', 'e', 'da', 'das', 'de', 'do', 'dos',
  'em', 'na', 'nas', 'no', 'nos', 'por', 'para', 'com', 'ou', 'ao', 'aos',
]);

function collapseSpaces(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function particleKey(word) {
  return word.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function formatToken(word, isFirst, keepAcronyms) {
  if (!word) return word;
  const lead = (word.match(/^[^A-Za-zÀ-ÿ0-9]+/) || [''])[0];
  const trail = (word.match(/[^A-Za-zÀ-ÿ0-9]+$/) || [''])[0];
  const core = word.slice(lead.length, word.length - trail.length);
  if (!core) return word;

  const lower = core.toLocaleLowerCase('pt-BR');
  const key = particleKey(core);
  const hasDiacritic = core.normalize('NFD').replace(/[\u0300-\u036f]/g, '') !== core.normalize('NFD');
  if (!isFirst && TITLE_PARTICLES.has(key) && !hasDiacritic) return lead + lower + trail;

  if (keepAcronyms && /^[A-Z]{2,3}$/.test(core) && !TITLE_PARTICLES.has(key)) {
    return lead + core + trail;
  }

  const titled = lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
  return lead + titled + trail;
}

function titleCasePt(text, keepAcronyms) {
  return collapseSpaces(text)
    .split(' ')
    .filter(Boolean)
    .map((raw, index) => raw
      .split('-')
      .map((part, partIndex) => formatToken(part, index === 0 && partIndex === 0, keepAcronyms))
      .join('-'))
    .join(' ');
}

function formatPolo(raw) {
  let value = collapseSpaces(raw);
  if (!value) return '';
  value = value.replace(/^\d+\s*[-–]\s*/, '');
  value = value.replace(/^CEB\s+/i, '');
  value = value.replace(/^POLO[_-\s]+/i, '');
  value = value.replace(/^[A-Z]{2}[_-\s]+/i, '');
  value = value.replace(/_/g, ' - ');
  return titleCasePt(value, false);
}

function formatCurso(raw) {
  const value = collapseSpaces(raw)
    .replace(/^\d+\s*[-–]\s*/, '')
    .replace(/\([^)]*\)/g, '');
  if (!value) return '';
  return titleCasePt(value, true);
}

function derivedPassword(nome) {
  const first = String(nome ?? '').trim().split(/\s+/).filter(Boolean)[0];
  if (!first) return null;
  const titled = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
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
  const nome = collapseSpaces(data?.Nome);
  const rgm = normalizeRgm(data?.RGM) || normalizeRgm(data?.RGM_erp_matricula);
  const email = collapseSpaces(data?.Email).toLowerCase();
  const emailAcad = collapseSpaces(data?.['Email acadêmico']).toLowerCase();
  const situacao = collapseSpaces(data?.['Situação Matrícula']).toUpperCase();
  return {
    nome,
    rgm,
    email: email || emailAcad,
    situacao,
    curso: formatCurso(data?.Curso),
    unidade: formatPolo(data?.Polo) || formatPolo(data?.Instituição),
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
        OR ($3::text <> '' AND (
          regexp_replace(COALESCE(data->>'RGM', ''), '\\D', '', 'g') = $3
          OR regexp_replace(COALESCE(data->>'RGM_erp_matricula', ''), '\\D', '', 'g') = $3
        ))
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
  if (!aluno.nome || !aluno.email || aluno.situacao !== SITUACAO_ATIVA) return null;
  return aluno;
}

function pickPhone(data) {
  const celular = collapseSpaces(data?.['Fone celular']);
  const comercial = collapseSpaces(data?.['Fone Comercial']);
  const residencial = collapseSpaces(data?.['Fone Residencial']);
  const digits = (value) => String(value || '').replace(/\D+/g, '');
  const candidates = [celular, comercial, residencial];
  for (const value of candidates) {
    const n = digits(value);
    if (n.length >= 10) return n;
  }
  return '';
}

async function phonesByRgms(pool, rgms) {
  const map = new Map();
  const list = [...new Set((rgms || []).map(normalizeRgm).filter(Boolean))];
  if (!pool || !list.length) return map;
  const snapshotId = await getLatestSnapshotId(pool);
  if (!snapshotId) return map;

  const result = await pool.query(
    `
    SELECT DISTINCT ON (regexp_replace(COALESCE(data->>'RGM', data->>'RGM_erp_matricula', ''), '\\D', '', 'g'))
      regexp_replace(COALESCE(data->>'RGM', data->>'RGM_erp_matricula', ''), '\\D', '', 'g') AS rgm,
      data
    FROM public.matriculados_rows
    WHERE snapshot_id = $1
      AND regexp_replace(COALESCE(data->>'RGM', data->>'RGM_erp_matricula', ''), '\\D', '', 'g') = ANY($2::text[])
    ORDER BY regexp_replace(COALESCE(data->>'RGM', data->>'RGM_erp_matricula', ''), '\\D', '', 'g'),
      CASE WHEN upper(btrim(COALESCE(data->>'Situação Matrícula', ''))) = 'EM CURSO' THEN 0 ELSE 1 END
    `,
    [snapshotId, list],
  );
  for (const row of result.rows) {
    map.set(row.rgm, pickPhone(row.data));
  }
  return map;
}

module.exports = {
  isConfigured,
  createPool,
  derivedPassword,
  passwordMatches,
  findByIdentifier,
  phonesByRgms,
  mapRow,
  formatPolo,
  formatCurso,
};
