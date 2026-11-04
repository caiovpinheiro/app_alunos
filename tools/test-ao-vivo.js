'use strict';
// Aba Ao vivo, sem banco e sem rede: node tools/test-ao-vivo.js
const assert = require('node:assert');
const aoVivo = require('../server/ao-vivo');
const crm = require('../server/ao-vivo-crm');
const resultado = require('../server/resultado');

const AGORA = Date.parse('2026-11-04T15:00:00-03:00');
const NIVEIS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ t: `Módulo ${n}` }));
const DESDE = '2026-10-29';
const CHAVE = 'eduit_teste';
let seq = 0;

function aluno(extra) {
  seq += 1;
  return {
    id: seq, nome: `Nome Secreto ${seq}`, rgm: `9900${seq}`, email: `aluno${seq}@segredo.test`,
    created_at: '2026-11-01T12:00:00-03:00', primeiro_acesso: null, trilha_ultima: null, niveis_concluidos: 0,
    total_niveis: 7, nivel_aberto: null, cert_erros: 0, dias_sem_acesso: null, ...extra,
  };
}
const entrou = { primeiro_acesso: '2026-11-01T12:20:00-03:00' };
const comecou = { ...entrou, trilha_ultima: '2026-11-01T13:00:00-03:00', nivel_aberto: 3, niveis_concluidos: 2 };
const concluiu = { ...entrou, trilha_ultima: '2026-11-02T13:00:00-03:00', niveis_concluidos: 7 };

const telLogin = '5511912340001';
const telOferta = '11912340002';
const telNada = '11912340003';
const lista = [
  aluno({ created_at: '2026-11-04T14:00:00-03:00' }), // no prazo
  aluno({ rgm: 'sem-tel' }),
  aluno({ rgm: 'login' }),
  aluno({ rgm: 'oferta' }),
  aluno({ rgm: 'nada' }),
  aluno(entrou),
  aluno(comecou),
  aluno({ ...comecou, trilha_ultima: '2026-11-04T14:30:00-03:00' }),
  aluno({ ...concluiu, cert_erros: 2 }),
  aluno(concluiu),
  aluno(concluiu), // este tem certificado
  aluno({ created_at: '2026-10-20T12:00:00-03:00' }), // antes do corte
];
const certificados = { [lista[10].id]: '2026-11-03T10:00:00-03:00' };
const telefones = new Map([['login', telLogin], ['oferta', telOferta], ['nada', telNada]]);
const alcance = {
  login: new Set([crm.chaveEmbaralhada(CHAVE, '11 91234-0001')]),
  oferta: new Set([crm.chaveEmbaralhada(CHAVE, telLogin), crm.chaveEmbaralhada(CHAVE, telOferta)]),
};
const opts = { desde: DESDE, agora: AGORA, niveis: NIVEIS, telefones, alcance, chave: CHAVE, progresso: { 1: { abriram: 5, concluiram: 5 } } };
const f = aoVivo.funil(lista, certificados, opts);

// Funil: bate com o Resultado da Visão geral, a mesma regra.
const r = resultado.calcular(lista.filter((a) => a.created_at >= '2026-10-29'), certificados, 'todos', { agora: AGORA, contar_desde: DESDE });
assert.strictEqual(f.total.contas, r.contas);
['entraram', 'comecaram', 'concluiram', 'certificado'].forEach((id) => {
  assert.strictEqual(f.etapas.find((e) => e.id === id).n, r.etapas.find((e) => e.id === id).n, id);
});
assert.strictEqual(f.etapas.find((e) => e.id === 'em24').n, r.primeiro_acesso_24h.n);
assert.strictEqual(f.etapas.find((e) => e.id === 'em24').de, r.primeiro_acesso_24h.de);
assert.strictEqual(f.total.contas, 11);

// Base de novos: a aba abre nela, e o corte de Configurações mais recente prevalece.
assert.strictEqual(aoVivo.baseValida('todas'), 'todas');
assert.strictEqual(aoVivo.baseValida('qualquer'), 'novos');
assert.strictEqual(aoVivo.desdeDaBase('novos', DESDE), '2026-11-04');
assert.strictEqual(aoVivo.desdeDaBase('todas', DESDE), DESDE);
assert.strictEqual(aoVivo.desdeDaBase('novos', '2026-12-01'), '2026-12-01');
assert.deepStrictEqual(aoVivo.basesDe(DESDE).map((b) => b.rotulo), ['Novos, desde 04/11', 'Todas, desde 29/10']);
const novos = aoVivo.funil(lista, certificados, { ...opts, desde: '2026-11-04' });
assert.strictEqual(novos.total.contas, 1, 'só a conta criada a partir do corte');
assert.strictEqual(novos.por_dia.length, 1);
assert.strictEqual(novos.total.primeiros_acessos, 0, 'acesso antigo não entra');
assert.strictEqual(novos.falta_100.motivos.reduce((n, m) => n + m.n, 0), novos.falta_100.total);

