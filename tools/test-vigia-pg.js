'use strict';
// Vigia contra um Postgres DESCARTÁVEL (nunca o de produção): cria as tabelas, semeia dados de teste,
// roda as rodadas com o n8n e o CRM falsos (sem rede) e confere retrato, trava, envio e aba.
//
//   initdb com LC_ALL=C e LANG=C, pg_ctl start, createdb vigia_teste, e então:
//   VIGIA_TESTE_DB=postgres://usuario@127.0.0.1:PORTA/vigia_teste node tools/test-vigia-pg.js
//
// Recusa rodar se o banco não se chamar *_teste ou se o host não for local.
const assert = require('node:assert');
const { Pool } = require('pg');

const url = process.env.VIGIA_TESTE_DB || '';
const u = url ? new URL(url) : null;
if (!u || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || !/_teste$/.test(u.pathname.slice(1))) {
  console.error('Defina VIGIA_TESTE_DB=postgres://...@127.0.0.1:PORTA/<nome>_teste (banco local descartável).');
  process.exit(2);
}

// Configuração de teste: tokens falsos (o fetch abaixo é falso, nada sai da máquina).
Object.assign(process.env, {
  N8N_API_KEY: 'chave-falsa-n8n', N8N_URL: 'http://n8n.falso',
  CRM_API_TOKEN: 'token-falso-crm', CRM_API_URL: 'http://crm.falso',
  VIGIA_APP_URL: 'http://app.falso', VIGIA_TEMPLATES_CHAVE: 'bv_boas_vindas,bv_acesso_link',
  VIGIA_ALERTA_PARA: 'cmconversaequipe0001', VIGIA_LIGADO: 'true', VIGIA_LIMITES: '',
});

const db = require('../server/db');
const instrumentacao = require('../server/instrumentacao');
const trilha = require('../server/trilha');
const acompanhamento = require('../server/acompanhamento');
const linkAcesso = require('../server/link-acesso');
const vigia = require('../server/vigia');

// ---------- n8n e CRM falsos ----------
const cenario = { erroFluxo: 'bxPxERzvVyriO8qr', vendas: 3, marketing: false, bvSemAcesso: false, matricula: 1 };
const enviados = [];
let relogio = Date.now(); // o n8n e o CRM falsos respondem com horários relativos a este relógio
function resposta(status, corpo) {
  return { status, ok: status >= 200 && status < 300, json: async () => corpo };
}
async function fetchFalso(href, opts = {}) {
  const x = new URL(href);
  const agora = relogio;
  const iso = (min) => new Date(agora - min * 60000).toISOString();
  if (x.host === 'app.falso') {
    if (x.pathname === '/health') return resposta(200, { ok: true });
    if (x.pathname === '/api/integracoes/link-acesso') return resposta(401, { success: false });
  }
  if (x.host === 'n8n.falso') {
    assert.strictEqual(opts.headers['X-N8N-API-KEY'], 'chave-falsa-n8n');
    const id = x.searchParams.get('workflowId');
    const data = [];
    if (id === '36vKiDidEwyN0t8y') for (let i = 0; i < cenario.vendas; i += 1) data.push({ id: `v${i}`, status: 'success', startedAt: iso(10 + i) });
    if (id === cenario.erroFluxo) data.push({ id: 'e1', status: 'error', startedAt: iso(30) });
    data.push({ id: 'velha', status: 'error', startedAt: iso(300) }); // fora da janela
    return resposta(200, { data, nextCursor: null });
  }
  if (x.host === 'crm.falso') {
    assert.strictEqual(opts.headers.Authorization, 'Bearer token-falso-crm');
    if (x.pathname === '/api/whatsapp-template-configs/approved') {
      return resposta(200, [
        { metaTemplateName: 'bv_boas_vindas', category: cenario.marketing ? 'MARKETING' : 'UTILITY' },
        { metaTemplateName: 'bv_acesso_link', category: 'UTILITY' },
      ]);
    }
    const m = x.pathname.match(/^\/api\/automations\/([^/]+)\/logs$/);
    if (m) {
      if (cenario.bvSemAcesso) return resposta(401, { message: 'Não autorizado.' });
      const passo = x.searchParams.get('stepId');
      const items = passo
        ? Array.from({ length: cenario.matricula }, () => ({ status: 'SUCCESS', stepId: passo, executedAt: iso(20), contactName: 'Pessoa Teste', contactPhone: '5511900000000' }))
        : m[1] === vigia.CRM.bv
          ? [{ status: 'SUCCESS', stepId: 's1', executedAt: iso(5), contactName: 'Pessoa Teste' }, { status: 'FAILED', stepId: 's2', executedAt: iso(15), contactPhone: '5511900000000' }]
          : [{ status: 'SUCCESS', stepId: 'e1', executedAt: iso(5) }];
      return resposta(200, { items, total: items.length });
    }
    if (x.pathname.startsWith('/api/analytics/') || x.pathname === '/api/inbox/daily-stats') return resposta(401, { message: 'Não autorizado.' });
    const c = x.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (c && opts.method === 'POST') {
      enviados.push({ conversa: c[1], texto: JSON.parse(opts.body).content });
      return resposta(201, { id: 'msg1' });
    }
  }
  throw new Error(`rota inesperada no teste: ${opts.method || 'GET'} ${href}`);
}

