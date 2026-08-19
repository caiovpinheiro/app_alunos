/* Configuração em runtime: busca URLs da API no servidor (sem hardcode de endpoints privados). */
window.AppConfig = (function () {
  'use strict';

  var cache = null;

  async function load() {
    if (cache) return cache;
    try {
      var res = await fetch('/api/config');
      if (!res.ok) throw new Error('config indisponível');
      cache = await res.json();
    } catch (err) {
      cache = { certificateApiUrl: '/api/certificates' };
    }
    return cache;
  }

  return { load: load };
})();