// Por dia: do mais novo ao corte, sem buraco, e a soma é o total.
assert.strictEqual(f.por_dia.length, 7);
assert.strictEqual(f.por_dia[0].dia, '2026-11-04');
assert.strictEqual(f.por_dia[6].dia, DESDE);
assert.strictEqual(f.por_dia.reduce((n, d) => n + d.contas, 0), f.total.contas);
assert.strictEqual(f.por_dia.find((d) => d.dia === '2026-11-01').primeiros_acessos, 6);

// Motivos: cada conta em um só e a soma é o que falta.
const motivo = (id) => (f.falta_100.motivos.find((m) => m.id === id) || { n: 0 }).n;
assert.strictEqual(f.falta_100.total, 10);
assert.strictEqual(f.falta_100.motivos.reduce((n, m) => n + m.n, 0), f.falta_100.total);
assert.strictEqual(motivo('no_prazo'), 1);
assert.strictEqual(motivo('sem_telefone'), 1);
assert.strictEqual(motivo('login_nao_entrou'), 1);
assert.strictEqual(motivo('oferta_sem_login'), 1);
assert.strictEqual(motivo('sem_oferta'), 1);
assert.strictEqual(motivo('nao_comecou'), 1);
assert.strictEqual(motivo('nao_concluiu'), 2);
assert.strictEqual(motivo('cert_erro'), 1);
assert.strictEqual(motivo('cert_sem_tentar'), 1);

// Sem CRM ou sem base de telefones: agrupa em vez de inventar o motivo.
const semCrm = aoVivo.funil(lista, certificados, { ...opts, alcance: null });
assert.strictEqual(semCrm.falta_100.motivos.find((m) => m.id === 'nao_entrou').n, 3);
assert.ok(!semCrm.falta_100.motivos.some((m) => m.id === 'sem_oferta'));
const semTel = aoVivo.funil(lista, certificados, { ...opts, telefones: null, alcance: null });
assert.ok(!semTel.falta_100.motivos.some((m) => m.id === 'sem_telefone'));
assert.strictEqual(semTel.falta_100.motivos.reduce((n, m) => n + m.n, 0), semTel.falta_100.total);

// Módulos: parado no aberto; sem nenhum aberto, no seguinte ao último concluído.
assert.strictEqual(aoVivo.moduloParado({ nivel_aberto: 3, niveis_concluidos: 2, total_niveis: 7 }), 3);
assert.strictEqual(aoVivo.moduloParado({ nivel_aberto: null, niveis_concluidos: 2, total_niveis: 7 }), 3);
assert.strictEqual(aoVivo.moduloParado({ nivel_aberto: null, niveis_concluidos: 9, total_niveis: 7 }), 7);
const m3 = f.modulos.lista.find((x) => x.modulo === 3);
assert.strictEqual(m3.parados, 2);
assert.strictEqual(m3.parados_24h, 1, 'quem mexeu há menos de 24 h não conta como parado há 24 h');
assert.strictEqual(f.modulos.nao_entraram, 5);
assert.strictEqual(f.modulos.nao_comecaram, 1);
assert.strictEqual(f.modulos.lista[0].abriram, 5);

// Telefone: mesma chave do CRM, com e sem 55 e o nono dígito.
assert.strictEqual(crm.chaveTelefone('5511912345678'), '1112345678');
assert.strictEqual(crm.chaveTelefone('1112345678'), '1112345678');
assert.strictEqual(crm.chaveTelefone('123'), null);
assert.strictEqual(crm.chaveEmbaralhada('k', '5511912345678'), crm.chaveEmbaralhada('k', '1112345678'));

// Privacidade: nada do aluno na resposta do funil.
const texto = JSON.stringify(f);
['Nome Secreto', 'segredo.test', '99001', 'sem-tel', '91234'].forEach((s) => assert.ok(!texto.includes(s), `vazou ${s}`));

