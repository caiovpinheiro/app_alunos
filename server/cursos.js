'use strict';

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_RESULTS = 12;

let cache = { at: 0, names: [] };

function uniqueSorted(values) {
  const set = new Set();
  for (const value of values) {
    const name = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (name) set.add(name);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

async function loadCourseNames(pool) {
  if (!pool) throw new Error('Postgres não configurado.');
  if (Date.now() - cache.at < CACHE_TTL_MS && cache.names.length) return cache.names;

  const result = await pool.query(
    `SELECT DISTINCT btrim(curso) AS curso
     FROM (
       SELECT curso FROM csu_alunos
       WHERE curso IS NOT NULL AND btrim(curso) <> ''
       UNION
       SELECT curso FROM csu_semestre_planos
       WHERE ativo = TRUE AND curso IS NOT NULL AND btrim(curso) <> ''
     ) c
     ORDER BY 1`,
  );
  cache = { at: Date.now(), names: uniqueSorted(result.rows.map((row) => row.curso)) };
  return cache.names;
}

function filterCourses(names, query) {
  const q = String(query ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!q) return names.slice(0, MAX_RESULTS);
  const starts = [];
  const contains = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) starts.push(name);
    else if (lower.includes(q)) contains.push(name);
    if (starts.length >= MAX_RESULTS) break;
  }
  return starts.concat(contains).slice(0, MAX_RESULTS);
}

async function searchCourses(pool, query) {
  const names = await loadCourseNames(pool);
  return filterCourses(names, query);
}

async function isKnownCourse(pool, name) {
  const normalized = String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return false;
  const names = await loadCourseNames(pool);
  return names.some((item) => item.toLowerCase() === normalized);
}

function canonicalCourseName(name, names) {
  const normalized = String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return names.find((item) => item.toLowerCase() === normalized) || name;
}

module.exports = {
  loadCourseNames,
  searchCourses,
  isKnownCourse,
  canonicalCourseName,
};
