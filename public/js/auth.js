/* Sessão do aluno no frontend (token opaco emitido pelo backend). */
window.Auth = (function () {
  'use strict';

  var TOKEN_KEY = 'csu_token';
  var USER_KEY = 'csu_user';

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function setSession(token, user) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify({
      name: (user && user.name) || 'Aluno',
      email: (user && user.email) || '',
      rgm: (user && user.rgm) || '',
    }));
    conferirVersao();
  }

  // Duas versões das telas (servidor: VERSAO_NOVA_PARA). Este arquivo é o mesmo nas duas; a página
  // diz qual é a dela (<meta name="app-versao">). Se a conta logada deve ver a outra, o servidor grava
  // o cookie e a página recarrega uma vez (no máximo a cada 30 s, para nunca entrar em laço).
  function versaoDaPagina() {
    var m = document.querySelector('meta[name="app-versao"]');
    return (m && m.getAttribute('content')) || 'nova';
  }

  function conferirVersao() {
    var token = getToken();
    if (!token || !window.fetch) return;
    fetch('/api/versao', { headers: { Authorization: 'Bearer ' + token }, credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.versao || d.versao === versaoDaPagina()) return;
        var chave = 'csu_versao_recarga';
        var ultima = Number(sessionStorage.getItem(chave) || 0);
        if (Date.now() - ultima < 30000) return;
        sessionStorage.setItem(chave, String(Date.now()));
        window.location.reload();
      })
      .catch(function () { /* sem resposta, fica na versão que já abriu */ });
  }

  conferirVersao();

  function getUser() {
    var raw = sessionStorage.getItem(USER_KEY);
    if (!raw) return { name: 'Aluno' };
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) { /* sessão antiga em texto puro */ }
    return { name: raw };
  }

  function getUserName() {
    return getUser().name || 'Aluno';
  }

  function clear() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  }

  function isAuthenticated() {
    return Boolean(getToken());
  }

  return {
    getToken: getToken,
    getUser: getUser,
    getUserName: getUserName,
    setSession: setSession,
    clear: clear,
    isAuthenticated: isAuthenticated,
  };
})();
