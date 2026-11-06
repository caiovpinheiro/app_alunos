#!/usr/bin/env node
'use strict';

// Fecha o ciclo do certificado para quem ficou para trás: completa curso e polo dos certificados que
// saíram sem eles e lista quem teve erro ao emitir, ainda não tem certificado e já tem curso e polo
// (o atendimento avisa "seu certificado está liberado: entre no app e emita").
//
// ATENÇÃO: usa o banco do .env (DATABASE_*). No computador, o .env aponta para o banco remoto:
// para testar, rode com DATABASE_* de um Postgres local.
//
// Uso:
//   node tools/certificados-pendentes.js               lista (tabela)
//   node tools/certificados-pendentes.js --csv         lista em CSV (separado por ;)
//   node tools/certificados-pendentes.js --concluiram  inclui quem concluiu a Aula e nunca tentou emitir
//   node tools/certificados-pendentes.js --completar   antes, completa curso e polo dos certificados (o sync já faz isso)
//
// O mesmo está no admin: GET /api/admin/certificados/pendentes (?concluiram=1, ?formato=csv).

require('dotenv').config({ quiet: true });
const db = require('../server/db');
const certificado = require('../server/certificado');
const trilha = require('../server/trilha');

async function main() {
  const args = new Set(process.argv.slice(2));
  const pool = db.createPool();
  try {
    await db.ensureSchema(pool);
    if (args.has('--completar')) {
      const n = await certificado.completarPendentes(pool);
      console.error(`Certificados completados com curso/polo: ${n}`);
    }
    const lista = await certificado.pendentesDeAviso(pool, { concluiram: args.has('--concluiram'), totalModulos: trilha.NIVEIS.length });
    if (args.has('--csv')) {
      process.stdout.write(`${certificado.paraCsv(lista)}\n`);
      return;
    }
    if (!lista.length) {
      console.log('Ninguém para avisar: todo mundo que teve erro já tem certificado ou ainda espera curso e polo.');
      return;
    }
    console.table(lista.map((a) => ({
      nome: a.nome,
      rgm: a.rgm,
      polo: a.polo,
      curso: a.curso,
      motivo: a.motivo === 'erro_ao_emitir' ? `erro (${a.erros}x)` : 'concluiu, não tentou',
      quando: certificado.agoraSP(new Date(a.ultimo_erro || a.concluiu_em)).slice(0, 16).replace('T', ' '),
    })));
    console.log(`${lista.length} aluno(s). Mensagem sugerida: "Seu certificado da Aula Inaugural está liberado. Entre no app e toque em Emitir certificado."`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Falha:', err.message);
  process.exitCode = 1;
});
