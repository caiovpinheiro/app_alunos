/* Tutoriais: busca, filtro, cards e modal com embed só ao clicar. */
window.Tutoriais = (function () {
  'use strict';

  var cache = [];
  var categorias = [];
  var query = '';
  var categoria = '';

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function filtered() {
    return cache.filter(function (item) {
      var hay = (item.titulo + ' ' + item.descricao).toLowerCase();
      var matchQ = !query || hay.indexOf(query) !== -1;
      var matchC = !categoria || item.categoria === categoria;
      return matchQ && matchC;
    });
  }

  function cardHtml(item) {
    var thumb = item.thumbnail_url || '';
    return (
      '<article class="tutorial-card">' +
        '<button type="button" class="tutorial-thumb" data-open-tutorial="' + item.id + '">' +
          (thumb ? '<img src="' + escapeHtml(thumb) + '" alt="">' : '<span class="tutorial-thumb-fallback"></span>') +
          '<span class="tutorial-play">▶</span>' +
        '</button>' +
        '<div class="tutorial-body">' +
          '<span class="tutorial-cat">' + escapeHtml(item.categoria) + '</span>' +
          '<h3>' + escapeHtml(item.titulo) + '</h3>' +
          '<p>' + escapeHtml(item.descricao) + '</p>' +
          (item.duracao ? '<span class="tutorial-dur">' + escapeHtml(item.duracao) + '</span>' : '') +
        '</div>' +
      '</article>'
    );
  }

  function render() {
    var wrap = document.getElementById('tutoriais-grid');
    if (!wrap) return;
    var items = filtered();
    wrap.innerHTML = items.length
      ? items.map(cardHtml).join('')
      : '<p class="aviso-empty">Nenhum tutorial encontrado.</p>';
  }

  function renderFilters(categorias) {
    var wrap = document.getElementById('tutoriais-filters');
    if (!wrap) return;
    var all = ['Todas'].concat(categorias || []);
    wrap.innerHTML = all.map(function (name) {
      var value = name === 'Todas' ? '' : name;
      var active = categoria === value ? ' is-active' : '';
      return '<button type="button" class="filter-chip' + active + '" data-cat="' + escapeHtml(value) + '">' + escapeHtml(name) + '</button>';
    }).join('');
  }

  function closeModal() {
    var modal = document.getElementById('tutorial-modal');
    var frame = document.getElementById('tutorial-frame');
    if (frame) frame.removeAttribute('src');
    if (modal) modal.classList.add('hidden');
  }

  function openModal(item) {
    var modal = document.getElementById('tutorial-modal');
    var frame = document.getElementById('tutorial-frame');
    var title = document.getElementById('tutorial-modal-title');
    var desc = document.getElementById('tutorial-modal-desc');
    if (!modal || !frame || !item || !item.youtube_id) return;
    title.textContent = item.titulo;
    desc.textContent = item.descricao;
    frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(item.youtube_id) + '?autoplay=1&rel=0';
    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  async function refresh() {
    if (!window.Auth.isAuthenticated()) return;
    try {
      var res = await window.Api.listTutoriais();
      cache = (res && res.tutoriais) || [];
      categorias = (res && res.categorias && res.categorias.length)
        ? res.categorias
        : Array.from(new Set(cache.map(function (item) { return item.categoria; }).filter(Boolean)));
      renderFilters(categorias);
      render();
    } catch (err) {
      cache = [];
      categorias = [];
      renderFilters(categorias);
      render();
    }
  }

  function init() {
    var search = document.getElementById('tutoriais-search');
    if (search) {
      search.addEventListener('input', function () {
        query = search.value.trim().toLowerCase();
        render();
      });
    }
    document.addEventListener('click', function (event) {
      var chip = event.target.closest('#tutoriais-filters [data-cat]');
      if (chip) {
        categoria = chip.getAttribute('data-cat') || '';
        renderFilters(categorias);
        render();
        return;
      }
      var open = event.target.closest('[data-open-tutorial]');
      if (open) {
        var id = Number(open.getAttribute('data-open-tutorial'));
        var item = cache.find(function (row) { return row.id === id; });
        openModal(item);
        return;
      }
      if (event.target.closest('[data-close-tutorial]')) closeModal();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeModal();
    });
  }

  return { init: init, refresh: refresh, closeModal: closeModal };
})();