// CRM: soma por passo e dia, falha vem de qualquer passo, status fora do mapa é ignorado.
const def = crm.AUTOMACOES[0];
const payloadAuto = {
  id: def.id, nome: 'BV - Calouros', ativa: true, atualizadaEm: '2026-11-03T14:17:00Z', ultimoRegistroEm: '2026-11-04T16:00:00Z',
  passos: Object.values(def.passos).map((id) => ({ id, tipo: 'x' })).concat([{ id: 'outro', tipo: 'x' }]),
  porDia: [
    { dia: '2026-11-03', passo: def.passos.oferta, status: 'SUCCESS', n: 10 },
    { dia: '2026-11-04', passo: def.passos.oferta, status: 'SUCCESS', n: 5 },
    { dia: '2026-11-04', passo: def.passos.oferta, status: 'FAILED', n: 1 },
    { dia: '2026-11-04', passo: def.passos.login, status: 'SUCCESS', n: 3 },
    { dia: '2026-11-04', passo: def.passos.espera_1h, status: 'SUCCESS', n: 2 },
    { dia: '2026-11-04', passo: 'outro', status: 'FAILED_HANDLED', n: 4 },
    { dia: '2026-11-04', passo: 'outro', status: 'SUCCESS', n: 99 },
    { dia: '2026-11-04', passo: null, status: 'STARTED', n: 50 },
  ],
};
const a = crm.resumirAutomacao(def, payloadAuto);
assert.strictEqual(a.total.oferta, 15);
assert.strictEqual(a.total.login, 3);
assert.strictEqual(a.total.falhas, 5);
assert.strictEqual(a.total.espera_1h, 2);
assert.strictEqual(a.dias[0].dia, '2026-11-04');
assert.deepStrictEqual(a.avisos, []);

// Passo que mudou de id no CRM vira aviso, não zero silencioso.
const semPasso = crm.resumirAutomacao(def, { ...payloadAuto, passos: payloadAuto.passos.filter((p) => p.id !== def.passos.lembrete_24h) });
assert.ok(semPasso.avisos[0].includes('lembrete_24h'));
assert.strictEqual(crm.resumirAutomacao(def, undefined).encontrada, false);

