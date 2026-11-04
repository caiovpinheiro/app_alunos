/* Admin › Ao vivo: funil do portal e régua do CRM. Dados de GET /api/admin/ao-vivo.
   Atualiza sozinho enquanto a aba está aberta e visível. Só números agregados de alunos. */
window.AdminAoVivo = (function () {
  'use strict';

  var C = function () { return window.AdminCore; };
  var esc = function (t) { return C().escapeHtml(t); };
  var INTERVALO_PADRAO = 45;
  var STATUS = { em_dia: 'Em dia', atrasado: 'Atrasado', indisponivel: 'Indisponível', nao_ligado: 'Falta ligar' };
  var SELO = { em_dia: 'bom', atrasado: 'regular', indisponivel: 'ruim', nao_ligado: 'sem_dados' };
  var ligado = false;
  var timer = null;
  var ultimo = null;
  var carregando = false;
  var base = 'novos';
  var ligadoEventos = false;

  function hora(iso) {
    return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function dataHora(iso) {
    if (!iso) return 'Sem leitura';
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function diaBr(iso) { var p = String(iso).split('-'); return p[2] + '/' + p[1]; }
  function pctTxt(v) { return v == null ? '—' : v + '%'; }
  function pct(n, de) { return de ? Math.round(n / de * 100) : null; }
  function selo(status) {
    return '<span class="pn-selo pn-selo--' + esc(SELO[status] || 'sem_dados') + '">' + esc(STATUS[status] || status) + '</span>';
  }
  function num(n, sub) {
    return '<td class="pn-num"><b>' + n + '</b>' + (sub == null ? '' : ' <span>' + esc(sub) + '</span>') + '</td>';
  }

  function etapasHtml(f) {
    var contas = '<article class="rs-et rs-et--base"><h4>Contas criadas</h4><p class="rs-n">' + f.total.contas + '</p>' +
      '<div class="rs-barra" aria-hidden="true"><i style="width:' + (f.total.contas ? 100 : 0) + '%"></i></div>' +
      '<p class="rs-sub">desde ' + esc(diaBr(f.desde)) + '</p></article>';
    return '<div class="rs-funil av-funil">' + contas + f.etapas.map(function (e) {
      var base = e.id === 'em24' ? ' das ' + e.de + ' contas com mais de 24 h' : '';
      return '<article class="rs-et"><h4>' + esc(e.rotulo) + '</h4>' +
        '<p class="rs-n">' + e.n + ' <span>' + pctTxt(e.pct) + '</span></p>' +
        '<div class="rs-barra" aria-hidden="true"><i style="width:' + (e.pct || 0) + '%"></i></div>' +
        '<p class="rs-sub av-falta">' + (!e.de ? (e.id === 'em24' ? 'Nenhuma conta completou 24 h ainda' : 'Nenhuma conta ainda')
          : (e.faltam > 0 ? 'Faltam <b>' + e.faltam + '</b> para 100%' : '100% atingido') + esc(base)) + '</p></article>';
    }).join('') + '</div>';
  }

  function faltaHtml(f) {
    var x = f.falta_100;
    if (!f.total.contas) return '';
    var linhas = x.motivos.map(function (m) {
      return '<tr><th scope="row">' + esc(m.texto) + '</th>' + num(m.n, pctTxt(m.pct_falta)) +
        '<td class="av-barra-c"><div class="rs-barra" aria-hidden="true"><i style="width:' + (m.pct_falta || 0) + '%"></i></div></td>' +
        '<td class="av-dono">' + esc(m.dono) + '</td></tr>';
    }).join('');
    return '<section class="pn-sec" aria-labelledby="av-h-falta"><h3 id="av-h-falta" class="pn-h3">Quanto falta para 100%</h3>' +
      '<p class="pn-sub">Faltam <b>' + x.total + '</b> de ' + f.total.contas + ' contas para chegar ao certificado. Cada conta aparece em um só motivo, o da etapa em que está.</p>' +
      (x.motivos.length ? '<div class="overflow-x-auto"><table class="pn-sits"><thead><tr><th scope="col">Motivo</th><th scope="col" class="pn-num">Contas</th><th scope="col">Parte do que falta</th><th scope="col">Quem age</th></tr></thead><tbody>' + linhas + '</tbody></table></div>'
        : '<p class="pn-vazio">Todas as contas chegaram ao certificado.</p>') + '</section>';
  }

  function diasHtml(f) {
    var cel = function (n, de) { return num(n, pctTxt(pct(n, de))); };
    var linhas = f.por_dia.map(function (d) {
      return '<tr><th scope="row">' + esc(diaBr(d.dia)) + '</th><td class="pn-num"><b>' + d.contas + '</b></td>' +
        cel(d.entraram, d.contas) + num(d.em24, d.com24h ? 'de ' + d.com24h : 'no prazo') +
        cel(d.comecaram, d.contas) + cel(d.concluiram, d.contas) + cel(d.certificado, d.contas) +
        '<td class="pn-num"><b>' + d.primeiros_acessos + '</b></td></tr>';
    }).join('');
    var t = f.total;
    var total = '<tr class="av-total"><th scope="row">Total</th><td class="pn-num"><b>' + t.contas + '</b></td>' +
      cel(t.entraram, t.contas) + num(t.em24, 'de ' + t.com24h) + cel(t.comecaram, t.contas) + cel(t.concluiram, t.contas) + cel(t.certificado, t.contas) +
      '<td class="pn-num"><b>' + t.primeiros_acessos + '</b></td></tr>';
    return '<section class="pn-sec" aria-labelledby="av-h-dia"><h3 id="av-h-dia" class="pn-h3">Por dia</h3>' +
      '<p class="pn-sub">Cada linha é o dia em que a conta foi criada e mostra até onde ela chegou até agora. A última coluna conta os primeiros acessos feitos naquele dia, de qualquer conta: é onde o efeito de uma campanha aparece.</p>' +
      '<div class="overflow-x-auto"><table class="pn-sits av-dias"><thead><tr><th scope="col">Dia</th><th scope="col" class="pn-num">Contas</th><th scope="col" class="pn-num">Entraram</th><th scope="col" class="pn-num">Em 24 h</th><th scope="col" class="pn-num">Começaram</th><th scope="col" class="pn-num">Concluíram</th><th scope="col" class="pn-num">Certificado</th><th scope="col" class="pn-num">1º acessos no dia</th></tr></thead><tbody>' +
      total + linhas + '</tbody></table></div></section>';
  }

  function modulosHtml(f) {
    var m = f.modulos;
    var fora = function (rotulo, n) { return '<tr><th scope="row">' + esc(rotulo) + '</th><td class="pn-num">—</td><td class="pn-num">—</td><td class="pn-num"><b>' + n + '</b></td><td class="pn-num">—</td></tr>'; };
    var linhas = m.lista.map(function (x) {
      return '<tr><th scope="row">Módulo ' + x.modulo + '<small>' + esc(x.titulo) + '</small></th>' +
        '<td class="pn-num"><b>' + x.abriram + '</b></td><td class="pn-num"><b>' + x.concluiram + '</b></td>' +
        '<td class="pn-num"><b>' + x.parados + '</b></td><td class="pn-num"><b>' + x.parados_24h + '</b></td></tr>';
    }).join('');
    return '<section class="pn-sec" aria-labelledby="av-h-mod"><h3 id="av-h-mod" class="pn-h3">Onde cada aluno parou</h3>' +
      '<p class="pn-sub">Só quem ainda não concluiu aparece em "Parados aqui". "Começou" só conta depois de um vídeo concluído, uma resposta ou um toque em Travei: quem só deu play continua em "Entrou e não começou".</p>' +
      '<div class="overflow-x-auto"><table class="pn-sits"><thead><tr><th scope="col">Etapa</th><th scope="col" class="pn-num">Abriram</th><th scope="col" class="pn-num">Concluíram</th><th scope="col" class="pn-num">Parados aqui</th><th scope="col" class="pn-num">Há 24 h ou mais</th></tr></thead><tbody>' +
      fora('Nunca entrou', m.nao_entraram) + fora('Entrou e não começou a Aula', m.nao_comecaram) + linhas + '</tbody></table></div></section>';
  }

  function aviso(texto, tipo) { return '<p class="av-aviso av-aviso--' + esc(tipo || 'regular') + '">' + esc(texto) + '</p>'; }

  var AUTOMACOES = { bv: 'BV - Calouros' };

  function automacaoHtml(a) {
    var t = a.total;
    var kpi = function (rotulo, n, sub) { return '<div class="av-kpi"><span>' + esc(rotulo) + '</span><b>' + n + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>'; };
    var entraram = t.oferta + t.sem_senha;
    var kpis = kpi('Entraram na régua', entraram) +
      kpi('Foram para a oferta', t.oferta, entraram ? pctTxt(pct(t.oferta, entraram)) + ' de quem entrou' : '') +
      kpi('Nasceram sem senha', t.sem_senha, 'Podem ir à mensagem sem link') +
      kpi('Login pedido', t.login, t.oferta ? pctTxt(pct(t.login, t.oferta)) + ' das ofertas' : '') +
      kpi('Sem resposta ao lembrete', t.sem_resposta, 'Depois de 48 h');
    var linhas = a.dias.map(function (d) {
      return '<tr><th scope="row">' + esc(diaBr(d.dia)) + '</th>' + num(d.oferta + d.sem_senha) + num(d.oferta) + num(d.sem_senha) + num(d.login) + num(d.sem_resposta) + '</tr>';
    }).join('');
    return '<article class="av-auto"><h4 class="pn-h4">' + esc(AUTOMACOES[a.id] || a.id) + '</h4>' +
      '<div class="av-kpis">' + kpis + '</div>' +
      '<div class="overflow-x-auto"><table class="pn-sits av-dias"><thead><tr><th scope="col">Dia</th><th scope="col" class="pn-num">Entraram</th><th scope="col" class="pn-num">Oferta</th><th scope="col" class="pn-num">Sem senha</th><th scope="col" class="pn-num">Login pedido</th><th scope="col" class="pn-num">Sem resposta</th></tr></thead><tbody>' + linhas + '</tbody></table></div></article>';
  }

  function reguaHtml(r) {
    var g = r.regua;
    var corpo = '<p class="pn-vazio">Os avisos da régua não puderam ser lidos nesta atualização.</p>';
    if (g) corpo = g.automacoes.length ? g.automacoes.map(automacaoHtml).join('') : '<p class="pn-vazio">Nenhum aviso do CRM ainda. Os números aparecem aqui quando o webhook for ligado; o histórico não entra.</p>';
    return '<section class="pn-sec" aria-labelledby="av-h-crm"><h3 id="av-h-crm" class="pn-h3">Régua do CRM</h3>' +
      '<p class="pn-sub">Cada pessoa conta uma vez em cada passo, pelo dia em que o CRM avisou o portal.' + (g && g.ultimo_evento_em ? ' Último aviso: ' + esc(dataHora(g.ultimo_evento_em)) + '.' : '') + '</p>' + corpo + '</section>';
  }

  var TESTE_STATUS = {
    agendado: ['Agendado', 'sem_dados'], em_andamento: ['Em andamento', 'regular'], amadurecendo: ['Esperando o prazo', 'regular'],
    encerrado: ['Encerrado', 'bom'], indisponivel: ['Indisponível', 'ruim'],
  };
  var LEITURA = { parcial: 'Parcial: ainda não decidir', melhor: 'Melhor que A', pior: 'Pior que A', sem_diferenca: 'Sem diferença clara', sem_dados: 'Sem dados ainda' };

  function metricaCel(m, principal) {
    return '<td class="pn-num' + (principal ? ' av-principal' : '') + '"><b>' + pctTxt(m.pct) + '</b> <span>' + m.n + ' de ' + m.de + '</span></td>';
  }

  function testeHtml(t) {
    var st = TESTE_STATUS[t.status] || [t.status, 'sem_dados'];
    var cab = '<article class="av-auto"><div class="av-auto-top"><h4 class="pn-h4">' + esc(t.titulo) + '</h4><span class="pn-selo pn-selo--' + st[1] + '">' + esc(st[0]) + '</span></div>' +
      '<p class="pn-nota">Início em ' + esc(diaBr(t.inicio)) + ', por ' + t.duracao_dias + ' dias. Leitura final em ' + esc(dataHora(t.leitura_em)) + '. Métrica principal: ' + esc(t.metrica_rotulo) + '.</p>' +
      t.avisos.map(function (x) { return aviso(x); }).join('');
    if (!t.grupos.length) return cab + '</article>';
    var comp = {};
    t.comparacoes.forEach(function (c) { comp[c.id] = c; });
    var linhas = t.grupos.map(function (g) {
      var c = comp[g.id];
      var dif = '—';
      if (c && c.diferenca != null) dif = (c.diferenca > 0 ? '+' : c.diferenca < 0 ? '−' : '') + Math.abs(c.diferenca) + ' pontos' + (c.margem != null ? ' (±' + c.margem + ')' : '');
      return '<tr><th scope="row">' + esc(g.id) + '<small>' + esc(g.rotulo) + '</small></th>' +
        num(g.sorteados, 'de ' + t.por_grupo) + num(g.login) + num(g.sem_conta) +
        metricaCel(g.metricas.entrou_24h, t.metrica === 'entrou_24h') + metricaCel(g.metricas.comecou_24h, t.metrica === 'comecou_24h') + metricaCel(g.metricas.concluiu_7d, t.metrica === 'concluiu_7d') +
        '<td class="av-leitura">' + esc(dif) + (c ? '<small>' + esc(LEITURA[c.leitura] || '') + '</small>' : '<small>Base de comparação</small>') + '</td></tr>';
    }).join('');
    return cab + '<div class="overflow-x-auto"><table class="pn-sits av-dias"><thead><tr><th scope="col">Variante</th><th scope="col" class="pn-num">No grupo</th><th scope="col" class="pn-num">Login pedido</th><th scope="col" class="pn-num">Sem conta</th><th scope="col" class="pn-num">Entrou em 24 h</th><th scope="col" class="pn-num">Começou em 24 h</th><th scope="col" class="pn-num">Concluiu em 7 dias</th><th scope="col">Contra A</th></tr></thead><tbody>' + linhas + '</tbody></table></div></article>';
  }

  function testesHtml(r) {
    var lista = r.testes || [];
    return '<section class="pn-sec" aria-labelledby="av-h-testes"><h3 id="av-h-testes" class="pn-h3">Testes A/B/C</h3>' +
      '<p class="pn-sub">Cada pessoa fica no grupo do primeiro aviso. Os percentuais só contam quem já teve o prazo inteiro. Até a leitura final, o placar é parcial e não serve para decidir.</p>' +
      (lista.length ? lista.map(testeHtml).join('') : '<p class="pn-vazio">Nenhum teste rodando. O placar aparece aqui quando a primeira rodada começar.</p>') + '</section>';
  }

  function fontesHtml(r) {
    var linhas = r.fontes.map(function (f) {
      return '<tr><th scope="row">' + esc(f.rotulo) + '</th><td>' + selo(f.status) + '</td><td class="av-quando">' + esc(dataHora(f.atualizado_em)) + '</td><td>' + esc(f.detalhe) + '</td></tr>';
    }).join('');
    var limites = r.limites.map(function (l) { return '<li><b>' + esc(l.fonte) + ':</b> ' + esc(l.texto) + '</li>'; }).join('');
    return '<section class="pn-sec" aria-labelledby="av-h-fontes"><h3 id="av-h-fontes" class="pn-h3">De onde vêm os dados</h3>' +
      '<div class="overflow-x-auto"><table class="pn-sits av-fontes"><thead><tr><th scope="col">Fonte</th><th scope="col">Situação</th><th scope="col">Última leitura boa</th><th scope="col">Detalhe</th></tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      '<h4 class="pn-h4">O que este painel não mede</h4><ul class="av-limites">' + limites + '</ul></section>';
  }

  function alertaHtml(r) {
    var ruins = r.fontes.filter(function (f) { return f.status !== 'em_dia'; });
    if (!ruins.length) return '';
    return aviso('Com atraso ou indisponível: ' + ruins.map(function (f) { return f.rotulo; }).join(', ') + '. Veja o detalhe em "De onde vêm os dados", no fim da página.');
  }

  function desenhar(r) {
    var alvo = document.getElementById('aovivo-conteudo');
    if (!alvo) return;
    alvo.innerHTML = alertaHtml(r) +
      '<section class="pn-sec" aria-labelledby="av-h-funil"><h3 id="av-h-funil" class="pn-h3">Funil desde ' + esc(diaBr(r.funil.desde)) + '</h3>' +
      '<p class="pn-sub">A meta é 100% em cada etapa. Os percentuais usam todas as contas criadas, como na Visão geral.</p>' + etapasHtml(r.funil) + '</section>' +
      faltaHtml(r.funil) + diasHtml(r.funil) + modulosHtml(r.funil) + reguaHtml(r) + testesHtml(r) + fontesHtml(r);
  }

  function mostrarStatus() {
    var el = document.getElementById('aovivo-status');
    if (!el) return;
    if (carregando && !ultimo) { el.textContent = 'Carregando…'; return; }
    if (!ultimo) return;
    var msg = 'Atualizado às ' + hora(ultimo.gerado_em);
    if (ultimo.erro) msg = 'Sem conexão. Mostrando a leitura das ' + hora(ultimo.gerado_em);
    el.textContent = msg + (document.hidden ? ' · pausado com a aba em segundo plano' : ' · atualiza sozinho a cada ' + (ultimo.atualiza_em_s || INTERVALO_PADRAO) + ' s');
  }

  function mostrarBases(r) {
    var campo = document.getElementById('aovivo-base');
    if (!campo || !r.bases) return;
    r.bases.forEach(function (b) {
      var op = campo.querySelector('option[value="' + b.id + '"]');
      if (op) op.textContent = b.rotulo;
    });
  }

  async function carregar() {
    if (carregando) return;
    carregando = true;
    mostrarStatus();
    var pedida = base;
    try {
      var r = await C().request('/api/admin/ao-vivo?base=' + encodeURIComponent(pedida));
      // Trocaram de base durante a leitura: esta resposta já não vale.
      if (pedida === base) {
        ultimo = r;
        desenhar(r);
        mostrarBases(r);
      }
    } catch (err) {
      if (ultimo) ultimo.erro = true;
      else { var alvo = document.getElementById('aovivo-conteudo'); if (alvo) alvo.innerHTML = aviso((err && err.message) || 'Não foi possível carregar o painel.', 'ruim'); }
    }
    carregando = false;
    mostrarStatus();
    if (pedida !== base) await carregar();
  }

  function agendar() {
    clearTimeout(timer);
    if (!ligado || document.hidden) return;
    var espera = (ultimo && ultimo.atualiza_em_s) || INTERVALO_PADRAO;
    timer = setTimeout(function () { carregar().then(agendar); }, espera * 1000);
  }

  function iniciar() {
    if (!ligadoEventos) {
      ligadoEventos = true;
      var b = document.getElementById('aovivo-atualizar');
      if (b) b.addEventListener('click', function () { carregar().then(agendar); });
      var campo = document.getElementById('aovivo-base');
      if (campo) campo.addEventListener('change', function () { base = campo.value; carregar().then(agendar); });
      // Em segundo plano não consulta nada; ao voltar, atualiza na hora.
      document.addEventListener('visibilitychange', function () {
        if (!ligado) return;
        mostrarStatus();
        if (document.hidden) clearTimeout(timer);
        else carregar().then(agendar);
      });
    }
    if (ligado) return;
    ligado = true;
    carregar().then(agendar);
  }

  function parar() {
    ligado = false;
    clearTimeout(timer);
  }

  return { iniciar: iniciar, parar: parar };
})();
