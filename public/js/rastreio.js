/* Rastreio do percurso do aluno. Dois destinos:
   1) Nosso servidor (POST /api/eventos), para o painel "Acompanhamento" do admin: acessos,
      tempo ativo, telas, cliques, vídeos e os eventos de cada tela. Liga quando /api/recursos
      devolve rastreio: true (RASTREIO_LIBERADO_PARA).
   2) O chat do CRM (Bwipo), para o atendente ver o contexto da conversa. Liga quando o chat
      está liberado (WEBCHAT_LIBERADO_PARA). Recebe só os eventos explícitos (track), não os
      cliques e o progresso de vídeo, que seriam ruído na conversa.

   Contrato com o widget (ver docs/integracao/bwipo-eventos.md):
     BwipoWebchat.identify({ externalId, name, email, attributes, userHash })
     BwipoWebchat.track(nome, dados, { important: true|false, at: ISO })

   Não guardamos o que o aluno digita em campos (só o termo das buscas da Central, que já existia),
   nem senha, nem IP. */
window.Rastreio = (function () {
  'use strict';

  // ---------- utilidades ----------
  function limpa(dados) {
    var out = {};
    Object.keys(dados || {}).forEach(function (k) {
      var v = dados[k];
      if (v == null) return;
      if (typeof v === 'string') v = v.slice(0, 200);
      if (typeof v === 'object') return; // só valores simples
      out[k] = v;
    });
    return out;
  }
  function telaAtual() { return window.location.pathname.slice(0, 60); }

  // ---------- 1) servidor ----------
  var servidorAtivo = false;
  var filaServ = [];
  var ativoS = 0;          // segundos ativos ainda não enviados
  var ultimaAtividade = Date.now();
  var ticker = null;
  var enviando = false;
  var SESSAO_KEY = 'csu_rastreio_sessao';
  var INATIVO_MS = 30 * 60 * 1000; // 30 min parado = novo acesso

  function novoId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  // Um acesso = uma aba até ficar 30 min sem uso.
  function sessao() {
    var s = null;
    try { s = JSON.parse(sessionStorage.getItem(SESSAO_KEY) || 'null'); } catch (e) { s = null; }
    var agora = Date.now();
    if (!s || !s.id || agora - (s.visto || 0) > INATIVO_MS) s = { id: novoId(), visto: agora };
    s.visto = agora;
    try { sessionStorage.setItem(SESSAO_KEY, JSON.stringify(s)); } catch (e) { /* sem storage: id só na memória */ }
    return s.id;
  }
  function dispositivo() {
    var w = window.innerWidth || 0;
    return w < 640 ? 'celular' : w < 1024 ? 'tablet' : 'computador';
  }

  function registrar(nome, dados) {
    if (!servidorAtivo || !nome) return;
    filaServ.push({ nome: String(nome), tela: telaAtual(), dados: limpa(dados), em: new Date().toISOString() });
    if (filaServ.length > 300) filaServ.splice(0, filaServ.length - 300);
    if (filaServ.length >= 40) enviar(false);
  }

  function enviar(saindo) {
    if (!servidorAtivo || enviando) return Promise.resolve();
    var token = window.Auth && window.Auth.getToken && window.Auth.getToken();
    if (!token) return Promise.resolve();
    if (!filaServ.length && ativoS < 5) return Promise.resolve();
    var lote = filaServ.splice(0, 40);
    var corpo = { sessao: sessao(), ativo_s: Math.round(ativoS), dispositivo: dispositivo(), eventos: lote };
    ativoS = 0;
    enviando = !saindo;
    try {
      return fetch('/api/eventos', {
        method: 'POST',
        keepalive: !!saindo, // ao fechar a aba o envio continua
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(corpo),
      }).then(function (r) {
        enviando = false;
        if (!r.ok && r.status >= 500) filaServ = lote.concat(filaServ); // tenta de novo no próximo ciclo
        else if (filaServ.length >= 40) enviar(false);
      }).catch(function () { enviando = false; filaServ = lote.concat(filaServ); });
    } catch (e) { enviando = false; return Promise.resolve(); }
  }

  function videoTocando() {
    var vs = document.querySelectorAll('video');
    for (var i = 0; i < vs.length; i++) if (!vs[i].paused && !vs[i].ended) return true;
    return false;
  }

  // A cada 5 s: conta tempo se a aba está visível e houve uso no último minuto (ou vídeo tocando).
  function iniciarTicker() {
    if (ticker) return;
    var ciclos = 0;
    ticker = setInterval(function () {
      if (document.visibilityState === 'visible' && (Date.now() - ultimaAtividade < 60000 || videoTocando())) ativoS += 5;
      ciclos += 1;
      if (ciclos % 3 === 0) enviar(false); // a cada 15 s
    }, 5000);
  }

  function marcaAtividade() { ultimaAtividade = Date.now(); }

  // Cliques: nome visível do botão/link (ou data-track), nunca o conteúdo de campos.
  function rotuloDe(el) {
    var t = el.getAttribute('data-track') || el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '';
    return t.replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  function aoClicar(e) {
    marcaAtividade();
    var el = e.target && e.target.closest && e.target.closest('a, button, [role="button"], summary, label.c-chip');
    if (!el || el.closest('[data-no-track]')) return;
    var dados = { alvo: rotuloDe(el) };
    if (el.tagName === 'A' && el.href) {
      try {
        var u = new URL(el.href, window.location.href);
        dados.destino = u.host === window.location.host ? u.pathname : u.host;
        if (el.target === '_blank' || u.host !== window.location.host) dados.externo = true;
      } catch (err) { /* href estranho: fica só o rótulo */ }
    }
    registrar('clique', dados);
  }

  // Vídeos: início, 25/50/75%, fim e pausa (com %). Vale para trilha, Central, Aula Inaugural e modal.
  var marcos = new WeakMap();
  function nomeVideo(v) {
    var src = v.currentSrc || (v.querySelector('source') && v.querySelector('source').src) || '';
    var arq = src.split('?')[0].split('/').slice(-2).join('/').replace(/\.mp4$/, '');
    var titulo = '';
    var modal = v.closest('#c-modal');
    if (modal) { var h = modal.querySelector('#c-mtitle'); titulo = h ? h.textContent : ''; }
    return { video: arq.slice(0, 80), titulo: titulo.slice(0, 120) || undefined };
  }
  function pct(v) { return v.duration ? Math.round((v.currentTime / v.duration) * 100) : 0; }
  function aoMidia(e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO') return;
    var m = marcos.get(v);
    if (!m) { m = { inicio: false, q: {} }; marcos.set(v, m); }
    var info = nomeVideo(v);
    if (e.type === 'play') {
      marcaAtividade();
      if (!m.inicio || v.currentTime < 1) { m.inicio = true; m.q = {}; registrar('video_inicio', info); }
      else registrar('video_retomado', Object.assign({ pct: pct(v) }, info));
    } else if (e.type === 'timeupdate') {
      var p = pct(v);
      [25, 50, 75].forEach(function (q) {
        if (p >= q && !m.q[q]) { m.q[q] = true; registrar('video_progresso', Object.assign({ pct: q }, info)); }
      });
    } else if (e.type === 'pause' && !v.ended) {
      registrar('video_pausa', Object.assign({ pct: pct(v) }, info));
    } else if (e.type === 'ended') {
      registrar('video_fim', info);
    }
  }

  function aoSair() {
    if (document.visibilityState === 'hidden') enviar(true);
  }

  var ouvindo = false;
  function ligarOuvintes() {
    if (ouvindo) return;
    ouvindo = true;
    document.addEventListener('click', aoClicar, true);
    ['play', 'pause', 'ended', 'timeupdate'].forEach(function (t) { document.addEventListener(t, aoMidia, true); });
    ['keydown', 'scroll', 'pointermove', 'touchstart'].forEach(function (t) {
      document.addEventListener(t, marcaAtividade, { capture: true, passive: true });
    });
    document.addEventListener('visibilitychange', aoSair);
    window.addEventListener('pagehide', function () { enviar(true); });
  }

  // ---------- 2) chat do CRM ----------
  var MAX_FILA = 200;
  var chatAtivo = false;
  var identidade = null;
  var identificado = false;
  var fila = [];
  var timer = null;
  var tentativas = 0;

  function api() {
    var b = window.BwipoWebchat;
    return b && typeof b.track === 'function' ? b : null;
  }

  function descarrega() {
    var b = api();
    if (!b) return false;
    if (!identificado && identidade && typeof b.identify === 'function') {
      try { b.identify(identidade); identificado = true; } catch (e) { /* tenta de novo depois */ }
    }
    while (fila.length) {
      var ev = fila.shift();
      try { b.track(ev.nome, ev.dados, { important: ev.importante, at: ev.at }); } catch (e) { fila.unshift(ev); return false; }
    }
    return true;
  }

  // O embed carrega assíncrono: confere a cada 2 s por até 2 minutos.
  function agenda() {
    if (timer) return;
    timer = setInterval(function () {
      tentativas += 1;
      if (descarrega() || tentativas > 60) { clearInterval(timer); timer = null; tentativas = 0; }
    }, 2000);
  }

  // Evento explícito das telas: vai para o servidor e para o chat.
  function track(nome, dados, opts) {
    if (!nome) return;
    registrar(nome, dados);
    if (!chatAtivo) return;
    fila.push({
      nome: String(nome),
      dados: limpa(dados),
      importante: !!(opts && opts.importante),
      at: new Date().toISOString(),
    });
    if (fila.length > MAX_FILA) fila.splice(0, fila.length - MAX_FILA);
    if (!descarrega()) agenda();
  }

  // Chamado depois do login, com o retorno de /api/recursos: { chat: r.webchat, servidor: r.rastreio }.
  function iniciar(cfg) {
    cfg = cfg || {};
    if (cfg.servidor && !servidorAtivo) {
      servidorAtivo = true;
      ligarOuvintes();
      iniciarTicker();
    }
    var chat = cfg.chat;
    if (chat) {
      chatAtivo = true;
      var id = chat.identity;
      if (id && id.external_id) {
        identidade = {
          externalId: id.external_id,
          name: id.name || undefined,
          email: id.email || undefined,
          attributes: id.attributes || {},
          userHash: id.user_hash || undefined,
        };
      }
      if (!descarrega()) agenda();
    }
  }

  // Logout: manda o que falta (ainda com o token) e desliga tudo. Devolve uma promessa
  // para o logout esperar o envio (no máximo 1,5 s) antes de apagar a sessão no servidor.
  function parar() {
    registrar('saiu', {});
    enviando = false;
    var envio = enviar(false);
    servidorAtivo = false;
    filaServ = [];
    ativoS = 0;
    if (ticker) { clearInterval(ticker); ticker = null; }
    try { sessionStorage.removeItem(SESSAO_KEY); } catch (e) { /* ok */ }
    chatAtivo = false;
    identidade = null;
    identificado = false;
    fila = [];
    if (timer) { clearInterval(timer); timer = null; }
    return Promise.race([envio, new Promise(function (r) { setTimeout(r, 1500); })]).catch(function () {});
  }

  // Para conferir no console: Rastreio.debug().
  function debug() {
    return {
      servidor: { ativo: servidorAtivo, naFila: filaServ.slice(), segundosAtivosPendentes: ativoS },
      chat: { ativo: chatAtivo, identificado: identificado, widgetComTrack: !!api(), naFila: fila.slice() },
    };
  }

  return { iniciar: iniciar, track: track, registrar: registrar, enviar: enviar, parar: parar, debug: debug };
})();
