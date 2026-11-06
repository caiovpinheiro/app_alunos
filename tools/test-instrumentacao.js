'use strict';
// Instrumentação e aba Medição, sem banco e sem rede: node tools/test-instrumentacao.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const medicao = require('../server/medicao');
const instrumentacao = require('../server/instrumentacao');
const avaliacoes = require('../server/avaliacoes');

const testes = [];
function teste(nome, fn) { testes.push([nome, fn]); }

// ---------- datas ----------
teste('semana começa na segunda e dias contam no calendário', () => {
  assert.strictEqual(medicao.inicioSemana('2026-11-06'), '2026-11-02'); // sexta → segunda
  assert.strictEqual(medicao.inicioSemana('2026-11-02'), '2026-11-02');
  assert.strictEqual(medicao.inicioSemana('2026-11-08'), '2026-11-02'); // domingo fica na semana que acabou
  assert.strictEqual(medicao.difDias('2026-10-30', '2026-11-02'), 3);
  assert.strictEqual(medicao.addDias('2026-10-31', 1), '2026-11-01');
  // 23h30 de Brasília ainda é o mesmo dia (UTC já virou).
  assert.strictEqual(medicao.diaSP('2026-11-06T02:30:00Z'), '2026-11-05');
});

// ---------- 1. retenção ----------
teste('retenção: D0 é o primeiro acesso; volta no mesmo dia não conta', () => {
  const hoje = '2026-11-30';
  const r = medicao.retencao([
    { criada: '2026-11-02', entrou: true, dias: ['2026-11-02', '2026-11-03'] }, // volta em D+1
    { criada: '2026-11-02', entrou: true, dias: ['2026-11-02', '2026-11-08'] }, // volta em D+6
    { criada: '2026-11-03', entrou: true, dias: ['2026-11-05', '2026-11-19'] }, // D0 = 05/11, volta em D+14
    { criada: '2026-11-04', entrou: true, dias: ['2026-11-04'] },               // nunca voltou
    { criada: '2026-11-05', entrou: false, dias: [] },                          // nunca entrou: fora da base
  ], hoje);
  const c = r.coortes[0];
  assert.strictEqual(c.semana, '2026-11-02');
  assert.strictEqual(c.contas, 5);
  assert.strictEqual(c.entraram, 4);
  assert.strictEqual(c.rastreadas, 4);
  assert.deepStrictEqual([c.janelas[1].voltaram, c.janelas[1].elegiveis], [1, 4]);
  assert.deepStrictEqual([c.janelas[7].voltaram, c.janelas[7].elegiveis], [2, 4]);
  assert.deepStrictEqual([c.janelas[14].voltaram, c.janelas[14].elegiveis], [3, 4]);
  assert.strictEqual(c.janelas[7].pct, 50);
  assert.ok(c.janelas[14].completa);
  assert.ok(c.janelas[14].poucos, '4 alunos é menos que o mínimo de 5');
});

teste('retenção: prazo que não terminou fica fora (hoje não conta)', () => {
  const hoje = '2026-11-10';
  const r = medicao.retencao([
    { criada: '2026-11-09', entrou: true, dias: ['2026-11-09'] },             // D+1 = hoje: ainda no prazo
    { criada: '2026-11-08', entrou: true, dias: ['2026-11-08', '2026-11-09'] }, // D+1 já passou
  ], hoje);
  const nova = r.coortes.find((x) => x.semana === '2026-11-09');
  const velha = r.coortes.find((x) => x.semana === '2026-11-02');
  assert.deepStrictEqual([nova.janelas[1].elegiveis, nova.janelas[1].no_prazo], [0, 1]);
  assert.strictEqual(nova.janelas[1].completa, false);
  assert.deepStrictEqual([velha.janelas[1].voltaram, velha.janelas[1].elegiveis], [1, 1]);
  // Semana de 02/11 terminou em 08/11: D+1 completo (09 < 10), D+7 não.
  assert.strictEqual(velha.janelas[1].completa, true);
  assert.strictEqual(velha.janelas[7].completa, false);
  assert.strictEqual(velha.janelas[7].no_prazo, 1);
  assert.strictEqual(r.coortes[0].semana, '2026-11-09', 'mais recente primeiro');
});

