'use strict';
// Aba Ao vivo, sem banco e sem rede: node tools/test-ao-vivo.js
const assert = require('node:assert');
const aoVivo = require('../server/ao-vivo');
const regua = require('../server/ao-vivo-regua');
const testes = require('../server/ao-vivo-testes');
const resultado = require('../server/resultado');

const AGORA = Date.parse('2026-11-04T15:00:00-03:00');
const NIVEIS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ t: `Módulo ${n}` }));
const DESDE = '2026-10-29';
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

const lista = [
  aluno({ created_at: '2026-11-04T14:00:00-03:00' }), // no prazo
  aluno({ rgm: '111-1' }), // sem telefone e sem aviso
  aluno({ rgm: '222-2' }), // recebeu o login
  aluno({ rgm: '333-3' }), // só a oferta
  aluno({ rgm: '444-4' }), // sem aviso nenhum
  aluno({ rgm: '555-5' }), // nasceu sem senha
  aluno(entrou),
  aluno(comecou),
  aluno({ ...comecou, trilha_ultima: '2026-11-04T14:30:00-03:00' }),
  aluno({ ...concluiu, cert_erros: 2 }),
  aluno(concluiu),
  aluno(concluiu), // este tem certificado
  aluno({ created_at: '2026-10-20T12:00:00-03:00' }), // antes do corte
];
const certificados = { [lista[11].id]: '2026-11-03T10:00:00-03:00' };
const telefones = new Map([['222-2', '5511912340001'], ['333-3', '11912340002'], ['444-4', '11912340003'], ['555-5', '11912340004']]);
const alcance = {
  inicio: Date.parse('2026-10-29T00:00:00-03:00'),
  oferta: new Set(['2222', '3333']),
  sem_senha: new Set(['5555']),
  login: new Set(['2222']),
};
const opts = { desde: DESDE, agora: AGORA, niveis: NIVEIS, telefones, alcance, progresso: { 1: { abriram: 5, concluiram: 5 } } };
const f = aoVivo.funil(lista, certificados, opts);

// Funil: bate com o Resultado da Visão geral, a mesma regra.
const r = resultado.calcular(lista.filter((a) => a.created_at >= '2026-10-29'), certificados, 'todos', { agora: AGORA, contar_desde: DESDE });
assert.strictEqual(f.total.contas, r.contas);
['entraram', 'comecaram', 'concluiram', 'certificado'].forEach((id) => {
  assert.strictEqual(f.etapas.find((e) => e.id === id).n, r.etapas.find((e) => e.id === id).n, id);
});
assert.strictEqual(f.etapas.find((e) => e.id === 'em24').n, r.primeiro_acesso_24h.n);
assert.strictEqual(f.etapas.find((e) => e.id === 'em24').de, r.primeiro_acesso_24h.de);
assert.strictEqual(f.total.contas, 12);

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
const motivo = (id, x = f) => (x.falta_100.motivos.find((m) => m.id === id) || { n: 0 }).n;
assert.strictEqual(f.falta_100.total, 11);
assert.strictEqual(f.falta_100.motivos.reduce((n, m) => n + m.n, 0), f.falta_100.total);
assert.strictEqual(motivo('no_prazo'), 1);
assert.strictEqual(motivo('sem_telefone'), 1);
assert.strictEqual(motivo('login_nao_entrou'), 1);
assert.strictEqual(motivo('oferta_sem_login'), 1);
assert.strictEqual(motivo('sem_senha'), 1);
assert.strictEqual(motivo('sem_registro'), 1);
assert.strictEqual(motivo('nao_comecou'), 1);
assert.strictEqual(motivo('nao_concluiu'), 2);
assert.strictEqual(motivo('cert_erro'), 1);
assert.strictEqual(motivo('cert_sem_tentar'), 1);

