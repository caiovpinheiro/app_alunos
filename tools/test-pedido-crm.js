'use strict';
// Pedido de ajuda -> CRM e contexto do chat, sem banco e sem rede externa: node tools/test-pedido-crm.js
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');

const SEGREDO = 'teste-s2s';

function pedido(extra) {
  return {
    id: 7, protocolo: 'AJ-TESTE', aluno_id: 482, origem: 'travei', criado_em: '2026-11-02T12:00:00.000Z',
    contexto: {
      aluno: { nome: 'Ana Souza', rgm: '2501234-5', curso: 'Pedagogia', polo: 'Barra Funda' },
      motivo: 'Tocou em Travei',
      onde: { nivel: 3, nivel_titulo: 'Estudando no AVA', parte: 2, parte_titulo: 'Atividades' },
      tentou: {}, progresso: { concluidos: 1, total: 7 }, ultimos_eventos: [],
      link_percurso: 'https://app.cruzeiroead.com.br/admin#acompanhamento/aluno/482',
    },
    ...extra,
  };
}

function bancoFalso() {
  const chamadas = [];
  return { chamadas, query: async (sql, params) => { chamadas.push({ sql, params }); return { rows: [] }; } };
}

function assinaturaOk(req, corpo) {
  const esperado = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(req.headers['x-timestamp'] + '.' + corpo).digest('hex');
  return req.headers['x-signature'] === esperado;
}

async function testaServidor() {
  const recebidos = [];
  let resposta = { status: 200, corpo: { conversation_id: 'c1', url: 'https://org.bwipo.com/inbox?c=9', deal_id: 'd1', deal_url: 'https://org.bwipo.com/pipeline?deal=3' } };
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      recebidos.push({ headers: req.headers, corpo: b, assinada: assinaturaOk(req, b) });
      res.writeHead(resposta.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resposta.corpo));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  process.env.PEDIDO_AJUDA_WEBHOOK_URL = `http://127.0.0.1:${srv.address().port}/s2s`;
  process.env.PEDIDO_AJUDA_WEBHOOK_SECRET = SEGREDO;
  const ajuda = require(path.join(__dirname, '..', 'server', 'ajuda-pedidos.js'));

  // Formato: só os dígitos do RGM, como no identify, e sem objetos nos campos.
  const c = ajuda.corpoCRM(pedido());
  assert.strictEqual(c.external_id, '25012345');
  assert.strictEqual(c.ref, 'AJ-TESTE');
  assert.strictEqual(c.category, 'travei');
  assert.strictEqual(c.priority, 'high');
  assert.strictEqual(c.fields.modulo, '3 · Estudando no AVA');
  assert.ok(Object.keys(c.fields).every((k) => /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(k)));
  assert.ok(Object.values(c.fields).every((v) => typeof v === 'string'));
  assert.deepStrictEqual(c.links, [{ label: 'Percurso do aluno', url: 'https://app.cruzeiroead.com.br/admin#acompanhamento/aluno/482' }]);
  assert.ok(!c.text.includes('Ver percurso'), 'o link vai em links, não duplicado na nota');
  assert.strictEqual(c.text, 'Tocou em Travei: Módulo 3 · Estudando no AVA, parte 2 "Atividades"\nProgresso: 1 de 7 módulos · Protocolo AJ-TESTE · RGM 2501234-5');
  // Nota curta: últimos passos e aparelho ficam no percurso.
  const cheio = pedido();
  cheio.contexto.onde.video = 'assistiu';
  cheio.contexto.tentou = { viu_dica: true };
  cheio.contexto.dispositivo = 'tablet · Chrome Mac';
  cheio.contexto.ultimos_eventos = [{ nome: 'video_pausa', em: '2026-11-02T12:00:00Z', dados: { titulo: 'aula/cap_06' } }];
  const curta = ajuda.corpoCRM(cheio).text;
  assert.strictEqual(curta.split('\n').length, 3);
  assert.match(curta, /^Já viu o vídeo, viu a dica\.$/m);
  assert.ok(!/cap_06|Chrome|Últimos passos/.test(curta));
  assert.strictEqual(ajuda.corpoCRM(pedido({ origem: 'busca_vazia' })).priority, 'normal');

  // A nota nunca passa do limite do CRM.
  const longa = pedido();
  longa.contexto.tentou = { termos: Array.from({ length: 900 }, (_, i) => `termo ${i}`) };
  assert.ok(ajuda.corpoCRM(longa).text.length <= 4000);

  // Envio assinado, com a chave de idempotência, e os links guardados.
  let banco = bancoFalso();
  assert.deepStrictEqual(await ajuda.enviarCRM(banco, pedido()), { enviado: true });
  assert.strictEqual(recebidos.length, 1);
  assert.ok(recebidos[0].assinada, 'assinatura de X-Timestamp + "." + corpo');
  assert.strictEqual(recebidos[0].headers['idempotency-key'], 'AJ-TESTE');
  assert.deepStrictEqual(banco.chamadas[0].params, [7, true, 'c1', 'https://org.bwipo.com/inbox?c=9', 'https://org.bwipo.com/pipeline?deal=3']);

  // Nova tentativa manda o mesmo corpo: o CRM recusa a mesma chave com corpo diferente.
  await ajuda.enviarCRM(bancoFalso(), pedido());
  assert.strictEqual(recebidos[1].corpo, recebidos[0].corpo);

  // Endereço que não é https não chega ao admin, e o envio continua valendo.
  resposta = { status: 200, corpo: { conversation_id: 'c2', url: 'javascript:alert(1)', deal_url: 'http://org.bwipo.com/x' } };
  banco = bancoFalso();
  assert.deepStrictEqual(await ajuda.enviarCRM(banco, pedido()), { enviado: true });
  assert.deepStrictEqual(banco.chamadas[0].params, [7, true, 'c2', null, null]);

  // Falha do CRM fica para nova tentativa.
  resposta = { status: 401, corpo: { code: 'SIGNATURE_INVALID' } };
  banco = bancoFalso();
  const erroOriginal = console.error;
  console.error = () => {};
  assert.deepStrictEqual(await ajuda.enviarCRM(banco, pedido()), { enviado: false });
  console.error = erroOriginal;
  assert.strictEqual(banco.chamadas[0].params[1], false);

  // Sem RGM não envia nem tenta de novo; o id interno nunca vira identificador.
  const n = recebidos.length;
  const semRgm = pedido();
  semRgm.contexto.aluno = { nome: 'Sem RGM', rgm: null, email: 'a@b.c' };
  assert.strictEqual(ajuda.corpoCRM(semRgm), null);
  banco = bancoFalso();
  assert.strictEqual((await ajuda.enviarCRM(banco, semRgm)).motivo, 'sem_rgm');
  assert.strictEqual(recebidos.length, n);
  assert.match(banco.chamadas[0].sql, /crm_tentativas = 5/);

  // Sem a chave, não envia.
  delete process.env.PEDIDO_AJUDA_WEBHOOK_SECRET;
  assert.strictEqual((await ajuda.enviarCRM(bancoFalso(), pedido())).motivo, 'sem_segredo');
  await new Promise((ok) => srv.close(ok));
}