teste('retenção: comparação só com coortes completas e com 5+ alunos', () => {
  const hoje = '2026-12-31';
  const conta = (criada, volta) => ({ criada, entrou: true, dias: volta ? [criada, medicao.addDias(criada, volta)] : [criada] });
  const contas = [];
  for (let i = 0; i < 5; i += 1) contas.push(conta('2026-11-02', i < 4 ? 2 : 0)); // 80% em D+7
  for (let i = 0; i < 5; i += 1) contas.push(conta('2026-11-09', i < 1 ? 2 : 0)); // 20% em D+7
  contas.push(conta('2026-11-16', 2));                                              // 1 aluno: poucos dados
  const r = medicao.retencao(contas, hoje);
  const c7 = r.comparacao[7];
  assert.strictEqual(c7.coortes, 2);
  assert.strictEqual(c7.pct, 50); // 5 de 10
  assert.deepStrictEqual(c7.melhor, { semana: '2026-11-02', pct: 80 });
  assert.deepStrictEqual(c7.pior, { semana: '2026-11-09', pct: 20 });
});

teste('retenção: dias repetidos e lista vazia não quebram', () => {
  const r = medicao.retencao([{ criada: '2026-11-02', entrou: true, dias: ['2026-11-03', '2026-11-03', null] }], '2026-12-01');
  assert.strictEqual(r.coortes[0].janelas[1].voltaram, 0);
  assert.deepStrictEqual(medicao.retencao([], '2026-12-01').coortes, []);
  assert.strictEqual(medicao.retencao(null, '2026-12-01').comparacao[1].pct, null);
});

// ---------- 2. resultado prático ----------
teste('resultado prático: conseguiu / não conseguiu / não respondeu, por módulo', () => {
  const bases = [
    { chave: 'modulo:1', rgm: 'a' }, { chave: 'modulo:1', rgm: 'b' }, { chave: 'modulo:1', rgm: 'c' }, { chave: 'modulo:1', rgm: 'd' },
    { chave: 'modulo:2', rgm: 'a' },
    { chave: 'video:tut_11', rgm: 'a' }, { chave: 'video:tut_11', rgm: 'b' },
    { chave: 'faq:senha', rgm: 'c' },
  ];
  const votos = [
    { chave: 'modulo:1', rgm: 'a', voto: 1 }, { chave: 'modulo:1', rgm: 'b', voto: -1 },
    { chave: 'modulo:1', rgm: 'z', voto: -1 }, // respondeu sem estar na base: entra na base
    { chave: 'video:tut_11', rgm: 'a', voto: -1 }, { chave: 'video:tut_11', rgm: 'b', voto: -1 },
    { chave: 'faq:senha', rgm: 'c', voto: 1 },
  ];
  const r = medicao.resultadoPratico(bases, votos, { modulos: [1, 2, 3], titulo: (t, id) => `${t}/${id}` });
  const m1 = r.modulos[0];
  assert.deepStrictEqual([m1.base, m1.conseguiu, m1.nao_conseguiu, m1.sem_resposta], [5, 1, 2, 2]);
  assert.strictEqual(m1.pct_conseguiu, 33);
  assert.strictEqual(m1.titulo, 'modulo/1');
  assert.strictEqual(r.modulos.length, 3, 'módulo sem dado aparece zerado');
  assert.deepStrictEqual([r.modulos[1].base, r.modulos[1].sem_resposta], [1, 1]);
  assert.deepStrictEqual([r.modulos[2].base, r.modulos[2].pct_conseguiu], [0, null]);
  // Piores: 100% "não funcionou" no vídeo vem antes de 67% no módulo 1; quem só teve "deu certo" fica fora.
  assert.deepStrictEqual(r.piores.map((x) => x.chave), ['video:tut_11', 'modulo:1']);
  assert.deepStrictEqual(r.conteudos.map((x) => x.chave), ['video:tut_11', 'faq:senha']);
  assert.strictEqual(r.totais.modulo.base, 6);
  assert.strictEqual(r.totais.video.pct_conseguiu, 0);
  assert.strictEqual(r.totais.faq.pct_conseguiu, 100);
});