// Sem avisos, ou conta anterior ao primeiro aviso: agrupa em vez de inventar o motivo.
const semRegua = aoVivo.funil(lista, certificados, { ...opts, alcance: null });
assert.strictEqual(motivo('nao_entrou', semRegua), 4);
assert.strictEqual(motivo('sem_registro', semRegua), 0);
const avisoDepois = aoVivo.funil(lista, certificados, { ...opts, alcance: { ...alcance, inicio: Date.parse('2026-11-02T00:00:00-03:00') } });
assert.strictEqual(motivo('login_nao_entrou', avisoDepois), 0, 'conta anterior aos avisos não usa os avisos');
assert.strictEqual(motivo('nao_entrou', avisoDepois), 4);
const semTel = aoVivo.funil(lista, certificados, { ...opts, telefones: null, alcance: null });
assert.strictEqual(motivo('sem_telefone', semTel), 0);
assert.strictEqual(semTel.falta_100.motivos.reduce((n, m) => n + m.n, 0), semTel.falta_100.total);

// Módulos: parado no aberto; sem nenhum aberto, no seguinte ao último concluído.
assert.strictEqual(aoVivo.moduloParado({ nivel_aberto: 3, niveis_concluidos: 2, total_niveis: 7 }), 3);
assert.strictEqual(aoVivo.moduloParado({ nivel_aberto: null, niveis_concluidos: 2, total_niveis: 7 }), 3);
assert.strictEqual(aoVivo.moduloParado({ nivel_aberto: null, niveis_concluidos: 9, total_niveis: 7 }), 7);
const m3 = f.modulos.lista.find((x) => x.modulo === 3);
assert.strictEqual(m3.parados, 2);
assert.strictEqual(m3.parados_24h, 1, 'quem mexeu há menos de 24 h não conta como parado há 24 h');
assert.strictEqual(f.modulos.nao_entraram, 6);
assert.strictEqual(f.modulos.nao_comecaram, 1);
assert.strictEqual(f.modulos.lista[0].abriram, 5);

// Privacidade: nada do aluno na resposta do funil.
const texto = JSON.stringify(f);
['Nome Secreto', 'segredo.test', '99001', '222-2', '91234'].forEach((s) => assert.ok(!texto.includes(s), `vazou ${s}`));

// Webhook: segredo, formato e o que vem vazio do CRM.
delete process.env.REGUA_WEBHOOK_SEGREDO;
assert.strictEqual(regua.autorizado('qualquer'), false, 'sem segredo configurado, ninguém entra');
process.env.REGUA_WEBHOOK_SEGREDO = 'segredo-teste';
assert.strictEqual(regua.autorizado('segredo-teste'), true);
assert.strictEqual(regua.autorizado('errado'), false);
assert.strictEqual(regua.autorizado(undefined), false);
assert.strictEqual(regua.autorizado(12345), false);
assert.ok(!('segredo' in regua.normalizar({ automacao: 'bv', passo: 'login', negocio: 'x', segredo: 'segredo-teste' })), 'segredo não é gravado');
const ev = regua.normalizar({ automacao: 'bv', passo: 'login', negocio: 'cmw2be3rh', rgm: '2501234-5', extra: 'ignorado', telefone: '11912345678' });
assert.deepStrictEqual(ev, { automacao: 'bv', passo: 'login', negocio: 'cmw2be3rh', rgm: '25012345', teste: null, variante: null });
assert.strictEqual(regua.normalizar({ automacao: 'bv', passo: 'login', negocio: 'x', rgm: '' }).rgm, null, 'campo vazio no CRM vira nulo');
assert.strictEqual(regua.normalizar({ automacao: 'bv', passo: 'entrou', negocio: 'x' }), null);
assert.strictEqual(regua.normalizar({ automacao: 'bv', passo: 'login', negocio: "x'; drop" }), null);
assert.strictEqual(regua.normalizar({ automacao: 'BV Calouros', passo: 'login', negocio: 'x' }), null);
assert.strictEqual(regua.normalizar(null), null);

