/* Grupo de estudo do curso (docs/grupo-estudo.md).
   Área oculta: só existe se GET /api/grupos/meu responder 200 (GRUPO_ESTUDO_ATIVA_PARA). Aí o módulo
   registra a tela /grupo, monta a seção e põe "Grupo do curso" no menu do topo. Com a flag desligada a API
   responde 404 e nada aparece.
   Mensagens: envio com moderação no servidor (publicada / bloqueada com explicação / em análise), denúncia
   e atualização por polling a cada 5 s com a tela aberta e a aba visível. */
window.GrupoEstudo = (function () {
  'use strict';

  var TELA = 'grupo-page';
  var PATH = '/grupo';
  var INTERVALO = 5000;
  var pathInicial = String(window.location.pathname || '').replace(/\/+$/, '');

  var estado = { verificado: false, ativo: false, dados: null, msgs: {}, cursor: null, timer: null, enviando: false };

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  async function api(url, opts) {
    opts = opts || {};
    var headers = Object.assign({ Authorization: 'Bearer ' + window.Auth.getToken() }, opts.body ? { 'Content-Type': 'application/json' } : {});
    var res = await fetch(url, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    var body = null;
    try { body = await res.json(); } catch (e) { /* sem corpo */ }
    if (!res.ok) {
      var err = new Error((body && body.message) || 'Falha na comunicação com o servidor.');
      err.status = res.status;
      throw err;
    }
    return body;
  }

  function hora(iso) {
    var d = new Date(iso);
    var hoje = new Date();
    var hh = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === hoje.toDateString() ? hh : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hh;
  }

  // ---------- Montagem da tela (só depois de a API liberar) ----------
  function montarSecao() {
    if (document.getElementById(TELA)) return;
    var sec = document.createElement('section');
    sec.id = TELA;
    sec.className = 'hidden min-h-screen';
    sec.setAttribute('aria-hidden', 'true');
    var modelo = document.querySelector('#meu-semestre-page > header');
    if (modelo) sec.appendChild(modelo.cloneNode(true));
    var main = document.createElement('main');
    main.className = 'ge-page portal-container py-6 lg:py-8';
    main.innerHTML = '<div id="ge-root"></div>';
    sec.appendChild(main);
    var antes = document.getElementById('avisos-page');
    document.getElementById('app').insertBefore(sec, antes || null);
  }

  function linkNoMenu() {
    document.querySelectorAll('.portal-nav').forEach(function (nav) {
      if (nav.querySelector('[data-grupo-nav]')) return;
      var a = document.createElement('a');
      a.href = PATH;
      a.setAttribute('data-nav', TELA);
      a.setAttribute('data-grupo-nav', '');
      a.textContent = 'Grupo'; // curto: o menu do topo já está no limite em telas médias
      a.title = 'Grupo de estudo do seu curso';
      nav.appendChild(a);
    });
  }

  function desmontar() {
    parar();
    document.querySelectorAll('[data-grupo-nav]').forEach(function (a) { a.remove(); });
    var sec = document.getElementById(TELA);
    if (sec) sec.remove();
    estado = { verificado: false, ativo: false, dados: null, msgs: {}, cursor: null, timer: null, enviando: false };
  }

  function renderBase() {
    var root = document.getElementById('ge-root');
    if (!root) return;
    var d = estado.dados;
    if (!d.grupo) {
      root.innerHTML =
        '<div class="ge-head"><p class="portal-eyebrow">Grupo de estudo</p><h1>Grupo do curso</h1></div>' +
        '<div class="ge-vazio"><p><strong>Seu curso ainda não chegou ao portal.</strong></p>' +
        '<p>Assim que o seu curso aparecer no cadastro, você entra automaticamente no grupo da turma. Isso costuma levar até 2 dias úteis depois da matrícula.</p></div>';
      return;
    }
    var silenciado = d.eu.silenciado_ate;
    root.innerHTML =
      '<div class="ge-head">' +
        '<p class="portal-eyebrow">Grupo de estudo</p>' +
        '<h1>' + esc(d.grupo.nome) + '</h1>' +
        '<p class="ge-sub">' + d.grupo.membros + (d.grupo.membros === 1 ? ' colega' : ' colegas') + ' no grupo · Você aparece como <strong>' + esc(d.eu.nome) + '</strong></p>' +
      '</div>' +
      '<details class="ge-regras"><summary><i data-lucide="shield-check" aria-hidden="true"></i> Regras do grupo</summary><ul>' +
        d.regras.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') +
      '</ul></details>' +
      '<div class="ge-feed" id="ge-feed" role="log" aria-live="polite" aria-label="Mensagens do grupo"><p class="ge-carregando">Carregando mensagens…</p></div>' +
      (silenciado
        ? '<p class="ge-silenciado" role="status">A equipe pausou seus envios no grupo até ' + esc(hora(silenciado)) + '. Você continua podendo ler.</p>'
        : '<form class="ge-form" id="ge-form" novalidate>' +
            '<label for="ge-texto" class="ge-sr">Mensagem para o grupo</label>' +
            '<textarea id="ge-texto" rows="2" maxlength="' + (d.max_texto || 500) + '" placeholder="Escreva para a turma: uma dúvida, uma dica, um combinado de estudo…"></textarea>' +
            '<div class="ge-form-pe"><span class="ge-cont" id="ge-cont">0/' + (d.max_texto || 500) + '</span>' +
            '<button type="submit" class="portal-btn portal-btn--primary" id="ge-enviar">Enviar</button></div>' +
            '<p class="ge-erro" id="ge-erro" role="alert" hidden></p>' +
          '</form>');
    if (window.lucide) window.lucide.createIcons();
  }

  function msgHtml(m) {
    var classes = 'ge-msg' + (m.minha ? ' ge-msg--minha' : '') + (m.status !== 'publicada' ? ' ge-msg--' + m.status : '');
    var rodape = '';
    if (m.minha && m.status !== 'publicada') {
      var rot = m.status === 'retida' ? 'Em análise' : m.status === 'removida' ? 'Removida pela equipe' : 'Não publicada';
      rodape = '<div class="ge-moder"><p class="ge-moder-tit"><i data-lucide="' + (m.status === 'retida' ? 'clock' : 'shield-alert') + '" aria-hidden="true"></i> ' + rot + ' · só você vê</p>' +
        '<p>' + esc(m.explicacao) + '</p></div>';
    } else if (!m.minha) {
      rodape = m.denunciada
        ? '<p class="ge-denunciada">Você denunciou esta mensagem.</p>'
        : '<button type="button" class="ge-denunciar" data-ge-denunciar="' + m.id + '">Denunciar</button>';
    }
    return '<article class="' + classes + '" data-id="' + m.id + '">' +
      '<header><strong>' + esc(m.minha ? 'Você' : m.autor) + '</strong><time datetime="' + esc(m.criado_em) + '">' + esc(hora(m.criado_em)) + '</time></header>' +
      '<p class="ge-texto">' + esc(m.texto) + '</p>' + rodape + '</article>';
  }

  function renderFeed() {
    var feed = document.getElementById('ge-feed');
    if (!feed) return;
    var pertoDoFim = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    var lista = Object.keys(estado.msgs).map(function (k) { return estado.msgs[k]; }).sort(function (a, b) { return a.id - b.id; });
    feed.innerHTML = lista.length
      ? lista.map(msgHtml).join('')
      : '<div class="ge-vazio"><p><strong>O grupo ainda está quieto.</strong></p><p>Que tal começar? Conte em que matéria você está ou poste a sua primeira dúvida.</p></div>';
    if (window.lucide) window.lucide.createIcons();
    if (pertoDoFim || !estado.rolou) { feed.scrollTop = feed.scrollHeight; estado.rolou = true; }
  }

  function aplicar(mensagens) {
    (mensagens || []).forEach(function (m) {
      if (m.oculta) delete estado.msgs[m.id];
      else estado.msgs[m.id] = m;
    });
  }

  // ---------- Dados ----------
  async function carregarMensagens() {
    try {
      var r = await api('/api/grupos/meu/mensagens' + (estado.cursor ? '?desde=' + encodeURIComponent(estado.cursor) : ''));
      var mudou = !estado.cursor || (r.mensagens && r.mensagens.length);
      aplicar(r.mensagens);
      estado.cursor = r.cursor || estado.cursor;
      if (mudou) renderFeed();
    } catch (err) {
      if (err.status === 404 || err.status === 401) { desmontar(); return; }
      var feed = document.getElementById('ge-feed');
      if (feed && !Object.keys(estado.msgs).length) feed.innerHTML = '<p class="ge-erro">' + esc(err.message) + '</p>';
    }
  }

  function tick() {
    if (document.visibilityState !== 'visible') return;
    var sec = document.getElementById(TELA);
    if (!sec || sec.classList.contains('hidden')) { parar(); return; }
    carregarMensagens();
  }

  function parar() {
    if (estado.timer) clearInterval(estado.timer);
    estado.timer = null;
  }

  async function abrir() {
    if (!estado.ativo) return;
    try {
      estado.dados = await api('/api/grupos/meu');
    } catch (err) {
      if (err.status === 404 || err.status === 401) { desmontar(); window.showScreen('dashboard-page', { replace: true }); }
      return;
    }
    estado.msgs = {};
    estado.cursor = null;
    estado.rolou = false;
    renderBase();
    if (!estado.dados.grupo) return;
    await carregarMensagens();
    parar();
    estado.timer = setInterval(tick, INTERVALO);
  }

  async function enviar(ev) {
    ev.preventDefault();
    if (estado.enviando) return;
    var campo = document.getElementById('ge-texto');
    var btn = document.getElementById('ge-enviar');
    var erro = document.getElementById('ge-erro');
    var texto = campo.value.trim();
    erro.hidden = true;
    if (!texto) { erro.textContent = 'Escreva a mensagem.'; erro.hidden = false; campo.focus(); return; }
    estado.enviando = true;
    btn.disabled = true;
    btn.textContent = 'Verificando…';
    try {
      var r = await api('/api/grupos/meu/mensagens', { method: 'POST', body: { texto: texto } });
      aplicar([r.mensagem]);
      campo.value = '';
      atualizarContador();
      estado.rolou = false;
      renderFeed();
    } catch (err) {
      if (err.status === 404) { desmontar(); return; }
      erro.textContent = err.message;
      erro.hidden = false;
    } finally {
      estado.enviando = false;
      btn.disabled = false;
      btn.textContent = 'Enviar';
    }
  }

  function atualizarContador() {
    var campo = document.getElementById('ge-texto');
    var cont = document.getElementById('ge-cont');
    if (campo && cont) cont.textContent = campo.value.length + '/' + campo.maxLength;
  }

  function abrirDenuncia(id, btn) {
    var art = btn.closest('.ge-msg');
    if (!art || art.querySelector('.ge-den-form')) return;
    var motivos = (estado.dados && estado.dados.motivos_denuncia) || {};
    var form = document.createElement('form');
    form.className = 'ge-den-form';
    form.innerHTML = '<fieldset><legend>Por que você está denunciando?</legend>' +
      Object.keys(motivos).map(function (k) {
        return '<label><input type="radio" name="motivo" value="' + esc(k) + '"> ' + esc(motivos[k]) + '</label>';
      }).join('') + '</fieldset>' +
      '<div class="ge-den-acts"><button type="submit" class="portal-btn portal-btn--primary">Enviar denúncia</button>' +
      '<button type="button" class="ge-den-cancelar">Cancelar</button></div><p class="ge-erro" role="alert" hidden></p>';
    btn.hidden = true;
    art.appendChild(form);
    form.querySelector('.ge-den-cancelar').addEventListener('click', function () { form.remove(); btn.hidden = false; btn.focus(); });
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var escolhido = form.querySelector('input[name="motivo"]:checked');
      var erro = form.querySelector('.ge-erro');
      if (!escolhido) { erro.textContent = 'Escolha o motivo.'; erro.hidden = false; return; }
      try {
        await api('/api/grupos/mensagens/' + id + '/denuncia', { method: 'POST', body: { motivo: escolhido.value } });
        if (estado.msgs[id]) estado.msgs[id].denunciada = true;
        renderFeed();
      } catch (err) {
        erro.textContent = err.message;
        erro.hidden = false;
      }
    });
    var primeiro = form.querySelector('input');
    if (primeiro) primeiro.focus();
  }

  // ---------- Liberação ----------
  async function verificar() {
    if (estado.verificado || !window.Auth.isAuthenticated()) return;
    estado.verificado = true;
    try {
      estado.dados = await api('/api/grupos/meu');
    } catch (err) {
      return; // 404 = área desligada para esta conta: nada aparece
    }
    estado.ativo = true;
    window.UI.registrarTela(TELA, PATH, 'Grupo do curso');
    montarSecao();
    linkNoMenu();
    if (pathInicial === PATH) {
      pathInicial = null;
      window.showScreen(TELA, { replace: true });
    }
  }

  function init() {
    var original = window.showScreen;
    window.showScreen = function (id, options) {
      original(id, options);
      if (!window.Auth.isAuthenticated()) { if (estado.verificado) desmontar(); return; }
      if (id === TELA && estado.ativo) abrir();
      else parar();
      verificar();
    };
    document.addEventListener('submit', function (e) { if (e.target && e.target.id === 'ge-form') enviar(e); });
    document.addEventListener('input', function (e) { if (e.target && e.target.id === 'ge-texto') atualizarContador(); });
    document.addEventListener('keydown', function (e) {
      // Enter envia; Shift+Enter quebra a linha.
      if (e.target && e.target.id === 'ge-texto' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        var f = document.getElementById('ge-form');
        if (f) f.requestSubmit();
      }
    });
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ge-denunciar]');
      if (b) abrirDenuncia(Number(b.getAttribute('data-ge-denunciar')), b);
    });
    document.addEventListener('visibilitychange', function () {
      var sec = document.getElementById(TELA);
      if (document.visibilityState === 'visible' && sec && !sec.classList.contains('hidden')) carregarMensagens();
    });
  }

  // Antes do init do app.js (este script vem antes dele), para envolver window.showScreen a tempo.
  document.addEventListener('DOMContentLoaded', init);

  return { abrir: abrir };
})();
