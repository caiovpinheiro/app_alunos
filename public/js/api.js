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
      err.codigo = body && body.codigo;
      throw err;
    }
    return body;
  }

  function authHeaders() {
    var token = window.Auth.getToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  // Origem do link de entrada (?o=bv, ?o=reenvio, ?o=polo...): lida ao carregar a página, antes de a
  // navegação trocar o endereço, e guardada na aba até o login (server/instrumentacao.js).
  var ORIGEM_KEY = 'csu-origem';
  (function guardarOrigem() {
    try {
      var o = new URLSearchParams(window.location.search).get('o');
      if (o && /^[a-z0-9_-]{1,24}$/i.test(o)) sessionStorage.setItem(ORIGEM_KEY, o.toLowerCase());
    } catch (e) { /* sem storage: entra sem origem */ }
  })();
  function origem() {
    try { return sessionStorage.getItem(ORIGEM_KEY) || null; } catch (e) { return null; }
  }
  function esquecerOrigem() {
    try { sessionStorage.removeItem(ORIGEM_KEY); } catch (e) { /* ok */ }
  }

  async function login(identifier, password) {
    var r = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: identifier, password: password, origem: origem() }),
    });
    esquecerOrigem();
    return r;
  }

  async function register(payload) {
    var r = await request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, payload, { origem: origem() })),
    });
    esquecerOrigem();
    return r;
  }

  // "Esqueci minha senha": avisa o servidor sem segurar o link (o WhatsApp abre do mesmo jeito).
  // O RGM/e-mail digitado só serve para o servidor achar a conta; ele não é guardado.
  function esqueciSenha(identifier) {
    var corpo = JSON.stringify({ identifier: String(identifier || '').trim().slice(0, 120) || null, origem: origem() });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/auth/esqueci', new Blob([corpo], { type: 'application/json' }))) return;
    } catch (e) { /* cai no fetch */ }
    try { fetch('/api/auth/esqueci', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: corpo }).catch(function () {}); } catch (e) { /* ok */ }
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

  async function listAvisos() {
    return request('/api/avisos', { headers: authHeaders() });
  }

  async function countAvisosNaoLidas() {
    return request('/api/avisos/nao-lidas', { headers: authHeaders() });
  }

  async function markAvisoRead(id) {
    return request('/api/avisos/' + encodeURIComponent(id) + '/lida', {
      method: 'POST',
      headers: authHeaders(),
    });
  }

  async function listTutoriais() {
    return request('/api/tutoriais', { headers: authHeaders() });
  }

  async function getAtendimentoPadrao() {
    return request('/api/atendimento/padrao');
  }

  async function getCentral() {
    return request('/api/central', { headers: authHeaders() });
  }

  // Pedido de ajuda (Travei / dificuldade): o servidor grava o contexto e devolve protocolo e WhatsApp.
  async function criarPedidoAjuda(corpo) {
    return request('/api/ajuda/pedidos', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify(corpo || {}),
    });
  }

  async function getPedidoAjudaAberto() {
    return request('/api/ajuda/pedidos/aberto', { headers: authHeaders() });
  }

  async function getMeuSemestre() {
    return request('/api/meu-semestre', { headers: authHeaders() });
  }

  async function getRecursos() {
    return request('/api/recursos', { headers: authHeaders() });
  }

  // RGM, curso e e-mail acadêmico do próprio aluno (dados de acesso à faculdade).
  async function getMeuAcesso() {
    return request('/api/meu-acesso', { headers: authHeaders() });
  }

  async function getTrilha() {
    return request('/api/trilha', { headers: authHeaders() });
  }

  async function getTrilhaResumo() {
    return request('/api/trilha/resumo', { headers: authHeaders() });
  }

  async function trilhaPost(acao, payload) {
    return request('/api/trilha/' + acao, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify(payload || {}),
    });
  }

  async function getAtendimento() {
    return request('/api/atendimento', { headers: authHeaders() });
  }

  async function downloadPlanoPng() {
    var res;
    try {
      res = await fetch('/api/meu-semestre/imagem.png', { headers: authHeaders() });
    } catch (networkErr) {
      throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
    }
    if (!res.ok) {
      var body = null;
      try { body = await res.json(); } catch (e) { /* ignore */ }
      var err = new Error((body && body.message) || 'Não foi possível baixar o plano de estudos.');
      err.status = res.status;
      throw err;
    }
    return res.blob();
  }

  async function getPlanoImageUrl() {
    return request('/api/meu-semestre/imagem-url', { headers: authHeaders() });
  }

  async function createIndicacao(payload) {
    return request('/api/indicacoes', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify(payload),
    });
  }

  // Avaliação joinha (vídeos, FAQ e Aula Inaugural): voto 1, -1 ou 0 (desfaz).
  async function avaliar(tipo, id, voto) {
    return request('/api/avaliacoes', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ tipo: tipo, id: id, voto: voto }),
    });
  }

  // Comentário do 👎 ("o que não ficou bom"): só vale depois de um voto -1 gravado.
  async function comentarAvaliacao(tipo, id, comentario) {
    return request('/api/avaliacoes/comentario', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ tipo: tipo, id: id, comentario: comentario }),
    });
  }

  async function getMinhasAvaliacoes() {
    return request('/api/avaliacoes/minhas', { headers: authHeaders() });
  }

  // Quantos 👍 cada conteúdo do tipo recebeu: {totais: {"<id>": n}} (só positivos).
  async function getTotaisAvaliacoes(tipo) {
    return request('/api/avaliacoes/totais?tipo=' + encodeURIComponent(tipo), { headers: authHeaders() });
  }

  return {
    avaliar: avaliar,
    comentarAvaliacao: comentarAvaliacao,
    getMinhasAvaliacoes: getMinhasAvaliacoes,
    getTotaisAvaliacoes: getTotaisAvaliacoes,
    login: login,
    register: register,
    esqueciSenha: esqueciSenha,
    logout: logout,
    emitCertificate: emitCertificate,
    searchCursos: searchCursos,
    listAvisos: listAvisos,
    countAvisosNaoLidas: countAvisosNaoLidas,
    markAvisoRead: markAvisoRead,
    listTutoriais: listTutoriais,
    getCentral: getCentral,
    getMeuSemestre: getMeuSemestre,
    criarPedidoAjuda: criarPedidoAjuda,
    getPedidoAjudaAberto: getPedidoAjudaAberto,
    downloadPlanoPng: downloadPlanoPng,
    getPlanoImageUrl: getPlanoImageUrl,
    getAtendimento: getAtendimento,
    getRecursos: getRecursos,
    getMeuAcesso: getMeuAcesso,
    getTrilha: getTrilha,
    getTrilhaResumo: getTrilhaResumo,
    trilhaPost: trilhaPost,
    createIndicacao: createIndicacao,
    getAtendimentoPadrao: getAtendimentoPadrao,
  };
})();