// Resumo: conta por dia em Brasília, separa automações e deixa variante fora.
const evento = (passo, rgm, quando, extra) => ({ automacao: 'bv', passo, rgm, teste: '', variante: '', criado_em: quando, ...extra });
const eventos = [
  evento('oferta', '2222', '2026-11-04T02:30:00Z'), // ainda 03/11 em Brasília
  evento('oferta', '3333', '2026-11-04T12:00:00Z'),
  evento('sem_senha', '5555', '2026-11-04T12:10:00Z'),
  evento('login', '2222', '2026-11-04T12:30:00Z'),
  evento('variante', '3333', '2026-11-04T12:40:00Z', { teste: 'r1', variante: 'A' }),
  evento('oferta', '7777', '2026-11-04T13:00:00Z', { automacao: 'outra' }),
];
const resumo = regua.resumir(eventos);
const bv = resumo.automacoes.find((a) => a.id === 'bv');
assert.strictEqual(resumo.automacoes.length, 2);
assert.strictEqual(bv.total.oferta, 2);
assert.strictEqual(bv.total.sem_senha, 1);
assert.strictEqual(bv.total.login, 1);
assert.deepStrictEqual(bv.dias.map((d) => d.dia), ['2026-11-04', '2026-11-03']);
assert.strictEqual(bv.dias[1].oferta, 1);
assert.strictEqual(resumo.ultimo_evento_em, '2026-11-04T13:00:00.000Z');
assert.ok(!JSON.stringify(resumo).includes('2222'), 'RGM não sai no resumo');
assert.deepStrictEqual(regua.resumir([]).automacoes, []);
assert.strictEqual(regua.alcanceDe([]), null);
const alc = regua.alcanceDe(eventos);
assert.ok(alc.login.has('2222') && alc.oferta.has('3333') && !alc.login.has('3333'));
assert.strictEqual(alc.inicio, Date.parse('2026-11-04T02:30:00Z'));

// Fonte: o que a tela diz em cada situação.
const t0 = Date.parse('2026-11-04T15:00:00Z');
assert.strictEqual(regua.fonte(resumo, t0).status, 'em_dia');
assert.strictEqual(regua.fonte(resumo, t0 + 3 * 86400000).status, 'atrasado');
assert.strictEqual(regua.fonte({ ultimo_evento_em: null }, t0).status, 'nao_ligado');
delete process.env.REGUA_WEBHOOK_SEGREDO;
assert.strictEqual(regua.fonte(resumo, t0).status, 'nao_ligado');
process.env.REGUA_WEBHOOK_SEGREDO = 'segredo-teste';

