'use strict';
// Vigia (server/vigia.js), sem banco e sem rede: node tools/test-vigia.js
// O teste com Postgres descartável fica em tools/test-vigia-pg.js.
const assert = require('node:assert');
const vigia = require('../server/vigia');

const testes = [];
function teste(nome, fn) { testes.push([nome, fn]); }

const L = vigia.limites({});
const agora = new Date('2026-11-06T17:00:00Z'); // 14h em Brasília
const inicio = new Date(agora.getTime() - 120 * 60000);

function indBase() {
  return {
    janela_min: 120,
    saude: { url: 'https://app.teste', app: { estado: 'ok' }, gerador: { estado: 'ok' } },
    app: {
      entradas: { total: 20, primeiras: 5, por_origem: { bv_acesso: 12, bv: 8 } },
      falhas: { total: 2, tentativas: 22, pct: 9.1, por_motivo: { senha_incorreta: 2, esqueci_senha: 3 } },
      contas: { contas: 100, nunca_entraram: 30, novas: 4 },
      travados: 2,
      eventos: { certificado_erro: 0, certificado_gerado: 3, video_inicio: 10, video_fim: 7 },
      links: { pedidos: 10, ok: 10, falhas: 0, por_resultado: { ok: 10 }, vazio_pct: 0, gerados: 10, usados: 4 },
    },
    n8n: { vendas: 6, fluxos: vigia.FLUXOS_N8N.map((f) => ({ id: f.id, nome: f.nome, vendas: Boolean(f.vendas), lido: true, total: 6, sucesso: 6, erro: 0 })) },
    crm: { templates: [{ nome: 'bv_boas_vindas', aprovado: true, categoria: 'UTILITY' }], bv: { total: 30, falhas: 0, por_status: {}, falhas_por_passo: {}, matricula: 0 }, email_acad: { total: 5, falhas: 0 } },
  };
}
const fontesOk = { app: { estado: 'ok' }, n8n: { estado: 'ok' }, crm_templates: { estado: 'ok' }, crm_bv: { estado: 'ok' }, crm_email: { estado: 'ok' }, crm_atendimento: { estado: 'sem_acesso', status: 401 } };
const ids = (al) => al.map((x) => x.id).sort();

// ---------- configuração ----------
teste('limites: padrões, JSON parcial e valores inválidos ignorados', () => {
  assert.strictEqual(L.falhas_login_pct, 30);
  const x = vigia.limites({ falhas_login_pct: 25, link_vazio_pct: 'abc', janela_min: 5, bv_ignorar_passos: ['p1'], extra: 1 });
  assert.strictEqual(x.falhas_login_pct, 25);
  assert.strictEqual(x.link_vazio_pct, 10);
  assert.strictEqual(x.janela_min, 30, 'janela mínima de 30 min');
  assert.deepStrictEqual(x.bv_ignorar_passos, ['p1']);
  assert.ok(!('extra' in x));
});

teste('faixa de 2 h alinhada ao horário de Brasília', () => {
  assert.strictEqual(vigia.slotDe('2026-11-06T17:59:00Z'), '2026-11-06T17:00:00.000Z'); // 14h59 → faixa das 14h
  assert.strictEqual(vigia.slotDe('2026-11-06T16:59:00Z'), '2026-11-06T15:00:00.000Z'); // 13h59 → faixa das 12h
  assert.strictEqual(vigia.slotDe('2026-11-06T13:00:00Z'), '2026-11-06T13:00:00.000Z'); // 10h00 → faixa das 10h
  assert.strictEqual(vigia.slotDe('2026-11-06T02:30:00Z'), '2026-11-06T01:00:00.000Z'); // 23h30 → faixa das 22h
  assert.strictEqual(vigia.minutosSP('2026-11-06T17:05:00Z'), 14 * 60 + 5);
});

