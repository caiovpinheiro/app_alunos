/* Serviços de API: autenticação e emissão de certificado. */
window.Api = (function () {
  'use strict';

  async function request(url, options) {
    var res;
    try {
      res = await fetch(url, options);
    } catch (networkErr) {
      throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
    }

    var body = null;
    try { body = await res.json(); } catch (e) { /* resposta sem corpo JSON */ }

    if (!res.ok) {
      var err = new Error((body && body.message) || 'Falha na comunicação com o servidor.');
      err.status = res.status;
      err.details = body && body.errors;
      throw err;
    }
    return body;
  }

  function authHeaders() {
    var token = window.Auth.getToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  async function login(identifier, password) {
    return request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: identifier, password: password }),
    });
  }

  async function logout() {
    try {
      await request('/api/auth/logout', { method: 'POST', headers: authHeaders() });
    } catch (e) { /* melhor esforço: sessão local é limpa de qualquer forma */ }
  }

  async function emitCertificate(payload) {
    var config = await window.AppConfig.load();
    return request(config.certificateApiUrl, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify(payload),
    });
  }

  async function searchCursos(query) {
    var q = encodeURIComponent(query || '');
    return request('/api/cursos?q=' + q, { headers: authHeaders() });
  }

  return { login: login, logout: logout, emitCertificate: emitCertificate, searchCursos: searchCursos };
})();
