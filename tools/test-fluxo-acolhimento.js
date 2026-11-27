'use strict';
// Admin › Fluxo do Acolhimento: node tools/test-fluxo-acolhimento.js
//
// Parte 1, sem banco: o fluxo inicial (server/dados/fluxo-acolhimento-inicial.json) passa inteiro pela validação,
// e a validação limpa o que vem do navegador (tipos, limites, botões, saídas soltas ou repetidas, ids).
// Parte 2, com um Postgres LOCAL descartável: cria um banco temporário (createdb), roda a migração duas vezes,
// lê o inicial, salva, recusa quem salva em cima de versão velha (409), restaura e apaga o banco no fim.
// Nunca lê o .env: só conecta em localhost / socket local. Sem Postgres local, a parte 2 é pulada (e diz isso).

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const fluxo = require('../server/fluxo-acolhimento');

let passos = 0;
let falhas = 0;
async function caso(nome, fn) {
  try {
    await fn();
    passos += 1;
    console.log('  ok  ' + nome);
  } catch (err) {
    falhas += 1;
    console.log('  FALHOU  ' + nome + '\n        ' + (err && err.message));
  }
}

async function semBanco() {
  console.log('=== Parte 1: validação, sem banco ===');

  await caso('fluxo inicial: 17 etapas e 19 saídas, sem perder nada do arquivo fornecido', () => {
    const bruto = require('../server/dados/fluxo-acolhimento-inicial.json');
    const f = fluxo.inicial();
    assert.strictEqual(f.nodes.length, 17);
    assert.strictEqual(f.edges.length, 19);
    assert.deepStrictEqual(f, bruto, 'o inicial normalizado é idêntico ao JSON fornecido');
    const welcome = f.nodes.find((n) => n.id === 'welcome');
    assert.match(welcome.content, /\{\{dealCustomFields\.rgm\}\}/);
  });

  await caso('formato errado vira FluxoInvalido', () => {
    for (const ruim of [null, {}, { nodes: [] , edges: [] }, { nodes: {}, edges: [] }, { nodes: [{ id: 'a b' }], edges: [] }]) {
      assert.throws(() => fluxo.normalizar(ruim), fluxo.FluxoInvalido);
    }
    assert.throws(() => fluxo.normalizar({ nodes: [{ id: 'a' }, { id: 'a' }], edges: [] }), /repetido/);
    const muitas = Array.from({ length: fluxo.LIMITES.etapas + 1 }, (_, i) => ({ id: 'n' + i }));
    assert.throws(() => fluxo.normalizar({ nodes: muitas, edges: [] }), /até/);
  });

  await caso('limpa campos: tipo desconhecido, textos longos, coordenadas, botões', () => {
    const f = fluxo.normalizar({
      nodes: [{
        id: 'x', title: '   ', content: 'a\r\nb' + 'z'.repeat(5000), type: 'disparar_agora', x: -50, y: '12.6',
        buttons: ['  Sim  ', '', 'Não', 'Talvez', 'Quarto', 'linha\nquebrada'],
      }],
      edges: [],
    });
    const n = f.nodes[0];
    assert.strictEqual(n.title, 'Sem título');
    assert.strictEqual(n.type, 'action');
    assert.strictEqual(n.content.length, fluxo.LIMITES.conteudo);
    assert.ok(n.content.startsWith('a\nb'));
    assert.deepStrictEqual([n.x, n.y], [0, 13]);
    assert.deepStrictEqual(n.buttons, ['Sim', 'Não', 'Talvez']);
    assert.ok(!('buttons' in fluxo.normalizar({ nodes: [{ id: 'y', buttons: [] }], edges: [] }).nodes[0]));
  });

  await caso('saídas: some a que aponta para etapa inexistente e a repetida', () => {
    const f = fluxo.normalizar({
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [
        { from: 'a', to: 'b', label: 'Sim' }, { from: 'a', to: 'b', label: 'Sim' }, { from: 'a', to: 'b', label: 'Não' },
        { from: 'a', to: 'sumiu' }, null, { from: 'b', to: 'a', label: 'x'.repeat(200) },
      ],
    });
    assert.deepStrictEqual(f.edges.map((e) => e.label.length), [3, 3, fluxo.LIMITES.rotulo]);
  });

  await caso('campos extras do navegador não são gravados', () => {
    const f = fluxo.normalizar({ nodes: [{ id: 'a', title: 'A', webhook: 'https://exemplo', __proto__x: 1 }], edges: [{ from: 'a', to: 'a', disparar: true }] });
    assert.deepStrictEqual(Object.keys(f.nodes[0]).sort(), ['content', 'id', 'title', 'type', 'x', 'y']);
    assert.deepStrictEqual(Object.keys(f.edges[0]).sort(), ['from', 'label', 'to']);
  });
}