function testaNavegador() {
  const log = [];
  const ouvintes = {};
  const opcoesTrack = [];
  const widget = {
    capabilities: { prefill: true },
    identify: (x) => log.push(['identify', x.externalId, x.userHash]),
    setContext: (x) => log.push(['setContext', JSON.parse(JSON.stringify(x))]),
    track: (n, d, o) => { opcoesTrack.push(o || {}); log.push(['track', n]); },
    open: () => log.push(['open']),
  };
  const janela = { addEventListener: (t, f) => { ouvintes[t] = f; }, location: { pathname: '/inicio' } };
  const sandbox = {
    window: janela, document: { addEventListener() {}, visibilityState: 'visible' }, navigator: {}, location: janela.location,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, console, Date, JSON, Object, String, Math,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'rastreio.js'), 'utf8'), sandbox);
  const R = janela.Rastreio;

  // Sem chat liberado, nada acontece nem acumula.
  R.contexto({ tela: 'Início' });
  janela.BwipoWebchat = widget;
  assert.strictEqual(R.sincronizarChat(), false);
  assert.strictEqual(log.length, 0);

  // Identifica antes de qualquer outra coisa, e assinado.
  delete janela.BwipoWebchat;
  R.iniciar({ chat: { identity: { external_id: '25012345', user_hash: 'abc', attributes: {} } } });
  R.contexto({ tela: 'Aula Inaugural' });
  janela.BwipoWebchat = widget;
  assert.ok(ouvintes['bwipo:webchat:ready'], 'ouve o aviso de pronto');
  ouvintes['bwipo:webchat:ready']();
  assert.deepStrictEqual(log[0], ['identify', '25012345', 'abc']);
  assert.deepStrictEqual(log[1], ['setContext', { tela: 'Aula Inaugural' }]);

  // Só uma identificação, e o contexto manda só o que mudou.
  log.length = 0;
  R.contexto({ modulo: '3 · AVA', parte: null });
  assert.deepStrictEqual(log, [['setContext', { modulo: '3 · AVA', parte: null }]]);

  // Trocar de tela apaga o módulo no CRM: o CRM junta as chaves, e só null remove.
  log.length = 0;
  R.contexto({ tela: 'Início', modulo: null, parte: null });
  assert.deepStrictEqual(log[0][1], { tela: 'Início', modulo: null, parte: null });

  // Sinal importante vira último sinal, com o módulo.
  log.length = 0;
  R.track('trilha_travei', { nivel: 3, nivel_titulo: 'AVA', parte: 2 }, { importante: true });
  assert.strictEqual(log[0][0], 'setContext');
  assert.match(log[0][1].ultimo_sinal, /^Tocou em "Travei" \(módulo 3, parte 2\) às /);
  assert.strictEqual(log[0][1].modulo, '3 · AVA');
  assert.deepStrictEqual(log[1], ['track', 'trilha_travei']);
  assert.strictEqual(opcoesTrack[opcoesTrack.length - 1].important, undefined, 'sinal não vira nota no CRM');
}

(async () => {
  await testaServidor();
  testaNavegador();
  console.log('ok: pedido ao CRM e contexto do chat');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