// ---------- agregação ----------
teste('n8n: conta só a janela; error e crashed são erro', () => {
  const r = vigia.agregarN8n([
    { status: 'success', startedAt: '2026-11-06T16:50:00Z' },
    { status: 'error', startedAt: '2026-11-06T16:00:00Z' },
    { status: 'crashed', startedAt: '2026-11-06T15:30:00Z' },
    { status: 'running', startedAt: '2026-11-06T16:59:00Z' },
    { status: 'error', startedAt: '2026-11-06T14:00:00Z' }, // fora da janela
  ], inicio);
  assert.deepStrictEqual([r.total, r.sucesso, r.erro, r.rodando], [4, 1, 2, 1]);
  assert.strictEqual(r.ultimo_erro_em, '2026-11-06T16:00:00.000Z');
});

teste('logs do CRM: só status, passo e horário; ignora passos tratados', () => {
  const r = vigia.agregarLogs([
    { status: 'SUCCESS', stepId: 'a', executedAt: '2026-11-06T16:00:00Z', contactName: 'Fulana', contactPhone: '5511999999999' },
    { status: 'FAILED', stepId: 'a', executedAt: '2026-11-06T16:10:00Z' },
    { status: 'FAILED', stepId: 'b', executedAt: '2026-11-06T16:20:00Z' },
    { status: 'FAILED', stepId: null, executedAt: '2026-11-06T16:30:00Z' },
    { status: 'FAILED', stepId: 'a', executedAt: '2026-11-06T10:00:00Z' }, // fora da janela
  ], inicio, { ignorar: ['b'] });
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.falhas, 2);
  assert.deepStrictEqual(r.falhas_por_passo, { a: 1, gatilho: 1 });
  assert.ok(!JSON.stringify(r).includes('Fulana') && !JSON.stringify(r).includes('5511'), 'nada pessoal no agregado');
});

teste('atendimento: só números, um nível', () => {
  assert.deepStrictEqual(vigia.numeros({ abertas: 3, nome: 'x', fila: { media: 2.5, rotulo: 'y' }, lista: [1, 2] }), { abertas: 3, 'fila.media': 2.5 });
});

// ---------- regras ----------
teste('tudo normal: nenhum alerta (fonte sem acesso não alerta)', () => {
  assert.deepStrictEqual(vigia.regras(indBase(), fontesOk, L, { inicio, agora }), []);
});

teste('cada regra do ponto de partida dispara', () => {
  const ind = indBase();
  ind.n8n.fluxos[2].erro = 2;                          // acad_senha_reserva com erro
  ind.n8n.vendas = 0;                                   // zero vendas às 14h
  ind.app.links = { pedidos: 10, ok: 8, falhas: 2, por_resultado: { ok: 8, conta_nao_encontrada: 2 }, vazio_pct: 20 };
  ind.crm.bv.falhas = 3; ind.crm.bv.falhas_por_passo = { p9: 3 };
  ind.crm.bv.matricula = 1;
  ind.crm.templates = [{ nome: 'bv_a', aprovado: false, categoria: null }, { nome: 'bv_b', aprovado: true, categoria: 'MARKETING' }];
  ind.app.falhas = { total: 10, tentativas: 25, pct: 40, por_motivo: { senha_incorreta: 9, conta_nao_encontrada: 1 } };
  ind.saude.gerador = { estado: 'desligado', status: 503 };
  const al = vigia.regras(ind, fontesOk, L, { inicio, agora });
  assert.deepStrictEqual(ids(al), ['bv_failed', 'bv_matricula', 'falhas_login', 'gerador_desligado', 'link_vazio', 'n8n_erro:bxPxERzvVyriO8qr',
    'template:bv_a', 'template:bv_b', 'vendas_zero'].sort());
  const link = al.find((x) => x.id === 'link_vazio');
  assert.match(link.detalhe, /2 de 10 pedidos sem link \(20%\)/);
  assert.match(link.acao, /Alunos Provisorios/);
  assert.strictEqual(al.find((x) => x.id === 'bv_matricula').nivel, 'critico');
  assert.match(al.find((x) => x.id === 'falhas_login').acao, /senha inicial/);
  al.forEach((x) => assert.ok(x.titulo && x.detalhe && x.acao, `${x.id} sem texto`));
});

