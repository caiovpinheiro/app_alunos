#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../server/db');
const materiasAlunos = require('../server/materiasAlunos');
const planoMateriasImagem = require('../server/planoMateriasImagem');

async function main() {
  const pool = db.createPool();
  await db.ensureSchema(pool);
  const action = process.argv[2] || 'all';

  if (action === 'sync' || action === 'all') {
    const synced = await materiasAlunos.syncFromSupabase(pool);
    console.log('Sync:', synced);
  }

  if (action === 'gerar' || action === 'all') {
    const batch = await planoMateriasImagem.startBatch(pool);
    console.log('Batch:', batch);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    let last = null;
    while (true) {
      const status = await planoMateriasImagem.getStatus(pool);
      if (status.pendentes === 0 && status.processando === 0 && !status.running) {
        console.log('Final:', status);
        break;
      }
      if (!last || JSON.stringify(last) !== JSON.stringify(status)) {
        console.log('Status:', status);
        last = status;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  if (action === 'status') {
    console.log(await planoMateriasImagem.getStatus(pool));
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