teste('resultado prático: só os 5 piores e ids com dois-pontos', () => {
  const votos = [];
  for (let i = 0; i < 8; i += 1) votos.push({ chave: `faq:p${i}`, rgm: 'x', voto: -1 });
  votos.push({ chave: 'video:aula:cap-1', rgm: 'x', voto: 1 });
  const r = medicao.resultadoPratico([], votos, {});
  assert.strictEqual(r.piores.length, 5);
  assert.ok(r.conteudos.some((x) => x.tipo === 'video' && x.id === 'aula:cap-1'));
  // Com amostra vem antes de "poucos dados", mesmo com porcentagem menor.
  const v = [{ chave: 'faq:um', rgm: 'a', voto: -1 }];
  ['a', 'b', 'c', 'd', 'e', 'f'].forEach((rgm, i) => v.push({ chave: 'modulo:1', rgm, voto: i < 2 ? -1 : 1 }));
  assert.deepStrictEqual(medicao.resultadoPratico([], v, {}).piores.map((x) => x.chave), ['modulo:1', 'faq:um']);
});

// ---------- 3. saídas ----------
teste('saídas: por destino e por onde o aluno estava', () => {
  const ev = [
    { aluno_id: 1, destino: 'email_academico', modulo: '1', tela: '/trilha' },
    { aluno_id: 1, destino: 'loja_duda', modulo: '1', tela: '/trilha' },
    { aluno_id: 2, destino: 'email_academico', modulo: '1', tela: '/trilha' },
    { aluno_id: 2, destino: 'ava', modulo: null, tela: '/meu-semestre' },
    { aluno_id: 3, destino: 'ava', modulo: '3', tela: '/trilha' },
    { aluno_id: 3, destino: 'site_qualquer', modulo: null, tela: '/inicio' }, // fora da lista: ignorado
  ];
  const s = medicao.saidas(ev, { 1: 'Primeiro acesso', 3: 'AVA' });
  assert.strictEqual(s.cliques, 5);
  assert.strictEqual(s.alunos, 3);
  assert.deepStrictEqual(s.por_destino.map((d) => [d.destino, d.cliques, d.alunos]), [['email_academico', 2, 2], ['ava', 2, 2], ['loja_duda', 1, 1]]);
  assert.deepStrictEqual(s.por_origem.map((o) => o.chave), ['modulo:1', 'modulo:3', 'tela:/meu-semestre']);
  assert.strictEqual(s.por_origem[0].rotulo, 'Aula Inaugural · Módulo 1 (Primeiro acesso)');
  assert.deepStrictEqual(s.por_origem[0].destinos, { email_academico: 2, loja_duda: 1 });
  assert.strictEqual(s.por_origem[2].rotulo, 'Meu semestre');
});