function hostLocal() {
  const h = process.env.PGHOST || 'localhost';
  if (!/^(localhost|127\.0\.0\.1|::1|\/.*)$/.test(h)) throw new Error(`PGHOST=${h} não é local: o teste só roda em Postgres local.`);
  return h;
}

async function comBanco() {
  console.log('\n=== Parte 2: com Postgres local descartável ===');
  const { Pool } = require('pg');
  const host = hostLocal();
  const nomeDb = `test_fluxo_acolhimento_${process.pid}`;
  try {
    execFileSync('createdb', ['-h', host, nomeDb], { stdio: 'pipe' });
  } catch (err) {
    console.log(`  PULADO: sem Postgres local para criar o banco de teste (${String(err.message).split('\n')[0]}).`);
    return;
  }
  const pool = new Pool({ host, database: nomeDb, user: process.env.PGUSER || os.userInfo().username, max: 4 });
  try {
    await pool.query(`CREATE TABLE csu_admins (id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, nome TEXT NOT NULL, pw_hash TEXT NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const adm = (await pool.query(`INSERT INTO csu_admins (email, nome, pw_hash) VALUES ('a@teste.local', 'Equipe Teste', 'x') RETURNING id`)).rows[0].id;

    await caso('migração roda duas vezes sem erro', async () => {
      await fluxo.ensureSchema(pool);
      await fluxo.ensureSchema(pool);
    });

    let primeira;
    await caso('sem linha salva, devolve o fluxo inicial', async () => {
      const r = await fluxo.ler(pool);
      assert.strictEqual(r.inicial, true);
      assert.strictEqual(r.atualizado_em, null);
      assert.strictEqual(r.fluxo.nodes.length, 17);
    });

    await caso('salvar grava, guarda quem salvou e recarregar mantém a edição', async () => {
      const f = fluxo.inicial();
      f.nodes.find((n) => n.id === 'invite').buttons = ['Sim, agora', 'Prefiro depois'];
      f.nodes[0].title = 'Início editado';
      primeira = await fluxo.salvar(pool, f, { adminId: adm, base: null });
      assert.strictEqual(primeira.inicial, false);
      assert.strictEqual(primeira.atualizado_por, 'Equipe Teste');
      const lido = await fluxo.ler(pool);
      assert.strictEqual(lido.fluxo.nodes[0].title, 'Início editado');
      assert.deepStrictEqual(lido.fluxo.nodes.find((n) => n.id === 'invite').buttons, ['Sim, agora', 'Prefiro depois']);
      assert.strictEqual(lido.atualizado_em, primeira.atualizado_em);
    });

    await caso('quem salva em cima de versão velha recebe Conflito (409) e nada muda', async () => {
      const f = fluxo.inicial();
      f.nodes[0].title = 'Versão de outra aba';
      await assert.rejects(fluxo.salvar(pool, f, { adminId: adm, base: null }), fluxo.Conflito);
      await assert.rejects(fluxo.salvar(pool, f, { adminId: adm, base: '2000-01-01T00:00:00.000Z' }), fluxo.Conflito);
      assert.strictEqual((await fluxo.ler(pool)).fluxo.nodes[0].title, 'Início editado');
      const ok = await fluxo.salvar(pool, f, { adminId: adm, base: primeira.atualizado_em });
      assert.strictEqual(ok.fluxo.nodes[0].title, 'Versão de outra aba');
    });

    await caso('fluxo inválido não chega ao banco', async () => {
      const antes = (await fluxo.ler(pool)).atualizado_em;
      await assert.rejects(fluxo.salvar(pool, { nodes: [], edges: [] }, { adminId: adm }), fluxo.FluxoInvalido);
      assert.strictEqual((await fluxo.ler(pool)).atualizado_em, antes);
    });

    await caso('restaurar volta ao fluxo inicial', async () => {
      const r = await fluxo.restaurar(pool);
      assert.strictEqual(r.inicial, true);
      assert.strictEqual(r.fluxo.nodes[0].title, 'Início');
      assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM csu_fluxo_acolhimento')).rows[0].n, 0);
    });
  } finally {
    await pool.end();
    execFileSync('dropdb', ['-h', host, nomeDb], { stdio: 'pipe' });
  }
}

(async () => {
  await semBanco();
  if (process.argv.includes('--sem-banco')) console.log('\n(parte 2 pulada: --sem-banco)');
  else await comBanco();
  console.log(falhas ? `\n*** ${falhas} FALHA(S) em ${passos + falhas} casos ***` : `\nTodos os ${passos} casos passaram.`);
  if (falhas) process.exitCode = 1;
})().catch((err) => {
  console.error('Erro no teste:', err);
  process.exitCode = 1;
});