// Testes A/B/C: grupo pela primeira passagem, falha fica no grupo, prazo inteiro e leitura só no fim.
function testesAbc() {
  const placarDe = require('../server/ao-vivo-testes');
  const def = {
    id: 'r1', titulo: 'Primeira mensagem', inicio: '2026-11-10', duracao_dias: 21, por_grupo: 3, metrica: 'entrou_24h',
    variantes: [{ id: 'A', rotulo: 'Atual', passo: 'pa' }, { id: 'B', rotulo: 'Login direto', passo: 'pb' }, { id: 'C', rotulo: 'Um botão', passo: 'pc' }],
  };
  assert.deepStrictEqual(placarDe.passosDe([def]), ['pa', 'pb', 'pc']);
  const em = '2026-11-11T12:00:00-03:00';
  const emMs = Date.parse(em);
  const conta = (id, tel, extra) => ({ id, rgm: `r${id}`, nome: `Nome Secreto ${id}`, tel, primeiro_acesso: null, ...extra });
  const contas = [
    conta(1, '11900000001', { primeiro_acesso: '2026-11-11T13:00:00-03:00' }),
    conta(2, '11900000002', { primeiro_acesso: '2026-11-13T13:00:00-03:00' }), // entrou depois de 24 h
    conta(3, '11900000003', { primeiro_acesso: '2026-11-11T14:00:00-03:00' }),
    conta(4, '11900000004', { primeiro_acesso: '2026-11-11T15:00:00-03:00' }),
    conta(5, '11900000005'),
    conta(6, '11900000009'), // mesmo telefone da 7: não dá para atribuir
    conta(7, '11900000009'),
  ];
  const telefones = new Map(contas.map((c) => [c.rgm, c.tel]));
  const k = (t) => crm.chaveEmbaralhada(CHAVE, t);
  const item = (t, ok = true, quando = em) => ({ k: k(t), em: new Date(quando).toISOString(), ok });
  const coorte = {
    pa: [item('11900000001'), item('11900000002', false), item('11988888888')], // o último não tem conta
    pb: [item('11900000003'), item('11900000004'), item('11900000001', true, '2026-11-12T12:00:00-03:00')], // a 1 já estava em A
    pc: [item('11900000005'), item('11900000009'), item('11900000006', true, '2026-11-09T12:00:00-03:00')], // antes do início
  };
  const marcos = new Map([[3, { comecou_em: '2026-11-11T16:00:00-03:00', ultimo_concluido: '2026-11-12T10:00:00-03:00', concluidos: 7 }], [4, { comecou_em: '2026-11-14T16:00:00-03:00', ultimo_concluido: null, concluidos: 1 }]]);
  const dados = { lista: contas, telefones, marcos, coorte, login: new Set([k('11900000003')]), chave: CHAVE, totalNiveis: 7 };

  const fim = placarDe.placar(def, { ...dados, agora: Date.parse('2026-12-03T12:00:00-03:00') });
  assert.strictEqual(fim.status, 'encerrado');
  const [a, b, c] = fim.grupos;
  assert.strictEqual(a.sorteados, 3);
  assert.strictEqual(a.falhas, 1, 'quem falhou fica no grupo');
  assert.strictEqual(a.sem_conta, 1);
  assert.strictEqual(a.metricas.entrou_24h.de, 2);
  assert.strictEqual(a.metricas.entrou_24h.n, 1, 'entrar depois de 24 h não conta');
  assert.strictEqual(b.sorteados, 2, 'vale a primeira passagem');
  assert.strictEqual(b.login, 1);
  assert.strictEqual(b.metricas.entrou_24h.pct, 100);
  assert.strictEqual(b.metricas.comecou_24h.n, 1);
  assert.strictEqual(b.metricas.concluiu_7d.n, 1);
  assert.strictEqual(c.sorteados, 2, 'antes do início não entra');
  assert.strictEqual(c.sem_conta, 1, 'telefone repetido fica sem vínculo');
  assert.ok(fim.avisos.some((x) => x.includes('outra variante')));
  assert.ok(fim.avisos.some((x) => x.includes('mais de uma conta')));
  assert.ok(fim.avisos.some((x) => x.includes('abaixo')) , 'C e B abaixo do planejado');
  assert.ok(['melhor', 'pior', 'sem_diferenca'].includes(fim.comparacoes[0].leitura));
  assert.ok(fim.comparacoes[0].margem != null);

  // Durante o teste: sem veredito, e quem ainda está dentro do prazo não conta.
  const durante = placarDe.placar(def, { ...dados, agora: emMs + 3600000 });
  assert.strictEqual(durante.status, 'em_andamento');
  assert.strictEqual(durante.grupos[0].metricas.entrou_24h.de, 0);
  assert.strictEqual(durante.comparacoes[0].leitura, 'sem_dados');
  const parcial = placarDe.placar(def, { ...dados, agora: emMs + 2 * 86400000 });
  assert.strictEqual(parcial.comparacoes[0].leitura, 'parcial');
  assert.strictEqual(parcial.comparacoes[0].margem, undefined);
  // Fim do teste, mas ainda dentro do prazo da métrica: continua sem veredito.
  assert.strictEqual(placarDe.placar(def, { ...dados, agora: Date.parse('2026-12-01T12:00:00-03:00') }).status, 'amadurecendo');

  // Veredito: 250 por grupo. A com 59%, B com 72% (ganha), C com 60% (empate).
  const pessoas = [];
  const coorteGrande = { pa: [], pb: [], pc: [] };
  const entra = { pa: 148, pb: 180, pc: 150 };
  Object.keys(coorteGrande).forEach((passo, g) => {
    for (let i = 0; i < 250; i += 1) {
      const tel = `119${String(g)}${String(i).padStart(7, '0')}`;
      pessoas.push({ id: 1000 + g * 1000 + i, rgm: `g${g}-${i}`, tel, primeiro_acesso: i < entra[passo] ? '2026-11-11T13:00:00-03:00' : null });
      coorteGrande[passo].push({ k: k(tel), em: new Date(em).toISOString(), ok: true });
    }
  });
  const decidido = placarDe.placar(def, {
    lista: pessoas, telefones: new Map(pessoas.map((p) => [p.rgm, p.tel])), marcos: new Map(), coorte: coorteGrande,
    login: new Set(), chave: CHAVE, totalNiveis: 7, agora: Date.parse('2026-12-03T12:00:00-03:00'),
  });
  assert.strictEqual(decidido.comparacoes[0].diferenca, 13);
  assert.strictEqual(decidido.comparacoes[0].leitura, 'melhor');
  assert.strictEqual(decidido.comparacoes[1].leitura, 'sem_diferenca');
  assert.ok(!decidido.avisos.some((x) => x.includes('abaixo')));

  // Antes do início e sem dados.
  assert.strictEqual(placarDe.placar(def, { ...dados, agora: Date.parse('2026-11-01T12:00:00-03:00') }).status, 'agendado');
  const semDados = placarDe.placar(def, { ...dados, coorte: null, agora: emMs });
  assert.strictEqual(semDados.status, 'indisponivel');
  assert.deepStrictEqual(semDados.grupos, []);

  // Privacidade: nem hash, nem telefone, nem nome no placar.
  const texto = JSON.stringify(fim);
  ['Nome Secreto', '119000', k('11900000001'), '"r2"'].forEach((x) => assert.ok(!texto.includes(x), `vazou ${x}`));
}
testesAbc();