teste('"Fazer agora": saiu em até 24 h, conta a partir do primeiro toque', () => {
  const t0 = Date.parse('2026-11-05T10:00:00-03:00');
  const em = (h) => new Date(t0 + h * 3600000).toISOString();
  const escolhas = [
    { aluno_id: 1, escolha: 'agora', em: em(0) },
    { aluno_id: 1, escolha: 'agora', em: em(5) },   // segundo toque: vale o primeiro
    { aluno_id: 2, escolha: 'agora', em: em(0) },
    { aluno_id: 3, escolha: 'agora', em: em(0) },
    { aluno_id: 4, escolha: 'depois', em: em(0) },
    { aluno_id: 3, escolha: 'depois', em: em(1) },  // fez as duas: conta como "agora"
  ];
  const saidas = [
    { aluno_id: 1, destino: 'email_academico', em: em(0.1) },
    { aluno_id: 1, destino: 'ava', em: em(2) },
    { aluno_id: 2, destino: 'ava', em: em(30) },    // depois de 24 h: não conta
    { aluno_id: 3, destino: 'ava', em: em(-1) },    // antes do toque: não conta
    { aluno_id: 4, destino: 'ava', em: em(1) },     // escolheu depois
  ];
  const f = medicao.fazerAgora(escolhas, saidas);
  assert.deepStrictEqual([f.agora, f.depois, f.sairam, f.sairam_ava], [3, 1, 1, 1]);
  assert.strictEqual(f.pct_sairam, 33);
  assert.deepStrictEqual(f.primeiro_destino, { email_academico: 1 });
  assert.ok(f.poucos);
});

// ---------- 4. ajuda ----------
teste('ofertas de ajuda: oferecida → aceita → resolvida, com mediana', () => {
  const p = (origem, criado, atendido, resolvido) => ({
    origem, situacao: resolvido ? 'resolvido' : atendido ? 'em_atendimento' : 'aberto',
    criado_em: `2026-11-05T10:${criado}:00Z`, atendido_em: atendido ? `2026-11-05T11:${atendido}:00Z` : null, resolvido_em: resolvido ? `2026-11-05T12:${resolvido}:00Z` : null,
  });
  const ev = [
    ...Array(4).fill({ nome: 'ajuda_oferecida', origem: 'travei' }),
    { nome: 'ajuda_recusada', origem: 'travei' },
    ...Array(2).fill({ nome: 'ajuda_oferecida', origem: 'nao_funcionou' }),
    { nome: 'ajuda_aceita', origem: 'travei' }, // aceitar conta pelos pedidos, não pelo evento
  ];
  const pedidos = [p('travei', '00', '00', '00'), p('travei', '00', '30', null), p('nao_funcionou', '00', null, null), p('ajuda_painel', '00', '00', '30')];
  const a = medicao.ajuda(ev, pedidos);
  const tr = a.origens.find((x) => x.origem === 'travei');
  assert.deepStrictEqual([tr.oferecida, tr.recusada, tr.aceita, tr.atendida, tr.resolvida], [4, 1, 2, 2, 1]);
  assert.strictEqual(tr.pct_aceita, 50);
  assert.strictEqual(tr.pct_resolvida, 50);
  assert.strictEqual(tr.mediana_atender_min, 75); // 60 e 90 min
  assert.strictEqual(tr.mediana_resolver_min, 120);
  const painel = a.origens.find((x) => x.origem === 'ajuda_painel');
  assert.strictEqual(painel.pct_aceita, null, 'pedido do painel não tem oferta');
  assert.strictEqual(a.total.oferecida, 6);
  assert.strictEqual(a.total.aceita, 4);
  assert.strictEqual(a.total.pct_aceita, 50, 'aceite total: 3 pedidos com oferta (travei 2 + nao_funcionou 1) de 6 ofertas');
  assert.strictEqual(a.total.mediana_resolver_min, 135); // 120 e 150
  assert.strictEqual(a.origens[0].origem, 'travei', 'mais ofertas primeiro');
  assert.strictEqual(medicao.mediana([]), null);
  assert.strictEqual(medicao.mediana([3, 1, 2]), 2);
});

