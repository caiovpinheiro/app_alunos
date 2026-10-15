/* Trilha "EaD Digital para Iniciantes": 7 níveis com vídeo, resumo e perguntas.
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

  var LOCK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" fill="none"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none"></path></svg>';
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
  function unlocked(i) { return !!P.review || !!peek[i] || i === 0 || !!S.done[i - 1]; }
  function currentIdx() { for (var i = 0; i < L().length; i++) if (!S.done[i]) return i; return L().length; }

  // ---------- topo, mapa, estado dos níveis ----------

  function hud() {
    var d = doneCount();
    var md = $('#tMedal');
    md.textContent = d; md.style.setProperty('--lv', d / L().length * 100);
    $('#tRank').textContent = d ? L()[d - 1].rank : 'Visitante';
    $('#tXpTxt').textContent = S.xp + ' de ' + C.pontos.maximo + ' pontos';
    $('#tLvTxt').textContent = d + ' de ' + L().length + ' níveis';
    $('#tXpFill').style.width = (S.xp / C.pontos.maximo * 100) + '%';
    $('#tReview').setAttribute('aria-pressed', P.review ? 'true' : 'false');
    var fin = $('#tFinal');
    fin.hidden = d < L().length;
    $('#tFinalTxt').textContent = 'Você fez ' + S.xp + ' de ' + C.pontos.maximo + ' pontos nos ' + L().length + ' níveis.';
    if (lastXp !== null && S.xp > lastXp) {
      var h = $('#tHud');
      $('#tGain').textContent = '+' + (S.xp - lastXp);
      h.classList.remove('bump'); void h.offsetWidth; h.classList.add('bump');
    }
    lastXp = S.xp;
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
      b.setAttribute('aria-label', 'Nível ' + (i + 1) + ': ' + l.t + (st === 'locked' ? ' (bloqueado)' : st === 'done' ? ' (concluído)' : ''));
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
      p.textContent = 'Vídeo assistido · você ganhou ' + C.pontos.video + ' pontos';
      sec.querySelector('.vmeter i').style.width = '100%';
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
    h += '<div class="eyebrow">' + (primeiro ? 'Olá, ' + esc(primeiro) + '! · ' : '') + 'Graduação EaD Digital</div>';
    h += '<h1>EaD Digital para <span class="hl">Iniciantes</span></h1>';
    h += '<p class="lede">Aqui você aprende, passo a passo, a usar tudo o que precisa no curso. São ' + L().length + ' partes. Em cada uma: assista ao vídeo, leia o resumo e responda as perguntas. Pode errar à vontade. O que você já fez fica salvo na sua conta: dá para continuar no celular ou no computador.</p>';
    h += '<ol class="how" aria-label="Em cada nível"><li><span>1</span>Assista</li><li><span>2</span>Leia</li><li><span>3</span>Responda</li></ol>';
    h += '<div class="a11y" role="group" aria-label="Facilidades de leitura">';
    h += '<button class="chipbtn" id="tBig" type="button" aria-pressed="false">A+ Letra maior</button>';
    h += '<button class="chipbtn" id="tSlow" type="button" aria-pressed="false">Vídeos mais devagar</button></div>';
    h += '</div></header>';

    h += '<div class="intro"><section class="start card" aria-labelledby="tStartTitle"><div class="cardhead"><div>';
    h += '<h2 id="tStartTitle">Comece por aqui: ' + C.tarefas.length + ' tarefas da primeira semana</h2>';
    h += '<p class="hint">Marque cada uma quando terminar. Se não souber fazer, o nível indicado ensina.</p></div>';
    h += '<span class="count" id="tTodoCount" aria-live="polite"></span></div><ul class="todo" id="tTodo">';
    C.tarefas.forEach(function (t) {
      h += '<li><label><input type="checkbox" data-tarefa="' + esc(t.id) + '"> <span>' + t.html + '</span></label></li>';
    });
    h += '</ul></section>';
    h += '<aside class="help" aria-labelledby="tHelpTitle"><div class="hh">' + HELP_ICON + '<h2 id="tHelpTitle">Travou? Peça ajuda, é normal</h2></div>';
    C.ajuda.forEach(function (p) { h += '<p>' + p + '</p>'; });
    if (C.whatsapp_url) h += '<p><a class="tWa" href="' + esc(C.whatsapp_url) + '" target="_blank" rel="noopener">Chamar o setor acadêmico no WhatsApp</a></p>';
    h += '</aside></div>';

    h += '<div class="hud" id="tHud"><div class="in"><span class="medal" id="tMedal">0</span><span class="gain" id="tGain" aria-hidden="true"></span>';
    h += '<div class="hudmain"><div class="rank"><small>Sua conquista</small><b id="tRank">Visitante</b></div><div class="xpbar"><i id="tXpFill"></i></div>';
    h += '<div class="xpline"><span id="tXpTxt"></span><span id="tLvTxt"></span></div></div></div></div>';

    h += '<div class="trailhead"><div><h2 class="sec-h">Sua trilha</h2><p class="hint">Toque em um nível aberto para ir até ele.</p></div>';
    h += '<div class="tools"><button class="chipbtn" id="tReview" type="button" aria-pressed="false">Ver tudo sem jogar</button>';
    h += '<button class="chipbtn" id="tReset" type="button">Começar de novo</button></div></div>';
    h += '<ol class="map" id="tMap" aria-label="Mapa de níveis"></ol><div id="tLevels" class="levels"></div>';

    h += '<div class="final" id="tFinal" hidden><div class="eyebrow" style="color:inherit">Trilha concluída</div><h2>Você é Formando!</h2><p id="tFinalTxt"></p>';
    h += '<p>Releia qualquer nível quando quiser. Na dúvida, vale o que está no Manual do Aluno e no Calendário Acadêmico.</p></div>';

    h += '<section class="glos card" aria-labelledby="tGlosTitle"><h2 id="tGlosTitle">Dicionário do aluno: o que quer dizer cada palavra</h2><dl>';
    C.glossario.forEach(function (g) { h += '<div><dt>' + g[0] + '</dt><dd>' + g[1] + '</dd></div>'; });
    h += '</dl></section></div>';

    h += '<dialog class="lb" id="tLb" aria-label="Tela ampliada"><button class="lbclose" id="tLbClose" type="button">Fechar</button>';
    h += '<div class="lbin"><img id="tLbImg" alt=""><p class="lbcap" id="tLbCap"></p></div></dialog>';
    return h;
  }

  function levelHtml(l, i) {
    var h = '<div class="lvhead"><span class="lvbadge" aria-hidden="true">' + (i + 1) + '</span><div class="tt"><div class="lvmeta"><span class="lvnum">Nível ' + (i + 1) + '</span><span class="state"></span></div><h2>' + esc(l.t) + '</h2></div></div>';
    h += '<div class="lockpanel">' + LOCK + '<span>Termine o nível ' + i + ' para abrir este. Ou toque em Ver tudo sem jogar, mais acima.</span></div>';
    h += '<div class="lvbody">';
    h += '<div class="step s1"><div class="part"><span class="pn">1</span><span class="pt">Assista ao vídeo</span><span class="pts">vale ' + C.pontos.video + ' pontos</span></div>';
    var vb = l.parts ? l.parts[0].v : l.video;
    h += '<div class="player"><video controls playsinline preload="metadata" poster="' + esc(vb) + '.jpg"><source src="' + esc(vb) + '.mp4" type="video/mp4"></video></div>';
    if (l.parts) {
      h += '<div class="parts" role="group" aria-label="Partes do vídeo">' + l.parts.map(function (p, k) {
        return '<button type="button" class="pbtn" data-k="' + k + '" aria-pressed="' + (k ? 'false' : 'true') + '"><span class="pk">' + (k + 1) + '</span><span>' + esc(p.t) + '</span><span class="pok" aria-hidden="true">✓</span></button>';
      }).join('') + '</div>';
      h += '<div class="partnext" hidden><span class="pq"></span><button type="button" class="btn pgo"></button><button type="button" class="linkbtn pstuck">Travei nesta parte</button><p class="perr" hidden></p></div>';
    }
    h += '<div class="vmeter" aria-hidden="true"><i></i></div>';
    h += '<div class="vidbar"><span class="prog">Assista até o fim para liberar as perguntas.</span><button class="linkbtn skip" type="button">Já sei isso, quero ir direto para as perguntas</button></div>';
    h += '<details class="more transcript-box"><summary>Ler a narração do vídeo</summary><div class="inner transcript"><p>Carregando…</p></div></details></div>';
    h += '<div class="step s2"><div class="part"><span class="pn">2</span><span class="pt">Leia o resumo</span></div><ul class="learn">' + l.learn.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
    if (l.formula) h += '<div class="formula">' + l.formula + '</div>';
    if (l.tip) h += '<p class="tip">' + l.tip + '</p>';
    h += '<details class="more"><summary>Ver as telas em alta resolução (' + l.shots.length + ')</summary><div class="inner"><div class="shots' + (l.tallShots ? ' tall' : '') + '">' + l.shots.map(function (s) {
      var src = '/trilha-midia/telas/' + s.img + '.webp';
      return '<figure class="shot"><button type="button" data-src="' + src + '" aria-label="Ampliar tela"><img src="' + src + '" width="' + s.w + '" height="' + s.h + '" loading="lazy" alt=""></button><figcaption>' + s.cap + '</figcaption></figure>';
    }).join('') + '</div></div></details></div>';
    h += '<div class="step s3"><div class="part"><span class="pn">3</span><span class="pt">Responda as perguntas</span><span class="pts">vale ' + l.qs.length * C.pontos.certa_1a + ' pontos</span></div><div class="gate">' + LOCK + '<span>As perguntas aparecem quando você terminar de assistir ao vídeo.</span></div><div class="mission"></div></div>';
    h += '<div class="cleared" hidden><span><b>Nível concluído!</b><br>Sua conquista: ' + esc(l.rank) + '</span>' + (i < L().length - 1 ? '<button class="btn" type="button">Ir para o nível ' + (i + 2) + '</button>' : '') + '</div></div>';
    return h;
  }

  function bindLevel(sec, l, i) {
    sec.querySelectorAll('.shot button').forEach(function (b) {
      b.addEventListener('click', function () { openLb(b.dataset.src, b.parentElement.querySelector('figcaption').innerHTML); });
    });
    sec.querySelectorAll('.shot img').forEach(function (im) { im.alt = im.closest('figure').querySelector('figcaption').textContent; });
    var nb = sec.querySelector('.cleared .btn');
    if (nb) nb.addEventListener('click', function () { document.getElementById('tlv' + (i + 1)).scrollIntoView({ behavior: smooth() }); });
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
      post('video', { nivel: i + 1, parte: parte }).then(function () { refreshUI(); if (paintParts) paintParts(); })
        .catch(function () { /* tenta de novo no próximo avanço do vídeo */ })
        .then(function () { sending[key] = false; });
    }

    var paintParts = null;
    if (l.parts) {
      var cur = 0; var pn = sec.querySelector('.partnext'); var last = l.parts.length - 1;
      tb.dataset.src = l.parts[0].v + '.txt';
      paintParts = function () {
        sec.querySelectorAll('.pbtn').forEach(function (b, k) {
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
      sec.querySelectorAll('.pbtn').forEach(function (b) { b.addEventListener('click', function () { go(+b.dataset.k, true); }); });
      v.addEventListener('ended', function () {
        markSeen(cur); paintParts();
        pn.querySelector('.pq').textContent = cur < last ? 'Conseguiu fazer a Parte ' + (cur + 1) + ' no seu celular?' : 'Pronto! Você terminou as ' + l.parts.length + ' partes.';
        pn.querySelector('.pgo').textContent = cur < last ? 'Sim! Ir para a Parte ' + (cur + 2) : 'Ir para as perguntas';
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
      });
      v.addEventListener('timeupdate', function () {
        if (!v.duration) return;
        var pct = v.currentTime / v.duration;
        if (pct >= 0.9) markSeen(cur);
        var seen = l.parts.filter(function (_, k) { return S.pseen[i + '-' + k]; }).length;
        var all = (seen + (S.pseen[i + '-' + cur] ? 0 : pct)) / l.parts.length;
        if (!S.watched[i]) {
          prog.textContent = 'Parte ' + (cur + 1) + ' de ' + l.parts.length + '. Você já viu ' + Math.round(all * 100) + '% do vídeo.';
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
    lg.innerHTML = '<span class="qx">vale ' + C.pontos.certa_1a + ' pontos</span>';
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
        var gain = r.tries.length <= 1 ? C.pontos.certa_1a : C.pontos.certa_depois;
        fb.className = 'fb ok'; fb.innerHTML = 'Certo! Você ganhou ' + gain + ' pontos.<span class="ex"></span>';
        fb.querySelector('.ex').textContent = r.exp || ''; fb.hidden = false;
      } else if (r.tries.length) {
        fb.className = 'fb no'; fb.textContent = 'Ainda não. Sem problema: escolha outra resposta (agora vale ' + C.pontos.certa_depois + ' pontos).'; fb.hidden = false;
      }
    }
    function pick(j) {
      if (rec().ok || pending) return;
      pending = true; d.classList.add('live');
      btns.forEach(function (b) { b.disabled = true; });
      post('resposta', { nivel: i + 1, pergunta: k, opcao: j }).then(function () {
        pending = false;
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

  function todoCount() {
    var c = root.querySelectorAll('#tTodo input');
    var n = 0; c.forEach(function (x) { if (x.checked) n++; });
    $('#tTodoCount').textContent = n + ' de ' + c.length + ' feitas';
  }

  function applyPrefs() {
    root.classList.toggle('big', !!P.big);
    $('#tBig').setAttribute('aria-pressed', P.big ? 'true' : 'false');
    $('#tSlow').setAttribute('aria-pressed', P.slow ? 'true' : 'false');
    root.querySelectorAll('video').forEach(function (v) { v.playbackRate = P.slow ? 0.8 : 1; v.defaultPlaybackRate = P.slow ? 0.8 : 1; });
  }

  function build() {
    root.innerHTML = shell();
    var lv = $('#tLevels');
    L().forEach(function (l, i) {
      var sec = document.createElement('section'); sec.className = 'level'; sec.id = 'tlv' + i;
      sec.innerHTML = levelHtml(l, i);
      bindLevel(sec, l, i);
      lv.appendChild(sec);
    });
    root.querySelectorAll('#tTodo input').forEach(function (c) {
      c.checked = !!S.tarefas[c.dataset.tarefa];
      c.addEventListener('change', function () {
        S.tarefas[c.dataset.tarefa] = c.checked; todoCount();
        post('tarefa', { tarefa: c.dataset.tarefa, feita: c.checked }).catch(function () {
          c.checked = !c.checked; S.tarefas[c.dataset.tarefa] = c.checked; todoCount();
        });
      });
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
    if (!built) root.innerHTML = '<p class="trilha-loading">Carregando sua trilha...</p>';
    if (built && alvo != null) irParaAlvo();
    window.Api.getTrilha().then(function (res) {
      C = res.conteudo; nome = res.nome || ''; S = fromServer(res.progresso);
      build();
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
      if (!built) root.innerHTML = '<p class="trilha-loading">Não foi possível carregar a trilha. Confira a internet e tente de novo.</p>';
    }).then(function () { loading = false; });
  }

  function refreshDashboard() {
    var body = document.getElementById('dashboard-trilha-body');
    if (!body || !window.Auth.isAuthenticated() || !document.body.classList.contains('trilha-on')) return;
    window.Api.getTrilhaResumo().then(function (r) {
      var pct = Math.round(r.concluidos / r.total * 100);
      var txt;
      if (r.concluidos >= r.total) txt = '<b>Trilha concluída!</b> ' + r.pontos + ' de ' + r.maximo + ' pontos.';
      else if (!r.comecou && !r.concluidos) txt = 'Você ainda não começou. Leva uns <b>10 minutos por nível</b>.';
      else txt = '<b>' + r.concluidos + ' de ' + r.total + ' níveis</b> · ' + r.pontos + ' pontos · Agora: ' + esc(r.atual ? r.atual.titulo : '');
      body.innerHTML = '<div class="trilha-dash-bar"><i style="width:' + pct + '%"></i></div><p class="trilha-dash-txt">' + txt + '</p>';
      var cta = document.querySelector('[data-trilha-cta]');
      if (cta) cta.textContent = r.concluidos >= r.total ? 'Rever a trilha' : (r.comecou || r.concluidos ? 'Continuar a trilha' : 'Começar a trilha');
    }).catch(function () {
      body.innerHTML = '<p class="trilha-dash-txt">Não foi possível carregar seu progresso agora.</p>';
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

  return { init: init, refresh: refresh, refreshDashboard: refreshDashboard, pause: pause, openLevel: openLevel };
})();
