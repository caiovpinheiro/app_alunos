/* Meu Semestre: card do dashboard e tela autenticada. Sem progresso do AVA. */
window.MeuSemestre = (function () {
  'use strict';

  var cache = null;

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseIso(value) {
    var raw = String(value || '').slice(0, 10);
    var parts = raw.split('-');
    if (parts.length !== 3) return null;
    return { iso: raw, y: parts[0], m: parts[1], d: parts[2], month: Number(parts[1]), day: Number(parts[2]) };
  }

  function formatDate(value) {
    var p = parseIso(value);
    if (!p) return '';
    return p.d + '/' + p.m + '/' + p.y;
  }

  function formatDayMonth(value) {
    var p = parseIso(value);
    if (!p) return '';
    return p.d + '/' + p.m;
  }

  function formatRange(start, end) {
    var a = parseIso(start);
    var b = parseIso(end) || a;
    if (!a) return '';
    if (!b || a.iso === b.iso) return formatDayMonth(a.iso);
    if (a.m === b.m && a.y === b.y) return a.d + ' a ' + b.d + '/' + b.m;
    return formatDayMonth(a.iso) + ' a ' + formatDayMonth(b.iso);
  }

  function monthShort(value) {
    var months = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
    var p = parseIso(value);
    if (!p) return '';
    return months[p.month - 1] || '';
  }

  function offlineHtml() {
    return (
      '<div class="ms-soon">' +
        '<span class="ms-soon-pill ms-soon-pill--off">Fora do ar</span>' +
        '<p>Opção fora do ar. Tente novamente em instantes.</p>' +
      '</div>'
    );
  }

  // ---------- Painel inicial: próximas datas, frase do topo e próximo passo ----------

  function isoDate(y, m, d) {
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function hojeIso() {
    var p = parseIso(cache && cache.hoje);
    if (p) return p.iso;
    var now = new Date();
    return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  function diasAte(iso) {
    var a = parseIso(hojeIso());
    var b = parseIso(iso);
    if (!a || !b) return null;
    var da = Date.UTC(Number(a.y), a.month - 1, a.day);
    var db = Date.UTC(Number(b.y), b.month - 1, b.day);
    return Math.round((db - da) / 86400000);
  }

  function quandoTxt(iso) {
    var n = diasAte(iso);
    if (n == null) return '';
    if (n <= 0) return 'Hoje';
    if (n === 1) return 'Amanhã';
    return 'Em ' + n + ' dias';
  }

  // Conta sem curso no cadastro (Meu Semestre vazio): diz o prazo e com quem falar.
  var MSG_SEM_PLANO = 'Ainda não encontramos as matérias do seu curso. Elas costumam aparecer em até 2 dias úteis depois da matrícula. Se demorar mais, fale com o acadêmico.';
  // Acesso em preparação (conta sem RGM, body.acesso-preparo): a faculdade ainda não criou o acesso.
  var MSG_PREPARO = 'Seu acesso está sendo preparado. As matérias, o calendário e as notas aparecem aqui assim que chegarem. Enquanto isso, comece pela Aula Inaugural.';
  function emPreparo() { return document.body.classList.contains('acesso-preparo'); }
  function comTrilha() { return document.body.classList.contains('trilha-on'); }

  // Regra única da mensalidade (igual no FAQ, na Trilha, no vídeo e no servidor):
  // vence todo dia 25; na 1ª, todos os descontos valem até o 25; da 2ª em diante,
  // até o dia 10 = 25%, do 11 ao 25 = 15%, depois do 25 sem desconto de pontualidade.
  // Dia 10 ou 25 em fim de semana ou feriado: vale o próximo dia útil.
  // O texto completo fica em financeiroHtml(); as datas efetivas saem de proximaMensalidade().

  // Feriados nacionais (fixos e os que mudam com a Páscoa) em que banco não abre.
  // É só para mostrar a data provável; o boleto mostra a data certa.
  function pascoa(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(y, mes - 1, dia);
  }

  function ehFeriado(t) {
    var dt = new Date(t);
    var md = String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
    if (['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].indexOf(md) !== -1) return true;
    var p = pascoa(dt.getUTCFullYear());
    var dias = Math.round((t - p) / 86400000);
    return dias === -48 || dias === -47 || dias === -2 || dias === 60;
  }

  // Dia d do mês, ou o próximo dia útil se cair em sábado, domingo ou feriado.
  function diaUtil(y, m, d) {
    var t = Date.UTC(y, m - 1, d);
    while (new Date(t).getUTCDay() === 0 || new Date(t).getUTCDay() === 6 || ehFeriado(t)) t += 86400000;
    var dt = new Date(t);
    return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  // O próximo vencimento (dia 25 ou o dia útil seguinte) a partir de hoje.
  function proximaMensalidade() {
    var hoje = hojeIso();
    var h = parseIso(hoje);
    var y = Number(h.y);
    var m = h.month;
    if (diaUtil(y, m, 25) < hoje) { m += 1; if (m > 12) { m = 1; y += 1; } }
    var venc = diaUtil(y, m, 25);
    var dez = diaUtil(y, m, 10);
    var dVenc = 'dia ' + Number(venc.slice(8, 10));
    var dDez = 'dia ' + Number(dez.slice(8, 10));
    var nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    var sub = hoje <= dez
      ? 'Até o ' + dDez + ': 25% de desconto; até o ' + dVenc + ': 15%. Na 1ª mensalidade, todos os descontos valem até o ' + dVenc + '.'
      : 'Até o ' + dVenc + ': 15% de desconto. Na 1ª mensalidade, todos os descontos valem até o ' + dVenc + '.';
    if (venc.slice(8, 10) !== '25') {
      var dow = new Date(Date.UTC(y, m - 1, 25)).getUTCDay();
      var motivo = dow === 6 ? 'num sábado' : dow === 0 ? 'num domingo' : 'num feriado';
      sub += ' Este mês o 25 cai ' + motivo + ', então vale o próximo dia útil.';
    }
    return {
      data: venc,
      titulo: 'Mensalidade de ' + nomes[m - 1],
      sub: sub,
      tipo: 'financeiro',
    };
  }

  function datasDoPainel() {
    var hoje = hojeIso();
    var lista = [];
    var vistos = {};
    function add(item) {
      if (!item || !item.data || item.data < hoje) return;
      // Um item por dia: no painel, datas diferentes valem mais que três avisos do mesmo dia.
      var chave = item.data;
      if (vistos[chave]) return;
      vistos[chave] = true;
      lista.push(item);
    }
    var resumo = (cache && cache.resumo) || {};
    var disc = resumo.disciplina_atual;
    var prova = resumo.proxima_prova;
    var prazo = resumo.proximo_prazo;
    add(proximaMensalidade());
    if (cache && cache.plano) {
      if (disc && disc.status === 'atual' && disc.data_fim) {
        add({ data: String(disc.data_fim).slice(0, 10), titulo: 'Fim de ' + disc.titulo, sub: 'Último dia do período de estudo.', tipo: 'disciplina' });
      }
      if (prova && prova.prova_inicio) {
        add({ data: String(prova.prova_inicio).slice(0, 10), titulo: 'Prova de ' + prova.titulo, sub: 'Aberta de ' + formatRange(prova.prova_inicio, prova.prova_fim) + '.', tipo: 'prova' });
      }
      if (prazo && prazo.data) {
        add({ data: String(prazo.data).slice(0, 10), titulo: prazo.titulo, sub: prazo.label || '' });
      }
      (cache.calendario || []).forEach(function (ev) {
        if (ev.tipo === 'financeiro') return;
        add({ data: String(ev.data_inicio || '').slice(0, 10), titulo: ev.titulo, sub: ev.subtitulo || '', tipo: ev.tipo });
      });
    }
    lista.sort(function (x, y) { return x.data.localeCompare(y.data); });
    return lista.slice(0, 3);
  }

  // Botão de cada data no Início: destino real de cada tipo. Pagamentos ficam na Área do Aluno (Financeiro).
  var AREA_DO_ALUNO = 'https://novoportal.cruzeirodosul.edu.br/';
  function acaoDaData(item) {
    var contexto = '<span class="sr-only">: ' + escapeHtml(item.titulo) + '</span>';
    if (item.tipo === 'financeiro') {
      return '<a class="p-date-btn" href="' + AREA_DO_ALUNO + '" target="_blank" rel="noopener noreferrer">Ver pagamentos' +
        '<span class="sr-only"> na Área do Aluno (abre em nova aba)</span><i data-lucide="external-link" aria-hidden="true"></i></a>';
    }
    var texto = item.tipo === 'prova' ? 'Consultar prova' : item.tipo === 'disciplina' ? 'Ver disciplina' : 'Ver no calendário';
    return '<a class="p-date-btn" href="/meu-semestre" data-go="meu-semestre-page">' + texto + contexto + '<i data-lucide="chevron-right" aria-hidden="true"></i></a>';
  }

  function dataItem(item, i) {
    var p = parseIso(item.data);
    return (
      '<li class="p-date-item' + (i === 0 ? ' is-hot' : '') + '">' +
        '<span class="p-date"><b>' + escapeHtml(p.d) + '</b><small>' + escapeHtml(monthShort(item.data)) + '</small></span>' +
        '<span class="p-date-t"><strong>' + escapeHtml(item.titulo) + ' <span class="p-pill' + (i === 0 ? ' p-pill--warn' : '') + '">' + escapeHtml(quandoTxt(item.data)) + '</span></strong>' +
          (item.sub ? '<span>' + escapeHtml(item.sub) + '</span>' : '') + '</span>' +
        acaoDaData(item) +
      '</li>'
    );
  }

  // Frase do semestre para o banner do Início (usada quando a trilha já foi concluída).
  function fraseDoSemestre() {
    var resumo = (cache && cache.resumo) || {};
    var disc = resumo.disciplina_atual;
    var prova = resumo.proxima_prova;
    if (!cache || !cache.plano || !disc) return '';
    var frase = disc.status === 'atual'
      ? 'Você está em ' + disc.titulo + '.'
      : 'Sua próxima matéria é ' + disc.titulo + '.';
    if (prova && prova.prova_inicio) {
      frase += (prova.titulo === disc.titulo ? ' A prova' : ' A prova de ' + prova.titulo) + ' abre em ' + formatDayMonth(prova.prova_inicio) + '.';
    }
    return frase;
  }

  function renderDashboard() {
    var wrap = document.getElementById('dashboard-semestre-body');
    if (window.Inicio) window.Inicio.setSemestre(fraseDoSemestre(), !!cache && !cache.plano);
    if (!wrap) return;
    var itens = datasDoPainel();
    wrap.innerHTML =
      (itens.length ? '<ul class="p-dates">' + itens.map(dataItem).join('') + '</ul>' : '<p class="p-muted">Nenhuma data nos próximos dias.</p>') +
      (cache && cache.plano
        ? ''
        : emPreparo()
          ? '<p class="p-note">' + MSG_PREPARO + (comTrilha() ? ' <button type="button" class="p-link" data-open-trilha="">Começar a Aula Inaugural</button>' : '') + '</p>'
          : '<p class="p-note">' + MSG_SEM_PLANO + ' <button type="button" class="p-link" onclick="showScreen(\'atendimento-page\')">Falar com o acadêmico</button></p>');
    if (window.lucide) window.lucide.createIcons();
  }

  // ---------- Tela Meu Semestre (/meu-semestre) ----------
  // Status é só do PERÍODO da disciplina (calculado no servidor): não é aprovação nem prova feita.
  function statusLabel(status) {
    if (status === 'atual') return 'Em andamento';
    if (status === 'encerrada') return 'Período encerrado';
    return 'Próxima';
  }

  var AVA_URL = 'https://ava.cruzeirodosul.edu.br/';
  var PORTAL_URL = 'https://novoportal.cruzeirodosul.edu.br/';
  var NOVA_ABA = '<span class="sr-only"> (abre em nova aba)</span>';

  // Data em texto + <time datetime>. Intervalo mostra início e fim ("06 a 09/11").
  function timeRange(start, end, longo) {
    var a = parseIso(start);
    if (!a) return '';
    var b = parseIso(end);
    var txt = b && b.iso !== a.iso ? formatRange(a.iso, b.iso) : (longo ? formatDate(a.iso) : formatDayMonth(a.iso));
    return '<time datetime="' + a.iso + '">' + escapeHtml(txt) + '</time>';
  }

  // Link de orientação: mesmo destino de antes (nível da trilha ou tutoriais), rótulo curto.
  function orientacaoLink(item, rotulo) {
    if (!item) return '';
    var ctx = '<span class="sr-only">: ' + escapeHtml(item.titulo) + '</span>';
    var dica = item.trilha ? ' title="Módulo ' + Number(item.trilha.nivel) + ' da Aula Inaugural: ' + escapeHtml(item.trilha.titulo) + '"' : '';
    if (item.trilha && document.body.classList.contains('trilha-on')) {
      return '<button type="button" class="sm-link" data-open-trilha="' + Number(item.trilha.nivel) + '"' + dica + '>' + rotulo + ctx + '<i data-lucide="chevron-right" aria-hidden="true"></i></button>';
    }
    if (!item.tutorial_categoria && !item.trilha) return '';
    return '<button type="button" class="sm-link" data-open-tutoriais="' + escapeHtml(item.tutorial_categoria || '') + '">' + rotulo + ctx + '<i data-lucide="chevron-right" aria-hidden="true"></i></button>';
  }

  function disciplinaAtualHtml(lista) {
    if (!lista.length) {
      var prox = (cache.disciplinas || []).filter(function (d) { return d.status === 'proxima'; })[0];
      return (
        '<article class="sm-card sm-now">' +
          '<span class="sm-ico" aria-hidden="true"><i data-lucide="book-open"></i></span>' +
          '<div class="sm-now-body"><p class="sm-eyebrow">Sua disciplina atual</p>' +
          '<h2>Nenhuma disciplina mensal em andamento agora.</h2>' +
          (prox ? '<p class="sm-muted">A próxima é ' + escapeHtml(prox.titulo) + (prox.data_inicio ? ', a partir de ' + timeRange(prox.data_inicio, null, true) : '') + '.</p>' : '') +
          '</div>' +
        '</article>'
      );
    }
    var corpo = lista.map(function (d) {
      var chips = [];
      if (d.data_fim) chips.push('<span class="sm-chip"><i data-lucide="clock-3" aria-hidden="true"></i>Estudos até <strong>' + timeRange(d.data_fim) + '</strong></span>');
      if (d.prova_inicio) chips.push('<span class="sm-chip"><i data-lucide="calendar-days" aria-hidden="true"></i>Prova: <strong>' + timeRange(d.prova_inicio, d.prova_fim) + '</strong></span>');
      return '<div class="sm-now-item"><h2>' + escapeHtml(d.titulo) + '</h2>' + (chips.length ? '<div class="sm-chips">' + chips.join('') + '</div>' : '') + '</div>';
    }).join('');
    return (
      '<article class="sm-card sm-now">' +
        '<span class="sm-ico" aria-hidden="true"><i data-lucide="book-open"></i></span>' +
        '<div class="sm-now-body">' +
          '<p class="sm-eyebrow">' + (lista.length > 1 ? 'Suas disciplinas atuais (' + lista.length + ')' : 'Sua disciplina atual') + '</p>' + corpo +
        '</div>' +
        '<div class="sm-now-acts">' +
          // Não existe link direto para cada disciplina: o botão leva ao AVA (onde ficam todas).
          '<a class="portal-btn" href="' + AVA_URL + '" target="_blank" rel="noopener noreferrer">Acessar o AVA' + NOVA_ABA + '<i data-lucide="external-link" aria-hidden="true"></i></a>' +
          orientacaoLink(lista[0], lista[0].tutorial_hint || 'Ver orientações') +
        '</div>' +
      '</article>'
    );
  }

  function mensalidadeCardHtml() {
    return (
      '<article class="sm-card sm-pay">' +
        '<span class="sm-ico sm-ico--star" aria-hidden="true"><i data-lucide="receipt-text"></i></span>' +
        '<div class="sm-pay-body">' +
          '<p class="sm-eyebrow">Mensalidades</p>' +
          '<h2>Vencimento todo dia 25</h2>' +
          '<p class="sm-muted">Consulte seus boletos, valores e datas no portal.</p>' +
          '<div class="sm-pay-acts">' +
            '<a class="portal-btn" href="' + PORTAL_URL + '" target="_blank" rel="noopener noreferrer">Ver pagamentos<span class="sr-only"> na Área do Aluno, menu Financeiro (abre em nova aba)</span><i data-lucide="external-link" aria-hidden="true"></i></a>' +
            '<a class="sm-link" href="#sm-financeiro" data-sm-financeiro>Entender os descontos<i data-lucide="chevron-down" aria-hidden="true"></i></a>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function disciplinaCard(d) {
    var mes = d.mes || monthShort(d.data_inicio);
    var periodo = d.data_inicio ? timeRange(d.data_inicio, d.data_fim) : '';
    var prova = d.prova_inicio ? timeRange(d.prova_inicio, d.prova_fim) : '';
    return (
      '<li class="sm-disc' + (d.status === 'atual' ? ' is-current' : '') + '"' + (d.status === 'atual' ? ' aria-current="true"' : '') + '>' +
        (mes ? '<span class="sm-month" aria-hidden="true">' + escapeHtml(mes) + '</span>' : '') +
        '<div class="sm-disc-body">' +
          (d.status ? '<span class="sm-tag sm-tag--' + escapeHtml(d.status) + '">' + escapeHtml(statusLabel(d.status)) + '</span>' : '') +
          '<h3>' + escapeHtml(d.titulo) + '</h3>' +
          '<dl class="sm-dl">' +
            (periodo ? '<div><dt>Período</dt><dd>' + periodo + '</dd></div>' : '') +
            (prova ? '<div><dt>Prova</dt><dd>' + prova + '</dd></div>' : '') +
          '</dl>' +
        '</div>' +
      '</li>'
    );
  }

  function atividadeIcon(titulo) {
    var t = String(titulo || '').toLowerCase();
    if (t.indexOf('carreira') !== -1) return 'briefcase';
    if (t.indexOf('projeto') !== -1) return 'users';
    if (t.indexOf('extens') !== -1) return 'file-text';
    if (t.indexOf('ambienta') !== -1) return 'laptop';
    return 'sparkles';
  }

  // Prazos com o rótulo da fonte: "Prazo preferencial" e "Disponível até" (não vira "prazo final").
  function atividadeRow(item, integrada) {
    var prazos = [];
    if (item.prazo_preferencial) prazos.push('<span>Prazo preferencial: <strong>' + timeRange(item.prazo_preferencial, null, true) + '</strong></span>');
    if (item.prazo) prazos.push('<span>' + (integrada ? 'Prazo até' : 'Disponível até') + ': <strong>' + timeRange(item.prazo, null, true) + '</strong></span>');
    return (
      '<li class="sm-act' + (integrada ? ' sm-act--integrada' : '') + '">' +
        '<span class="sm-ico" aria-hidden="true"><i data-lucide="' + (integrada ? 'bar-chart-3' : atividadeIcon(item.titulo)) + '"></i></span>' +
        '<div class="sm-act-body">' +
          (integrada ? '<span class="sm-tag sm-tag--integrada">Avaliação integrada</span>' : '') +
          '<h3>' + escapeHtml(item.titulo) + '</h3>' +
          (prazos.length ? '<p class="sm-prazos">' + prazos.join('<span class="sm-sep" aria-hidden="true">·</span>') + '</p>' : '') +
        '</div>' +
        orientacaoLink(item, 'Ver orientações') +
      '</li>'
    );
  }

  var ICONE_EVENTO = { prova: 'clipboard-check', prazo: 'flag', financeiro: 'wallet', disciplina: 'book-open', recuperacao: 'rotate-ccw', encerramento: 'calendar-check', divulgacao: 'megaphone' };
  var ROTULO_EVENTO = { prova: 'Prova', prazo: 'Prazo', financeiro: 'Mensalidade' };

  function eventoItem(ev, destaque) {
    var p = parseIso(ev.data_inicio);
    if (!p) return '';
    var rotulo = ROTULO_EVENTO[ev.tipo];
    return (
      '<li class="sm-ev' + (destaque ? ' is-next' : '') + '">' +
        '<span class="sm-ev-date" aria-hidden="true"><b>' + escapeHtml(p.d) + '</b><small>' + escapeHtml(monthShort(p.iso)) + '</small></span>' +
        '<div class="sm-ev-body">' +
          '<p class="sm-ev-t"><i data-lucide="' + (ICONE_EVENTO[ev.tipo] || 'calendar') + '" aria-hidden="true"></i>' +
            (rotulo ? '<span class="sm-ev-kind">' + rotulo + '</span>' : '') +
            '<strong>' + escapeHtml(ev.titulo) + '</strong>' +
            (destaque ? '<span class="sm-ev-next">Próxima</span>' : '') + '</p>' +
          '<p class="sm-ev-sub">' + timeRange(ev.data_inicio, ev.data_fim, !ev.data_fim || ev.data_fim === ev.data_inicio) +
            (ev.subtitulo ? ' · ' + escapeHtml(ev.subtitulo) : '') + '</p>' +
        '</div>' +
      '</li>'
    );
  }

  // Mesma fonte do Início: calendário do servidor + o próximo vencimento (proximaMensalidade).
  function eventosDoSemestre() {
    var hoje = hojeIso();
    var todos = (cache.calendario || []).map(function (ev) {
      return { titulo: ev.titulo, subtitulo: ev.subtitulo, data_inicio: String(ev.data_inicio || '').slice(0, 10), data_fim: String(ev.data_fim || ev.data_inicio || '').slice(0, 10), tipo: ev.tipo };
    }).filter(function (ev) { return ev.data_inicio; });
    var m = proximaMensalidade();
    todos.push({ titulo: m.titulo, subtitulo: 'Vencimento (ou o próximo dia útil)', data_inicio: m.data, data_fim: m.data, tipo: 'financeiro' });
    todos.sort(function (a, b) { return a.data_inicio.localeCompare(b.data_inicio); });
    // Evento em andamento (06 a 09/11 com hoje = 07/11) ainda é "próximo": conta a data final.
    var futuros = todos.filter(function (ev) { return (ev.data_fim || ev.data_inicio) >= hoje; });
    var passados = todos.filter(function (ev) { return (ev.data_fim || ev.data_inicio) < hoje; }).reverse();
    return { futuros: futuros, passados: passados };
  }

  function calendarioHtml() {
    var ev = eventosDoSemestre();
    var VISIVEIS = 4;
    var primeiros = ev.futuros.slice(0, VISIVEIS);
    var resto = ev.futuros.slice(VISIVEIS);
    var temMais = resto.length || ev.passados.length;
    return (
      '<section class="sm-card sm-cal" aria-labelledby="sm-h-datas">' +
        '<div class="sm-head"><h2 id="sm-h-datas">Próximas datas</h2>' +
          (temMais ? '<button type="button" class="sm-link" data-sm-toggle aria-expanded="false" aria-controls="sm-cal-mais">Ver calendário completo<i data-lucide="chevron-down" aria-hidden="true"></i></button>' : '') +
        '</div>' +
        (primeiros.length
          ? '<ol class="sm-evs">' + primeiros.map(function (e, i) { return eventoItem(e, i === 0); }).join('') + '</ol>'
          : '<p class="sm-muted">Nenhuma data futura cadastrada.</p>') +
        (temMais
          ? '<div id="sm-cal-mais" hidden>' +
              (resto.length ? '<h3 class="sm-h3">Mais adiante</h3><ol class="sm-evs">' + resto.map(function (e) { return eventoItem(e, false); }).join('') + '</ol>' : '') +
              (ev.passados.length ? '<h3 class="sm-h3">Datas anteriores</h3><ol class="sm-evs sm-evs--past">' + ev.passados.map(function (e) { return eventoItem(e, false); }).join('') + '</ol>' : '') +
            '</div>'
          : '') +
      '</section>'
    );
  }

  function apoioHtml() {
    var comTrilha = document.body.classList.contains('trilha-on');
    return (
      '<aside class="sm-help" aria-labelledby="sm-h-help">' +
        '<p class="sm-eyebrow">Precisa de orientação?</p>' +
        '<h2 id="sm-h-help">A gente te ajuda!</h2>' +
        '<p>Aprenda a acessar o AVA, fazer provas e acompanhar suas notas.</p>' +
        '<div class="sm-help-acts">' +
          '<a class="portal-btn portal-btn--primary" href="/tutoriais" data-go="tutoriais-page">Consultar tutoriais<i data-lucide="chevron-right" aria-hidden="true"></i></a>' +
          '<button type="button" class="sm-help-link" data-help-open>Preciso de ajuda</button>' +
          (comTrilha ? '<button type="button" class="sm-help-link" data-open-trilha="">Ver a Aula Inaugural</button>' : '') +
        '</div>' +
        '<span class="sm-help-art" aria-hidden="true"><i data-lucide="message-circle-question"></i></span>' +
      '</aside>'
    );
  }

  // Regra única da mensalidade em lista (a frase curta do Início usa a mesma regra).
  // Removidos daqui por não terem fonte validada: "pode haver juros pequenos" e "em dezembro o 25 costuma ir para o 28".
  function financeiroHtml() {
    return (
      '<section class="sm-card sm-fin" id="sm-financeiro" aria-labelledby="sm-h-fin">' +
        '<h2 id="sm-h-fin" class="sm-fin-h"><button type="button" class="sm-fin-btn" data-sm-toggle aria-expanded="false" aria-controls="sm-fin-body">' +
          '<span class="sm-ico sm-ico--star" aria-hidden="true"><i data-lucide="badge-percent"></i></span>' +
          '<span><span class="sm-eyebrow">Mensalidades</span>Como funcionam o vencimento e os descontos</span>' +
          '<i data-lucide="chevron-down" class="sm-fin-chev" aria-hidden="true"></i></button></h2>' +
        '<div id="sm-fin-body" class="sm-fin-body" hidden>' +
          '<p>A mensalidade vence <strong>todo dia 25</strong>.</p>' +
          '<ul>' +
            '<li><strong>1ª mensalidade</strong> (a do mês da sua turma): todos os descontos valem até o <strong>dia 25</strong>, o próprio vencimento.</li>' +
            '<li><strong>Da 2ª em diante:</strong> até o <strong>dia 10</strong>, 25% de desconto de pontualidade; do dia 11 ao 25, 15%; depois do dia 25, sem esse desconto. A bolsa e os outros descontos continuam.</li>' +
            '<li>Se o dia 10 ou o 25 cair em sábado, domingo ou feriado, vale o <strong>próximo dia útil</strong>. O boleto mostra a data certa de cada mês.</li>' +
          '</ul>' +
          '<p class="sm-muted">Boletos, valores e pagamentos ficam na Área do Aluno, menu Financeiro. ' +
            '<a href="' + PORTAL_URL + '" target="_blank" rel="noopener noreferrer">Abrir a Área do Aluno' + NOVA_ABA + '</a></p>' +
        '</div>' +
      '</section>'
    );
  }

  function renderPage() {
    var root = document.getElementById('meu-semestre-content');
    if (!root) return;

    if (!cache) {
      root.innerHTML = '<p class="aviso-empty">Carregando o semestre...</p>';
      return;
    }

    if (!cache.plano) {
      // Sem matérias: com a Aula Inaugural liberada, ela vira a ação principal enquanto os dados não chegam.
      var preparo = emPreparo();
      root.innerHTML =
        '<div class="ms-empty">' +
          '<span class="ms-soon-pill">' + (preparo ? 'Acesso em preparação' : 'Cadastro em atualização') + '</span>' +
          '<h2>Meu Semestre</h2>' +
          '<p>' + (preparo ? MSG_PREPARO : MSG_SEM_PLANO) + '</p>' +
          '<div class="ms-empty-acts">' +
            (comTrilha() ? '<button type="button" class="portal-btn portal-btn--primary ms-empty-btn" data-open-trilha="">Começar a Aula Inaugural<i data-lucide="chevron-right" aria-hidden="true"></i></button>' : '') +
            '<button type="button" class="ms-secondary-btn ms-empty-btn" onclick="showScreen(\'atendimento-page\')">Falar com o acadêmico</button>' +
          '</div>' +
        '</div>';
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    var disciplinas = cache.disciplinas || [];
    var atuais = disciplinas.filter(function (d) { return d.status === 'atual'; });
    var resumoAtual = cache.resumo && cache.resumo.disciplina_atual;
    if (!atuais.length && resumoAtual && resumoAtual.status === 'atual') atuais = [resumoAtual];
    var atividades = cache.atividades || [];
    var avaliacao = cache.avaliacao_integrada;

    root.innerHTML =
      '<section class="portal-hero sm-hero" aria-labelledby="sm-h1">' +
        '<div class="portal-hero__content">' +
          '<p class="portal-eyebrow">Meu semestre</p>' +
          '<h1 id="sm-h1">Meu semestre</h1>' +
          '<p class="portal-hero__lede">Suas disciplinas, atividades e próximas datas.</p>' +
          '<p class="sm-hero-meta">' + escapeHtml(cache.plano.curso) + ' · ' + escapeHtml(cache.plano.periodo) + '</p>' +
        '</div>' +
        '<span class="sm-hero-art" aria-hidden="true"><i data-lucide="book-open"></i><i data-lucide="calendar-days"></i></span>' +
      '</section>' +

      '<div data-apps-slot></div>' +

      '<div class="sm-note" role="note">' +
        '<i data-lucide="info" aria-hidden="true"></i>' +
        '<p>Esta é uma prévia. Confira todas as informações no portal oficial ou no app Duda.</p>' +
        '<div class="sm-note-acts">' +
          '<a class="sm-link" href="' + PORTAL_URL + '" target="_blank" rel="noopener noreferrer">Acessar portal oficial' + NOVA_ABA + '<i data-lucide="external-link" aria-hidden="true"></i></a>' +
        '</div>' +
      '</div>' +

      '<div class="sm-main">' + disciplinaAtualHtml(atuais) + mensalidadeCardHtml() + '</div>' +

      '<section aria-labelledby="sm-h-disc">' +
        '<div class="sm-head"><div><h2 id="sm-h-disc">Disciplinas do semestre</h2><span class="p-squiggle" aria-hidden="true"></span></div></div>' +
        (disciplinas.length
          ? '<ol class="sm-discs">' + disciplinas.map(disciplinaCard).join('') + '</ol>'
          : '<p class="sm-muted">Nenhuma disciplina mensal cadastrada.</p>') +
      '</section>' +

      '<section aria-labelledby="sm-h-ativ">' +
        '<div class="sm-head"><div><h2 id="sm-h-ativ">Atividades do semestre</h2><span class="p-squiggle" aria-hidden="true"></span></div></div>' +
        ((atividades.length || avaliacao)
          ? '<ul class="sm-acts">' + atividades.map(function (a) { return atividadeRow(a, false); }).join('') +
              (avaliacao ? atividadeRow(avaliacao, true) : '') + '</ul>'
          : '<p class="sm-muted">Nenhuma atividade obrigatória cadastrada.</p>') +
      '</section>' +

      '<div class="sm-bottom">' + calendarioHtml() + apoioHtml() + '</div>' +

      financeiroHtml();

    if (window.Apps) window.Apps.render(root);
    if (window.lucide) window.lucide.createIcons();
  }

  var retryTimer = null;

  function showOffline() {
    var dash = document.getElementById('dashboard-semestre-body');
    if (dash) dash.innerHTML = offlineHtml();
    var page = document.getElementById('meu-semestre-content');
    if (page) {
      page.innerHTML =
        '<div class="ms-empty">' +
          '<span class="ms-soon-pill ms-soon-pill--off">Fora do ar</span>' +
          '<h2>Meu Semestre</h2>' +
          '<p>Opção fora do ar. Tente novamente em instantes.</p>' +
        '</div>';
    }
    if (window.lucide) window.lucide.createIcons();
  }

  async function refresh() {
    if (!window.Auth.isAuthenticated()) {
      cache = null;
      return;
    }
    try {
      cache = await window.Api.getMeuSemestre();
    } catch (err) {
      if (!retryTimer) {
        retryTimer = setTimeout(function () {
          retryTimer = null;
          refresh();
        }, 2000);
      }
      if (cache && cache.plano) {
        renderDashboard();
        renderPage();
        return;
      }
      showOffline();
      return;
    }
    renderDashboard();
    renderPage();
  }

  // Botão com aria-expanded que mostra/esconde a região de aria-controls.
  function alternar(btn) {
    var abrir = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(abrir));
    var alvo = document.getElementById(btn.getAttribute('aria-controls'));
    if (alvo) alvo.hidden = !abrir;
  }

  function init() {
    var page = document.getElementById('meu-semestre-page');
    if (!page) return;
    page.addEventListener('click', function (event) {
      if (page.classList.contains('hidden')) return;
      var tog = event.target.closest('[data-sm-toggle]');
      if (tog) { alternar(tog); return; }
      var fin = event.target.closest('[data-sm-financeiro]');
      if (fin) {
        event.preventDefault();
        var b = document.querySelector('#sm-financeiro [data-sm-toggle]');
        if (b && b.getAttribute('aria-expanded') !== 'true') alternar(b);
        var sec = document.getElementById('sm-financeiro');
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (b) b.focus({ preventScroll: true });
        return;
      }
      var btn = event.target.closest('[data-open-tutoriais]');
      if (!btn) return;
      event.preventDefault();
      window.showScreen('tutoriais-page');
    });
  }

  return {
    init: init,
    refresh: refresh,
  };
})();
