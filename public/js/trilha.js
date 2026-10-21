/* Aula Inaugural (antiga Trilha "EaD Digital para Iniciantes"): programa único com 7 módulos.
   Cada módulo = capítulo(s) da aula + resumo + perguntas com pontos. Ordem livre (sugerida).
   Certificado de 4 horas: 7 módulos concluídos + meta de pontos (a regra vale no servidor).
   Conteúdo e progresso vêm de /api/trilha; a correção das respostas é feita no servidor.
   Só as preferências de leitura (letra maior, vídeo devagar, ver tudo) ficam no aparelho. */
window.Trilha = (function () {
  'use strict';

  var PREFS_KEY = 'csu-trilha-prefs';
  var C = null;            // conteúdo público
  var S = null;            // progresso do aluno
  var P = loadPrefs();
  var nome = '';
  var built = false;
  var loading = false;
  var lastXp = null;
  var root = null;
  var peek = {};           // níveis abertos por link (tutoriais, Meu Semestre) mesmo sem terminar o anterior
  var alvo = null;         // nível (0-based) para rolar quando a trilha terminar de montar
  var emitido = false;     // certificado já emitido (vem de /api/trilha/resumo)
  var querAulaCompleta = false; // pedido de "Assistir à aula completa" antes da tela montar

  var LOCK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" fill="none"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none"></path></svg>';
  // Card de conclusão (encerramento): medalha decorativa, check das pílulas e ícone de download.
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 12.5l4 4 8-9"/></svg>';
  var DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>';
  var MEDAL = (function () {
    var folhas = '';
    [118, 138, 158, 178, 198].forEach(function (a) {
      [a, 180 - a].forEach(function (g) {
        var r = g * Math.PI / 180, x = (60 + 28 * Math.cos(r)).toFixed(1), y = (56 + 28 * Math.sin(r)).toFixed(1);
        folhas += '<ellipse cx="' + x + '" cy="' + y + '" rx="5.2" ry="2.4" transform="rotate(' + (g + (g > 90 ? 60 : 120)) + ' ' + x + ' ' + y + ')"/>';
      });
    });
    return '<svg class="tc-medal" viewBox="0 0 120 132" aria-hidden="true" focusable="false"><defs>' +
      '<linearGradient id="tcmG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffeaa0"/><stop offset=".5" stop-color="#ffc72c"/><stop offset="1" stop-color="#e08a00"/></linearGradient>' +
      '<linearGradient id="tcmR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7b500"/><stop offset="1" stop-color="#c47400"/></linearGradient></defs>' +
      '<path d="M40 84 27 124l15-7 9 13 12-38zM80 84l13 40-15-7-9 13-12-38z" fill="url(#tcmR)"/>' +
      '<path d="M15 16l7 9M6 37l10 3M105 16l-7 9M114 37l-10 3" stroke="#ffc72c" stroke-width="3.2" stroke-linecap="round"/>' +
      '<circle cx="60" cy="56" r="43" fill="url(#tcmG)"/><circle cx="60" cy="56" r="43" fill="none" stroke="#b97300" stroke-opacity=".45" stroke-width="2"/>' +
      '<circle cx="60" cy="56" r="35" fill="none" stroke="#c98500" stroke-opacity=".5" stroke-width="1.6"/>' +
      '<g fill="#d99400">' + folhas + '</g>' +
      '<path d="M60 33l6.6 13.4 14.8 2.2-10.7 10.4 2.5 14.7L60 66.8l-13.2 6.9 2.5-14.7-10.7-10.4 14.8-2.2z" fill="#ffe27a" stroke="#c07c00" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  })();
  var HELP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20c0 1.5-2 2-5 2"/></svg>';

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(P)); } catch (e) { /* sem armazenamento: segue sem salvar */ }
  }
  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function smooth() {
    return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  }
  function $(sel) { return root ? root.querySelector(sel) : null; }

  // ---------- estado ----------

  function fromServer(prog) {
    var s = { done: {}, watched: {}, skipped: {}, pseen: {}, ans: {}, xp: prog.pontos || 0, tarefas: {} };
    prog.niveis.forEach(function (n, i) {
      if (n.concluido) s.done[i] = true;
      if (n.video_ok) s.watched[i] = true;
      if (n.pulou_video) s.skipped[i] = true;
      (n.partes_vistas || []).forEach(function (k) { s.pseen[i + '-' + k] = true; });
      Object.keys(n.respostas || {}).forEach(function (k) { s.ans[i + '-' + k] = n.respostas[k]; });
    });
    (prog.tarefas || []).forEach(function (t) { s.tarefas[t] = true; });
    return s;
  }

  function applyLevel(row) {
    var i = row.nivel - 1;
    S.done[i] = !!row.concluido;
    S.watched[i] = !!row.video_ok;
    S.skipped[i] = !!row.pulou_video;
    (row.partes_vistas || []).forEach(function (k) { S.pseen[i + '-' + k] = true; });
    Object.keys(row.respostas || {}).forEach(function (k) { S.ans[i + '-' + k] = row.respostas[k]; });
  }

  function post(acao, payload) {
    return window.Api.trilhaPost(acao, payload).then(function (res) {
      if (res && res.nivel) applyLevel(res.nivel);
      if (res && typeof res.pontos === 'number') S.xp = res.pontos;
      return res;
    }).catch(function (err) {
      if (err && err.status === 401) {
        window.Auth.clear();
        window.showScreen('login-page', { replace: true });
      }
      throw err;
    });
  }

  var L = function () { return C.niveis; };
  function doneCount() { return L().filter(function (_, i) { return S.done[i]; }).length; }
  // Ordem livre: todos os módulos ficam abertos; a ordem de cima para baixo é só a sugerida.
  function unlocked() { return true; }
  function num(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function meta() { return (C.certificado && C.certificado.meta) || C.pontos.meta || C.pontos.maximo; }
  // Pontuação simples: cada módulo concluído vale 10 pontos (7 módulos = 70 = meta).
  function pm() { return (C.pontos && C.pontos.modulo) || 10; }
  function horas() { return (C.certificado && C.certificado.horas) || 4; }
  function liberado() { return doneCount() >= L().length && S.xp >= meta(); }
  function currentIdx() { for (var i = 0; i < L().length; i++) if (!S.done[i]) return i; return L().length; }

  // ---------- topo, mapa, estado dos níveis ----------

  function hud() {
    var d = doneCount();
    var md = $('#tMedal');
    md.textContent = d; md.style.setProperty('--lv', d / L().length * 100);
    $('#tRank').textContent = d ? L()[d - 1].rank : 'Visitante';
    $('#tXpTxt').textContent = num(S.xp) + ' de ' + num(meta()) + ' pontos para o certificado';
    $('#tLvTxt').textContent = d + ' de ' + L().length + ' módulos';
    $('#tXpFill').style.width = Math.min(100, S.xp / meta() * 100) + '%';
    $('#tReview').setAttribute('aria-pressed', P.review ? 'true' : 'false');
    certStatus();
    if (lastXp !== null && S.xp > lastXp) {
      var h = $('#tHud');
      $('#tGain').textContent = '+' + (S.xp - lastXp);
      h.classList.remove('bump'); void h.offsetWidth; h.classList.add('bump');
    }
    lastXp = S.xp;
  }

  // Linha do certificado no placar e bloco de encerramento.
  function certStatus() {
    var tot = L().length;
    var d = doneCount();
    // Cada módulo vale 10 pontos: o que falta em módulos é o que falta em pontos.
    var faltam = Math.max(0, tot - d);
    var falta = (faltam === 1 ? 'Falta 1 módulo' : 'Faltam ' + faltam + ' módulos') + ' (' + num(faltam * pm()) + ' pontos).';
    var ok = liberado();
    var linha = $('#tCertTxt');
    if (linha) {
      linha.classList.toggle('is-ok', ok || emitido);
      linha.textContent = emitido
        ? 'Certificado já emitido. Pode gerar o PDF de novo no fim da página.'
        : ok
          ? 'Certificado de ' + horas() + ' horas liberado! Emita no fim da página.'
          : 'Certificado de ' + horas() + ' horas: conclua os ' + tot + ' módulos (' + num(meta()) + ' pontos). ' + falta;
    }
    var box = $('#tCert');
    if (!box) return;
    if (ok || emitido) {
      box.className = 'tcert tcert-ok';
      var ck = '<span class="tc-ck">' + CHECK + '</span>';
      var sub = !emitido ? 'Você concluiu todos os módulos. Seu certificado está liberado.'
        : ok ? 'Você concluiu todos os módulos e já emitiu o seu certificado. Pode gerar o PDF de novo quando quiser.'
          : 'Você já emitiu o seu certificado. Pode gerar o PDF de novo quando quiser.';
      box.innerHTML =
        '<div class="tc-in"><div class="tc-art"><span class="tc-medal-wrap">' + MEDAL + '</span><p class="tc-hrs">Certificado de <b>' + horas() + ' horas</b></p></div>' +
        '<div class="tc-body"><div class="tc-top"><span class="tc-k">Aula Inaugural concluída</span><span class="tc-badge">' + ck + (emitido ? 'Emitido' : 'Concluído') + '</span></div>' +
        '<h3 class="tc-h">Sua jornada começou com uma conquista!</h3><p class="tc-sub">' + sub + '</p>' +
        '<div class="tc-row"><ul class="tc-pills" aria-label="Seu resultado">' +
        '<li>' + (d >= tot ? ck : '') + d + ' de ' + tot + ' módulos</li>' +
        '<li>' + (S.xp >= meta() ? ck : '') + num(S.xp) + ' pontos</li></ul>' +
        '<div class="tc-acts"><button type="button" class="tc-btn" data-gerar-certificado>' + DOWNLOAD + '<span data-cert-txt>' + (emitido ? 'Gerar o PDF de novo' : 'Emitir meu certificado') + '</span></button>' +
        '<button type="button" class="tc-link" data-rever-modulos>Rever os módulos <span aria-hidden="true">→</span></button></div></div></div></div>';
    } else {
      box.className = 'tcert';
      box.innerHTML = LOCK + '<p><b>Certificado de ' + horas() + ' horas</b><br>Conclua os ' + tot + ' módulos (' + pm() + ' pontos cada, ' + num(meta()) + ' no total). ' + falta + '</p>';
    }
  }

  function map() {
    var m = $('#tMap'); m.innerHTML = '';
    var cur = currentIdx();
    m.style.setProperty('--p', Math.min(cur, L().length - 1) / (L().length - 1));
    L().forEach(function (l, i) {
      var li = document.createElement('li');
      var b = document.createElement('button'); b.type = 'button';
      var st = S.done[i] ? 'done' : (i === cur ? 'current' : (unlocked(i) ? 'open' : 'locked'));
      b.className = 'node ' + st;
      b.innerHTML = '<span class="dot">' + (S.done[i] ? '✓' : (i + 1)) + '</span><span class="nm">' + esc(l.short) + '</span>';
      b.setAttribute('aria-label', 'Módulo ' + (i + 1) + ': ' + l.t + (st === 'done' ? ' (concluído)' : ''));
      b.addEventListener('click', function () { if (unlocked(i)) document.getElementById('tlv' + i).scrollIntoView({ behavior: smooth() }); });
      li.appendChild(b); m.appendChild(li);
    });
  }

  function levelState(i) {
    var sec = document.getElementById('tlv' + i);
    if (!sec) return;
    var open = unlocked(i);
    sec.dataset.st = S.done[i] ? 'done' : open ? 'open' : 'locked';
    sec.dataset.w = S.watched[i] ? '1' : '0';
    sec.querySelector('.lvbody').hidden = !open;
    sec.querySelector('.lockpanel').hidden = open;
    var st = sec.querySelector('.state');
    st.className = 'state ' + (S.done[i] ? 's-done' : open ? 's-cur' : '');
    st.textContent = S.done[i] ? 'Concluído' : open ? 'Em andamento' : 'Bloqueado';
    sec.querySelector('.cleared').hidden = !S.done[i];
    var mOpen = P.review || S.watched[i] || S.skipped[i] || S.done[i];
    sec.querySelector('.mission').hidden = !mOpen;
    sec.querySelector('.gate').hidden = !!mOpen;
    sec.querySelector('.skip').hidden = !!mOpen;
    if (S.watched[i]) {
      var p = sec.querySelector('.vidbar .prog');
      p.className = 'prog seen';
      p.textContent = 'Vídeo assistido';
      sec.querySelector('.vmeter i').style.width = '100%';
    } else if (S.skipped[i] || S.done[i]) {
      sec.querySelector('.vidbar .prog').textContent = S.done[i] && !S.skipped[i]
        ? 'Módulo concluído.'
        : 'Você pulou o vídeo. Pode voltar a ele quando quiser.';
    }
  }

  function refreshUI() {
    hud(); map();
    L().forEach(function (_, i) { levelState(i); });
    todoCount();
  }

  // ---------- construção da tela ----------

  function shell() {
    var primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
    var h = '';
    h += '<div class="wrap">';
    h += '<header class="hero"><div class="hero-txt">';
    h += '<div class="eyebrow">' + (primeiro ? 'Olá, ' + esc(primeiro) + '! · ' : '') + 'Aula Inaugural · Graduação EaD</div>';
    h += '<h1>Aula <span class="hl">Inaugural</span></h1>';
    h += '<p class="lede">Tudo o que você precisa para começar, em ' + L().length + ' módulos curtos. Em cada um: assista ao capítulo da aula, leia o resumo e responda às perguntas. Pode errar à vontade: cada módulo concluído vale ' + pm() + ' pontos. Concluiu os ' + L().length + ' (' + num(meta()) + ' pontos)? Emita o certificado de ' + horas() + ' horas. O que você já fez fica salvo na sua conta.</p>';
    h += '<p class="lede lede-atalho">Já sabe algum assunto? Em cada módulo, toque em <b>Já sei isso</b> para ir direto às perguntas. Prefere ver tudo de uma vez? <button type="button" class="linkbtn lede-link" data-open-aula>Assistir à aula completa (sem pontos)</button></p>';
    h += '<ol class="how" aria-label="Em cada módulo"><li><span>1</span>Assista</li><li><span>2</span>Leia</li><li><span>3</span>Responda</li></ol>';
    h += '<div class="a11y" role="group" aria-label="Facilidades de leitura">';
    h += '<button class="chipbtn" id="tBig" type="button" aria-pressed="false">A+ Letra maior</button>';
    h += '<button class="chipbtn" id="tSlow" type="button" aria-pressed="false">Vídeos mais devagar</button></div>';
    h += '</div></header>';
    h += '<div data-apps-slot data-apps-variant="compacta" class="t-apps"></div>';

    h += '<div class="intro"><section class="start card" aria-labelledby="tStartTitle"><div class="cardhead"><div>';
    // Lista automática: cada item se marca sozinho pelo progresso real (módulos concluídos, certificado emitido).
    h += '<h2 id="tStartTitle">Sua primeira semana</h2>';
    h += '<p class="hint">Se marca sozinho conforme você avança nos módulos.</p></div>';
    h += '<span class="count" id="tTodoCount" aria-live="polite"></span></div><ul class="todo" id="tTodo">';
    C.tarefas.forEach(function (t, k) {
      h += '<li data-todo="' + k + '"><span class="tk" aria-hidden="true"></span><span class="tx">' + t.html + '<span class="sr"></span></span></li>';
    });
    h += '</ul></section>';
    h += '<aside class="help" aria-labelledby="tHelpTitle"><div class="hh">' + HELP_ICON + '<h2 id="tHelpTitle">Travou? Peça ajuda, é normal</h2></div>';
    C.ajuda.forEach(function (p) { h += '<p>' + p + '</p>'; });
    if (C.whatsapp_url) h += '<p><a class="tWa" href="' + esc(C.whatsapp_url) + '" target="_blank" rel="noopener">Chamar o setor acadêmico no WhatsApp</a></p>';
    h += '</aside></div>';

    h += '<div class="hud" id="tHud"><div class="in"><span class="medal" id="tMedal">0</span><span class="gain" id="tGain" aria-hidden="true"></span>';
    h += '<div class="hudmain"><div class="rank"><small>Sua conquista</small><b id="tRank">Visitante</b></div><div class="xpbar"><i id="tXpFill"></i></div>';
    h += '<div class="xpline"><span id="tXpTxt"></span><span id="tLvTxt"></span></div><p class="certline" id="tCertTxt" aria-live="polite"></p></div></div></div>';

    h += '<div class="trailhead" id="tModulos"><div><h2 class="sec-h" id="tModulosH" tabindex="-1">Seus módulos</h2><p class="hint">Faça na ordem que quiser. A ordem sugerida é de cima para baixo.</p></div>';
    h += '<div class="tools"><button class="chipbtn" id="tReview" type="button" aria-pressed="false">Ver tudo sem jogar</button>';
    h += '<button class="chipbtn" id="tReset" type="button">Começar de novo</button></div></div>';
    h += '<ol class="map" id="tMap" aria-label="Mapa dos módulos"></ol>';
    // Aula completa: todos os capítulos em sequência, sem pontos (os pontos vêm dos módulos).
    if (C.aula_completa && C.aula_completa.length) {
      var seg = C.aula_completa.reduce(function (n, c) { var p = String(c.duracao || '0:0').split(':'); return n + (Number(p[0]) * 60 + Number(p[1] || 0)); }, 0);
      h += '<details class="level tcaps-sec taula" id="tAulaCompleta"><summary><span class="lvbadge" aria-hidden="true">▶</span><span class="tt"><span class="lvnum">Sem pontos</span><b>Aula completa</b>' +
        '<small>' + C.aula_completa.length + ' capítulos em sequência' + (seg ? ' · ' + Math.round(seg / 60) + ' min' : '') + '. Para quem prefere ver tudo de uma vez.</small></span></summary>' +
        capsPlayer(C.aula_completa, 'tAc') + '</details>';
    }
    // Abertura (sem pontos), os 7 módulos e o encerramento com o certificado.
    if (C.abertura && C.abertura.length) {
      h += '<section class="level tcaps-sec" aria-labelledby="tAbertura"><div class="lvhead"><span class="lvbadge" aria-hidden="true">▶</span><div class="tt"><div class="lvmeta"><span class="lvnum">Abertura</span><span class="state">Sem pontos</span></div><h2 id="tAbertura">Boas-vindas</h2></div></div>' + capsPlayer(C.abertura, 'tAb') + '</section>';
    }
    h += '<div id="tLevels" class="levels"></div>';
    h += '<section class="level tcaps-sec tfinal" id="tFinal" data-cert-area aria-labelledby="tFinalH"><div class="lvhead"><span class="lvbadge" aria-hidden="true">★</span><div class="tt"><div class="lvmeta"><span class="lvnum">Encerramento</span></div><h2 id="tFinalH">Encerramento e certificado</h2></div></div>';
    if (C.encerramento && C.encerramento.length) h += capsPlayer(C.encerramento, 'tEn');
    h += '<div id="tCert" class="tcert"></div><div class="perr" data-cert-erro hidden></div>';
    h += '<p class="hint">Releia qualquer módulo quando quiser. Na dúvida, vale o que está no Manual do Aluno e no Calendário Acadêmico.</p></section>';

    // O antigo "Dicionário do aluno" virou explicação no próprio texto (public/js/glossario.js).
    h += '</div>';

    h += '<dialog class="lb" id="tLb" aria-label="Tela ampliada"><button class="lbclose" id="tLbClose" type="button">Fechar</button>';
    h += '<div class="lbin"><img id="tLbImg" alt=""><p class="lbcap" id="tLbCap"></p></div></dialog>';
    return h;
  }

  // Joinha pra cima / pra baixo no vídeo (public/js/avaliacao.js): 'modulo-N' ou 'boasvindas'.
  function avaliacao(id) {
    return window.Avaliacao ? window.Avaliacao.html('aula', id) : '';
  }

  // Player simples de capítulos sem pontos (abertura e encerramento): troca o vídeo pelo botão do capítulo.
  function capsPlayer(caps, id) {
    var h = '<div class="tcaps" data-caps="' + id + '"><div class="player"><video controls playsinline preload="metadata" poster="' + esc(caps[0].v) + '.jpg"><source src="' + esc(caps[0].v) + '.mp4" type="video/mp4"></video></div>';
    if (caps.length === 1 && id === 'tAb') {
      h += '<div class="tcaps-info"><b>' + esc(caps[0].t) + (caps[0].duracao ? ' · ' + esc(caps[0].duracao) : '') + '</b>' +
        '<p>Um recado rápido antes de começar: como funciona o estudo, os 7 módulos, os pontos e o certificado de ' + horas() + ' horas.</p>' +
        '<p class="hint">Não vale pontos. Pode pular, se quiser.</p></div>';
    }
    if (id === 'tAb') h += avaliacao('boasvindas');
    if (caps.length > 1) {
      h += '<div class="parts" role="group" aria-label="Capítulos">' + caps.map(function (c, k) {
        return '<button type="button" class="pbtn" data-cap-v="' + esc(c.v) + '" aria-pressed="' + (k ? 'false' : 'true') + '"><span class="pk">' + (k + 1) + '</span><span>' + esc(c.t) + (c.duracao ? ' · ' + esc(c.duracao) : '') + '</span></button>';
      }).join('') + '</div>';
    }
    return h + '</div>';
  }

  function bindCaps(box) {
    var v = box.querySelector('video');
    var btns = box.querySelectorAll('[data-cap-v]');
    btns.forEach(function (b, k) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var src = b.getAttribute('data-cap-v');
        v.querySelector('source').setAttribute('src', src + '.mp4'); v.poster = src + '.jpg'; v.load();
        var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
      });
    });
    // Terminou um capítulo: segue para o próximo, como a aula contínua.
    v.addEventListener('ended', function () {
      var atual = Array.prototype.findIndex.call(btns, function (x) { return x.getAttribute('aria-pressed') === 'true'; });
      if (atual > -1 && btns[atual + 1]) btns[atual + 1].click();
    });
  }

  function levelHtml(l, i) {
    var h = '<div class="lvhead"><span class="lvbadge" aria-hidden="true">' + (i + 1) + '</span><div class="tt"><div class="lvmeta"><span class="lvnum">Módulo ' + (i + 1) + '</span><span class="state"></span></div><h2>' + esc(l.t) + '</h2></div></div>';
    h += '<div class="lockpanel" hidden></div>';
    h += '<div class="lvbody">';
    // Vídeo e resumo ficam juntos: em tela larga aparecem lado a lado (ver trilha.css).
    h += '<div class="lvpair">';
    var capsTxt = l.capitulos && l.capitulos.length
      ? (l.capitulos.length > 1 ? 'Assista aos capítulos da aula' : 'Assista ao capítulo da aula')
      : 'Assista ao vídeo';
    h += '<div class="step s1"><div class="part"><span class="pn">1</span><span class="pt">' + capsTxt + '</span></div>';
    var vb = l.parts ? l.parts[0].v : l.video;
    h += '<div class="player"><video controls playsinline preload="metadata" poster="' + esc(vb) + '.jpg"><source src="' + esc(vb) + '.mp4" type="video/mp4"></video></div>';
    if (l.parts) {
      h += '<div class="parts" role="group" aria-label="Capítulos do módulo">' + l.parts.map(function (p, k) {
        return '<button type="button" class="pbtn" data-k="' + k + '" aria-pressed="' + (k ? 'false' : 'true') + '"><span class="pk">' + (k + 1) + '</span><span>' + esc(p.t) + '</span><span class="pok" aria-hidden="true">✓</span></button>';
      }).join('') + '</div>';
      h += '<div class="partnext" hidden><span class="pq"></span><button type="button" class="btn pgo"></button><button type="button" class="linkbtn pstuck">Travei nesta parte</button><p class="perr" hidden></p></div>';
    }
    h += '<div class="vmeter" aria-hidden="true"><i></i></div>';
    h += '<div class="vidbar"><span class="prog">Assista até o fim para liberar as perguntas.</span><button class="linkbtn skip" type="button">Já sei isso, quero ir direto para as perguntas</button>' +
      (l.parts ? '' : '<button class="linkbtn stuck1" type="button">Travei neste módulo</button>') + '</div>';
    if (!l.parts) h += '<p class="perr stuck1-msg" hidden>Sem problema! Leia o resumo, veja os vídeos curtos de como fazer ou toque em <b>Ajuda</b>, no topo da página, para falar com a equipe do seu polo.</p>';
    h += avaliacao('modulo-' + (i + 1));
    h += '</div>';
    // Coluna do resumo: tópicos curtos, regra em destaque e, fechado, tudo o que é para aprofundar.
    var topicos = l.topicos && l.topicos.length ? l.topicos : l.learn;
    h += '<div class="step s2"><div class="part"><span class="pn">2</span><span class="pt">Leia o resumo</span></div>';
    // Módulo 1 (Primeiro acesso): RGM e e-mail acadêmico do próprio aluno, quando o app tem (dados-acesso.js).
    if (i === 0) h += '<div data-dados-acesso-slot="faixa" data-dados-acesso-onde="modulo" hidden></div>';
    h += '<ul class="learn topicos">' + topicos.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
    if (l.formula) h += '<div class="formula">' + l.formula + '</div>';
    // O texto vai num <span>: a caixa é flex (ícone "!" + texto) e links/negritos soltos virariam colunas.
    if (l.tip) h += '<p class="tip"><span>' + l.tip + '</span></p>';
    h += '<div class="extras">';
    // Vídeos antigos do módulo (sem pontos): o "como fazer" mostrando as telas. Com passo_aberto, já vem aberto.
    var passo = l.passo_a_passo || [];
    if (passo.length) {
      var passoTit = passo.length > 1 ? 'Vídeos curtos: como fazer no portal (' + passo.length + ')' : 'Vídeo extra: veja como fazer, tela por tela';
      h += '<details class="more passo"' + (l.passo_aberto ? ' open' : '') + '><summary><span>' + passoTit + '<small>Opcional, não vale pontos</small></span></summary><div class="inner">' +
        (passo.length > 1 ? '<div class="parts" role="group" aria-label="Vídeos curtos">' + passo.map(function (p, k) {
          return '<button type="button" class="pbtn" data-passo-v="' + esc(p.v) + '" aria-pressed="' + (k ? 'false' : 'true') + '"><span class="pk">' + (k + 1) + '</span><span>' + esc(p.t) + '</span></button>';
        }).join('') + '</div>' : '') +
        '<div class="player"><video controls playsinline preload="none" poster="' + esc(passo[0].v) + '.jpg"><source src="' + esc(passo[0].v) + '.mp4" type="video/mp4"></video></div></div></details>';
    }
    if (l.topicos && l.topicos.length) {
      h += '<details class="more resumo-full"><summary>Ver resumo completo</summary><div class="inner"><ul class="learn">' + l.learn.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div></details>';
    }
    h += '<details class="more transcript-box"><summary>Ler a narração do vídeo</summary><div class="inner transcript"><p>Carregando…</p></div></details>';
    h += '<details class="more"><summary>Ver as telas em alta resolução (' + l.shots.length + ')</summary><div class="inner"><div class="shots' + (l.tallShots ? ' tall' : '') + '">' + l.shots.map(function (s) {
      var src = '/trilha-midia/telas/' + s.img + '.webp';
      return '<figure class="shot"><button type="button" data-src="' + src + '" aria-label="Ampliar tela"><img src="' + src + '" width="' + s.w + '" height="' + s.h + '" loading="lazy" alt=""></button><figcaption>' + s.cap + '</figcaption></figure>';
    }).join('') + '</div></div></details></div></div>';
    h += '</div>';
    h += '<div class="step s3"><div class="part"><span class="pn">3</span><span class="pt">Responda as perguntas</span><span class="pts">módulo vale ' + pm() + ' pontos</span></div><div class="gate">' + LOCK + '<span>As perguntas aparecem quando você terminar de assistir ao vídeo.</span></div><div class="mission"></div></div>';
    h += '<div class="cleared" hidden><span><b>Módulo concluído! +' + pm() + ' pontos</b><br>Sua conquista: ' + esc(l.rank) + '</span>' + (i < L().length - 1 ? '<button class="btn" type="button">Ir para o módulo ' + (i + 2) + '</button>' : '<button class="btn" type="button">Ir para o certificado</button>') + '</div></div>';
    return h;
  }

  function bindLevel(sec, l, i) {
    sec.querySelectorAll('.shot button').forEach(function (b) {
      b.addEventListener('click', function () { openLb(b.dataset.src, b.parentElement.querySelector('figcaption').innerHTML); });
    });
    sec.querySelectorAll('.shot img').forEach(function (im) { im.alt = im.closest('figure').querySelector('figcaption').textContent; });
    var nb = sec.querySelector('.cleared .btn');
    if (nb) nb.addEventListener('click', function () { (document.getElementById('tlv' + (i + 1)) || document.getElementById('tFinal')).scrollIntoView({ behavior: smooth() }); });
    // Passo a passo opcional (vídeos antigos do módulo, sem pontos)
    var pv = sec.querySelector('.passo video');
    sec.querySelectorAll('[data-passo-v]').forEach(function (b) {
      b.addEventListener('click', function () {
        sec.querySelectorAll('[data-passo-v]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var src = b.getAttribute('data-passo-v');
        pv.querySelector('source').setAttribute('src', src + '.mp4'); pv.poster = src + '.jpg'; pv.load();
        var pr = pv.play(); if (pr && pr.catch) pr.catch(function () {});
      });
    });
    var st1 = sec.querySelector('.stuck1');
    if (st1) st1.addEventListener('click', function () {
      sec.querySelector('.stuck1-msg').hidden = false; st1.hidden = true;
      post('travei', { nivel: i + 1, parte: 0 }).catch(function () {});
      window.Rastreio && window.Rastreio.track('trilha_travei', { nivel: i + 1, nivel_titulo: l.t, parte: 1, parte_titulo: l.t }, { importante: true });
    });
    var ms = sec.querySelector('.mission');
    l.qs.forEach(function (q, k) { ms.appendChild(question(i, k, q)); });

    var v = sec.querySelector('video');
    var prog = sec.querySelector('.vidbar .prog');
    var meter = sec.querySelector('.vmeter i');
    var tb = sec.querySelector('.transcript-box');
    var sending = {};

    function markSeen(parte) {
      var key = i + '-' + parte;
      if (S.pseen[key] || sending[key]) return;
      sending[key] = true;
      post('video', { nivel: i + 1, parte: parte }).then(function () {
        window.Rastreio && window.Rastreio.track('trilha_video_assistido', { nivel: i + 1, nivel_titulo: l.t, parte: l.parts ? parte + 1 : null, parte_titulo: l.parts ? l.parts[parte].t : null });
        refreshUI(); if (paintParts) paintParts();
      })
        .catch(function () { /* tenta de novo no próximo avanço do vídeo */ })
        .then(function () { sending[key] = false; });
    }

    var paintParts = null;
    if (l.parts) {
      var cur = 0; var pn = sec.querySelector('.partnext'); var last = l.parts.length - 1;
      tb.dataset.src = l.parts[0].v + '.txt';
      paintParts = function () {
        sec.querySelectorAll('.pbtn[data-k]').forEach(function (b, k) {
          b.setAttribute('aria-pressed', k === cur ? 'true' : 'false');
          b.classList.toggle('seen', !!S.pseen[i + '-' + k]);
        });
      };
      var go = function (k, play) {
        cur = k; var p = l.parts[k];
        v.querySelector('source').setAttribute('src', p.v + '.mp4'); v.poster = p.v + '.jpg'; v.load();
        if (play) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
        pn.hidden = true; tb.dataset.src = p.v + '.txt'; delete tb.dataset.loaded; tb.open = false; paintParts();
      };
      sec.querySelectorAll('.pbtn[data-k]').forEach(function (b) { b.addEventListener('click', function () { go(+b.dataset.k, true); }); });
      v.addEventListener('ended', function () {
        markSeen(cur); paintParts();
        pn.querySelector('.pq').textContent = cur < last ? 'Capítulo ' + (cur + 1) + ' de ' + l.parts.length + ' visto.' : 'Pronto! Você viu os ' + l.parts.length + ' capítulos.';
        pn.querySelector('.pgo').textContent = cur < last ? 'Ir para o capítulo ' + (cur + 2) : 'Ir para as perguntas';
        var e = pn.querySelector('.perr'); e.hidden = true; e.textContent = l.parts[cur].erro;
        pn.querySelector('.pstuck').hidden = false; pn.hidden = false;
      });
      pn.querySelector('.pgo').addEventListener('click', function () {
        if (cur < last) go(cur + 1, true);
        else { pn.hidden = true; sec.querySelector('.s3').scrollIntoView({ behavior: smooth() }); }
      });
      pn.querySelector('.pstuck').addEventListener('click', function () {
        pn.querySelector('.perr').hidden = false; pn.querySelector('.pstuck').hidden = true;
        post('travei', { nivel: i + 1, parte: cur }).catch(function () {});
        window.Rastreio && window.Rastreio.track('trilha_travei', { nivel: i + 1, nivel_titulo: l.t, parte: cur + 1, parte_titulo: l.parts[cur].t }, { importante: true });
      });
      v.addEventListener('timeupdate', function () {
        if (!v.duration) return;
        var pct = v.currentTime / v.duration;
        if (pct >= 0.9) markSeen(cur);
        var seen = l.parts.filter(function (_, k) { return S.pseen[i + '-' + k]; }).length;
        var all = (seen + (S.pseen[i + '-' + cur] ? 0 : pct)) / l.parts.length;
        if (!S.watched[i]) {
          prog.textContent = 'Capítulo ' + (cur + 1) + ' de ' + l.parts.length + '. Você já viu ' + Math.round(all * 100) + '% do módulo.';
          meter.style.width = Math.min(100, all * 100) + '%';
        }
      });
      paintParts();
    } else {
      tb.dataset.src = l.video + '.txt';
      v.addEventListener('timeupdate', function () {
        if (!v.duration) return;
        var pct = v.currentTime / v.duration;
        if (!S.watched[i]) {
          prog.textContent = 'Você já assistiu ' + Math.round(pct * 100) + '%. Falta pouco para liberar as perguntas.';
          meter.style.width = Math.min(100, pct * 100) + '%';
        }
        if (pct >= 0.9 && !S.watched[i]) markSeen(0);
      });
    }

    sec.querySelector('.skip').addEventListener('click', function () {
      S.skipped[i] = true; refreshUI();
      sec.querySelector('.mission').scrollIntoView({ block: 'nearest', behavior: smooth() });
      post('pular', { nivel: i + 1 }).catch(function () {});
      window.Rastreio && window.Rastreio.track('trilha_video_pulado', { nivel: i + 1, nivel_titulo: l.t });
    });

    tb.addEventListener('toggle', function () {
      if (!tb.open || tb.dataset.loaded) return; tb.dataset.loaded = '1';
      fetch(tb.dataset.src).then(function (r) { if (!r.ok) throw new Error(); return r.text(); }).then(function (t) {
        var cues = t.split(/\r?\n\r?\n/).map(function (b) {
          return b.split(/\r?\n/).filter(function (x) { return x && !/-->/.test(x) && x !== 'WEBVTT'; }).join(' ');
        }).filter(Boolean);
        var box = tb.querySelector('.transcript'); box.innerHTML = '';
        cues.forEach(function (c) { var p = document.createElement('p'); p.textContent = c; box.appendChild(p); });
      }).catch(function () { tb.querySelector('.transcript').textContent = 'Não foi possível carregar a narração.'; });
    });
  }

  function question(i, k, q) {
    var id = i + '-' + k;
    var d = document.createElement('div'); d.className = 'q';
    var fs = document.createElement('fieldset');
    var lg = document.createElement('legend');
    lg.appendChild(document.createTextNode(q.q)); fs.appendChild(lg);
    var opts = document.createElement('div'); opts.className = 'opts';
    var fb = document.createElement('p'); fb.className = 'fb'; fb.hidden = true;
    // ordem embaralhada fixa por pergunta, para a certa não cair sempre na mesma posição
    var order = q.opts.map(function (_, j) { return j; }); var seed = (i + 1) * 97 + (k + 1) * 13;
    for (var x = order.length - 1; x > 0; x--) {
      seed = (seed * 9301 + 49297) % 233280;
      var y = Math.floor(seed / 233280 * (x + 1));
      var tmp = order[x]; order[x] = order[y]; order[y] = tmp;
    }
    var btns = []; var pending = false;
    order.forEach(function (j) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'opt'; b.textContent = q.opts[j];
      b.addEventListener('click', function () { pick(j); });
      opts.appendChild(b); btns[j] = b;
    });
    function rec() { return S.ans[id] || { tries: [], ok: false }; }
    function paint() {
      var r = rec();
      r.tries.forEach(function (j) {
        if (!r.ok || j !== r.certa) { btns[j].classList.add('wrong'); btns[j].disabled = true; }
      });
      if (r.ok) {
        btns.forEach(function (b) { b.disabled = true; });
        btns[r.certa].classList.add('right');
        fb.className = 'fb ok'; fb.innerHTML = 'Certo!<span class="ex"></span>';
        fb.querySelector('.ex').textContent = r.exp || ''; fb.hidden = false;
      } else if (r.tries.length) {
        fb.className = 'fb no'; fb.textContent = 'Ainda não. Sem problema: escolha outra resposta. Errar não tira pontos.'; fb.hidden = false;
      }
    }
    function pick(j) {
      if (rec().ok || pending) return;
      pending = true; d.classList.add('live');
      btns.forEach(function (b) { b.disabled = true; });
      var eraConcluido = !!S.done[i];
      post('resposta', { nivel: i + 1, pergunta: k, opcao: j }).then(function () {
        pending = false;
        var r = rec();
        window.Rastreio && window.Rastreio.track('trilha_resposta', { nivel: i + 1, pergunta: q.q, resposta: q.opts[j], acertou: !!r.ok, tentativa: r.tries.length || 1 });
        if (!eraConcluido && S.done[i]) {
          window.Rastreio && window.Rastreio.track('trilha_nivel_concluido', { nivel: i + 1, nivel_titulo: L()[i].t, pontos_total: S.xp });
        }
        btns.forEach(function (b) { if (!b.classList.contains('wrong')) b.disabled = false; });
        paint(); refreshUI();
      }).catch(function () {
        pending = false;
        btns.forEach(function (b) { if (!b.classList.contains('wrong')) b.disabled = false; });
        fb.className = 'fb no'; fb.textContent = 'Não foi possível salvar sua resposta. Confira a internet e toque de novo.'; fb.hidden = false;
      });
    }
    fs.appendChild(opts); fs.appendChild(fb); d.appendChild(fs); paint();
    return d;
  }

  function openLb(src, cap) {
    $('#tLbImg').src = src; $('#tLbCap').innerHTML = cap;
    var lb = $('#tLb'); if (lb.showModal) lb.showModal(); else lb.setAttribute('open', '');
  }

  // Item feito = todos os módulos dele concluídos, ou o certificado já emitido.
  function todoFeito(t) {
    if (t.certificado) return emitido;
    var m = t.modulos || [];
    return m.length > 0 && m.every(function (n) { return S.done[n - 1]; });
  }
  function todoCount() {
    var lis = root.querySelectorAll('#tTodo [data-todo]');
    var n = 0;
    lis.forEach(function (li) {
      var ok = todoFeito(C.tarefas[li.dataset.todo]);
      if (ok) n++;
      li.classList.toggle('is-done', ok);
      li.querySelector('.sr').textContent = ok ? ' (feito)' : ' (a fazer)';
    });
    $('#tTodoCount').textContent = n + ' de ' + lis.length;
  }

  function applyPrefs() {
    root.classList.toggle('big', !!P.big);
    $('#tBig').setAttribute('aria-pressed', P.big ? 'true' : 'false');
    $('#tSlow').setAttribute('aria-pressed', P.slow ? 'true' : 'false');
    root.querySelectorAll('video').forEach(function (v) { v.playbackRate = P.slow ? 0.8 : 1; v.defaultPlaybackRate = P.slow ? 0.8 : 1; });
  }

  function build() {
    root.innerHTML = shell();
    if (window.Apps) window.Apps.render(root);
    var lv = $('#tLevels');
    if (window.DadosAcesso) setTimeout(function () { window.DadosAcesso.render(root); }, 0);
    L().forEach(function (l, i) {
      var sec = document.createElement('section'); sec.className = 'level'; sec.id = 'tlv' + i;
      sec.innerHTML = levelHtml(l, i);
      bindLevel(sec, l, i);
      lv.appendChild(sec);
    });
    root.querySelectorAll('[data-caps]').forEach(bindCaps);
    // Palavras do EaD (A2, AF, DP, RGM…): tocar na palavra sublinhada mostra o que ela quer dizer.
    if (window.Glossario) window.Glossario.marcar(root, C.glossario);
    // "Rever os módulos" (card de conclusão): volta para a lista de módulos.
    $('#tCert').addEventListener('click', function (e) {
      if (!e.target.closest('[data-rever-modulos]')) return;
      $('#tModulos').scrollIntoView({ behavior: smooth() });
      $('#tModulosH').focus({ preventScroll: true });
    });
    $('#tBig').addEventListener('click', function () { P.big = !P.big; savePrefs(); applyPrefs(); });
    $('#tSlow').addEventListener('click', function () { P.slow = !P.slow; savePrefs(); applyPrefs(); });
    $('#tReview').addEventListener('click', function () { P.review = !P.review; savePrefs(); refreshUI(); });
    var armed = null; var rs = $('#tReset');
    rs.addEventListener('click', function () {
      if (!armed) {
        rs.textContent = 'Tem certeza? Toque de novo';
        armed = setTimeout(function () { armed = null; rs.textContent = 'Começar de novo'; }, 4000);
        return;
      }
      clearTimeout(armed); armed = null; rs.textContent = 'Começar de novo';
      window.Api.trilhaPost('reiniciar', {}).then(function (res) {
        S = fromServer(res.progresso); lastXp = null; build(); window.scrollTo(0, 0);
      }).catch(function () { rs.textContent = 'Não deu certo. Tente de novo'; });
    });
    $('#tLbClose').addEventListener('click', function () { $('#tLb').close(); });
    $('#tLb').addEventListener('click', function (e) { if (e.target === $('#tLb') || e.target.classList.contains('lbin')) $('#tLb').close(); });
    root.addEventListener('loadedmetadata', function (e) { if (e.target.tagName === 'VIDEO') e.target.playbackRate = P.slow ? 0.8 : 1; }, true);
    applyPrefs();
    lastXp = null;
    refreshUI();
    built = true;
    irParaAlvo();
    if (querAulaCompleta) { querAulaCompleta = false; mostrarAulaCompleta(); }
  }

  // "Assistir à aula completa" (de qualquer tela): abre o bloco da aula completa nesta tela.
  function mostrarAulaCompleta() {
    var d = document.getElementById('tAulaCompleta');
    if (!d) return;
    d.open = true;
    setTimeout(function () {
      d.scrollIntoView({ behavior: 'instant', block: 'start' }); // sem animação (o html tem scroll-behavior: smooth)
      var s = d.querySelector('summary'); if (s) s.focus({ preventScroll: true });
    }, 200);
  }
  // A troca de tela recarrega e redesenha a aula: o pedido fica guardado até o próximo build()
  // (ou abre na hora, se não houver redesenho em seguida).
  function abrirAulaCompleta() {
    querAulaCompleta = true;
    window.showScreen('trilha-page');
    setTimeout(function () {
      if (!querAulaCompleta || loading) return;
      querAulaCompleta = false;
      if (built) mostrarAulaCompleta();
    }, 1500);
  }

  // ---------- link direto para um nível (/trilha#nivel-3) ----------

  function nivelDoHash() {
    var m = /^#nivel-(\d+)$/.exec(window.location.hash || '');
    return m ? Number(m[1]) : null;
  }

  function irParaAlvo() {
    if (alvo == null || !C || !L()[alvo]) return;
    var i = alvo; alvo = null;
    peek[i] = true; refreshUI();
    var sec = document.getElementById('tlv' + i);
    if (!sec) return;
    setTimeout(function () {
      sec.scrollIntoView({ behavior: smooth(), block: 'start' });
      sec.classList.add('is-target');
      setTimeout(function () { sec.classList.remove('is-target'); }, 2200);
    }, 60);
  }

  function openLevel(n) {
    n = Number(n);
    if (!n || n < 1) { window.showScreen('trilha-page'); return; }
    var lv = C && L()[n - 1];
    window.Rastreio && window.Rastreio.track('trilha_nivel_aberto', { nivel: n, nivel_titulo: lv ? lv.t : null });
    alvo = n - 1;
    window.showScreen('trilha-page');
    try { window.history.replaceState(window.history.state, '', '/trilha#nivel-' + n); } catch (e) { /* ignore */ }
    if (built) irParaAlvo();
  }

  // ---------- API pública ----------

  function refresh() {
    root = document.getElementById('trilha-root');
    if (!root || !window.Auth.isAuthenticated() || loading) return;
    var doHash = nivelDoHash();
    if (doHash) alvo = doHash - 1;
    loading = true;
    if (!built) root.innerHTML = '<p class="trilha-loading">Carregando a Aula Inaugural...</p>';
    if (built && alvo != null) irParaAlvo();
    window.Api.getTrilha().then(function (res) {
      C = res.conteudo; nome = res.nome || ''; S = fromServer(res.progresso);
      build();
      window.Api.getTrilhaResumo().then(function (r) {
        emitido = !!(r && r.certificado && r.certificado.emitido);
        if (built) { certStatus(); todoCount(); }
      }).catch(function () { /* sem o resumo, vale a regra de pontos */ });
    }).catch(function (err) {
      if (err && err.status === 401) {
        window.Auth.clear();
        window.showScreen('login-page', { replace: true });
        return;
      }
      if (err && err.status === 404) {
        document.body.classList.remove('trilha-on');
        window.showScreen('dashboard-page', { replace: true });
        return;
      }
      if (!built) root.innerHTML = '<p class="trilha-loading">Não foi possível carregar a Aula Inaugural. Confira a internet e tente de novo.</p>';
    }).then(function () { loading = false; });
  }

  // Início: o banner (window.Inicio) usa o progresso real para escolher frase e ação.
  function refreshDashboard() {
    if (!window.Inicio || !window.Auth.isAuthenticated() || !document.body.classList.contains('trilha-on')) return;
    window.Api.getTrilhaResumo().then(function (r) {
      window.Inicio.setTrilha(r);
    }).catch(function () {
      // Sem o progresso, o banner fica no estado "primeiros passos" (sem barra).
      window.Inicio.setTrilha(null);
    });
  }

  function pause() {
    var r = document.getElementById('trilha-root');
    if (r) r.querySelectorAll('video').forEach(function (v) { if (!v.paused) v.pause(); });
  }

  function init() {
    root = document.getElementById('trilha-root');
    // Qualquer botão com data-open-trilha="N" (tutoriais, Meu Semestre, painel) abre o nível N.
    document.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-open-trilha]');
      if (!btn) return;
      event.preventDefault();
      openLevel(btn.getAttribute('data-open-trilha'));
    });
  }

  return { init: init, refresh: refresh, refreshDashboard: refreshDashboard, pause: pause, openLevel: openLevel, abrirAulaCompleta: abrirAulaCompleta };
})();