teste('vendas: só com a janela inteira entre 8h e 22h', () => {
  const ind = indBase();
  ind.n8n.vendas = 0;
  const em = (iso) => { const a = new Date(iso); return { inicio: new Date(a.getTime() - 120 * 60000), agora: a }; };
  assert.deepStrictEqual(ids(vigia.regras(ind, fontesOk, L, em('2026-11-06T12:00:00Z'))), []);           // 07h-09h
  assert.deepStrictEqual(ids(vigia.regras(ind, fontesOk, L, em('2026-11-06T13:00:00Z'))), ['vendas_zero']); // 08h-10h
  assert.deepStrictEqual(ids(vigia.regras(ind, fontesOk, L, em('2026-11-07T01:05:00Z'))), ['vendas_zero']); // 20h05-22h05
  assert.deepStrictEqual(ids(vigia.regras(ind, fontesOk, L, em('2026-11-07T03:00:00Z'))), []);           // 22h-00h
  ind.n8n.vendas = null; // fluxo de vendas não lido: não dá para dizer que não houve venda
  assert.deepStrictEqual(ids(vigia.regras(ind, fontesOk, L, em('2026-11-06T17:00:00Z'))), []);
});

teste('amostra pequena não alerta (link e login)', () => {
  const ind = indBase();
  ind.app.links = { pedidos: 2, ok: 0, falhas: 2, por_resultado: { erro: 2 }, vazio_pct: 100 };
  ind.app.falhas = { total: 5, tentativas: 6, pct: 83.3, por_motivo: { senha_incorreta: 5 } };
  assert.deepStrictEqual(vigia.regras(ind, fontesOk, L, { inicio, agora }), []);
});

teste('fonte com erro ou chave recusada vira alerta; sem acesso e desligada não', () => {
  const f = { ...fontesOk, n8n: { estado: 'recusado', status: 401 }, crm_bv: { estado: 'sem_acesso', status: 401 }, crm_templates: { estado: 'erro', status: 0, detalhe: 'sem resposta' }, crm_email: { estado: 'desligado' } };
  const ind = indBase();
  const al = vigia.regras(ind, f, L, { inicio, agora });
  assert.deepStrictEqual(ids(al), ['fonte:crm_templates', 'fonte:n8n']);
  assert.match(al.find((x) => x.id === 'fonte:n8n').acao, /N8N_API_KEY/);
});

teste('app fora do ar não duplica com gerador fora', () => {
  const ind = indBase();
  ind.saude.app = { estado: 'fora', status: 0, detalhe: 'sem resposta' };
  ind.saude.gerador = { estado: 'fora', status: 0, detalhe: 'sem resposta' };
  assert.deepStrictEqual(ids(vigia.regras(ind, fontesOk, L, { inicio, agora })), ['app_fora']);
});

// ---------- envio sem repetir ----------
teste('novidades: alerta igual não repete; mudou de nível ou voltou ao normal, avisa', () => {
  const a1 = [{ id: 'link_vazio', nivel: 'critico', titulo: 'Link' }, { id: 'falhas_login', nivel: 'atencao', titulo: 'Login' }];
  const r1 = vigia.novidades(a1, {}, agora);
  assert.deepStrictEqual(r1.novos.map((x) => x.id), ['link_vazio', 'falhas_login']);
  const depois = new Date(agora.getTime() + 2 * 3600000);
  const r2 = vigia.novidades(a1, r1.proximo, depois);
  assert.deepStrictEqual([r2.novos.length, r2.resolvidos.length], [0, 0], 'nada mudou: nada a enviar');
  const r3 = vigia.novidades([{ id: 'link_vazio', nivel: 'atencao', titulo: 'Link' }], r2.proximo, depois);
  assert.deepStrictEqual(r3.novos.map((x) => x.id), ['link_vazio'], 'mudou de nível');
  assert.deepStrictEqual(r3.resolvidos, ['falhas_login']);
  const r4 = vigia.novidades(a1.slice(0, 1), r1.proximo, new Date(agora.getTime() + 13 * 3600000), 12);
  assert.deepStrictEqual(r4.novos.map((x) => x.id), ['link_vazio'], 'lembrete depois de 12 h');
});

