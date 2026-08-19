'use strict';

require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15000,
});

async function main() {
  await client.connect();
  const db = await client.query('SELECT current_database() AS db, current_user AS usr');
  console.log('conectado:', db.rows[0].db, 'como', db.rows[0].usr);

  const tables = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name
  `);
  console.log('\nTABELAS:');
  for (const t of tables.rows) console.log(`  ${t.table_schema}.${t.table_name}`);

  for (const t of tables.rows) {
    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [t.table_schema, t.table_name],
    );
    console.log(`\nCOLUNAS ${t.table_schema}.${t.table_name}:`);
    for (const c of cols.rows) {
      console.log(`  ${c.column_name} ${c.data_type} ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    }

    const count = await client.query(`SELECT COUNT(*)::int AS n FROM "${t.table_schema}"."${t.table_name}"`);
    console.log(`  linhas: ${count.rows[0].n}`);
  }
}

main()
  .catch((err) => {
    console.error('Falha na inspeção:', err.code || '', err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end().catch(() => {}));