async function leitura() {
  process.env.CRM_API_URL = 'https://crm.teste/';
  process.env.CRM_API_TOKEN = CHAVE;
  const pedidos = [];
  const bloco = (data) => ({ ok: true, data });
  const bom = {
    automacoes: bloco([payloadAuto]),
    alcance: bloco({ [def.passos.oferta]: ['chave1'], [def.passos.login]: ['chave2'], 'rea-template': ['chave3'] }),
    atendimento: bloco({ aguardandoResposta: 108 }),
    atendentes: bloco({ hoje: [], periodo: [], periodoDesde: DESDE, cortado: false }),
  };
  let resposta = () => ({ ok: true, status: 200, json: async () => bom });
  const leitor = crm.novoLeitor(async (url, init) => { pedidos.push({ url, init }); return resposta(); });

  const t0 = Date.parse('2026-11-04T15:00:00Z');
  const lido = await leitor.ler(DESDE, t0);
  assert.strictEqual(pedidos[0].init.method, 'GET');
  assert.strictEqual(pedidos[0].init.headers.Authorization, `Bearer ${CHAVE}`);
  assert.ok(pedidos[0].url.startsWith('https://crm.teste/api/painel/portal-aluno?'));
  assert.ok(pedidos[0].url.includes(`desde=${DESDE}`));
  assert.ok(!pedidos[0].url.includes('coorte='), 'sem teste não pede a coorte');
  assert.ok(!crm.fontes(lido.estado, t0).some((x) => x.id === 'crm_coorte'));
  await leitor.ler(DESDE, t0, ['pa', 'pb']);
  assert.ok(pedidos[1].url.includes('coorte=pa%2Cpb'));
  assert.ok(lido.alcance.oferta.has('chave1') && lido.alcance.oferta.has('chave3') && lido.alcance.login.has('chave2'));
  assert.strictEqual(lido.resumo.atendimento.aguardandoResposta, 108);
  assert.ok(crm.fontes(lido.estado, t0).every((x) => x.status === 'em_dia'));

  // Um bloco caiu: os outros seguem e ele mostra a última leitura boa.
  resposta = () => ({ ok: true, status: 200, json: async () => ({ ...bom, atendimento: { ok: false, error: 'x' } }) });
  const parcial = await leitor.ler(DESDE, t0 + 60000);
  assert.strictEqual(parcial.resumo.atendimento.aguardandoResposta, 108);
  const fp = crm.fontes(parcial.estado, t0 + 60000);
  assert.strictEqual(fp.find((x) => x.id === 'crm_atendimento').status, 'atrasado');
  assert.strictEqual(fp.find((x) => x.id === 'crm_atendimento').atualizado_em, new Date(t0).toISOString());
  assert.strictEqual(fp.find((x) => x.id === 'crm_automacoes').status, 'em_dia');

  // CRM fora: mantém os números, marca atrasado e não vaza o token no erro.
  const erros = console.error;
  const logs = [];
  console.error = (...x) => logs.push(x.join(' '));
  resposta = () => ({ ok: false, status: 503, json: async () => ({}) });
  const fora = await leitor.ler(DESDE, t0 + 10 * 60000);
  console.error = erros;
  assert.ok(fora.resumo.automacoes);
  assert.ok(crm.fontes(fora.estado, t0 + 10 * 60000).every((x) => x.status === 'atrasado'));
  assert.ok(!logs.join(' ').includes(CHAVE), 'token no log');

  // Sem configuração: não chama nada e o painel diz o que falta.
  delete process.env.CRM_API_TOKEN;
  const qtd = pedidos.length;
  assert.strictEqual(await leitor.ler(DESDE, t0), null);
  assert.strictEqual(pedidos.length, qtd);
  assert.ok(crm.fontes(null, t0).every((x) => x.status === 'nao_ligado'));
}

leitura().then(() => console.log('ok: tools/test-ao-vivo.js')).catch((err) => { console.error(err); process.exit(1); });