// Testes A/B/C: grupo pelo primeiro aviso, prazo inteiro e leitura só no fim.
(function testesAbc() {
  const def = {
    id: 'r1', titulo: 'Primeira mensagem', inicio: '2026-11-10', duracao_dias: 21, por_grupo: 3, metrica: 'entrou_24h',
    variantes: [{ id: 'A', rotulo: 'Atual' }, { id: 'B', rotulo: 'Login direto' }, { id: 'C', rotulo: 'Um botão' }],
  };
  const em = '2026-11-11T12:00:00-03:00';
  const emMs = Date.parse(em);
  const conta = (id, extra) => ({ id, rgm: `10${id}-0`, nome: `Nome Secreto ${id}`, primeiro_acesso: null, ...extra });
  const contas = [
    conta(1, { primeiro_acesso: '2026-11-11T13:00:00-03:00' }),
    conta(2, { primeiro_acesso: '2026-11-13T13:00:00-03:00' }), // entrou depois de 24 h
    conta(3, { primeiro_acesso: '2026-11-11T14:00:00-03:00' }),
    conta(4, { primeiro_acesso: '2026-11-11T15:00:00-03:00' }),
    conta(5),
  ];
  const aviso = (id, variante, quando = em) => ({ passo: 'variante', teste: 'r1', variante, rgm: `10${id}0`, criado_em: quando });
  const avisos = [
    aviso(1, 'A'), aviso(2, 'A'), aviso(99, 'A'), // o 99 não tem conta
    aviso(3, 'B'), aviso(4, 'B'), aviso(1, 'B', '2026-11-12T12:00:00-03:00'), // o 1 já estava em A
    aviso(5, 'C'), aviso(6, 'C', '2026-11-09T12:00:00-03:00'), // antes do início
    { passo: 'variante', teste: 'outro', variante: 'A', rgm: '1050', criado_em: em }, // outro teste
    { passo: 'variante', teste: 'r1', variante: 'C', rgm: null, criado_em: em }, // sem RGM
    { passo: 'login', teste: '', variante: '', rgm: '1030', criado_em: em },
  ];
  const marcos = new Map([[3, { comecou_em: '2026-11-11T16:00:00-03:00', ultimo_concluido: '2026-11-12T10:00:00-03:00', concluidos: 7 }], [4, { comecou_em: '2026-11-14T16:00:00-03:00', ultimo_concluido: null, concluidos: 1 }]]);
  const dados = { lista: contas, marcos, eventos: avisos, login: new Set(['1030']), totalNiveis: 7 };

  const fim = testes.placar(def, { ...dados, agora: Date.parse('2026-12-03T12:00:00-03:00') });
  assert.strictEqual(fim.status, 'encerrado');
  const [a, b, c] = fim.grupos;
  assert.strictEqual(a.sorteados, 3);
  assert.strictEqual(a.sem_conta, 1);
  assert.strictEqual(a.metricas.entrou_24h.de, 2);
  assert.strictEqual(a.metricas.entrou_24h.n, 1, 'entrar depois de 24 h não conta');
  assert.strictEqual(b.sorteados, 2, 'vale o primeiro aviso');
  assert.strictEqual(b.login, 1);
  assert.strictEqual(b.metricas.entrou_24h.pct, 100);
  assert.strictEqual(b.metricas.comecou_24h.n, 1);
  assert.strictEqual(b.metricas.concluiu_7d.n, 1);
  assert.strictEqual(c.sorteados, 1, 'antes do início e sem RGM não entram');
  assert.ok(fim.avisos.some((x) => x.includes('outra variante')));
  assert.ok(fim.avisos.some((x) => x.includes('sem RGM')));
  assert.ok(fim.avisos.some((x) => x.includes('abaixo')));
  assert.ok(['melhor', 'pior', 'sem_diferenca'].includes(fim.comparacoes[0].leitura));
  assert.ok(fim.comparacoes[0].margem != null);

  // Durante o teste: sem veredito, e quem ainda está dentro do prazo não conta.
  const durante = testes.placar(def, { ...dados, agora: emMs + 3600000 });
  assert.strictEqual(durante.status, 'em_andamento');
  assert.strictEqual(durante.grupos[0].metricas.entrou_24h.de, 0);
  assert.strictEqual(durante.comparacoes[0].leitura, 'sem_dados');
  const parcial = testes.placar(def, { ...dados, agora: emMs + 2 * 86400000 });
  assert.strictEqual(parcial.comparacoes[0].leitura, 'parcial');
  assert.strictEqual(parcial.comparacoes[0].margem, undefined);
  // Fim do teste, mas ainda dentro do prazo da métrica: continua sem veredito.
  assert.strictEqual(testes.placar(def, { ...dados, agora: Date.parse('2026-12-01T12:00:00-03:00') }).status, 'amadurecendo');

  // Veredito: 250 por grupo. A com 59%, B com 72% (ganha), C com 60% (empate).
  const pessoas = [];
  const grandes = [];
  const entra = { A: 148, B: 180, C: 150 };
  Object.keys(entra).forEach((v, g) => {
    for (let i = 0; i < 250; i += 1) {
      const rgm = `9${g}${String(i).padStart(4, '0')}`;
      pessoas.push({ id: 1000 + g * 1000 + i, rgm, primeiro_acesso: i < entra[v] ? '2026-11-11T13:00:00-03:00' : null });
      grandes.push({ passo: 'variante', teste: 'r1', variante: v, rgm, criado_em: em });
    }
  });
  const decidido = testes.placar(def, { lista: pessoas, marcos: new Map(), eventos: grandes, login: new Set(), totalNiveis: 7, agora: Date.parse('2026-12-03T12:00:00-03:00') });
  assert.strictEqual(decidido.comparacoes[0].diferenca, 13);
  assert.strictEqual(decidido.comparacoes[0].leitura, 'melhor');
  assert.strictEqual(decidido.comparacoes[1].leitura, 'sem_diferenca');
  assert.ok(!decidido.avisos.some((x) => x.includes('abaixo')));

  // Antes do início e sem dados.
  assert.strictEqual(testes.placar(def, { ...dados, agora: Date.parse('2026-11-01T12:00:00-03:00') }).status, 'agendado');
  const semDados = testes.placar(def, { ...dados, eventos: null, agora: emMs });
  assert.strictEqual(semDados.status, 'indisponivel');
  assert.deepStrictEqual(semDados.grupos, []);

  // Privacidade: nem RGM nem nome no placar.
  const textoPlacar = JSON.stringify(fim);
  ['Nome Secreto', '1010', '101-0', '9900'].forEach((x) => assert.ok(!textoPlacar.includes(x), `vazou ${x}`));
}());

console.log('ok: tools/test-ao-vivo.js');
