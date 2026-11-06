'use strict';
// Lembretes da régua (server/regua-fup.js) e a medida por mensagem do vigia, contra um Postgres DESCARTÁVEL.
//   VIGIA_TESTE_DB=postgres://usuario@127.0.0.1:PORTA/<nome>_teste node tools/test-regua-fup-pg.js
// O CRM é falso (fetch em memória): nada sai da máquina.
const assert = require('node:assert');
const express = require('express');
const { Pool } = require('pg');

const url = process.env.VIGIA_TESTE_DB || '';
const u = url ? new URL(url) : null;
if (!u || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || !/_teste$/.test(u.pathname.slice(1))) {
  console.error('Defina VIGIA_TESTE_DB=postgres://...@127.0.0.1:PORTA/<nome>_teste (banco local descartável).');
  process.exit(2);
}
Object.assign(process.env, {
  LINK_ACESSO_SEGREDO: 'segredo-de-teste', APP_PUBLIC_URL: 'https://app.teste',
  CRM_API_TOKEN: 'token-falso', CRM_API_URL: 'http://crm.falso',
  CRM_CAMPO_LINK_ACESSO: 'campoLinkUrl01', CRM_CAMPO_LINK_CODIGO: 'campoLinkCod01',
});

const db = require('../server/db');
const instrumentacao = require('../server/instrumentacao');
const linkAcesso = require('../server/link-acesso');
const fup = require('../server/regua-fup');
const vigia = require('../server/vigia');

const chamadas = [];
let crmFora = false;
async function crmFalso(href, opts) {
  const x = new URL(href);
  assert.strictEqual(x.host, 'crm.falso');
  assert.strictEqual(opts.headers.Authorization, 'Bearer token-falso');
  chamadas.push({ metodo: opts.method, caminho: x.pathname, corpo: opts.body ? JSON.parse(opts.body) : null });
  if (crmFora) return { ok: false, status: 502, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({}) };
}

let pool;
const ids = {};
const testes = [];
function teste(nome, fn) { testes.push([nome, fn]); }

async function preparar() {
  await db.ensureSchema(pool);
  await instrumentacao.ensureSchema(pool);
  await linkAcesso.ensureSchema(pool);
  await vigia.ensureSchema(pool);
  await pool.query('TRUNCATE csu_alunos, csu_link_acesso_pedidos RESTART IDENTITY CASCADE');
  for (const [k, rgm, entrou] of [['novo', '880001', false], ['entrou', '880002', true]]) {
    const r = await pool.query(
      `INSERT INTO csu_alunos (email, rgm, nome, pw_hash, primeiro_login_em) VALUES ($1, $2, 'Conta Teste', 'x', $3) RETURNING id`,
      [`${k}@teste.fup`, rgm, entrou ? new Date() : null]);
    ids[k] = r.rows[0].id;
  }
}
const ctx = { findAluno: db.findAlunoByIdentifier, fetchImpl: crmFalso };

teste('quem ainda não entrou: checagem sem origem não gera link; com origem gera e grava nos campos', async () => {
  const bv = await linkAcesso.gerar(pool, ids.novo, 'bv_acesso', { negocio: 'dealTeste001' });
  const so = await fup.lembrete(pool, { negocio: 'dealTeste001', rgm: '880001' }, ctx);
  assert.deepStrictEqual(so, { ok: true, entrou: false });
  assert.strictEqual(chamadas.length, 0);

  const r = await fup.lembrete(pool, { negocio: 'dealTeste001', rgm: '880001', origem: 'fup1_b' }, ctx);
  assert.deepStrictEqual(r, { ok: true, entrou: false, link: 'gravado' });
  const put = chamadas.pop();
  assert.strictEqual(put.metodo, 'PUT');
  assert.strictEqual(put.caminho, '/api/deals/dealTeste001/custom-fields');
  const [cUrl, cCod] = put.corpo.values;
  assert.strictEqual(cUrl.fieldId, 'campoLinkUrl01');
  assert.match(cUrl.value, /^https:\/\/app\.teste\/a\/[A-Za-z0-9_-]{43}\?o=fup1_b$/);
  assert.strictEqual(cCod.value, cUrl.value.split('/a/')[1], 'código = o que vem depois de /a/');
  // O link da BV continua valendo (o botão da mensagem anterior não quebra).
  const abertos = await pool.query('SELECT origem, negocio FROM csu_links_acesso WHERE aluno_id = $1 AND cancelado_em IS NULL ORDER BY id', [ids.novo]);
  assert.deepStrictEqual(abertos.rows.map((x) => x.origem), ['bv_acesso', 'fup1_b']);
  assert.ok(abertos.rows.every((x) => x.negocio === 'dealTeste001'));
  ids.tokenBv = bv.codigo.split('?')[0];
});

teste('entrou por um link: os outros abertos são cancelados e o negócio ganha app_entrou', async () => {
  const c = await linkAcesso.consumir(pool, ids.tokenBv);
  assert.ok(c.aluno);
  const abertos = await pool.query('SELECT COUNT(*)::int AS n FROM csu_links_acesso WHERE aluno_id = $1 AND usado_em IS NULL AND cancelado_em IS NULL', [ids.novo]);
  assert.strictEqual(abertos.rows[0].n, 0);
  await fup.aoEntrar(crmFalso)(pool, { alunoId: ids.novo, primeira: true });
  assert.deepStrictEqual(chamadas.pop(), { metodo: 'POST', caminho: '/api/deals/dealTeste001/tags', corpo: { tagName: 'app_entrou' } });
  await fup.aoEntrar(crmFalso)(pool, { alunoId: ids.novo, primeira: true });
  assert.strictEqual(chamadas.length, 0, 'uma vez por conta');
});

