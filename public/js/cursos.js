/* Autocomplete de cursos a partir do catálogo (Supabase via backend). */
window.CursoAutocomplete = (function () {
  'use strict';

  var timer = null;
  var lastQuery = '';
  var activeIndex = -1;
  var items = [];
  var input;
  var list;
  var errEl;

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hide() {
    if (!list) return;
    list.classList.remove('is-open');
    list.hidden = true;
    list.innerHTML = '';
    activeIndex = -1;
    items = [];
    if (input) input.setAttribute('aria-expanded', 'false');
  }

  function showError(message) {
    if (!errEl) return;
    errEl.textContent = message;
    errEl.classList.remove('hidden');
  }

  function hideError() {
    if (!errEl) return;
    errEl.classList.add('hidden');
  }

  function highlight(name, query) {
    var safe = escapeHtml(name);
    var q = (query || '').trim();
    if (!q) return safe;
    var idx = name.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return safe;
    return escapeHtml(name.slice(0, idx))
      + '<strong>' + escapeHtml(name.slice(idx, idx + q.length)) + '</strong>'
      + escapeHtml(name.slice(idx + q.length));
  }

  function render(query) {
    if (!items.length) {
      list.innerHTML = '<li class="curso-suggestion curso-empty">Nenhum curso encontrado</li>';
      list.classList.add('is-open');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      return;
    }
    list.innerHTML = items.map(function (name, i) {
      var cls = 'curso-suggestion' + (i === activeIndex ? ' is-active' : '');
      return '<li class="' + cls + '" role="option" data-index="' + i + '">' + highlight(name, query) + '</li>';
    }).join('');
    list.classList.add('is-open');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function select(name) {
    input.value = name;
    hide();
    hideError();
  }

  async function search(query) {
    lastQuery = query;
    try {
      var res = await window.Api.searchCursos(query);
      if (lastQuery !== query) return;
      items = (res && res.cursos) || [];
      activeIndex = items.length ? 0 : -1;
      hideError();
      render(query);
    } catch (err) {
      items = [];
      hide();
      if (err.status === 401) {
        showError('Sua sessão expirou. Entre novamente para buscar o curso.');
        return;
      }
      showError('Não foi possível carregar os cursos. Tente novamente.');
    }
  }

  function scheduleSearch() {
    var query = input.value.replace(/\s+/g, ' ').trim();
    clearTimeout(timer);
    timer = setTimeout(function () { search(query); }, 120);
  }

  function onKeyDown(event) {
    if (!list.classList.contains('is-open')) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!items.length) return;
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      render(lastQuery);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!items.length) return;
      activeIndex = Math.max(activeIndex - 1, 0);
      render(lastQuery);
    } else if (event.key === 'Enter' && activeIndex >= 0 && items[activeIndex]) {
      event.preventDefault();
      select(items[activeIndex]);
    } else if (event.key === 'Escape') {
      hide();
    }
  }

  function init() {
    input = document.getElementById('f_curso');
    list = document.getElementById('curso-suggestions');
    errEl = document.getElementById('err_curso');
    if (!input || !list) return;

    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.addEventListener('input', scheduleSearch);
    input.addEventListener('focus', scheduleSearch);
    input.addEventListener('keydown', onKeyDown);
    input.addEventListener('blur', function () {
      setTimeout(hide, 180);
    });
    list.addEventListener('mousedown', function (event) {
      var item = event.target.closest('[data-index]');
      if (!item) return;
      event.preventDefault();
      select(items[Number(item.getAttribute('data-index'))]);
    });
  }

  return { init: init, hide: hide };
})();
