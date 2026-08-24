/* Avisos e notificações do aluno (sino, dashboard e página completa). */
window.Avisos = (function () {
  'use strict';

  var cache = [];

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function prioridadeLabel(value) {
    if (value === 'alta') return 'Alta';
    if (value === 'media') return 'Média';
    return 'Baixa';
  }

  function formatDate(value) {
    if (!value) return '';
    var raw = String(value).slice(0, 10);
    var parts = raw.split('-');
    if (parts.length !== 3) return raw;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  function cardHtml(aviso, compact) {
    var unread = aviso.lida ? '' : ' is-unread';
    var body = compact
      ? '<p class="aviso-desc">' + escapeHtml(aviso.descricao) + '</p>'
      : '<p class="aviso-desc">' + escapeHtml(aviso.descricao) + '</p>';
    return (
      '<article class="aviso-card' + unread + '" data-aviso-id="' + aviso.id + '">' +
        '<div class="aviso-meta">' +
          '<span class="aviso-cat">' + escapeHtml(aviso.categoria) + '</span>' +
          '<span class="aviso-prio aviso-prio-' + escapeHtml(aviso.prioridade) + '">' + prioridadeLabel(aviso.prioridade) + '</span>' +
          (aviso.lida ? '' : '<span class="aviso-dot">Não lida</span>') +
        '</div>' +
        '<h3 class="aviso-title">' + escapeHtml(aviso.titulo) + '</h3>' +
        body +
        '<p class="aviso-dates">Válido até ' + escapeHtml(formatDate(aviso.data_fim)) +
          (aviso.recorrente ? ' · todo dia ' + aviso.dia_recorrente : '') +
        '</p>' +
        (aviso.lida ? '' : '<button type="button" class="aviso-read-btn" data-mark-read="' + aviso.id + '">Marcar como lida</button>') +
      '</article>'
    );
  }

  function updateBadge(count) {
    document.querySelectorAll('[data-notif-badge]').forEach(function (el) {
      if (count > 0) {
        el.textContent = count > 9 ? '9+' : String(count);
        el.classList.remove('hidden');
      } else {
        el.textContent = '0';
        el.classList.add('hidden');
      }
    });
  }

  function renderDashboard() {
    var wrap = document.getElementById('dashboard-avisos-list');
    if (!wrap) return;
    var top = cache.slice(0, 3);
    if (!top.length) {
      wrap.innerHTML = '<p class="aviso-empty">Nenhum aviso no momento.</p>';
      return;
    }
    wrap.innerHTML = top.map(function (item) { return cardHtml(item, true); }).join('');
  }

  function renderPage() {
    var wrap = document.getElementById('avisos-page-list');
    if (!wrap) return;
    if (!cache.length) {
      wrap.innerHTML = '<p class="aviso-empty">Nenhum aviso disponível agora.</p>';
      return;
    }
    wrap.innerHTML = cache.map(function (item) { return cardHtml(item, false); }).join('');
  }

  function renderDropdown() {
    var html;
    var items = cache.slice(0, 5);
    if (!items.length) {
      html = '<p class="aviso-empty">Sem avisos novos.</p>';
    } else {
      html = items.map(function (aviso) {
        return (
          '<button type="button" class="notif-item' + (aviso.lida ? '' : ' is-unread') + '" data-aviso-id="' + aviso.id + '">' +
            '<strong>' + escapeHtml(aviso.titulo) + '</strong>' +
            '<span>' + escapeHtml(aviso.categoria) + '</span>' +
          '</button>'
        );
      }).join('');
    }
    document.querySelectorAll('.notif-dropdown-list').forEach(function (wrap) {
      wrap.innerHTML = html;
    });
  }

  function closeDropdown() {
    document.querySelectorAll('.notif-dropdown').forEach(function (panel) {
      panel.classList.add('hidden');
    });
  }

  function toggleDropdown(event) {
    if (event) event.stopPropagation();
    var wrap = event.target.closest('.notif-wrap');
    var panel = wrap && wrap.querySelector('.notif-dropdown');
    if (!panel) return;
    var wasOpen = !panel.classList.contains('hidden');
    closeDropdown();
    if (!wasOpen) {
      renderDropdown();
      panel.classList.remove('hidden');
    }
  }

  async function refresh() {
    if (!window.Auth.isAuthenticated()) {
      cache = [];
      updateBadge(0);
      return;
    }
    try {
      var res = await window.Api.listAvisos();
      cache = (res && res.avisos) || [];
      var unread = cache.filter(function (item) { return !item.lida; }).length;
      updateBadge(unread);
      renderDashboard();
      renderPage();
      renderDropdown();
    } catch (err) {
      cache = [];
      updateBadge(0);
    }
  }

  async function markRead(id) {
    try {
      await window.Api.markAvisoRead(id);
      await refresh();
    } catch (err) { /* silencioso: o aluno ainda vê a lista */ }
  }

  function onClick(event) {
    var mark = event.target.closest('[data-mark-read]');
    if (mark) {
      event.preventDefault();
      markRead(mark.getAttribute('data-mark-read'));
      return;
    }
    var item = event.target.closest('.notif-item[data-aviso-id]');
    if (item) {
      event.preventDefault();
      closeDropdown();
      markRead(item.getAttribute('data-aviso-id'));
      window.showScreen('avisos-page');
    }
  }

  function init() {
    document.addEventListener('click', function (event) {
      if (event.target.closest('[data-notif-toggle]')) {
        toggleDropdown(event);
        return;
      }
      if (!event.target.closest('.notif-dropdown') && !event.target.closest('[data-notif-toggle]')) {
        closeDropdown();
      }
      onClick(event);
    });
  }

  return {
    init: init,
    refresh: refresh,
    closeDropdown: closeDropdown,
  };
})();
