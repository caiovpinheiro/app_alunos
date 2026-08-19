'use strict';

require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: false,
  connectionTimeoutMillis: 15000,
});

async function main() {
  await client.connect();
  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'csu_%'
    ORDER BY table_name
  `);
  console.log('tabelas csu_*:', tables.rows.map((r) => r.table_name).join(', '));

  const alunos = await client.query('SELECT id, email, rgm, nome, ativo FROM csu_alunos');
  console.log('alunos:', JSON.stringify(alunos.rows));

  const certs = await client.query('SELECT certificate_id, email, nome, rgm, unidade, created_at FROM csu_certificados ORDER BY id');
  console.log('certificados:', JSON.stringify(certs.rows));

  const sessoes = await client.query('SELECT COUNT(*)::int AS n FROM csu_sessoes');
  console.log('sessoes ativas:', sessoes.rows[0].n);
}

main()
  .catch((err) => {
    console.error('Falha:', err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end().catch(() => {}));