// ---------- dados de teste ----------
async function semear(pool) {
  await db.ensureSchema(pool);
  await Promise.all([instrumentacao.ensureSchema(pool), trilha.ensureSchema(pool), acompanhamento.ensureSchema(pool), linkAcesso.ensureSchema(pool)]);
  await pool.query('TRUNCATE csu_alunos, csu_login_falhas RESTART IDENTITY CASCADE'); // banco descartável
  const ids = [];
  for (let i = 1; i <= 8; i += 1) {
    const r = await pool.query(
      `INSERT INTO csu_alunos (email, rgm, nome, pw_hash, ativo, primeiro_login_em, created_at)
       VALUES ($1, $2, $3, 'x', TRUE, $4, now() - interval '1 day') RETURNING id`,
      [`conta${i}@teste.vigia`, `99000${i}`, `Conta Teste ${i}`, i <= 5 ? new Date() : null],
    );
    ids.push(r.rows[0].id);
  }
  for (let i = 0; i < 5; i += 1) await instrumentacao.entrada(pool, { alunoId: ids[i], origem: i < 3 ? 'bv_acesso' : 'bv', primeira: i < 2, via: 'login' });
  for (const motivo of ['senha_incorreta', 'senha_incorreta', 'esqueci_senha']) await instrumentacao.falha(pool, { motivo, origem: 'bv' });
  await pool.query(`INSERT INTO csu_trilha_progresso (aluno_id, nivel, travei) VALUES ($1, 1, '{"p1": 2}'), ($2, 1, '{}')`, [ids[0], ids[1]]);
  await pool.query(`INSERT INTO csu_eventos (aluno_id, nome) VALUES ($1, 'certificado_erro'), ($1, 'video_inicio'), ($2, 'video_inicio'), ($2, 'video_fim')`, [ids[0], ids[1]]);
  for (const r of ['ok', 'ok', 'ok', 'conta_nao_encontrada']) await vigia.registrarPedidoLink(pool, r, 'bv_acesso');
  await linkAcesso.gerar(pool, ids[2], 'bv_acesso');
  return ids;
}

const testes = [];
function teste(nome, fn) { testes.push([nome, fn]); }

let pool;
const faixa = (h) => new Date(`2026-11-06T${String(h + 3).padStart(2, '0')}:05:00Z`); // h = hora de Brasília

function rodada(h, fetchImpl) {
  relogio = faixa(h).getTime();
  return vigia.rodadaAgendada(pool, { agora: faixa(h), fetchImpl });
}

