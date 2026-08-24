'use strict';

const fs = require('node:fs');
const path = require('node:path');
const db = require('../server/db');

const FILE = path.join(__dirname, '..', 'data', 'acessos.json');
const concurrency = 8;

(async () => {
  if (!fs.existsSync(FILE)) {
    throw new Error('Arquivo data/acessos.json não encontrado. Rode tools/sync-acessos.js antes.');
  }

  const payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const alunos = payload.alunos || [];
  console.log('destino', process.env.DATABASE_HOST, process.env.DATABASE_NAME, 'alunos', alunos.length);

  const pool = db.createPool();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let cursor = 0;

  try {
    await db.ensureSchema(pool);
    const who = await pool.query('SELECT current_database() AS db');
    console.log('conectado em', who.rows[0].db);

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
    console.log('import ok', { created, updated, skipped, total: alunos.length });
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error('falhou', err.message);
  process.exit(1);
});