teste('mensagem: alertas com ação, voltou ao normal e link do painel, sem dado pessoal', () => {
  const ind = indBase();
  ind.n8n.fluxos[0].erro = 1;
  ind.crm.bv.matricula = 2;
  const al = vigia.regras(ind, fontesOk, L, { inicio, agora });
  const m = vigia.montarMensagem({ novos: al, resolvidos: ['falhas_login'], titulos: { falhas_login: 'Muitas falhas de login' }, abertos: al.length + 1, agora, painel: 'https://app.teste/admin#vigia' });
  assert.match(m, /^\*Vigia do calouro\* · 06\/11/);
  assert.match(m, /🔴 \*Erro no n8n: comercial_p_academico/);
  assert.match(m, /→ Abra o n8n/);
  assert.match(m, /🔴 \*Graduação caindo no template de matrícula\*\n2 negócios passaram/);
  assert.match(m, /✅ Voltou ao normal: Muitas falhas de login\./);
  assert.match(m, /Seguem abertos \(já avisados\): 1\./);
  assert.match(m, /Painel: https:\/\/app\.teste\/admin#vigia$/);
  assert.ok(!/\d{10,}/.test(m), 'nenhum número de telefone');
});

// ---------- régua: A/B ----------
const msg = (origem, base, entraram) => ({ origem, base, entraram, pct: base ? Math.round((entraram / base) * 1000) / 10 : null });

teste('A/B: agrupa por prefixo; códigos sem variante ficam fora', () => {
  const t = vigia.testesAB([msg('bv_acesso', 300, 120), msg('fup1_a', 10, 2), msg('fup1_b', 12, 5), msg('fup2_a', 50, 10)], 60);
  assert.deepStrictEqual(t.map((x) => x.teste), ['fup1'], 'bv_acesso não é teste; fup2 tem uma variante só');
  assert.strictEqual(t[0].estado, 'coletando');
  assert.strictEqual(t[0].faltam, 50 + 48);
});

teste('A/B: vencedor só com amostra e diferença significativa', () => {
  const venceu = vigia.testesAB([msg('fup1_a', 200, 40), msg('fup1_b', 200, 70)], 60)[0];
  assert.deepStrictEqual([venceu.estado, venceu.vencedor], ['vencedor', 'B']); // 20% x 35%, z ≈ 3,4
  const empate = vigia.testesAB([msg('fup1_a', 200, 40), msg('fup1_b', 200, 48)], 60)[0];
  assert.deepStrictEqual([empate.estado, empate.vencedor], ['empate', null]); // 20% x 24%: pode ser acaso
  // Com 3 variantes, o melhor precisa bater as duas outras com margem mais rígida.
  const tres = vigia.testesAB([msg('fup1_a', 200, 40), msg('fup1_b', 200, 70), msg('fup1_c', 200, 62)], 60)[0];
  assert.strictEqual(tres.estado, 'empate', 'B não bate C com folga');
});

teste('A/B: o vencedor vira alerta verde com a ação', () => {
  const ind = indBase();
  ind.regua = { dias: 14, mensagens: [], testes: vigia.testesAB([msg('fup1_a', 200, 40), msg('fup1_b', 200, 70)], 60) };
  const al = vigia.regras(ind, fontesOk, L, { inicio, agora });
  assert.deepStrictEqual(ids(al), ['teste:fup1:B']);
  assert.strictEqual(al[0].nivel, 'info');
  assert.match(al[0].detalhe, /^35% entraram em 24 h \(70 de 200\) contra A 20% \(40 de 200\)\.$/);
  assert.match(al[0].acao, /Deixe só a variante B \(fup1_b\)/);
  assert.match(vigia.montarMensagem({ novos: al, agora }), /🟢 \*Teste fup1: a variante B venceu\*/);
});

teste('resumo da tendência', () => {
  const r = vigia.resumo(indBase(), [{ nivel: 'critico' }, { nivel: 'atencao' }]);
  assert.deepStrictEqual([r.vendas, r.n8n_erros, r.entradas, r.link_vazio_pct, r.alertas, r.criticos], [6, 0, 20, 0, 2, 1]);
});

(async () => {
  for (const [nome, fn] of testes) {
    await fn();
    console.log('ok -', nome);
  }
  console.log(`\n${testes.length} testes passaram.`);
})().catch((err) => { console.error(err); process.exit(1); });