// ---------- 5. entrada ----------
teste('origem do primeiro acesso por coorte', () => {
  const o = medicao.origens([
    { criada: '2026-11-02', entrou: true, medida: true, origem: 'bv' },
    { criada: '2026-11-03', entrou: true, medida: true, origem: 'bv' },
    { criada: '2026-11-03', entrou: true, medida: true, origem: null },
    { criada: '2026-11-04', entrou: true, medida: false, origem: null }, // entrou antes da medição
    { criada: '2026-11-04', entrou: false, medida: false, origem: null },
    { criada: '2026-11-10', entrou: true, medida: true, origem: 'reenvio' },
  ]);
  assert.deepStrictEqual(o.origens, ['bv', 'reenvio', 'sem_origem']);
  const s = o.coortes.find((c) => c.semana === '2026-11-02');
  assert.deepStrictEqual([s.contas, s.nao_entrou, s.antes], [5, 1, 1]);
  assert.deepStrictEqual(s.origens, { bv: 2, sem_origem: 1 });
  assert.strictEqual(o.coortes[0].semana, '2026-11-09');
});

teste('falhas de login por dia e por motivo', () => {
  const f = medicao.falhasPorDia([
    { dia: '2026-11-05', motivo: 'senha_incorreta', aluno_id: 7 },
    { dia: '2026-11-05', motivo: 'senha_incorreta', aluno_id: 7 },
    { dia: '2026-11-05', motivo: 'conta_nao_encontrada', aluno_id: null },
    { dia: '2026-11-06', motivo: 'esqueci_senha', aluno_id: 8 },
  ]);
  assert.strictEqual(f.total, 4);
  assert.strictEqual(f.contas_identificadas, 2);
  assert.deepStrictEqual(f.motivos, { senha_incorreta: 2, conta_nao_encontrada: 1, esqueci_senha: 1 });
  assert.deepStrictEqual(f.dias.map((d) => [d.dia, d.total, d.contas]), [['2026-11-06', 1, 1], ['2026-11-05', 3, 1]]);
});

teste('origem do link: só minúsculas, números, _ e -, até 24', () => {
  assert.strictEqual(instrumentacao.limparOrigem('BV'), 'bv');
  assert.strictEqual(instrumentacao.limparOrigem(' reenvio '), 'reenvio');
  assert.strictEqual(instrumentacao.limparOrigem('polo_sp-1'), 'polo_sp-1');
  assert.strictEqual(instrumentacao.limparOrigem('a@b.com'), null);
  assert.strictEqual(instrumentacao.limparOrigem('<script>'), null);
  assert.strictEqual(instrumentacao.limparOrigem('x'.repeat(25)), null);
  assert.strictEqual(instrumentacao.limparOrigem(null), null);
  assert.ok(instrumentacao.MOTIVOS.esqueci_senha && instrumentacao.MOTIVOS.senha_incorreta);
});

teste('falha e entrada nunca gravam o que foi digitado', async () => {
  const chamadas = [];
  const pool = { query: async (sql, params) => { chamadas.push({ sql, params }); return { rows: [] }; } };
  await instrumentacao.falha(pool, { alunoId: 12, motivo: 'senha_incorreta', origem: 'bv' });
  await instrumentacao.falha(pool, { alunoId: 'aluno@x.com', motivo: 'conta_nao_encontrada', origem: '99123456' });
  await instrumentacao.falha(pool, { motivo: 'motivo_inventado' });
  await instrumentacao.entrada(pool, { alunoId: 12, origem: 'BV', primeira: true, via: 'login' });
  const ins = chamadas.filter((c) => /^INSERT/.test(c.sql.trim()));
  assert.strictEqual(ins.length, 3, 'motivo desconhecido não grava');
  assert.deepStrictEqual(ins[0].params, [12, 'senha_incorreta', 'bv']);
  assert.deepStrictEqual(ins[1].params, [null, 'conta_nao_encontrada', '99123456'], 'id que não é número vira null');
  assert.deepStrictEqual(ins[2].params, [12, 'bv', true, 'login']);
});

