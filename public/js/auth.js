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
  }

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
