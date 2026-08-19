'use strict';

require('dotenv').config();

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL/KEY ausentes');

  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  });
  console.log('status', res.status);
  if (!res.ok) {
    console.log((await res.text()).slice(0, 300));
    process.exitCode = 1;
    return;
  }

  const spec = await res.json();
  const paths = Object.keys(spec.paths || {});
  const related = paths.filter((p) => /catalog|curso|course|grad/i.test(p));
  console.log('paths relacionadas:', related.join(', ') || '(nenhuma)');

  const schemas = spec.definitions || spec.components?.schemas || {};
  for (const name of related.map((p) => p.replace(/^\//, '')).filter((n) => !n.startsWith('rpc/'))) {
    const schema = schemas[name];
    const props = schema && schema.properties ? Object.keys(schema.properties) : [];
    console.log(`${name}:`, props.join(', ') || '(sem schema)');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
