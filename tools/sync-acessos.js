'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const db = require('../server/db');
const matriculados = require('../server/matriculados');
const syncAcessos = require('../server/sync-acessos');

const OUT_FILE = path.join(__dirname, '..', 'data', 'acessos.json');

(async () => {
  if (!matriculados.isConfigured()) {
    throw new Error('Configure MATRICULADOS_HOST e MATRICULADOS_DATABASE no .env');
  }

  const destPool = db.createPool();
  const sourcePool = matriculados.createPool();
  try {
    console.log('lendo matriculados em curso...');
    const payload = await syncAcessos.loadLatestEmCurso(sourcePool);
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload));
    console.log(`json: ${OUT_FILE} (${payload.alunos.length} alunos, sem senha)`);

    console.log('gravando na tabela csu_alunos...');
    const result = await syncAcessos.syncFromMatriculados(destPool, { force: true });
    console.log('sync ok', result);
  } finally {
    await destPool.end();
    await sourcePool.end();
  }
})().catch((err) => {
  console.error('falhou', err.message);
  process.exit(1);
});