teste('quem já entrou: o lembrete só marca a tag, sem link novo', async () => {
  const antes = (await pool.query('SELECT COUNT(*)::int AS n FROM csu_links_acesso')).rows[0].n;
  const r = await fup.lembrete(pool, { negocio: 'dealTeste002', rgm: '880002', origem: 'fup1_a' }, ctx);
  assert.deepStrictEqual(r, { ok: true, entrou: true, tag: 'marcada' });
  assert.strictEqual(chamadas.pop().caminho, '/api/deals/dealTeste002/tags');
  assert.strictEqual((await pool.query('SELECT COUNT(*)::int AS n FROM csu_links_acesso')).rows[0].n, antes);
});

teste('nada derruba a régua: conta inexistente, CRM fora, código inválido', async () => {
  assert.deepStrictEqual(await fup.lembrete(pool, { negocio: 'dealTeste009', rgm: '999', origem: 'fup1_a' }, ctx), { ok: false, motivo: 'conta_nao_encontrada' });
  assert.deepStrictEqual(await fup.lembrete(pool, { negocio: 'x', rgm: '880001' }, ctx), { ok: false, motivo: 'sem_negocio' });
  assert.deepStrictEqual(await fup.lembrete(pool, { negocio: 'dealTeste001', rgm: '880001', origem: 'Fup 1!' }, ctx), { ok: false, motivo: 'origem_invalida' });
  crmFora = true;
  await pool.query('UPDATE csu_alunos SET primeiro_login_em = NULL WHERE id = $1', [ids.novo]);
  const r = await fup.lembrete(pool, { negocio: 'dealTeste001', rgm: '880001', origem: 'fup2_a' }, ctx);
  assert.deepStrictEqual(r, { ok: true, entrou: false, link: 'HTTP 502' });
  crmFora = false;
  chamadas.length = 0;
});

teste('rota: segredo errado é 401; o resto responde 200 para não parar o fluxo do CRM', async () => {
  const app = express();
  app.use(express.json());
  fup.registrarRotas(app, { getPool: () => pool, findAluno: db.findAlunoByIdentifier, instrumentacao });
  const srv = app.listen(0);
  const porta = srv.address().port;
  try {
    const post = (corpo) => fetch(`http://127.0.0.1:${porta}/api/integracoes/regua-fup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    assert.strictEqual((await post({ segredo: 'errado', negocio: 'dealTeste001', rgm: '880001' })).status, 401);
    const ok = await post({ segredo: 'segredo-de-teste', negocio: 'dealTeste009', rgm: '999' });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(await ok.json(), { ok: false, motivo: 'conta_nao_encontrada' });
  } finally {
    srv.close();
  }
});

teste('vigia: taxa de entrada em 24 h por mensagem, só com o prazo completo', async () => {
  await pool.query('TRUNCATE csu_alunos RESTART IDENTITY CASCADE');
  const agora = Date.now();
  const h = (n) => new Date(agora - n * 3600000);
  // fup1_a: 4 receberam há 30 h; 1 entrou em 2 h, 1 entrou depois de 24 h, 2 nunca.
  // fup1_b: 3 receberam há 30 h; 2 entraram em 5 h. 1 recebeu há 2 h (ainda no prazo: fora da conta).
  // bv_acesso: 1 já tinha entrado antes do envio (fora da base).
  const casos = [
    ['fup1_a', 30, 28], ['fup1_a', 30, 1], ['fup1_a', 30, null], ['fup1_a', 30, null],
    ['fup1_b', 30, 25], ['fup1_b', 30, 25], ['fup1_b', 30, null], ['fup1_b', 2, null],
    ['bv_acesso', 30, 40],
  ];
  let i = 0;
  for (const [origem, enviadoHa, entrouHa] of casos) {
    i += 1;
    const a = await pool.query(`INSERT INTO csu_alunos (email, rgm, nome, pw_hash, primeiro_login_em) VALUES ($1, $2, 'Conta Teste', 'x', $3) RETURNING id`,
      [`c${i}@teste.fup`, `77${i}`, entrouHa == null ? null : h(entrouHa)]);
    await pool.query(`INSERT INTO csu_links_acesso (token_hash, aluno_id, origem, criado_em, expira_em) VALUES ($1, $2, $3, $4, now() + interval '7 days')`,
      [`hash${i}`, a.rows[0].id, origem, h(enviadoHa)]);
  }
  const r = await vigia.lerRegua(pool, new Date(agora), vigia.limites({ ab_min_amostra: 3 }));
  const por = Object.fromEntries(r.mensagens.map((m) => [m.origem, [m.base, m.entraram, m.pct]]));
  assert.deepStrictEqual(por, { bv_acesso: [0, 0, null], fup1_a: [4, 1, 25], fup1_b: [3, 2, 66.7] });
  assert.strictEqual(r.testes.length, 1);
  assert.strictEqual(r.testes[0].teste, 'fup1');
  assert.strictEqual(r.testes[0].estado, 'empate', 'amostra mínima atingida, mas 7 contas não decidem nada');
});

(async () => {
  pool = new Pool({ connectionString: url, max: 4 });
  try {
    await preparar();
    for (const [nome, fn] of testes) {
      await fn();
      console.log('ok -', nome);
    }
    console.log(`\n${testes.length} testes com Postgres passaram.`);
  } finally {
    await pool.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
