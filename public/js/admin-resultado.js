/* Admin › Visão geral: o resultado do período. Contas criadas, até onde chegaram e como isso evoluiu.
   Todos os percentuais grandes usam a mesma base (as contas do período). Dados em r.resultado de GET /api/admin/painel. */
window.AdminResultado = (function () {
  'use strict';

  var C = function () { return window.AdminCore; };
  var esc = function (t) { return C().escapeHtml(t); };
  var FAIXA = { bom: 'Bom', regular: 'Regular', ruim: 'Ruim', sem_dados: 'Poucos dados' };

  function selo(faixa, meta) {
    return '<span class="pn-selo pn-selo--' + esc(faixa) + '" title="' + esc(meta || '') + '">' + esc(FAIXA[faixa] || faixa) + '</span>';
  }
  function abrir(texto, p, etapa) {
    var b = { texto: texto, aba: 'acompanhamento', sinal: p.sinal, etapa: etapa || '' };
    if (p.id === 'datas') { b.criada_de = p.de; b.criada_ate = p.ate; }
    return '<button type="button" class="pn-ir" data-pn-ir="' + esc(JSON.stringify(b)) + '">' + esc(texto) + '</button>';
  }
  function pctTxt(v) { return v == null ? '—' : v + '%'; }
  function diaBr(iso) { var p = String(iso).split('-'); return p[2] + '/' + p[1]; }

  function frase(r) {
    if (!r.contas) return 'Nenhuma conta criada ' + esc(r.periodo.rotulo) + '.';
    var e = r.etapas;
    var parte = function (x, verbo) { return '<b>' + x.n + '</b> ' + verbo + ' (' + x.pct_contas + '%)'; };
    return 'Das <b>' + r.contas + '</b> contas criadas ' + esc(r.periodo.rotulo) + ', ' +
      parte(e[0], e[0].n === 1 ? 'entrou' : 'entraram') + ', ' +
      parte(e[1], e[1].n === 1 ? 'começou a Aula' : 'começaram a Aula') + ', ' +
      parte(e[2], e[2].n === 1 ? 'concluiu' : 'concluíram') + ' e ' +
      parte(e[3], e[3].n === 1 ? 'tem certificado' : 'têm certificado') + '.';
  }

  function variacao(v, periodo) {
    if (v == null) return '';
    var quando = periodo === 'hoje' ? 'ontem' : 'o período anterior';
    var txt = v === 0 ? 'Igual a ' + quando : (v > 0 ? '+' : '−') + Math.abs(v) + ' pontos sobre ' + quando;
    return '<p class="rs-var">' + esc(txt) + '</p>';
  }

  function funilHtml(r) {
    var contas = '<article class="rs-et rs-et--base"><h4>Contas criadas</h4>' +
      '<p class="rs-n">' + r.contas + '</p>' +
      '<div class="rs-barra" aria-hidden="true"><i style="width:' + (r.contas ? 100 : 0) + '%"></i></div>' +
      '<p class="rs-sub">' + esc(r.periodo.rotulo) + '</p>' +
      (r.contas_anterior == null ? '' : '<p class="rs-var">' + r.contas_anterior + (r.periodo.id === 'hoje' ? ' ontem' : ' no período anterior') + '</p>') +
      (r.contas ? '<div class="rs-a">' + abrir('Ver as contas', r.periodo) + '</div>' : '') + '</article>';
    var etapas = r.etapas.map(function (e) {
      return '<article class="rs-et"><h4>' + esc(e.rotulo) + '</h4>' +
        '<p class="rs-n">' + e.n + ' <span>' + pctTxt(e.pct_contas) + '</span></p>' +
        '<div class="rs-barra" aria-hidden="true"><i style="width:' + (e.pct_contas || 0) + '%"></i></div>' +
        '<p class="rs-sub">' + pctTxt(e.conversao) + ' ' + esc(e.conversao_de) + ' ' + selo(e.faixa, e.meta) + '</p>' +
        variacao(e.variacao, r.periodo.id) +
        (e.falta ? '<div class="rs-a">' + abrir(e.falta.texto, r.periodo, e.falta.etapa) + '</div>' : '') + '</article>';
    }).join('');
    return '<div class="rs-funil">' + contas + etapas + '</div>';
  }

  function acessoHtml(r) {
    var p = r.primeiro_acesso_24h;
    var a = r.acessando;
    var item = function (titulo, valor, faixa, meta, detalhe, acao) {
      return '<article class="rs-ac"><div><h4>' + esc(titulo) + '</h4><p class="rs-ac-d">' + esc(detalhe) + '</p></div>' +
        '<p class="rs-ac-v"><strong>' + pctTxt(valor) + '</strong> ' + selo(faixa, meta) + '</p>' + (acao || '') + '</article>';
    };
    return '<div class="rs-acessos">' +
      item('Primeiro acesso em até 24 h', p.valor, p.faixa, p.meta, p.n + ' de ' + p.de + ' contas com mais de 24 h') +
      item('Seguem acessando', a.valor, a.faixa, a.meta, a.n + ' de ' + a.de + ' que entraram acessaram nos últimos ' + a.dias + ' dias',
        a.falta ? abrir(a.falta.texto, r.periodo, a.falta.etapa) : '') +
    '</div>';
  }

  function rotuloLinha(l, ev) { return ev.agrupado === 'semana' ? 'Semana de ' + diaBr(l.inicio) : diaBr(l.inicio); }

  function graficoHtml(r) {
    var ev = r.evolucao;
    var max = ev.linhas.reduce(function (m, l) { return Math.max(m, l.contas); }, 0);
    if (!max) return '';
    var total = ev.linhas.length;
    var cada = Math.max(1, Math.ceil(total / 8));
    var colunas = ev.linhas.map(function (l, i) {
      var altE = l.entraram / max * 100;
      var altN = (l.contas - l.entraram) / max * 100;
      var lado = i < total / 3 ? 'esq' : i > total * 2 / 3 ? 'dir' : 'meio';
      var marca = (total - 1 - i) % cada === 0 ? '<span class="rs-x">' + esc(diaBr(l.inicio)) + '</span>' : '';
      return '<div class="rs-col">' +
        '<div class="rs-pilha">' +
          (l.contas - l.entraram ? '<i class="rs-seg rs-seg--nao" style="height:' + altN + '%"></i>' : '') +
          (l.entraram ? '<i class="rs-seg rs-seg--sim" style="height:' + altE + '%"></i>' : '') +
        '</div>' + marca +
        '<div class="rs-tip rs-tip--' + lado + '"><b>' + esc(rotuloLinha(l, ev)) + '</b><br>' + l.contas + ' conta(s)<br>' +
          l.entraram + (l.entraram === 1 ? ' entrou (' : ' entraram (') + pctTxt(l.contas ? Math.round(l.entraram / l.contas * 100) : null) + ')</div>' +
      '</div>';
    }).join('');
    return '<div class="rs-graf" role="img" aria-label="Contas criadas por ' + esc(ev.agrupado) + ' e quantas entraram. Os números estão na tabela abaixo.">' +
      '<div class="rs-legenda" aria-hidden="true"><span><i class="rs-seg--sim"></i>Entraram</span><span><i class="rs-seg--nao"></i>Ainda não entraram</span><small>Maior ' + esc(ev.agrupado) + ': ' + max + ' contas</small></div>' +
      '<div class="rs-colunas">' + colunas + '</div></div>';
  }

  function tabelaHtml(r) {
    var ev = r.evolucao;
    var linhas = ev.linhas.filter(function (l) { return l.contas; }).reverse();
    if (!linhas.length) return '';
    var cel = function (n, de) { return '<td class="pn-num"><b>' + n + '</b> <span>' + pctTxt(de ? Math.round(n / de * 100) : null) + '</span></td>'; };
    return '<div class="rs-tabela overflow-x-auto"><table class="pn-sits"><thead><tr><th scope="col">' + (ev.agrupado === 'semana' ? 'Semana de criação' : 'Dia de criação') + '</th>' +
      '<th scope="col" class="pn-num">Contas</th><th scope="col" class="pn-num">Entraram</th><th scope="col" class="pn-num">Começaram</th><th scope="col" class="pn-num">Concluíram</th><th scope="col" class="pn-num">Certificado</th></tr></thead><tbody>' +
      linhas.map(function (l) {
        return '<tr><th scope="row">' + esc(diaBr(l.inicio)) + (l.antiga ? ' <small>versão antiga</small>' : '') + '</th>' +
          '<td class="pn-num"><b>' + l.contas + '</b></td>' + cel(l.entraram, l.contas) + cel(l.comecaram, l.contas) + cel(l.concluiram, l.contas) + cel(l.certificado, l.contas) + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function html(r) {
    var notas = [];
    if (r.etapas.some(function (e) { return e.variacao != null; })) notas.push('Contas mais novas tiveram menos tempo para avançar: na comparação, as etapas finais tendem a ficar abaixo do período anterior.');
    if (r.tem_versao_antiga) notas.push('Contas marcadas como "versão antiga" não veem a Aula Inaugural e puxam para baixo as etapas da Aula.');
    return '<section class="pn-sec rs" aria-labelledby="rs-h">' +
      '<h3 id="rs-h" class="pn-h3">Resultado das contas criadas</h3>' +
      (r.contar_desde ? '<p class="rs-corte">Só contas criadas a partir de ' + esc(diaBr(r.contar_desde)) + '/' + esc(r.contar_desde.slice(0, 4)) + '. Dá para mudar a data em Configurações.</p>' : '') +
      '<p class="rs-frase">' + frase(r) + '</p>' +
      funilHtml(r) +
      (r.contas ? acessoHtml(r) : '') +
      '<h4 class="pn-h4">Evolução</h4>' +
      '<p class="pn-sub">Por ' + esc(r.evolucao.agrupado) + ' em que a conta foi criada. Cada linha mostra até onde as contas daquele ' + esc(r.evolucao.agrupado) + ' chegaram até agora.</p>' +
      (graficoHtml(r) || '<p class="pn-vazio">Nenhuma conta criada nesse intervalo.</p>') +
      tabelaHtml(r) +
      (notas.length ? '<p class="rs-nota">' + esc(notas.join(' ')) + '</p>' : '') +
    '</section>';
  }

  return { html: html };
})();
