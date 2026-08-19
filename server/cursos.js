'use strict';

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_RESULTS = 12;

let cache = { at: 0, names: [] };

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  const table = process.env.SUPABASE_CURSOS_TABLE || 'cursos_catalogo_ia';
  const column = process.env.SUPABASE_CURSOS_COLUMN || 'curso';
  if (!url || !key) throw new Error('Supabase não configurado.');
  return { url, key, table, column };
}

function uniqueSorted(values) {
  const set = new Set();
  for (const value of values) {
    const name = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (name) set.add(name);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

async function loadCourseNames() {
  if (Date.now() - cache.at < CACHE_TTL_MS && cache.names.length) return cache.names;

  const { url, key, table, column } = supabaseConfig();
  const encodedColumn = encodeURIComponent(column);
  const endpoint = `${url}/rest/v1/${encodeURIComponent(table)}?select=${encodedColumn}&${encodedColumn}=not.is.null&limit=2000`;

  const res = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Falha ao consultar cursos (${res.status}): ${detail.slice(0, 180)}`);
  }

  const rows = await res.json();
  cache = { at: Date.now(), names: uniqueSorted(rows.map((row) => row[column])) };
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

async function searchCourses(query) {
  const names = await loadCourseNames();
  return filterCourses(names, query);
}

async function isKnownCourse(name) {
  const normalized = String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return false;
  const names = await loadCourseNames();
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