// ---------- avaliação "pratica" ----------
teste('"Conseguiu fazer?" usa o tipo pratica e não aceita comentário', () => {
  assert.deepStrictEqual(avaliacoes.validar({ tipo: 'pratica', id: 'modulo:1', voto: 1 }), { tipo: 'pratica', id: 'modulo:1', voto: 1 });
  assert.ok(avaliacoes.validar({ tipo: 'pratica', id: 'video:acesso-email-senha', voto: -1 }));
  assert.ok(avaliacoes.validar({ tipo: 'pratica', id: 'faq:dp-adaptacao', voto: 0 }));
  assert.strictEqual(avaliacoes.validar({ tipo: 'pratica', id: 'modulo-1', voto: 1 }), null);
  assert.strictEqual(avaliacoes.validar({ tipo: 'pratica', id: 'outro:1', voto: 1 }), null);
  assert.strictEqual(avaliacoes.validarComentario({ tipo: 'pratica', id: 'modulo:1', comentario: 'oi' }), null);
  assert.ok(avaliacoes.validar({ tipo: 'aula', id: 'modulo-1', voto: 1 }), 'joinha continua igual');
});

// ---------- front: lista única de destinos (public/js/rastreio.js) ----------
function carregarRastreio() {
  const registrados = [];
  const sandbox = {
    window: { location: { href: 'https://app.cruzeiroead.com.br/trilha', host: 'app.cruzeiroead.com.br', pathname: '/trilha' }, addEventListener() {} },
    document: { addEventListener() {}, querySelectorAll: () => [], visibilityState: 'visible' },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URL, setInterval: () => 0, clearInterval() {}, setTimeout, console,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/rastreio.js'), 'utf8'), sandbox);
  return { R: sandbox.window.Rastreio, registrados };
}

teste('destinos: todos os links da faculdade no conteúdo caem num destino conhecido', () => {
  const { R } = carregarRastreio();
  assert.strictEqual(R.destinoDe('https://ava.cruzeirodosul.edu.br/'), 'ava');
  assert.strictEqual(R.destinoDe('https://novoportal.cruzeirodosul.edu.br/'), 'area_aluno');
  assert.strictEqual(R.destinoDe('https://emailacademico.cruzeiroead.com.br/descobrir'), 'email_academico');
  assert.strictEqual(R.destinoDe('https://apps.apple.com/br/app/duda/id6451416655'), 'loja_duda');
  assert.strictEqual(R.destinoDe('https://play.google.com/store/apps/details?id=br.com.cruzeirodosulvirtual'), 'loja_duda');
  assert.strictEqual(R.destinoDe('https://apps.apple.com/br/app/microsoft-authenticator/id983156458'), 'loja_authenticator');
  assert.strictEqual(R.destinoDe('https://play.google.com/store/apps/details?id=com.azure.authenticator'), 'loja_authenticator');
  assert.strictEqual(R.destinoDe('https://play.google.com/store/apps/details?id=com.whatsapp'), null, 'outra loja não conta');
  assert.strictEqual(R.destinoDe('https://wa.me/5511999999999'), null);
  assert.strictEqual(R.destinoDe('/trilha#nivel-2'), null);
  // Varre os arquivos citados no pedido: nenhum link da faculdade fica sem destino.
  const arquivos = ['public/js/meu-semestre.js', 'public/js/apps.js', 'server/assets/trilha.json', 'server/assets/central/faq.json', 'public/index.html'];
  const faculdade = /(cruzeirodosul\.edu\.br|emailacademico\.cruzeiroead\.com\.br|apps\.apple\.com|play\.google\.com)/;
  let vistos = 0;
  arquivos.forEach((f) => {
    const txt = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    (txt.match(/https:\/\/[^\s"'<>\\)]+/g) || []).filter((u) => faculdade.test(u)).forEach((u) => {
      vistos += 1;
      assert.ok(R.destinoDe(u), `${f}: ${u} sem destino`);
    });
  });
  assert.ok(vistos >= 15, `achou só ${vistos} links`);
});

(async () => {
  for (const [nome, fn] of testes) {
    await fn();
    console.log('ok -', nome);
  }
  console.log(`\n${testes.length} testes passaram.`);
})().catch((err) => { console.error(err); process.exit(1); });
