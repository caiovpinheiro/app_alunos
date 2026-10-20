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

  async function register(payload) {
    return request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
    logout: logout,
    emitCertificate: emitCertificate,
    searchCursos: searchCursos,
    listAvisos: listAvisos,
    countAvisosNaoLidas: countAvisosNaoLidas,
    markAvisoRead: markAvisoRead,
    listTutoriais: listTutoriais,
    getCentral: getCentral,
    getMeuSemestre: getMeuSemestre,
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
