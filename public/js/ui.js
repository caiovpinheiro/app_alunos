/* Navegação entre telas e feedback visual (erros, loading, preview). */
window.UI = (function () {
  'use strict';

  var SCREENS = ['login-page', 'first-access-page', 'dashboard-page', 'form-page', 'success-page'];
  var PUBLIC_SCREENS = ['login-page', 'first-access-page'];

  function showScreen(screenId) {
    if (PUBLIC_SCREENS.indexOf(screenId) === -1 && !window.Auth.isAuthenticated()) {
      screenId = 'login-page';
    }
    SCREENS.forEach(function (id) {
      document.getElementById(id).classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
    window.scrollTo(0, 0);
  }

  function setUserName(name) {
    document.getElementById('user-display-name').textContent = name;
  }

  function setLoginLoading(loading) {
    var btn = document.getElementById('btn-login');
    btn.disabled = loading;
    btn.textContent = loading ? 'Entrando...' : 'Entrar';
  }

  function showLoginError(message) {
    var el = document.getElementById('login-error');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function hideLoginError() {
    document.getElementById('login-error').classList.add('hidden');
  }

  function setRegisterLoading(loading) {
    var btn = document.getElementById('btn-register');
    btn.disabled = loading;
    btn.textContent = loading ? 'Criando acesso...' : 'Criar acesso';
  }

  function showRegisterError(message) {
    var el = document.getElementById('register-error');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function hideRegisterError() {
    document.getElementById('register-error').classList.add('hidden');
  }

  function setDashboardCertLoading(loading) {
    var btn = document.getElementById('btn-gerar-certificado');
    var text = document.getElementById('btn-gerar-certificado-text');
    if (!btn || !text) return;
    btn.disabled = loading;
    text.textContent = loading ? 'Gerando certificado...' : 'Gerar certificado';
  }

  function showDashboardCertError(message) {
    var el = document.getElementById('dashboard-cert-error');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function hideDashboardCertError() {
    document.getElementById('dashboard-cert-error').classList.add('hidden');
  }

  function setSubmitLoading(loading) {
    var btn = document.getElementById('btn-submit');
    var text = document.getElementById('btn-text');
    var loader = document.getElementById('btn-loader');
    btn.disabled = loading;
    btn.classList.toggle('opacity-70', loading);
    text.textContent = loading ? 'Gerando certificado...' : 'Gerar meu certificado';
    loader.classList.toggle('hidden', !loading);
  }

  function clearFieldErrors() {
    document.querySelectorAll('[id^="err_"]').forEach(function (el) {
      el.classList.add('hidden');
    });
  }

  function showFieldErrors(errors) {
    Object.keys(errors).forEach(function (field) {
      var el = document.getElementById('err_' + field);
      if (el) {
        el.textContent = errors[field];
        el.classList.remove('hidden');
      }
    });
  }

  function showFormAlert(message) {
    var el = document.getElementById('form-alert');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function hideFormAlert() {
    document.getElementById('form-alert').classList.add('hidden');
  }

  function showPreview(blobUrl, protocolo) {
    document.getElementById('preview-frame').src = blobUrl;
    if (protocolo) {
      document.getElementById('cert-protocol').textContent = 'Protocolo: ' + protocolo;
    }
  }

  function clearPreview() {
    document.getElementById('preview-frame').removeAttribute('src');
  }

  return {
    showScreen: showScreen,
    setUserName: setUserName,
    setLoginLoading: setLoginLoading,
    showLoginError: showLoginError,
    hideLoginError: hideLoginError,
    setRegisterLoading: setRegisterLoading,
    showRegisterError: showRegisterError,
    hideRegisterError: hideRegisterError,
    setDashboardCertLoading: setDashboardCertLoading,
    showDashboardCertError: showDashboardCertError,
    hideDashboardCertError: hideDashboardCertError,
    setSubmitLoading: setSubmitLoading,
    clearFieldErrors: clearFieldErrors,
    showFieldErrors: showFieldErrors,
    showFormAlert: showFormAlert,
    hideFormAlert: hideFormAlert,
    showPreview: showPreview,
    clearPreview: clearPreview,
  };
})();
