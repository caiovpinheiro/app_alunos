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

  function soonHtml(compact) {
    return (
      '<div class="ms-soon">' +
        '<span class="ms-soon-pill">Em breve</span>' +
        '<p>Em breve você poderá organizar seu semestre por aqui.</p>' +
        (compact
          ? '<button type="button" onclick="showScreen(\'meu-semestre-page\')" class="btn-plastic dash-card-btn w-full flex items-center justify-center gap-2 bg-gray-50 text-cruzeiro font-semibold py-2.5 rounded-lg">' +
              '<span class="btn-plastic-label">Ver Meu Semestre</span>' +
              '<i data-lucide="chevron-right" class="w-4 h-4"></i>' +
            '</button>'
          : '') +
      '</div>'
    );
  }

  function offlineHtml() {
    return (
      '<div class="ms-soon">' +
        '<span class="ms-soon-pill ms-soon-pill--off">Fora do ar</span>' +
        '<p>Opção fora do ar. Tente novamente em instantes.</p>' +
      '</div>'
    );
  }

  function dashFact(label, value) {
    if (!value) return '';
    return (
      '<div class="ms-dash-fact">' +
        '<dt>' + escapeHtml(label) + '</dt>' +
        '<dd>' + escapeHtml(value) + '</dd>' +
      '</div>'
    );
  }

  function renderDashboard() {
    var wrap = document.getElementById('dashboard-semestre-body');
    if (!wrap) return;
    if (!cache || !cache.plano) {
      wrap.innerHTML = soonHtml(true);
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    var resumo = cache.resumo || {};
    var disc = resumo.disciplina_atual;
    var prova = resumo.proxima_prova;
    var prazo = resumo.proximo_prazo;
    var periodo = disc ? formatRange(disc.data_inicio, disc.data_fim) : '';
    var provaTxt = prova ? formatRange(prova.prova_inicio, prova.prova_fim) : '';
    var prazoTxt = prazo ? (prazo.titulo + ' · ' + formatDayMonth(prazo.data)) : '';
    var payTxt = '1ª parcela dia 25 · demais até o dia 10';

    wrap.innerHTML =
      '<dl class="ms-dash-facts">' +
        dashFact('Disciplina atual', disc && disc.titulo) +
        dashFact('Período de estudo', periodo) +
        dashFact('Próxima prova', provaTxt) +
        dashFact('Próximo prazo importante', prazoTxt) +
        dashFact('Mensalidades', payTxt) +
      '</dl>' +
      '<p class="ms-dash-note">' + escapeHtml(cache.aviso_pagamento || '') + '</p>' +
      '<button type="button" onclick="showScreen(\'meu-semestre-page\')" class="btn-plastic dash-card-btn w-full flex items-center justify-center gap-2 bg-gray-50 text-cruzeiro font-semibold py-2.5 rounded-lg">' +
        '<span class="btn-plastic-label">Ver Meu Semestre</span>' +
        '<i data-lucide="chevron-right" class="w-4 h-4"></i>' +
      '</button>';
    if (window.lucide) window.lucide.createIcons();
  }

  function statusLabel(status) {
    if (status === 'atual') return 'Em andamento';
    if (status === 'encerrada') return 'Encerrada';
    return 'Próxima';
  }

  function subjectCard(item) {
    var current = item.status === 'atual' ? ' is-current' : '';
    var mes = item.mes || monthShort(item.data_inicio);
    var period = formatRange(item.data_inicio, item.data_fim);
    var exam = formatRange(item.prova_inicio, item.prova_fim);
    var classes = 'ms-subject' + current + (mes ? '' : ' ms-subject--no-month') + (exam ? '' : ' ms-subject--no-exam');
    return (
      '<article class="' + classes + '">' +
        (mes ? '<div class="ms-month">' + escapeHtml(mes) + '</div>' : '') +
        '<div class="ms-subject-copy">' +
          (item.status ? '<span class="ms-tag">' + escapeHtml(statusLabel(item.status)) + '</span>' : '') +
          '<h3>' + escapeHtml(item.titulo) + '</h3>' +
          (period ? '<span>Período: ' + escapeHtml(period) + '</span>' : '') +
        '</div>' +
        (exam
          ? '<div class="ms-exam"><small>Prova</small><strong>' + escapeHtml(exam) + '</strong></div>'
          : '') +
      '</article>'
    );
  }

  function atividadeIcon(titulo) {
    var t = String(titulo || '').toLowerCase();
    if (t.indexOf('carreira') !== -1) return 'graduation-cap';
    if (t.indexOf('projeto') !== -1) return 'file-text';
    if (t.indexOf('extens') !== -1) return 'book-open';
    return 'sparkles';
  }

  function atividadeCard(item) {
    var prazoPref = item.prazo_preferencial
      ? 'Finalize preferencialmente até ' + formatDate(item.prazo_preferencial)
      : '';
    var prazoFinal = item.prazo ? 'Disponível até ' + formatDate(item.prazo) : '';
    var prazo = prazoPref || prazoFinal;
    var extra = prazoPref && prazoFinal ? prazoFinal : '';
    var link = item.tutorial_categoria
      ? '<button type="button" class="ms-text-link" data-open-tutoriais="' + escapeHtml(item.tutorial_categoria) + '">' +
          escapeHtml(item.tutorial_hint || 'Ver tutoriais') +
          ' <i data-lucide="chevron-right" class="w-4 h-4"></i></button>'
      : '';
    return (
      '<article class="ms-obligation">' +
        '<span class="ms-obligation-icon"><i data-lucide="' + atividadeIcon(item.titulo) + '" class="w-5 h-5"></i></span>' +
        '<div>' +
          '<h3>' + escapeHtml(item.titulo) + '</h3>' +
          (prazo ? '<p>' + escapeHtml(prazo) + '</p>' : '') +
          (extra ? '<p class="ms-muted">' + escapeHtml(extra) + '</p>' : '') +
          link +
        '</div>' +
      '</article>'
    );
  }

  function eventDot(tipo) {
    if (tipo === 'financeiro') return 'amber';
    if (tipo === 'prova') return 'navy';
    if (tipo === 'encerramento' || tipo === 'divulgacao' || tipo === 'recuperacao') return 'navy';
    return 'blue';
  }

  function calendarItem(item) {
    var start = parseIso(item.data_inicio);
    if (!start) return '';
    var when = item.data_fim && item.data_fim !== item.data_inicio
      ? formatRange(item.data_inicio, item.data_fim)
      : formatDate(item.data_inicio);
    return (
      '<div class="ms-event">' +
        '<div><strong>' + escapeHtml(start.d) + '</strong><span>' + escapeHtml(monthShort(item.data_inicio)) + '</span></div>' +
        '<p><b>' + escapeHtml(item.titulo) + '</b><small>' + escapeHtml(item.subtitulo || when) + '</small></p>' +
        '<span class="ms-dot ms-dot-' + eventDot(item.tipo) + '"></span>' +
      '</div>'
    );
  }

  function tutorialLinks(list) {
    var cats = {};
    (list || []).forEach(function (item) {
      if (!item.categoria || cats[item.categoria]) return;
      cats[item.categoria] = item;
    });
    var keys = Object.keys(cats);
    if (!keys.length) {
      return '<button type="button" class="ms-secondary-btn" onclick="showScreen(\'tutoriais-page\')">Ver todos os tutoriais</button>';
    }
    return keys.map(function (cat) {
      return (
        '<button type="button" class="ms-guide-link" data-open-tutoriais="' + escapeHtml(cat) + '">' +
          '<span>' + escapeHtml(cat) + '</span>' +
          '<small>' + escapeHtml(cats[cat].hint || 'Abrir tutoriais') + '</small>' +
        '</button>'
      );
    }).join('') +
      '<button type="button" class="ms-secondary-btn" onclick="showScreen(\'tutoriais-page\')">Ver todos os tutoriais</button>';
  }

  function renderPage() {
    var root = document.getElementById('meu-semestre-content');
    if (!root) return;

    if (!cache) {
      root.innerHTML = '<p class="aviso-empty">Carregando o semestre...</p>';
      return;
    }

    if (!cache.plano) {
      root.innerHTML =
        '<div class="ms-empty">' +
          '<span class="ms-soon-pill">Em breve</span>' +
          '<h2>Meu Semestre</h2>' +
          '<p>Em breve você poderá organizar seu semestre por aqui.</p>' +
        '</div>';
      return;
    }

    var resumo = cache.resumo || {};
    var disc = resumo.disciplina_atual;
    var nome = (cache.aluno && cache.aluno.nome) || window.Auth.getUserName();
    var avaliacao = cache.avaliacao_integrada;
    var disciplinas = cache.disciplinas || [];
    var atividades = cache.atividades || [];
    var calendario = cache.calendario || [];

    var heroDates = [];
    if (disc && disc.data_fim) {
      heroDates.push('<span><i data-lucide="clock-3" class="w-4 h-4"></i> Estude até <strong>' + escapeHtml(formatDate(disc.data_fim)) + '</strong></span>');
    }
    if (disc && (disc.prova_inicio || disc.prova_fim)) {
      heroDates.push('<span><i data-lucide="calendar-days" class="w-4 h-4"></i> Prova: <strong>' + escapeHtml(formatRange(disc.prova_inicio, disc.prova_fim)) + '</strong></span>');
    }
    var heroDisc = disc
      ? (
        '<article class="ms-now">' +
          '<div class="ms-card-heading">' +
            '<span class="ms-icon-box"><i data-lucide="book-open" class="w-5 h-5"></i></span>' +
            '<div><small>Disciplina atual</small><h2>' + escapeHtml(disc.titulo) + '</h2></div>' +
          '</div>' +
          (heroDates.length ? '<div class="ms-date-row">' + heroDates.join('') + '</div>' : '') +
        '</article>'
      )
      : '<article class="ms-now"><p class="ms-muted">Nenhuma disciplina mensal em andamento.</p></article>';

    var heroPay =
        '<article class="ms-pay">' +
          '<div class="ms-pay-top">' +
            '<span class="ms-icon-box ms-icon-amber"><i data-lucide="receipt-text" class="w-5 h-5"></i></span>' +
          '</div>' +
          '<small>Mensalidades</small>' +
          '<h2>Vencimentos fixos</h2>' +
          '<p>A 1ª parcela vence no <strong>dia 25</strong>. As demais devem ser pagas até o <strong>dia 10</strong> de cada mês.</p>' +
        '</article>';

    var avaliacaoHtml = avaliacao
      ? (
        '<article class="ms-integrated">' +
          '<small>Avaliação integrada</small>' +
          '<h3>' + escapeHtml(avaliacao.titulo) + '</h3>' +
          (avaliacao.prazo ? '<p>Prazo até <strong>' + escapeHtml(formatDate(avaliacao.prazo)) + '</strong></p>' : '') +
          (avaliacao.tutorial_categoria
            ? '<button type="button" class="ms-text-link" data-open-tutoriais="' + escapeHtml(avaliacao.tutorial_categoria) + '">' +
                escapeHtml(avaliacao.tutorial_hint || 'Ver tutoriais') +
                ' <i data-lucide="chevron-right" class="w-4 h-4"></i></button>'
            : '') +
        '</article>'
      )
      : '';

    var financeNote =
      '<article class="ms-finance">' +
        '<p>A <strong>1ª parcela</strong> vence no <strong>dia 25</strong>.</p>' +
        '<p>As demais mensalidades devem ser pagas até o <strong>dia 10</strong> de cada mês.</p>' +
      '</article>';

    root.innerHTML =
      '<header class="ms-page-head">' +
        '<p class="ms-eyebrow">Meu Semestre</p>' +
        '<h2>Olá, ' + escapeHtml(nome) + '</h2>' +
        '<p class="ms-muted">' + escapeHtml(cache.plano.curso) + ' · ' + escapeHtml(cache.plano.periodo) + '</p>' +
        '<p class="ms-preview-note">' +
          '<span class="ms-preview-note-text">Esta lista é uma prévia. Nem sempre todas as matérias aparecem aqui. Confira o que está disponível no <a href="https://novoportal.cruzeirodosul.edu.br/" target="_blank" rel="noopener">portal</a> ou no app Duda</span>' +
          '<span class="ms-store-badges">' +
            '<a class="ms-store-badge" href="https://apps.apple.com/br/app/duda/id6451416655" target="_blank" rel="noopener">' +
              '<img src="/assets/stores/app-store.svg" alt="Baixar na App Store" width="120" height="40">' +
            '</a>' +
            '<a class="ms-store-badge ms-store-badge--play" href="https://play.google.com/store/apps/details?id=br.com.cruzeirodosulvirtual" target="_blank" rel="noopener">' +
              '<img src="/assets/stores/google-play.png" alt="Disponível no Google Play" width="135" height="40">' +
            '</a>' +
          '</span>' +
        '</p>' +
      '</header>' +
      '<section class="ms-hero" aria-label="Resumo do semestre">' + heroDisc + heroPay + '</section>' +
      '<section class="ms-section">' +
        '<div class="ms-section-title"><div><p class="ms-eyebrow">Jornada acadêmica</p><h3>Disciplinas mensais</h3></div></div>' +
        '<div class="ms-timeline">' +
          (disciplinas.length ? disciplinas.map(subjectCard).join('') : '<p class="ms-muted">Nenhuma disciplina mensal cadastrada.</p>') +
        '</div>' +
      '</section>' +
      '<section class="ms-section">' +
        '<div class="ms-section-title"><div><p class="ms-eyebrow">Não deixe para o final</p><h3>Atividades obrigatórias do semestre</h3></div></div>' +
        '<div class="ms-obligations">' +
          (atividades.length ? atividades.map(atividadeCard).join('') : '<p class="ms-muted">Nenhuma atividade obrigatória cadastrada.</p>') +
        '</div>' +
      '</section>' +
      (avaliacaoHtml ? '<section class="ms-section">' + avaliacaoHtml + '</section>' : '') +
      '<section class="ms-bottom">' +
        '<article class="ms-calendar">' +
          '<div class="ms-section-title ms-compact"><div><p class="ms-eyebrow">Próximas datas</p><h3>Calendário</h3></div><i data-lucide="calendar-days" class="w-6 h-6"></i></div>' +
          (calendario.length ? calendario.map(calendarItem).join('') : '<p class="ms-muted">Sem datas cadastradas.</p>') +
        '</article>' +
        '<article class="ms-guides">' +
          '<p class="ms-eyebrow">Guias e tutoriais</p>' +
          '<h3>Não sabe como começar?</h3>' +
          '<p>Veja os tutoriais já disponíveis no portal sobre provas, atividades e financeiro.</p>' +
          '<div class="ms-guide-list">' + tutorialLinks(cache.tutoriais) + '</div>' +
        '</article>' +
      '</section>' +
      '<section class="ms-section">' +
        '<div class="ms-section-title"><div><p class="ms-eyebrow">Financeiro</p><h3>Mensalidades</h3></div></div>' +
        financeNote +
      '</section>';

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
      cache = null;
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
      return;
    }
    renderDashboard();
    renderPage();
  }

  function init() {
    var page = document.getElementById('meu-semestre-page');
    if (!page) return;
    page.addEventListener('click', function (event) {
      if (page.classList.contains('hidden')) return;
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
