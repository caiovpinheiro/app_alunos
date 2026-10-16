/* Central de ajuda (tela /tutoriais para contas com a trilha liberada):
   busca única, assuntos, vídeos curtos, Aula Inaugural por capítulos e perguntas frequentes. */
window.Central = (function () {
  'use strict';

  var C = null;          // conteúdo vindo de /api/central
  var busca = '';
  var assunto = 0;       // 0 = todos; 1..7 = nível da trilha
  var carregando = false;

  var ASSUNTOS = [
    [0, 'Tudo'], [1, 'Entrar'], [2, 'Área do Aluno'], [3, 'Aulas'],
    [4, 'Provas e notas'], [5, 'Pagamentos'], [6, 'Horas'], [7, 'Formatura']
  ];

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function semAcento(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/<[^>]+>/g, ' ');
  }
  function mmss(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  }
  function bate(texto, nivel) {
    if (assunto && nivel !== assunto) return false;
    if (!busca) return true;
    var hay = semAcento(texto);
    return busca.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }
  function nivelDe(item) { return item.trilha ? item.trilha.nivel : 0; }
  function linkTrilha(item) {
    return item.trilha
      ? '<button type="button" class="c-trilha" data-open-trilha="' + item.trilha.nivel + '">Aprender no Nível ' + item.trilha.nivel + ' da trilha</button>'
      : '';
  }

  function hero() {
    return (
      '<header class="c-hero">' +
        '<p class="c-kicker">Central de ajuda</p>' +
        '<h1>Tire a sua dúvida <em>sem complicação</em></h1>' +
        '<p class="c-lead">Vídeos curtinhos, a Aula Inaugural separada por assunto e as perguntas que todo mundo faz.</p>' +
        '<label class="c-search"><span class="sr-only">Buscar na central de ajuda</span>' +
          '<i data-lucide="search" class="w-5 h-5" aria-hidden="true"></i>' +
          '<input id="c-busca" type="search" autocomplete="off" placeholder="Escreva a sua dúvida. Ex.: boleto, senha, prova" value="' + esc(busca) + '">' +
        '</label>' +
        '<div class="c-chips" role="group" aria-label="Escolha um assunto">' +
          ASSUNTOS.map(function (a) {
            return '<button type="button" class="c-chip" data-assunto="' + a[0] + '" aria-pressed="' + (assunto === a[0]) + '">' + esc(a[1]) + '</button>';
          }).join('') +
        '</div>' +
      '</header>'
    );
  }

  function trilhaCard() {
    return (
      '<aside class="c-start">' +
        '<span class="c-star" aria-hidden="true"></span>' +
        '<div><p class="c-start-k">Começando agora?</p><h2>Faça a Trilha EaD para Iniciantes</h2>' +
        '<p>7 níveis com vídeo, resumo e perguntas, do primeiro acesso à formatura.</p></div>' +
        '<button type="button" class="c-btn" data-open-trilha="">Ir para a trilha</button>' +
      '</aside>'
    );
  }

  function videos() {
    var lista = (C.videos || []).filter(function (v) { return bate(v.titulo + ' ' + v.resumo + ' ' + v.categoria, nivelDe(v)); });
    var corpo;
    if (!(C.videos || []).length) {
      corpo = '<p class="c-empty">Os vídeos novos estão sendo gravados. Enquanto isso, a trilha e as perguntas abaixo explicam tudo.</p>';
    } else if (!lista.length) {
      corpo = '<p class="c-empty">Nenhum vídeo sobre isso. Veja as perguntas abaixo.</p>';
    } else {
      corpo = '<div class="c-vgrid">' + lista.map(function (v) {
        return (
          '<article class="c-vcard">' +
            '<button type="button" class="c-vthumb" data-c-video="' + esc(v.id) + '" aria-label="Assistir: ' + esc(v.titulo) + '">' +
              '<img src="' + esc(v.v) + '.jpg" alt="" loading="lazy"><span class="c-play" aria-hidden="true"></span>' +
              (v.duracao ? '<span class="c-dur">' + esc(v.duracao) + '</span>' : '') +
            '</button>' +
            '<div class="c-vbody"><span class="c-cat">' + esc(v.categoria) + '</span><h3>' + esc(v.titulo) + '</h3>' +
            (v.resumo ? '<p>' + esc(v.resumo) + '</p>' : '') + linkTrilha(v) + '</div>' +
          '</article>'
        );
      }).join('') + '</div>';
    }
    return '<section class="c-sec" aria-labelledby="c-h-videos"><h2 id="c-h-videos" class="c-h">Vídeos rápidos <span>1 tarefa por vídeo</span></h2>' + corpo + '</section>';
  }

  function aula() {
    var A = C.aula;
    if (!A || !A.capitulos || !A.capitulos.length) return '';
    var caps = A.capitulos.map(function (c, i) { return { c: c, i: i }; })
      .filter(function (x) { return bate(x.c.titulo + ' ' + x.c.resumo, nivelDe(x.c)); });
    if (!caps.length && (busca || assunto)) return '';
    return (
      '<section class="c-sec" aria-labelledby="c-h-aula">' +
        '<h2 id="c-h-aula" class="c-h">Aula Inaugural por assunto <span>pule direto para o que interessa</span></h2>' +
        '<div class="c-aula">' +
          '<div class="c-player" id="c-player">' +
            '<button type="button" class="c-pposter" data-c-cap="0" aria-label="Assistir à Aula Inaugural do começo">' +
              '<span class="c-pk">Aula Inaugural</span>' +
              '<span class="c-pt">Tudo o que você precisa saber para começar</span>' +
              '<span class="c-pm">' + A.capitulos.length + ' assuntos' + (A.duracao_s ? ' · ' + Math.round(A.duracao_s / 60) + ' min' : '') + ' · toque num assunto para pular direto</span>' +
              '<span class="c-play" aria-hidden="true"></span>' +
            '</button>' +
          '</div>' +
          '<ol class="c-caps">' + caps.map(function (x) {
            return (
              '<li><button type="button" class="c-cap" data-c-cap="' + x.i + '">' +
                '<span class="c-time">' + mmss(x.c.inicio_s) + '</span>' +
                '<span class="c-capt"><strong>' + esc(x.c.titulo) + '</strong>' + (x.c.resumo ? '<small>' + esc(x.c.resumo) + '</small>' : '') + '</span>' +
              '</button>' + linkTrilha(x.c) + '</li>'
            );
          }).join('') + '</ol>' +
        '</div>' +
        '<p class="c-note">Assistiu à aula? <button type="button" class="c-link" onclick="showScreen(\'form-page\')">Gere o seu certificado</button></p>' +
      '</section>'
    );
  }

  function faq() {
    var grupos = (C.faq || []).map(function (g) {
      return { g: g, ps: g.perguntas.filter(function (p) { return bate(p.q + ' ' + p.a + ' ' + (p.tags || []).join(' '), nivelDe(p)); }) };
    }).filter(function (x) { return x.ps.length; });
    var abrir = !!busca;
    var corpo = grupos.length
      ? grupos.map(function (x) {
          return (
            '<div class="c-fgroup"><h3>' + esc(x.g.titulo) + '</h3>' +
            x.ps.map(function (p) {
              return (
                '<details class="c-q"' + (abrir ? ' open' : '') + '><summary>' + esc(p.q) + '</summary>' +
                  '<div class="c-a"><p>' + p.a + '</p>' + linkTrilha(p) + '</div>' +
                '</details>'
              );
            }).join('') + '</div>'
          );
        }).join('')
      : '<p class="c-empty">Não achamos essa dúvida. Fale com a gente no WhatsApp, logo abaixo.</p>';
    return '<section class="c-sec" aria-labelledby="c-h-faq"><h2 id="c-h-faq" class="c-h">Perguntas frequentes</h2>' + corpo + '</section>';
  }

  function rodape() {
    return (
      '<footer class="c-help">' +
        '<div><h2>Não achou o que procurava?</h2><p>A equipe responde no WhatsApp ' + esc(C.whatsapp || '') + '.</p></div>' +
        '<a class="c-btn" href="' + esc(C.whatsapp_url || '#') + '" target="_blank" rel="noopener">Chamar no WhatsApp</a>' +
      '</footer>'
    );
  }

  function render(foco) {
    var box = document.getElementById('central-ajuda');
    if (!box || !C) return;
    box.innerHTML = hero() + trilhaCard() + '<div id="c-res">' + videos() + aula() + faq() + '</div>' + rodape();
    if (window.lucide) window.lucide.createIcons();
    if (foco) {
      var inp = document.getElementById('c-busca');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
  }
  // Ao digitar, só a área de resultados muda (o campo de busca não perde o foco).
  function renderResultados() {
    var res = document.getElementById('c-res');
    if (!res || !C) return;
    res.innerHTML = videos() + aula() + faq();
  }

  function tocarCapitulo(i) {
    var A = C && C.aula; if (!A) return;
    var c = A.capitulos[i] || A.capitulos[0];
    var p = document.getElementById('c-player'); if (!p) return;
    p.innerHTML = '<iframe title="Aula Inaugural" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen ' +
      'src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(A.video_id) + '?autoplay=1&rel=0&start=' + (c.inicio_s || 0) + '"></iframe>';
    if (window.matchMedia('(max-width: 900px)').matches) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function abrirVideo(id) {
    var v = (C.videos || []).find(function (x) { return x.id === id; });
    if (!v) return;
    var m = document.getElementById('c-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'c-modal'; m.className = 'c-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
      document.body.appendChild(m);
    }
    m.innerHTML =
      '<div class="c-mcard"><div class="c-mhead"><h3>' + esc(v.titulo) + '</h3><button type="button" class="c-close" data-c-close>Fechar</button></div>' +
      '<video controls autoplay playsinline preload="metadata" poster="' + esc(v.v) + '.jpg"><source src="' + esc(v.v) + '.mp4" type="video/mp4"></video>' +
      linkTrilha(v) + '</div>';
    m.hidden = false;
    m.querySelector('[data-c-close]').focus();
  }
  function fecharVideo() {
    var m = document.getElementById('c-modal');
    if (!m || m.hidden) return;
    var vid = m.querySelector('video'); if (vid) vid.pause();
    m.hidden = true; m.innerHTML = '';
  }

  async function refresh() {
    if (!document.body.classList.contains('trilha-on') || !window.Auth.isAuthenticated() || carregando) return;
    var box = document.getElementById('central-ajuda');
    if (box && !C) box.innerHTML = '<p class="c-empty">Carregando a central de ajuda…</p>';
    carregando = true;
    try {
      var r = await window.Api.getCentral();
      C = (r && r.conteudo) || null;
      render(false);
    } catch (err) {
      if (box) box.innerHTML = '<p class="c-empty">Não foi possível carregar a central de ajuda agora. Tente de novo em instantes.</p>';
    } finally {
      carregando = false;
    }
  }

  function init() {
    document.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'c-busca') { busca = semAcento(e.target.value).trim(); renderResultados(); }
    });
    document.addEventListener('click', function (e) {
      var t = e.target;
      var chip = t.closest('#central-ajuda [data-assunto]');
      if (chip) { assunto = Number(chip.getAttribute('data-assunto')) || 0; render(false); return; }
      var cap = t.closest('#central-ajuda [data-c-cap]');
      if (cap) { tocarCapitulo(Number(cap.getAttribute('data-c-cap'))); return; }
      var vid = t.closest('#central-ajuda [data-c-video]');
      if (vid) { abrirVideo(vid.getAttribute('data-c-video')); return; }
      if (t.closest('[data-c-close]') || t.id === 'c-modal') { fecharVideo(); return; }
      if (t.closest('#c-modal [data-open-trilha]')) fecharVideo();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharVideo(); });
  }

  return { init: init, refresh: refresh, close: fecharVideo };
})();
