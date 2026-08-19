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
  const users = await client.query('SELECT id, username, role, left(pw_hash, 7) AS hash_prefix, created_at FROM app_users');
  console.log('app_users:', JSON.stringify(users.rows, null, 2));

  const perms = await client.query('SELECT page FROM user_permissions GROUP BY page ORDER BY page');
  console.log('páginas em user_permissions:', perms.rows.map((r) => r.page).join(', '));
}

main()
  .catch((err) => {
    console.error('Falha:', err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end().catch(() => {}));
