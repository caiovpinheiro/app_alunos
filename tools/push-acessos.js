'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'data', 'acessos.json');
const URL = process.env.APP_URL || 'https://outros-app-alunos.ca31ey.easypanel.host';
const SECRET = process.env.IMPORT_SECRET;
const CHUNK = 400;

if (!SECRET) {
  console.error('Defina IMPORT_SECRET no .env');
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const alunos = payload.alunos || [];

(async () => {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < alunos.length; i += CHUNK) {
    const chunk = alunos.slice(i, i + CHUNK);
    const res = await fetch(`${URL.replace(/\/$/, '')}/api/admin/sync-acessos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-import-secret': SECRET,
      },
      body: JSON.stringify({ alunos: chunk }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      console.error('falhou no lote', i, res.status, body);
      process.exit(1);
    }
    created += body.created;
    updated += body.updated;
    skipped += body.skipped;
    console.log(`enviados ${Math.min(i + CHUNK, alunos.length)}/${alunos.length}`);
  }
  console.log('push ok', { created, updated, skipped, total: alunos.length });
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