teste('retrato com os números do app, do n8n e do CRM', async () => {
  await vigia.ensureSchema(pool);
  await pool.query('TRUNCATE csu_vigia_retratos, csu_link_acesso_pedidos');
  await semear(pool);
  relogio = Date.now();
  const r = await vigia.rodar(pool, { slot: null, fetchImpl: fetchFalso });
  const a = r.indicadores.app;
  assert.strictEqual(r.manual, true);
  assert.deepStrictEqual(a.entradas.por_origem, { bv_acesso: 3, bv: 2 });
  assert.strictEqual(a.entradas.primeiras, 2);
  assert.deepStrictEqual([a.falhas.total, a.falhas.tentativas], [2, 7], 'esqueci_senha não conta como tentativa');
  assert.strictEqual(a.contas.nunca_entraram, 3);
  assert.strictEqual(a.travados, 1);
  assert.deepStrictEqual([a.eventos.certificado_erro, a.eventos.video_inicio, a.eventos.video_fim], [1, 2, 1]);
  assert.deepStrictEqual([a.links.pedidos, a.links.falhas, a.links.vazio_pct, a.links.gerados], [4, 1, 25, 1]);
  assert.strictEqual(r.indicadores.n8n.vendas, 3);
  assert.strictEqual(r.indicadores.n8n.fluxos.find((f) => f.id === 'bxPxERzvVyriO8qr').erro, 1);
  assert.deepStrictEqual([r.indicadores.crm.bv.falhas, r.indicadores.crm.bv.matricula], [1, 1]);
  assert.deepStrictEqual(r.fontes.crm_atendimento, { estado: 'sem_acesso', status: 401, codigo: null });
  const al = r.alertas.map((x) => x.id).sort();
  assert.deepStrictEqual(al, ['bv_failed', 'bv_matricula', 'link_vazio', 'n8n_erro:bxPxERzvVyriO8qr']);
  assert.ok(r.envio.mensagem.includes('Link de acesso saindo vazio'), 'a leitura manual mostra a prévia');
  assert.strictEqual(r.envio.enviado, false);
  assert.strictEqual(enviados.length, 0, 'leitura manual nunca envia');
  const txt = JSON.stringify(r);
  ['Conta Teste', '@teste.vigia', '990001', 'Pessoa Teste', '5511900000000'].forEach((p) => assert.ok(!txt.includes(p), `retrato contém ${p}`));
});

teste('rodada agendada envia uma mensagem e não repete na faixa seguinte se nada mudou', async () => {
  const r1 = await rodada(10, fetchFalso);
  assert.strictEqual(r1.rodou, true);
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].conversa, 'cmconversaequipe0001');
  assert.match(enviados[0].texto, /Erro no n8n: acad_senha_reserva/);
  assert.match(enviados[0].texto, /Graduação caindo no template de matrícula/);
  assert.strictEqual(r1.retrato.envio.enviado, true);

  const r2 = await rodada(10, fetchFalso);
  assert.deepStrictEqual([r2.rodou, r2.motivo], [false, 'faixa_lida'], 'mesma faixa não roda de novo');

  const r3 = await rodada(12, fetchFalso);
  assert.strictEqual(r3.rodou, true);
  assert.strictEqual(r3.retrato.envio.motivo, 'nada_novo');
  assert.strictEqual(enviados.length, 1, 'nada mudou: nenhuma mensagem nova');
});

teste('mudou: alerta novo e o que voltou ao normal saem numa mensagem só', async () => {
  cenario.erroFluxo = null;  // n8n voltou ao normal
  cenario.marketing = true;  // template virou MARKETING
  const r = await rodada(14, fetchFalso);
  assert.strictEqual(r.rodou, true);
  assert.strictEqual(enviados.length, 2);
  const t = enviados[1].texto;
  assert.match(t, /Template virou MARKETING: bv_boas_vindas/);
  assert.match(t, /Voltou ao normal: Erro no n8n: acad_senha_reserva/);
  assert.ok(!t.includes('Graduação caindo'), 'o que já foi avisado e continua igual não repete');
  assert.match(t, /Seguem abertos \(já avisados\): 3\./);
});

teste('envio que falha é tentado de novo na faixa seguinte', async () => {
  cenario.matricula = 0;
  cenario.vendas = 0;
  const falha = (href, opts) => (opts && opts.method === 'POST' && href.includes('/messages') ? Promise.resolve(resposta(500, {})) : fetchFalso(href, opts));
  const r1 = await rodada(16, falha);
  assert.strictEqual(r1.retrato.envio.enviado, false);
  assert.strictEqual(r1.retrato.envio.motivo, 'HTTP 500');
  const r2 = await rodada(18, fetchFalso);
  assert.strictEqual(r2.retrato.envio.enviado, true);
  assert.match(enviados[enviados.length - 1].texto, /Nenhuma venda em 2 h/);
  assert.match(enviados[enviados.length - 1].texto, /Voltou ao normal: Graduação caindo no template de matrícula/);
});

