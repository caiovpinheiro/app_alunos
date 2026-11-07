'use strict';
/*
 * Teste do link de acesso (server/link-acesso.js) contra um Postgres de teste.
 *
 *   DATABASE_URL=postgres://localhost:5433/teste LINK_ACESSO_SEGREDO=x node tools/test-link-acesso.js
 *
 * Cobre: primeira entrada grava o cookie do aparelho; tocar de novo no mesmo aparelho entra;
 * outro aparelho ou sem cookie conta como usado; link novo cancela o antigo; link vencido;
 * situação de acesso para o follow-up (não entrou, entrou, sem conta, segredo errado).
 * Nunca rode contra o banco de produção: o teste cria e apaga um aluno.
 */
const assert = require('node:assert/strict');
const express = require('express');
const { Pool } = require('pg');
const db = require('../server/db');
const instrumentacao = require('../server/instrumentacao');
const linkAcesso = require('../server/link-acesso');

const url = process.env.DATABASE_URL;
if (!url || /easypanel|cruzeiro|amazonaws|\.com/.test(url)) {
  console.error('Use DATABASE_URL de um Postgres local de teste.');
  process.exit(1);
}
process.env.LINK_ACESSO_SEGREDO = process.env.LINK_ACESSO_SEGREDO || 'segredo-de-teste';

const pool = new Pool({ connectionString: url });

function cookieDe(res) {
  const c = res.headers.get('set-cookie') || '';
  const m = /csu_link=([^;]+)/.exec(c);
  return { valor: m ? m[1] : null, bruto: c };
}

async function main() {
  await db.ensureSchema(pool);
  await instrumentacao.garantir(pool);
  await linkAcesso.ensureSchema(pool);
  const rgm = '99887766';
  await pool.query('DELETE FROM csu_alunos WHERE rgm = $1', [rgm]);
  const ins = await pool.query(
    `INSERT INTO csu_alunos (email, rgm, nome, pw_hash) VALUES ($1, $2, $3, 'DERIVED') RETURNING id`,
    ['teste.link@example.com', rgm, 'Teste Link'],
  );
  const alunoId = ins.rows[0].id;

  const app = express();
  app.use(express.json());
  linkAcesso.registrarRotas(app, {
    getPool: () => pool,
    findAluno: db.findAlunoByIdentifier,
    createSession: db.createSession,
    instrumentacao,
    ensureSchemaAlunos: () => db.ensureSchema(pool),
  });
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const entrar = (token, cookie) => fetch(base + '/api/auth/link', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: 'csu_link=' + cookie } : {}),
    body: JSON.stringify({ token, origem: 'teste' }),
  });

  const situacao = (rgmX, segredo) => fetch(base + '/api/integracoes/situacao-acesso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Segredo': segredo || process.env.LINK_ACESSO_SEGREDO },
    body: JSON.stringify({ rgm: rgmX }),
  });

  try {
    // 0. Situação antes de tudo: conta existe e nunca entrou; RGM sem conta; segredo errado.
    let s = await situacao(rgm);
    assert.equal(s.status, 200);
    let sb = await s.json();
    assert.equal(sb.situacao, 'nao_entrou', 'conta nova não entrou');
    assert.equal(sb.link, null, 'sem link ainda');
    assert.equal((await (await situacao('11112222')).json()).situacao, 'sem_conta');
    assert.equal((await situacao(rgm, 'errado')).status, 401, 'segredo errado');

    // Gera pelo endpoint do n8n.
    let r = await fetch(base + '/api/integracoes/link-acesso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Segredo': process.env.LINK_ACESSO_SEGREDO },
      body: JSON.stringify({ rgm, origem: 'bv_acesso' }),
    });
    assert.equal(r.status, 200, 'gera o link');
    const token = /\/a\/([A-Za-z0-9_-]+)/.exec((await r.json()).url)[1];

    // Link gerado e ainda não usado: continua "nao_entrou", com o link pendente.
    sb = await (await situacao(rgm)).json();
    assert.equal(sb.situacao, 'nao_entrou');
    assert.deepEqual([sb.link.usado, sb.link.vencido], [false, false]);

    // 1. Primeira entrada: sessão e cookie do aparelho só na rota do link.
    r = await entrar(token);
    assert.equal(r.status, 200, 'primeira entrada');
    const ck = cookieDe(r);
    assert.ok(ck.valor, 'grava o cookie do aparelho');
    assert.match(ck.bruto, /Path=\/api\/auth\/link/);
    assert.match(ck.bruto, /HttpOnly/);
    const b1 = await r.json();
    assert.ok(b1.token, 'devolve sessão');

    sb = await (await situacao(rgm)).json();
    assert.equal(sb.situacao, 'entrou', 'depois de entrar pelo link');
    assert.ok(sb.primeira_entrada_em);
    assert.equal(sb.link.usado, true);

    // 2. Mesmo aparelho, toca de novo: entra de novo, sem regravar o cookie.
    r = await entrar(token, ck.valor);
    assert.equal(r.status, 200, 'entra de novo no mesmo aparelho');
    assert.equal(cookieDe(r).valor, null, 'não troca o cookie no reuso');
    const b2 = await r.json();
    assert.notEqual(b2.token, b1.token, 'sessão nova a cada entrada');

    // 3. Sem cookie (outro aparelho) e com cookie errado: já usado, com o RGM para preencher.
    r = await entrar(token);
    assert.equal(r.status, 401);
    let b = await r.json();
    assert.equal(b.codigo, 'link_usado');
    assert.equal(b.rgm, rgm);
    r = await entrar(token, 'X'.repeat(43));
    assert.equal((await r.json()).codigo, 'link_usado', 'cookie de outro aparelho');

    // 4. Link novo para o mesmo aluno cancela o antigo, inclusive no aparelho que já usou.
    r = await fetch(base + '/api/integracoes/link-acesso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Segredo': process.env.LINK_ACESSO_SEGREDO },
      body: JSON.stringify({ rgm, origem: 'bv_acesso' }),
    });
    const token2 = /\/a\/([A-Za-z0-9_-]+)/.exec((await r.json()).url)[1];
    r = await entrar(token, ck.valor);
    assert.equal((await r.json()).codigo, 'link_usado', 'antigo cancelado');
    r = await entrar(token2);
    assert.equal(r.status, 200, 'novo funciona');
    const ck2 = cookieDe(r).valor;

    // 5. Vencido: nem o mesmo aparelho entra.
    await pool.query(`UPDATE csu_links_acesso SET expira_em = now() - interval '1 minute' WHERE aluno_id = $1 AND cancelado_em IS NULL`, [alunoId]);
    r = await entrar(token2, ck2);
    b = await r.json();
    assert.equal(b.codigo, 'link_expirado');

    // 6. Inválido.
    r = await entrar('curto');
    assert.equal((await r.json()).codigo, 'link_invalido');

    // 7. Entradas registradas: duas pelo link, uma de novo.
    const e = await pool.query(`SELECT via, count(*)::int AS n FROM csu_entradas WHERE aluno_id = $1 GROUP BY via ORDER BY via`, [alunoId]);
    assert.deepEqual(Object.fromEntries(e.rows.map((x) => [x.via, x.n])), { link: 2, link_de_novo: 1 });

    console.log('ok: link de acesso (primeira entrada, mesmo aparelho, outro aparelho, cancelado, vencido, inválido) e situação de acesso');
  } finally {
    srv.close();
    await pool.query('DELETE FROM csu_alunos WHERE id = $1', [alunoId]);
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
