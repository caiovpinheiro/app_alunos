/* Atendimento: WhatsApp por polo e formulário de indicação. */
window.Atendimento = (function () {
  'use strict';

  function setHref(id, url) {
    var el = document.getElementById(id);
    if (!el) return;
    if (url) {
      el.setAttribute('href', url);
      el.classList.remove('opacity-50', 'pointer-events-none');
    } else {
      el.setAttribute('href', '#');
      el.classList.add('opacity-50', 'pointer-events-none');
    }
  }

  async function refresh() {
    if (!window.Auth.isAuthenticated()) return;
    try {
      var res = await window.Api.getAtendimento();
      var polo = document.getElementById('atendimento-polo');
      if (polo) polo.textContent = res.polo ? 'Polo: ' + res.polo : 'Polo ainda não informado — usaremos o contato padrão.';
      setHref('btn-whatsapp-academico', res.academico && res.academico.url);
      setHref('btn-whatsapp-comercial', res.comercial && res.comercial.url);
    } catch (err) { /* a tela continua utilizável */ }
  }

  async function submitIndicacao(event) {
    event.preventDefault();
    var alertEl = document.getElementById('indicacao-alert');
    var okEl = document.getElementById('indicacao-ok');
    alertEl.classList.add('hidden');
    okEl.classList.add('hidden');
    window.UI.clearFieldErrors();

    var payload = {
      nome: document.getElementById('f_ind_nome').value,
      whatsapp: document.getElementById('f_ind_whatsapp').value,
      email: document.getElementById('f_ind_email').value,
      curso_interesse: document.getElementById('f_ind_curso').value,
      observacao: document.getElementById('f_ind_obs').value,
    };

    var btn = document.getElementById('btn-indicacao');
    btn.disabled = true;
    try {
      await window.Api.createIndicacao(payload);
      document.getElementById('indicacao-form').reset();
      okEl.textContent = 'Indicação registrada. O comercial receberá os dados.';
      okEl.classList.remove('hidden');
    } catch (err) {
      if (err.details) {
        var mapped = {};
        if (err.details.nome) mapped.ind_nome = err.details.nome;
        if (err.details.whatsapp) mapped.ind_whatsapp = err.details.whatsapp;
        if (err.details.email) mapped.ind_email = err.details.email;
        if (err.details.observacao) mapped.ind_obs = err.details.observacao;
        window.UI.showFieldErrors(mapped);
      }
      alertEl.textContent = err.message || 'Não foi possível enviar a indicação.';
      alertEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  }

  function setIndicacaoOpen(open) {
    var panel = document.getElementById('indicacao-panel');
    var btn = document.getElementById('btn-toggle-indicacao');
    if (!panel || !btn) return;

    if (open) {
      panel.hidden = false;
      // força reflow para a animação de expandir
      void panel.offsetHeight;
      panel.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      btn.classList.add('is-active');
      if (window.lucide) window.lucide.createIcons();
      window.setTimeout(function () {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 80);
    } else {
      panel.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('is-active');
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        if (!panel.classList.contains('is-open')) panel.hidden = true;
      }
      panel.addEventListener('transitionend', finish, { once: true });
      window.setTimeout(finish, 500);
    }
  }

  function toggleIndicacao() {
    var panel = document.getElementById('indicacao-panel');
    if (!panel) return;
    setIndicacaoOpen(!panel.classList.contains('is-open'));
  }

  function init() {
    var form = document.getElementById('indicacao-form');
    if (form) form.addEventListener('submit', submitIndicacao);
    var toggleBtn = document.getElementById('btn-toggle-indicacao');
    if (toggleBtn) toggleBtn.addEventListener('click', toggleIndicacao);
    var closeBtn = document.getElementById('btn-close-indicacao');
    if (closeBtn) closeBtn.addEventListener('click', function () { setIndicacaoOpen(false); });
  }

  return { init: init, refresh: refresh, toggleIndicacao: toggleIndicacao };
})();