teste('trava: com outra instância rodando, esta não roda', async () => {
  const outra = await pool.connect();
  try {
    await outra.query('SELECT pg_advisory_lock(7724001)');
    const r = await rodada(20, fetchFalso);
    assert.deepStrictEqual([r.rodou, r.motivo], [false, 'outra_instancia']);
  } finally {
    await outra.query('SELECT pg_advisory_unlock(7724001)');
    outra.release();
  }
  const n = await pool.query('SELECT COUNT(*)::int AS n FROM csu_vigia_retratos WHERE slot = $1', [vigia.slotDe(faixa(20))]);
  assert.strictEqual(n.rows[0].n, 0);
});

teste('duas instâncias ao mesmo tempo (pools separados): só um retrato na faixa', async () => {
  const outroPool = new Pool({ connectionString: url, max: 2 });
  const vigia2 = (() => { delete require.cache[require.resolve('../server/vigia')]; return require('../server/vigia'); })();
  try {
    const [a, b] = await Promise.all([
      rodada(20, fetchFalso),
      vigia2.rodadaAgendada(outroPool, { agora: faixa(20), fetchImpl: fetchFalso }),
    ]);
    assert.strictEqual([a.rodou, b.rodou].filter(Boolean).length, 1, JSON.stringify([a.motivo, b.motivo]));
  } finally {
    await outroPool.end();
  }
  const n = await pool.query('SELECT COUNT(*)::int AS n FROM csu_vigia_retratos WHERE slot = $1', [vigia.slotDe(faixa(20))]);
  assert.strictEqual(n.rows[0].n, 1);
});

teste('aba: último retrato, tendência de 24 h e aviso de atraso', async () => {
  const p = await vigia.painelAdmin(pool);
  assert.ok(p.ultimo && p.ultimo.indicadores.resumo);
  assert.ok(!('conhecidos' in p.ultimo.envio) && !('para' in p.ultimo.envio), 'a aba não expõe o destino');
  assert.ok(p.tendencia.length >= 1);
  assert.strictEqual(p.config.alerta_para, true);
  // As rodadas de teste têm data de 06/11/2026; se hoje for depois, a última agendada está "atrasada".
  assert.strictEqual(typeof p.atrasado, 'boolean');
  await pool.query("UPDATE csu_vigia_retratos SET lido_em = now() - interval '3 hours' WHERE slot IS NOT NULL");
  assert.strictEqual((await vigia.painelAdmin(pool)).atrasado, true, '3 h sem leitura agendada');
  await pool.query("UPDATE csu_vigia_retratos SET lido_em = now() - interval '20 minutes' WHERE slot = $1", [vigia.slotDe(faixa(20))]);
  const q = await vigia.painelAdmin(pool);
  assert.strictEqual(q.atrasado, false);
  assert.strictEqual(q.minutos_sem_leitura, 20);
});

teste('sem as chaves: n8n e CRM desligados, nada enviado', async () => {
  const antes = { ...process.env };
  delete process.env.N8N_API_KEY; delete process.env.CRM_API_TOKEN;
  try {
    relogio = Date.now();
  const r = await vigia.rodar(pool, { slot: null, fetchImpl: fetchFalso });
    assert.strictEqual(r.fontes.n8n.estado, 'desligado');
    assert.strictEqual(r.fontes.crm_bv.estado, 'desligado');
    assert.strictEqual(r.indicadores.n8n, null);
    assert.ok(!r.alertas.some((x) => x.id.startsWith('fonte:')));
  } finally {
    Object.assign(process.env, antes);
  }
});

(async () => {
  pool = new Pool({ connectionString: url, max: 4 });
  try {
    for (const [nome, fn] of testes) {
      await fn();
      console.log('ok -', nome);
    }
    console.log(`\n${testes.length} testes com Postgres passaram.`);
  } finally {
    await pool.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
