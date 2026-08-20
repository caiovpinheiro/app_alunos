'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const db = require('../server/db');
const matriculados = require('../server/matriculados');

const OUT_FILE = path.join(__dirname, '..', 'data', 'acessos.json');

function mapAluno(data) {
  const mapped = {
    nome: String(data?.Nome ?? '').replace(/\s+/g, ' ').trim(),
    rgm: String(data?.RGM ?? '').replace(/\D+/g, ''),
    email: String(data?.Email ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
      || String(data?.['Email acadêmico'] ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
    situacao: String(data?.['Situação Matrícula'] ?? '').replace(/\s+/g, ' ').trim().toUpperCase(),
  };
  return mapped;
}

async function loadFromDisparos() {
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    database: 'disparos',
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 20000,
    statement_timeout: 120000,
  });
  await client.connect();
  try {
    const latest = await client.query(`
      SELECT id, file_name, row_count, created_at
      FROM public.matriculados_snapshots
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const snap = latest.rows[0];
    if (!snap) throw new Error('Nenhum snapshot de matriculados encontrado.');

    const rows = await client.query(
      `
      SELECT data
      FROM public.matriculados_rows
      WHERE snapshot_id = $1
        AND upper(btrim(COALESCE(data->>'Situação Matrícula', ''))) = 'EM CURSO'
      `,
      [snap.id],
    );

    const byRgm = new Map();
    const emails = new Set();
    for (const row of rows.rows) {
      const aluno = mapAluno(row.data);
      if (!aluno.nome || !aluno.rgm || !aluno.email) continue;
      if (!matriculados.derivedPassword(aluno.nome)) continue;
      if (byRgm.has(aluno.rgm)) continue;
      if (emails.has(aluno.email)) continue;
      byRgm.set(aluno.rgm, { nome: aluno.nome, rgm: aluno.rgm, email: aluno.email });
      emails.add(aluno.email);
    }

    return {
      snapshot_id: snap.id,
      snapshot_at: snap.created_at,
      file_name: snap.file_name,
      generated_at: new Date().toISOString(),
      alunos: [...byRgm.values()],
    };
  } finally {
    await client.end();
  }
}

async function importIntoAcessos(payload) {
  const pool = db.createPool();
  const concurrency = 8;
  try {
    await db.ensureSchema(pool);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let cursor = 0;
    const alunos = payload.alunos;

    async function worker() {
      while (cursor < alunos.length) {
        const index = cursor;
        cursor += 1;
        const aluno = alunos[index];
        try {
          const row = await db.upsertAcessoDerived(pool, aluno);
          if (row.created) created += 1;
          else updated += 1;
        } catch (err) {
          skipped += 1;
          console.error('skip', aluno.rgm, err.code || err.message);
        }
        const done = created + updated + skipped;
        if (done % 1000 === 0) console.log(`progresso ${done}/${alunos.length}`);
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return { created, updated, skipped, total: alunos.length };
  } finally {
    await pool.end();
  }
}

(async () => {
  console.log('lendo matriculados em curso...');
  const payload = await loadFromDisparos();
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload));
  console.log(`json: ${OUT_FILE} (${payload.alunos.length} alunos, sem senha)`);

  console.log('gravando na tabela csu_alunos...');
  const result = await importIntoAcessos(payload);
  console.log('sync ok', result);
})().catch((err) => {
  console.error('falhou', err.message);
  process.exit(1);
});
