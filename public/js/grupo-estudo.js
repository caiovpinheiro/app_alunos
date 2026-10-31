/* Grupo de estudo do curso (docs/grupo-estudo.md).
   Área oculta: só existe se GET /api/grupos/meu responder 200 (GRUPO_ESTUDO_ATIVA_PARA). Aí o módulo
   registra a tela /grupo, monta a seção e põe "Grupo" no menu do topo. Com a flag desligada a API
   responde 404 e nada aparece.
   Tela pensada primeiro para o celular: faixa do grupo no topo, conversa em balões (agrupados por autor e
   por dia) e campo de escrever fixo embaixo. Cada mensagem passa pela moderação no servidor antes de
   aparecer: o autor vê "Verificando…" e depois publicada, não publicada (com a explicação) ou em análise.
   Denúncia pelo menu ⋯ da mensagem. Atualiza por polling a cada 5 s com a tela aberta e a aba visível. */
window.GrupoEstudo = (function () {
  'use strict';

  var TELA = 'grupo-page';
  var PATH = '/grupo';
  var INTERVALO = 5000;
  var CHAVE_BOAS_VINDAS = 'grupo_boas_vindas_ok';
  var pathInicial = String(window.location.pathname || '').replace(/\/+$/, '');

  var estado = novoEstado();
  function novoEstado() {
    return { verificado: false, ativo: false, dados: null, msgs: {}, cursor: null, timer: null, enviando: false, rolou: false, tmp: 0 };
  }

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function guardado(chave) {
    try { return window.localStorage.getItem(chave); } catch (e) { return null; }
  }
  function guardar(chave, valor) {
    try { window.localStorage.setItem(chave, valor); } catch (e) { /* modo privado: tudo bem */ }
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

  // ---------- Datas ----------
  function hora(iso) {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function dia(iso) {
    var d = new Date(iso);
    var hoje = new Date();
    var ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
    if (d.toDateString() === hoje.toDateString()) return 'Hoje';
    if (d.toDateString() === ontem.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  }
  function quando(iso) {
    var d = new Date(iso);
    return dia(iso).toLowerCase() === 'hoje' ? 'hoje às ' + hora(iso) : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' + hora(iso);
  }

  // Cor do avatar: sempre a mesma para o mesmo nome (4 tons da marca).
  function tom(nome) {
    var h = 0;
    String(nome || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return 'ge-av--' + (h % 4);
  }

  function icone(nome) {
    return '<i data-lucide="' + nome + '" aria-hidden="true"></i>';
  }

  // ---------- Montagem da tela (só depois de a API liberar) ----------
  function montarSecao() {
    if (document.getElementById(TELA)) return;
    var sec = document.createElement('section');
    sec.id = TELA;
    sec.className = 'hidden';
    sec.setAttribute('aria-hidden', 'true');
    var modelo = document.querySelector('#meu-semestre-page > header');
    if (modelo) sec.appendChild(modelo.cloneNode(true));
    var main = document.createElement('main');
    main.className = 'ge';
    main.id = 'ge-root';
    sec.appendChild(main);
    var sheet = document.createElement('dialog');
    sheet.className = 'ge-sheet';
    sheet.id = 'ge-sheet';
    sheet.setAttribute('aria-labelledby', 'ge-sheet-tit');
    sec.appendChild(sheet);
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
      a.textContent = 'Grupo';
      a.title = 'Grupo de estudo do seu curso';
      nav.appendChild(a);
    });
  }

  // No celular o menu do topo rola e "Grupo" fica fora da tela: o Início ganha uma entrada logo depois do banner.
  function entradaNoInicio() {
    var hero = document.querySelector('#dashboard-page .portal-hero');
    var d = estado.dados;
    if (!hero || !d || !d.grupo || document.getElementById('ge-entrada')) return;
    var a = document.createElement('a');
    a.id = 'ge-entrada';
    a.className = 'ge-entrada';
    a.href = PATH;
    a.setAttribute('data-go', TELA);
    a.innerHTML =
      '<span class="ge-entrada-ico">' + icone('users') + '</span>' +
      '<span class="ge-entrada-txt"><b>Grupo de ' + esc(d.grupo.nome) + '</b>' +
      '<span>Tire dúvidas e estude com ' + (d.grupo.membros > 1 ? (d.grupo.membros - 1) + (d.grupo.membros === 2 ? ' colega' : ' colegas') : 'a sua turma') + ' do seu curso</span></span>' +
      icone('chevron-right');
    hero.insertAdjacentElement('afterend', a);
    if (window.lucide) window.lucide.createIcons();
  }

  function desmontar() {
    parar();
    var entrada = document.getElementById('ge-entrada');
    if (entrada) entrada.remove();
    document.querySelectorAll('[data-grupo-nav]').forEach(function (a) { a.remove(); });
    var sec = document.getElementById(TELA);
    if (sec) sec.remove();
    estado = novoEstado();
  }

  // ---------- Desenho ----------
  function renderBase() {
    var root = document.getElementById('ge-root');
    if (!root) return;
    var d = estado.dados;
    if (!d.grupo) {
      root.innerHTML =
        '<div class="ge-bar"><div class="ge-bar-txt"><h1>Grupo do curso</h1><p>Seu grupo de estudo</p></div></div>' +
        '<div class="ge-feed"><div class="ge-intro">' +
          '<span class="ge-intro-ico">' + icone('users') + '</span>' +
          '<h2>Seu curso ainda não chegou ao portal</h2>' +
          '<p>Assim que ele aparecer no cadastro, você entra automaticamente no grupo da sua turma. Isso costuma levar até 2 dias úteis depois da matrícula.</p>' +
        '</div></div>';
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    var silenciado = d.eu.silenciado_ate;
    var max = d.max_texto || 500;
    root.innerHTML =
      '<div class="ge-bar">' +
        '<span class="ge-bar-ico">' + icone('users') + '</span>' +
        '<div class="ge-bar-txt">' +
          '<h1>' + esc(d.grupo.nome) + '</h1>' +
          '<p>' + d.grupo.membros + (d.grupo.membros === 1 ? ' colega' : ' colegas') + ' · você é <b>' + esc(d.eu.nome) + '</b></p>' +
        '</div>' +
        '<button type="button" class="ge-bar-btn" id="ge-regras-btn" aria-expanded="false" aria-controls="ge-regras">' + icone('shield-check') + '<span>Regras</span></button>' +
      '</div>' +
      '<div class="ge-regras" id="ge-regras" hidden>' +
        '<p class="ge-regras-tit">Toda mensagem passa por um moderador antes de aparecer.</p>' +
        '<ul>' + d.regras.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
      '</div>' +
      '<div class="ge-feed" id="ge-feed" role="log" aria-live="polite" aria-label="Conversa do grupo"><p class="ge-carregando">Carregando a conversa…</p></div>' +
      (silenciado
        ? '<div class="ge-pausa" role="status">' + icone('clock') + '<p>A equipe pausou seus envios até ' + esc(quando(silenciado)) + '. Você continua podendo ler.</p></div>'
        : '<form class="ge-compor" id="ge-form" novalidate>' +
            '<label for="ge-texto" class="ge-sr">Mensagem para o grupo</label>' +
            '<div class="ge-campo">' +
              '<textarea id="ge-texto" rows="1" maxlength="' + max + '" placeholder="Mensagem para a turma" enterkeyhint="send"></textarea>' +
              '<span class="ge-cont" id="ge-cont" hidden></span>' +
            '</div>' +
            '<button type="submit" class="ge-enviar" id="ge-enviar" aria-label="Enviar">' + icone('send-horizontal') + '</button>' +
            '<p class="ge-erro" id="ge-erro" role="alert" hidden></p>' +
          '</form>');
    if (window.lucide) window.lucide.createIcons();
  }

  function boasVindasHtml() {
    var d = estado.dados;
    return '<div class="ge-intro">' +
      '<span class="ge-intro-ico">' + icone('users') + '</span>' +
      '<h2>Bem-vindo(a) ao grupo de ' + esc(d.grupo.nome) + '</h2>' +
      '<p>Um espaço para tirar dúvidas e estudar com a sua turma, sem precisar sair do portal.</p>' +
      '<ul class="ge-intro-regras">' +
        '<li>' + icone('book-open') + '<span>Dúvidas, dicas, resumos e combinados de estudo.</span></li>' +
        '<li>' + icone('ban') + '<span>Prova, gabarito, cola e trabalho pronto não entram: isso pode anular a sua prova.</span></li>' +
        '<li>' + icone('lock') + '<span>Sem telefone, e-mail ou @: aqui você aparece só como <b>' + esc(d.eu.nome) + '</b></span></li>' +
      '</ul>' +
      '<button type="button" class="ge-intro-ok" data-ge-boas-vindas>Entendi</button>' +
    '</div>';
  }

  function vazioHtml() {
    return '<div class="ge-intro ge-intro--vazio">' +
      '<h2>Ninguém escreveu ainda</h2>' +
      '<p>Que tal começar? Toque numa ideia:</p>' +
      '<div class="ge-ideias">' +
        '<button type="button" data-ge-ideia="Oi, turma! Em que matéria vocês estão agora?">Em que matéria vocês estão?</button>' +
        '<button type="button" data-ge-ideia="Alguém quer combinar de estudar junto esta semana?">Combinar de estudar junto</button>' +
        '<button type="button" data-ge-ideia="Estou com uma dúvida: ">Postar uma dúvida</button>' +
      '</div></div>';
  }

  function statusHtml(m) {
    if (m.status === 'enviando') {
      return '<p class="ge-st ge-st--verif">' + icone('shield') + '<span>Verificando…</span></p>';
    }
    if (!m.minha || m.status === 'publicada') return '';
    var tit = m.status === 'retida' ? 'Em análise' : m.status === 'removida' ? 'Removida pela equipe' : 'Não publicada';
    return '<div class="ge-st ge-st--' + m.status + '">' +
      '<p class="ge-st-tit">' + icone(m.status === 'retida' ? 'clock' : 'shield-alert') + '<span>' + tit + '</span><span class="ge-st-so">só você vê</span></p>' +
      '<p class="ge-st-exp">' + esc(m.explicacao) + '</p></div>';
  }

  function msgHtml(m, anterior) {
    var mesmoAutor = anterior && anterior.minha === m.minha && anterior.autor === m.autor && dia(anterior.criado_em) === dia(m.criado_em) &&
      (new Date(m.criado_em) - new Date(anterior.criado_em)) < 10 * 60 * 1000;
    var classes = 'ge-msg' + (m.minha ? ' ge-msg--minha' : '') + ' ge-msg--' + m.status + (mesmoAutor ? ' ge-msg--seq' : '');
    var nome = m.minha ? '' : (mesmoAutor ? '' : '<p class="ge-autor">' + esc(m.autor) + '</p>');
    var avatar = m.minha ? '' : (mesmoAutor ? '<span class="ge-av ge-av--vazio" aria-hidden="true"></span>'
      : '<span class="ge-av ' + tom(m.autor) + '" aria-hidden="true">' + esc(String(m.autor || '?').charAt(0)) + '</span>');
    var menu = (!m.minha && m.status === 'publicada')
      ? (m.denunciada
        ? '<span class="ge-den-ok" title="Você denunciou esta mensagem">' + icone('flag') + '<span class="ge-sr">Você denunciou esta mensagem</span></span>'
        : '<button type="button" class="ge-mais" data-ge-mais="' + m.id + '" aria-label="Opções da mensagem de ' + esc(m.autor) + '">' + icone('ellipsis-vertical') + '</button>')
      : '';
    return '<article class="' + classes + '" data-id="' + esc(m.id) + '">' + avatar +
      '<div class="ge-bolha">' + nome +
        '<p class="ge-texto">' + esc(m.texto) + '<time class="ge-hora" datetime="' + esc(m.criado_em) + '">' + esc(hora(m.criado_em)) + '</time></p>' +
        statusHtml(m) +
      '</div>' + menu + '</article>';
  }

  function renderFeed() {
    var feed = document.getElementById('ge-feed');
    if (!feed) return;
    var pertoDoFim = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
    var lista = Object.keys(estado.msgs).map(function (k) { return estado.msgs[k]; }).sort(function (a, b) {
      return (a.ordem || a.id) - (b.ordem || b.id);
    });
    var html = guardado(CHAVE_BOAS_VINDAS) ? '' : boasVindasHtml();
    var diaAtual = null;
    var anterior = null;
    lista.forEach(function (m) {
      var dd = dia(m.criado_em);
      if (dd !== diaAtual) {
        html += '<p class="ge-dia"><span>' + esc(dd) + '</span></p>';
        diaAtual = dd;
        anterior = null;
      }
      html += msgHtml(m, anterior);
      anterior = m;
    });
    if (!lista.length) html += vazioHtml();
    feed.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
    if (pertoDoFim || !estado.rolou) { feed.scrollTop = feed.scrollHeight; estado.rolou = true; }
  }

  // Devolve true só se algo mudou de fato (o cursor tem 2 s de folga e repete mensagens já vistas).
  function aplicar(mensagens) {
    var mudou = false;
    (mensagens || []).forEach(function (m) {
      if (m.oculta) {
        if (estado.msgs[m.id]) { delete estado.msgs[m.id]; mudou = true; }
        return;
      }
      var antes = estado.msgs[m.id];
      if (!antes || JSON.stringify(antes) !== JSON.stringify(m)) { estado.msgs[m.id] = m; mudou = true; }
    });
    return mudou;
  }

  // ---------- Dados ----------
  async function carregarMensagens() {
    try {
      var r = await api('/api/grupos/meu/mensagens' + (estado.cursor ? '?desde=' + encodeURIComponent(estado.cursor) : ''));
      var primeira = !estado.cursor;
      var mudou = aplicar(r.mensagens);
      estado.cursor = r.cursor || estado.cursor;
      if (primeira || mudou) renderFeed();
    } catch (err) {
      if (err.status === 404 || err.status === 401) { desmontar(); return; }
      var feed = document.getElementById('ge-feed');
      if (feed && !Object.keys(estado.msgs).length) feed.innerHTML = '<p class="ge-erro ge-erro--feed">' + esc(err.message) + '</p>';
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

  // ---------- Envio ----------
  function ajustarCampo() {
    var campo = document.getElementById('ge-texto');
    var cont = document.getElementById('ge-cont');
    if (!campo) return;
    campo.style.height = 'auto';
    campo.style.height = Math.min(campo.scrollHeight, 132) + 'px';
    if (cont) {
      var resta = campo.maxLength - campo.value.length;
      cont.hidden = resta > 80;
      cont.textContent = resta;
    }
  }

  async function enviar(ev) {
    ev.preventDefault();
    if (estado.enviando) return;
    var campo = document.getElementById('ge-texto');
    var btn = document.getElementById('ge-enviar');
    var erro = document.getElementById('ge-erro');
    var texto = campo.value.trim();
    erro.hidden = true;
    if (!texto) { campo.focus(); return; }
    estado.enviando = true;
    btn.disabled = true;
    // Balão provisório "Verificando…" enquanto o moderador decide.
    var tmpId = 'tmp-' + (++estado.tmp);
    estado.msgs[tmpId] = { id: tmpId, ordem: Number.MAX_SAFE_INTEGER, minha: true, autor: estado.dados.eu.nome, texto: texto, criado_em: new Date().toISOString(), status: 'enviando' };
    campo.value = '';
    ajustarCampo();
    estado.rolou = false;
    renderFeed();
    try {
      var r = await api('/api/grupos/meu/mensagens', { method: 'POST', body: { texto: texto } });
      delete estado.msgs[tmpId];
      aplicar([r.mensagem]);
      estado.rolou = false;
      renderFeed();
    } catch (err) {
      delete estado.msgs[tmpId];
      renderFeed();
      if (err.status === 404) { desmontar(); return; }
      if (!campo.value) { campo.value = texto; ajustarCampo(); }
      erro.textContent = err.message;
      erro.hidden = false;
    } finally {
      estado.enviando = false;
      btn.disabled = false;
      if (window.matchMedia && !window.matchMedia('(pointer: coarse)').matches) campo.focus();
    }
  }

  // ---------- Denúncia (folha que sobe de baixo) ----------
  function abrirDenuncia(id) {
    var m = estado.msgs[id];
    var sheet = document.getElementById('ge-sheet');
    if (!m || !sheet) return;
    var motivos = (estado.dados && estado.dados.motivos_denuncia) || {};
    sheet.innerHTML =
      '<form method="dialog" class="ge-sheet-in" id="ge-den-form">' +
        '<div class="ge-sheet-topo"><h2 id="ge-sheet-tit">Denunciar mensagem</h2>' +
          '<button type="button" class="ge-sheet-x" data-ge-fechar aria-label="Fechar">' + icone('x') + '</button></div>' +
        '<blockquote class="ge-sheet-cit"><b>' + esc(m.autor) + '</b>' + esc(m.texto) + '</blockquote>' +
        '<fieldset><legend>O que há de errado?</legend>' +
          Object.keys(motivos).map(function (k) {
            return '<label class="ge-opcao"><input type="radio" name="motivo" value="' + esc(k) + '"><span>' + esc(motivos[k]) + '</span></label>';
          }).join('') +
        '</fieldset>' +
        '<p class="ge-sheet-nota">A equipe analisa e quem escreveu não fica sabendo quem denunciou.</p>' +
        '<p class="ge-erro" role="alert" hidden></p>' +
        '<button type="submit" class="ge-sheet-ok">Enviar denúncia</button>' +
      '</form>';
    if (window.lucide) window.lucide.createIcons();
    var form = sheet.querySelector('form');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var escolhido = form.querySelector('input[name="motivo"]:checked');
      var erro = form.querySelector('.ge-erro');
      if (!escolhido) { erro.textContent = 'Escolha o que há de errado.'; erro.hidden = false; return; }
      var ok = form.querySelector('.ge-sheet-ok');
      ok.disabled = true;
      try {
        await api('/api/grupos/mensagens/' + id + '/denuncia', { method: 'POST', body: { motivo: escolhido.value } });
        if (estado.msgs[id]) estado.msgs[id].denunciada = true;
        form.innerHTML =
          '<div class="ge-sheet-feito">' + icone('check') + '<h2 id="ge-sheet-tit">Obrigado por avisar</h2>' +
          '<p>A equipe vai olhar essa mensagem. Se ela quebrar as regras, sai do grupo.</p>' +
          '<button type="button" class="ge-sheet-ok" data-ge-fechar>Voltar à conversa</button></div>';
        if (window.lucide) window.lucide.createIcons();
        renderFeed();
      } catch (err) {
        ok.disabled = false;
        erro.textContent = err.message;
        erro.hidden = false;
      }
    });
    if (typeof sheet.showModal === 'function') sheet.showModal(); else sheet.setAttribute('open', '');
  }

  function fecharSheet() {
    var sheet = document.getElementById('ge-sheet');
    if (sheet && sheet.open) { if (typeof sheet.close === 'function') sheet.close(); else sheet.removeAttribute('open'); }
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
    entradaNoInicio();
    if (pathInicial === PATH) {
      pathInicial = null;
      window.showScreen(TELA, { replace: true });
    }
  }

  function init() {
    var original = window.showScreen;
    window.showScreen = function (id, options) {
      original(id, options);
      document.body.classList.toggle('ge-on', id === TELA && estado.ativo);
      if (!window.Auth.isAuthenticated()) { if (estado.verificado) desmontar(); return; }
      if (id === TELA && estado.ativo) abrir();
      else parar();
      verificar();
    };
    document.addEventListener('submit', function (e) { if (e.target && e.target.id === 'ge-form') enviar(e); });
    document.addEventListener('input', function (e) { if (e.target && e.target.id === 'ge-texto') ajustarCampo(); });
    document.addEventListener('keydown', function (e) {
      // No computador, Enter envia e Shift+Enter quebra a linha. No celular, Enter quebra a linha (envia pelo botão).
      if (e.target && e.target.id === 'ge-texto' && e.key === 'Enter' && !e.shiftKey && !e.isComposing &&
          !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) {
        e.preventDefault();
        var f = document.getElementById('ge-form');
        if (f) f.requestSubmit();
      }
    });
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ge-mais]');
      if (b) { abrirDenuncia(b.getAttribute('data-ge-mais')); return; }
      if (e.target.closest('[data-ge-fechar]')) { fecharSheet(); return; }
      var sheet = document.getElementById('ge-sheet');
      if (sheet && e.target === sheet) { fecharSheet(); return; } // toque fora da folha
      if (e.target.closest('[data-ge-boas-vindas]')) { guardar(CHAVE_BOAS_VINDAS, '1'); renderFeed(); return; }
      var ideia = e.target.closest('[data-ge-ideia]');
      if (ideia) {
        var campo = document.getElementById('ge-texto');
        if (campo) { campo.value = ideia.getAttribute('data-ge-ideia'); ajustarCampo(); campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
        return;
      }
      var rb = e.target.closest('#ge-regras-btn');
      if (rb) {
        var painel = document.getElementById('ge-regras');
        var abrirRegras = painel.hidden;
        painel.hidden = !abrirRegras;
        rb.setAttribute('aria-expanded', String(abrirRegras));
      }
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
