/* Central de ajuda (tela /tutoriais para contas com a trilha liberada), organizada por tema.
   Topo: busca. Depois "Comece por aqui" (quem ainda não começou a Aula Inaugural) ou o cartão do
   progresso, a faixa de temas fixa e uma seção por tema: vídeos na ordem da jornada e as dúvidas
   daquele assunto. Com busca, os resultados aparecem separados por tema.
   Temas e ordem vêm de /api/central (server/assets/central/temas.json). */
window.Central = (function () {
  'use strict';

  var C = null;            // conteúdo vindo de /api/central
  var busca = '';          // termo normalizado (sem acento, minúsculo)
  var buscaTexto = '';     // o que o aluno digitou, para voltar ao campo
  var carregando = false;
  var buscaTimer = null;
  var resumoTrilha = null; // progresso real da trilha (Comece por aqui x cartão do progresso)
  var gatilhoVideo = null; // botão que abriu o vídeo: o foco volta para ele ao fechar
  var maisVideos = {};     // tema -> mostrando todos os vídeos
  var maisFaq = {};        // tema -> mostrando todas as perguntas
  var observador = null;   // marca o tema à vista na faixa fixa
  var VISIVEIS = 4;        // vídeos por tema antes de "Ver todos" (3 no celular, via CSS)
  var DUVIDAS = 3;         // perguntas por tema antes de "Ver as N perguntas"
  // Início: 3 vídeos escolhidos à mão (curadoria fixa, não é personalização).
  var DESTAQUES_INICIO = ['acesso-email-senha', 'acesso-entrar-duda', 'pagar-pix'];

  function track(nome, dados, opts) { if (window.Rastreio) window.Rastreio.track(nome, dados, opts); }

  // Busca sem nenhum resultado é sinal de que o aluno não achou a resposta: vai como aviso.
  function rastreiaBusca(termo) {
    if (!termo || termo.length < 3) return;
    var res = document.getElementById('c-res');
    var total = res ? res.querySelectorAll('.portal-vcard, .c-q').length : 0;
    if (total) track('central_busca', { termo: termo, resultados: total });
    else {
      track('central_busca_sem_resultado', { termo: termo }, { importante: true });
      if (window.Dificuldade) window.Dificuldade.buscaVazia(termo);
    }
  }

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function semAcento(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/<[^>]+>/g, ' ');
  }
  function seg(d) { var p = String(d || '').split(':').map(Number); return p.length === 2 ? p[0] * 60 + (p[1] || 0) : 0; }
  function minutos(s) { return Math.max(1, Math.round(s / 60)) + ' min'; }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }
  function bate(texto) {
    if (!busca) return true;
    var hay = semAcento(texto);
    return busca.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }
  function linkTrilha(item) {
    return item.trilha
      ? '<button type="button" class="c-trilha" data-open-trilha="' + item.trilha.nivel + '">Fazer o módulo ' + item.trilha.nivel + ' da Aula Inaugural</button>'
      : '';
  }
  // Joinha pra cima / pra baixo (public/js/avaliacao.js). Sem o helper, não mostra nada.
  function avaliacao(tipo, id) { return id && window.Avaliacao ? window.Avaliacao.html(tipo, id) : ''; }

  // ---------- Dados por tema ----------
  function temas() { return (C && C.temas) || []; }
  function temaPorId(id) { return temas().filter(function (t) { return t.id === id; })[0] || null; }
  function porOrdem(a, b) { return (a.ordem || 999) - (b.ordem || 999); }
  function videosDoTema(id) { return ((C && C.videos) || []).filter(function (v) { return v.tema === id; }).sort(porOrdem); }
  function perguntas() { return ((C && C.faq) || []).reduce(function (a, g) { return a.concat(g.perguntas || []); }, []); }
  function perguntasDoTema(id) { return perguntas().filter(function (p) { return p.tema === id; }).sort(porOrdem); }
  function bateVideo(v) { return bate(v.titulo + ' ' + v.resumo + ' ' + v.categoria + ' ' + (v.termos || '')); }
  function batePergunta(p) { return bate(p.q + ' ' + p.a + ' ' + (p.tags || []).join(' ')); }

  // Rótulo do card: "Parte 2 de 4" na série, "Entenda como funciona" no capítulo, "Passo a passo" na tarefa.
  function rotulo(v) {
    var naSerie = v.serie ? ((C && C.videos) || []).filter(function (x) { return x.serie === v.serie; }).length : 0;
    if (naSerie > 1 && v.parte) return 'Parte ' + v.parte + ' de ' + naSerie;
    return v.tipo === 'entenda' ? 'Entenda como funciona' : 'Passo a passo';
  }

  function hero() {
    return (
      '<section class="portal-hero c-hero" aria-labelledby="c-h1">' +
        '<div class="portal-hero__content">' +
          '<p class="portal-eyebrow">Central de ajuda</p>' +
          '<h1 id="c-h1">Como podemos ajudar?</h1>' +
          '<p class="portal-hero__lede">Escolha um tema ou escreva o que você precisa.</p>' +
          '<form class="c-search" role="search" id="c-busca-form">' +
            '<label for="c-busca" class="sr-only">Buscar na Central de ajuda</label>' +
            '<i data-lucide="search" aria-hidden="true"></i>' +
            '<input id="c-busca" type="search" autocomplete="off" placeholder="Ex.: senha, boleto, prova" value="' + esc(buscaTexto) + '">' +
            '<button type="submit" class="portal-btn c-search-go">Buscar</button>' +
          '</form>' +
          '<p class="c-hint">Mais buscados: ' + ['senha', 'boleto', 'nota', 'DP'].map(function (q) {
            return '<button type="button" data-c-q="' + esc(q) + '">' + esc(q) + '</button>';
          }).join(', ') + '</p>' +
        '</div>' +
        '<div class="portal-hero__art" aria-hidden="true"><img src="/assets/portal/hero-estudante-640.webp" srcset="/assets/portal/hero-estudante-640.webp 640w, /assets/portal/hero-estudante.webp 1310w" sizes="(min-width: 1024px) 360px, 260px" width="640" height="587" alt="" decoding="async"></div>' +
      '</section>'
    );
  }

  // Quem ainda não começou a Aula Inaugural vê o caminho de 5 passos; quem já começou, o próprio progresso.
  function novato() {
    var r = resumoTrilha;
    return !r || (!r.comecou && !(r.concluidos > 0) && !(r.certificado && (r.certificado.emitido || r.certificado.liberado)));
  }

  function comecePorAqui() {
    var passos = ((C && C.comece) || []).map(function (p) {
      var video = p.video ? ((C.videos || []).filter(function (v) { return v.id === p.video; })[0]) : null;
      var lista = p.tema ? videosDoTema(p.tema) : [];
      if (!video && lista.length) video = lista[0];
      if (!video) return null;
      var meta = lista.length > 1 ? plural(lista.length, 'vídeo curto', 'vídeos curtos') + ' · ' + minutos(lista.reduce(function (s, v) { return s + seg(v.duracao); }, 0)) : (video.duracao || '');
      return { titulo: p.titulo, video: video, meta: meta, s: lista.length > 1 ? lista.reduce(function (s, v) { return s + seg(v.duracao); }, 0) : seg(video.duracao) };
    }).filter(Boolean);
    if (!passos.length) return trilhaCard();
    var total = passos.reduce(function (s, p) { return s + p.s; }, 0);
    return (
      '<section class="c-path" aria-labelledby="c-h-path">' +
        '<div class="c-path-head"><div><h2 id="c-h-path">Está começando agora? Comece por aqui</h2>' +
          '<p>' + plural(passos.length, 'passo', 'passos') + ', cerca de ' + minutos(total) + '. Assista na ordem e você já sabe o básico do curso.</p></div>' +
          '<button type="button" class="portal-btn portal-btn--primary" data-c-video="' + esc(passos[0].video.id) + '">Começar pelo passo 1 <i data-lucide="chevron-right" aria-hidden="true"></i></button>' +
        '</div>' +
        '<ol class="c-steps">' + passos.map(function (p, i) {
          return '<li><button type="button" data-c-video="' + esc(p.video.id) + '"><span class="c-step-n" aria-hidden="true">' + (i + 1) + '</span>' +
            '<span class="c-step-t"><span class="sr-only">Passo ' + (i + 1) + ': </span>' + esc(p.titulo) + '</span><span class="c-step-m">' + esc(p.meta) + '</span></button></li>';
        }).join('') + '</ol>' +
        '<p class="c-path-alt">Prefere tudo de uma vez? <button type="button" class="c-link" data-open-trilha="">Fazer a Aula Inaugural completa</button>, com certificado de 4 horas.</p>' +
      '</section>'
    );
  }

  function trilhaCard() {
    var r = resumoTrilha;
    var fim = r && r.total && r.concluidos >= r.total;
    var andamento = r && !fim && (r.comecou || r.concluidos > 0) && r.atual;
    var cert = r && r.certificado;
    var titulo = 'Está começando agora?', txt = 'Faça a Aula Inaugural: 7 módulos curtos e certificado de 4 horas.', cta = 'Começar a Aula Inaugural', nivel = '';
    if (cert && cert.emitido) { titulo = 'Aula Inaugural concluída'; txt = 'Quer revisar algum assunto? Os módulos continuam abertos para você.'; cta = 'Rever a Aula Inaugural'; }
    else if (cert && cert.liberado) { titulo = 'Seu certificado está liberado!'; txt = 'Você concluiu os 7 módulos da Aula Inaugural. Emita o certificado de 4 horas.'; cta = 'Ir para o certificado'; }
    else if (andamento) { titulo = 'Continue a Aula Inaugural'; txt = 'Você está no módulo ' + r.atual.nivel + ': ' + r.atual.titulo + '. ' + (cert ? Number(cert.pontos || 0).toLocaleString('pt-BR') + ' de ' + Number(cert.meta || 70).toLocaleString('pt-BR') + ' pontos.' : ''); cta = 'Continuar o módulo ' + r.atual.nivel; nivel = String(r.atual.nivel); }
    else if (fim) { titulo = 'Falta pouco para o certificado'; txt = 'Você concluiu os 7 módulos. Emita o certificado de 4 horas no fim da Aula Inaugural.'; cta = 'Ver os módulos'; }
    return (
      '<aside class="c-start" aria-labelledby="c-h-start">' +
        '<span class="c-star" aria-hidden="true"></span>' +
        '<div><h2 id="c-h-start">' + esc(titulo) + '</h2><p>' + esc(txt) + '</p></div>' +
        '<button type="button" class="portal-btn" data-open-trilha="' + esc(nivel) + '">' + esc(cta) + ' <i data-lucide="chevron-right" aria-hidden="true"></i></button>' +
      '</aside>'
    );
  }

  // Card de vídeo (o mesmo no Início e na Central). A capa é só para mouse; o botão "Assistir ao vídeo" é o do teclado.
  function cardHtml(v, comJoinhas) {
    comJoinhas = comJoinhas === true && !!window.Avaliacao;
    var nJoinhas = comJoinhas ? window.Avaliacao.joinhas('video', v.id) : 0;
    return (
      '<article class="portal-vcard' + (v.tipo === 'entenda' ? ' portal-vcard--entenda' : '') + '">' +
        '<button type="button" class="portal-vthumb' + (v.capa ? ' has-capa' : '') + '" data-c-video="' + esc(v.id) + '" tabindex="-1" aria-hidden="true">' +
          '<img src="' + esc(v.capa || v.v + '.jpg') + '" alt="" loading="lazy" decoding="async" width="960" height="540"><span class="c-play"></span>' +
          (v.duracao ? '<span class="c-dur">' + esc(v.duracao) + '</span>' : '') +
          (comJoinhas ? window.Avaliacao.selo('video', v.id) : '') +
        '</button>' +
        '<div class="portal-vbody">' +
          '<span class="portal-vcat">' + esc(rotulo(v)) + '</span>' +
          '<h3>' + esc(v.titulo) + '</h3>' +
          (v.resumo ? '<p>' + esc(v.resumo) + '</p>' : '') +
          '<div class="portal-vacts">' +
            '<button type="button" class="portal-vwatch" data-c-video="' + esc(v.id) + '">Assistir ao vídeo<span class="sr-only">: ' + esc(v.titulo) + (v.duracao ? ', ' + esc(v.duracao) : '') + (nJoinhas ? ', ' + nJoinhas + (nJoinhas === 1 ? ' joinha' : ' joinhas') : '') + '</span><i data-lucide="chevron-right" aria-hidden="true"></i></button>' +
            linkTrilha(v) +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function pergunta(t, p) {
    var id = esc(t.id + '-' + p.id);
    return (
      '<div class="c-q">' +
        '<h4><button type="button" class="c-qbtn" id="c-qb-' + id + '" aria-expanded="false" aria-controls="c-qa-' + id + '">' + esc(p.q) + '</button></h4>' +
        '<div class="c-a" id="c-qa-' + id + '" role="region" aria-labelledby="c-qb-' + id + '" hidden><p>' + p.a + '</p>' + linkTrilha(p) + avaliacao('faq', p.id) + '</div>' +
      '</div>'
    );
  }

  // ---------- Índice e faixa de temas ----------
  function meta(t) {
    return plural(videosDoTema(t.id).length, 'vídeo', 'vídeos') + ' · ' + plural(perguntasDoTema(t.id).length, 'pergunta', 'perguntas');
  }
  function indice() {
    return (
      '<section class="c-indice" aria-labelledby="c-h-indice">' +
        '<h2 id="c-h-indice" class="c-h2">Escolha um tema</h2>' +
        '<div class="c-tiles">' + temas().map(function (t) {
          return '<a class="c-tile" href="#' + esc(t.id) + '" data-c-tema="' + esc(t.id) + '">' +
            '<span class="c-tico" aria-hidden="true"><i data-lucide="' + esc(t.icone || 'circle-help') + '"></i></span>' +
            '<span class="c-tile-t"><strong>' + esc(t.nome) + '</strong><span>' + esc(meta(t)) + '</span></span></a>';
        }).join('') + '</div>' +
      '</section>'
    );
  }
  function faixa() {
    return (
      '<nav class="c-tbar" id="c-tbar" aria-label="Temas da Central">' +
        '<div class="c-tbar-in">' + temas().map(function (t) {
          return '<a href="#' + esc(t.id) + '" data-c-tema="' + esc(t.id) + '">' + esc(t.curto || t.nome) + '</a>';
        }).join('') + '</div>' +
      '</nav>'
    );
  }

  // ---------- Seção de cada tema ----------
  // Sem busca: até 4 vídeos (3 no celular) e 3 dúvidas, com "ver todos". Com busca: só o que bateu, tudo aberto.
  function secao(t, vs, ps) {
    var todosV = busca || maisVideos[t.id];
    var todasP = busca || maisFaq[t.id];
    var dur = minutos(vs.reduce(function (s, v) { return s + seg(v.duracao); }, 0));
    var cab = busca
      ? plural(vs.length, 'vídeo', 'vídeos') + ' e ' + plural(ps.length, 'pergunta', 'perguntas')
      : plural(vs.length, 'vídeo', 'vídeos') + (vs.length ? ' · ' + dur : '');
    var maisV = !busca && vs.length > 3
      ? '<button type="button" class="c-more-btn' + (vs.length <= VISIVEIS ? ' so-celular' : '') + '" data-c-mais-videos="' + esc(t.id) + '" aria-expanded="' + !!todosV + '">' +
          (todosV ? 'Mostrar menos' : 'Ver todos os ' + vs.length + ' vídeos') + '</button>'
      : '';
    var visiveis = todasP ? ps : ps.slice(0, DUVIDAS);
    var maisP = !busca && ps.length > DUVIDAS
      ? '<button type="button" class="c-link" data-c-mais-faq="' + esc(t.id) + '" aria-expanded="' + !!todasP + '">' +
          (todasP ? 'Mostrar menos' : 'Ver as ' + ps.length + ' perguntas') + '</button>'
      : '';
    return (
      '<section class="c-tema" id="c-tema-' + esc(t.id) + '" data-tema="' + esc(t.id) + '" aria-labelledby="c-th-' + esc(t.id) + '">' +
        '<div class="c-thead">' +
          '<span class="c-tico" aria-hidden="true"><i data-lucide="' + esc(t.icone || 'circle-help') + '"></i></span>' +
          '<div class="c-thead-t"><h2 id="c-th-' + esc(t.id) + '">' + esc(t.nome) + '</h2>' + (busca ? '' : '<p>' + esc(t.linha) + '</p>') + '</div>' +
          '<span class="c-tmeta">' + esc(cab) + '</span>' +
        '</div>' +
        (t.id === 'acesso' ? '<div data-dados-acesso-slot="faixa" data-dados-acesso-onde="central" hidden></div>' : '') +
        (vs.length ? '<div class="portal-video-grid c-tgrid' + (todosV ? ' is-all' : '') + '">' + vs.map(function (v) { return cardHtml(v, true); }).join('') + '</div>' + maisV : '') +
        (ps.length
          ? '<div class="c-tfaq"><div class="c-tfaq-h"><h3>' + (busca ? 'Perguntas' : 'Dúvidas sobre ' + esc(t.nome.toLowerCase())) + '</h3>' + maisP + '</div>' +
              visiveis.map(function (p) { return pergunta(t, p); }).join('') + '</div>'
          : '') +
      '</section>'
    );
  }

  function blocos() {
    return temas().map(function (t) {
      return { t: t, vs: videosDoTema(t.id).filter(bateVideo), ps: perguntasDoTema(t.id).filter(batePergunta) };
    }).filter(function (b) { return !busca || b.vs.length || b.ps.length; });
  }

  function contagem() {
    return blocos().reduce(function (n, b) { n.videos += b.vs.length; n.faq += b.ps.length; return n; }, { videos: 0, faq: 0 });
  }

  function suporte() {
    return (
      '<section class="portal-support" aria-labelledby="c-h-ajuda">' +
        '<span class="portal-support__ico" aria-hidden="true"><i data-lucide="messages-square"></i></span>' +
        '<div class="portal-support__txt"><h2 id="c-h-ajuda">Ainda precisa de ajuda?</h2>' +
        '<p>Conte com a equipe do seu polo.</p></div>' +
        '<div class="portal-support__acts">' +
          '<button type="button" class="portal-btn" data-help-open>Preciso de ajuda <i data-lucide="chevron-right" aria-hidden="true"></i></button>' +
          '<a class="portal-link" href="/atendimento" data-go="atendimento-page">Comercial e indicação</a>' +
        '</div>' +
      '</section>'
    );
  }

  function vazio() {
    return (
      '<div class="c-vazio">' +
        '<span class="c-vazio-ico" aria-hidden="true"><i data-lucide="search-x"></i></span>' +
        '<h2>Não encontramos esse assunto.</h2>' +
        '<p>Tente outra palavra, como senha, boleto ou prova. Ou fale com a equipe.</p>' +
        '<div class="c-vazio-acts"><button type="button" class="portal-btn" data-c-limpar>Limpar busca</button>' +
        '<button type="button" class="portal-link" data-help-open>Falar com a equipe</button></div>' +
      '</div>'
    );
  }

  function resultados() {
    if (!temas().length) return '<p class="c-empty">Os vídeos estão sendo organizados. Fale com a equipe se precisar de ajuda agora.</p>';
    var bs = blocos();
    if (busca && !bs.length) return vazio();
    var corpo = bs.map(function (b) { return secao(b.t, b.vs, b.ps); }).join('');
    if (busca) {
      var n = contagem();
      return '<p class="c-fsum">' + plural(n.videos, 'vídeo', 'vídeos') + ' e ' + plural(n.faq, 'pergunta', 'perguntas') + ' para "' + esc(buscaTexto.trim()) + '" ' +
        '<button type="button" class="c-link" data-c-limpar>Limpar busca</button></p>' + corpo;
    }
    return indice() + corpo;
  }

  // Anuncia o resultado para leitor de tela.
  function anunciar() {
    var st = document.getElementById('c-status');
    if (!st) return;
    if (!busca) { st.textContent = ''; return; }
    var n = contagem();
    st.textContent = (!n.videos && !n.faq)
      ? 'Não encontramos esse assunto.'
      : plural(n.videos, 'vídeo', 'vídeos') + ' e ' + n.faq + (n.faq === 1 ? ' pergunta encontrada.' : ' perguntas encontradas.');
  }

  // Faixa de temas: destaca o tema que está na tela.
  // Altura real do topo da tela (no celular ele tem duas linhas): a faixa de temas cola logo abaixo dele.
  function medirTopo() {
    var h = document.querySelector('#tutoriais-page > header');
    if (h) document.documentElement.style.setProperty('--c-topo', Math.round(h.getBoundingClientRect().height) + 'px');
  }

  function observarTemas() {
    if (observador) { observador.disconnect(); observador = null; }
    var bar = document.getElementById('c-tbar');
    if (!bar) return;
    medirTopo();
    bar.hidden = !!busca;
    if (busca || !('IntersectionObserver' in window)) return;
    var visiveis = {};
    observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) { visiveis[e.target.getAttribute('data-tema')] = e.isIntersecting; });
      // O primeiro tema (na ordem da página) que está na faixa de leitura é o atual.
      var atual = temas().map(function (t) { return t.id; }).filter(function (id) { return visiveis[id]; })[0];
      if (!atual) return;
      var trilho = bar.querySelector('.c-tbar-in');
      bar.querySelectorAll('[data-c-tema]').forEach(function (a) {
        var on = a.getAttribute('data-c-tema') === atual;
        if (on) { a.setAttribute('aria-current', 'true'); if (trilho && trilho.scrollWidth > trilho.clientWidth) trilho.scrollLeft = a.offsetLeft - trilho.offsetLeft - 16; }
        else a.removeAttribute('aria-current');
      });
    }, { rootMargin: '-160px 0px -55% 0px' });
    document.querySelectorAll('#central-ajuda .c-tema').forEach(function (s) { observador.observe(s); });
  }

  function irParaTema(id, suave) {
    var sec = document.getElementById('c-tema-' + id);
    if (!sec) return false;
    sec.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'start' });
    var h = sec.querySelector('h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    if (history.replaceState) history.replaceState(null, '', '#' + id);
    return true;
  }

  function depoisDeDesenhar(alvo) {
    if (window.lucide) window.lucide.createIcons();
    if (window.DadosAcesso) window.DadosAcesso.render(alvo);
    observarTemas();
  }

  function render(foco) {
    var box = document.getElementById('central-ajuda');
    if (!box || !C) return;
    box.innerHTML = hero() + (novato() ? comecePorAqui() : trilhaCard()) + faixa() +
      '<div data-apps-slot></div>' +
      '<p id="c-status" class="sr-only" role="status" aria-live="polite"></p>' +
      '<div id="c-res">' + resultados() + '</div>' + suporte();
    if (window.Apps) window.Apps.render(box);
    depoisDeDesenhar(box);
    if (foco) {
      var inp = document.getElementById('c-busca');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
    // Link direto para um tema: /tutoriais#pagamentos
    var hash = (location.hash || '').replace(/^#/, '');
    if (hash && temaPorId(hash)) setTimeout(function () { irParaTema(hash, false); }, 50);
  }
  // Ao digitar ou abrir "ver todos", só os resultados mudam (o foco fica onde estava).
  function renderResultados() {
    var res = document.getElementById('c-res');
    if (!res || !C) return;
    res.innerHTML = resultados();
    depoisDeDesenhar(res);
    anunciar();
  }

  // Início: 3 vídeos da biblioteca, com o mesmo card e o mesmo player da Central.
  async function renderInicio() {
    var box = document.getElementById('inicio-videos');
    if (!box || !document.body.classList.contains('trilha-on') || !window.Auth.isAuthenticated()) return;
    try {
      await carregar();
    } catch (err) {
      box.innerHTML = '<p class="p-muted">Não foi possível carregar os vídeos agora.</p>';
      return;
    }
    var todos = (C && C.videos) || [];
    var lista = DESTAQUES_INICIO.map(function (id) { return todos.find(function (v) { return v.id === id; }); }).filter(Boolean);
    todos.forEach(function (v) { if (lista.length < 3 && lista.indexOf(v) === -1) lista.push(v); });
    box.innerHTML = lista.length ? lista.map(cardHtml).join('') : '<p class="p-muted">Os vídeos estão sendo gravados.</p>';
    if (window.lucide) window.lucide.createIcons();
  }

  // ---------- Player ----------
  // "A seguir neste tema": os próximos vídeos do mesmo tema, na ordem (volta ao começo no fim).
  function aSeguir(v) {
    var lista = videosDoTema(v.tema);
    var i = lista.indexOf(v);
    if (i < 0 || lista.length < 2) return '';
    var prox = lista.slice(i + 1).concat(lista.slice(0, i)).slice(0, 3);
    var t = temaPorId(v.tema);
    return (
      '<div class="c-next"><h3>A seguir' + (t ? ' em ' + esc(t.nome) : '') + '</h3><ol>' + prox.map(function (x) {
        return '<li><button type="button" data-c-video="' + esc(x.id) + '">' +
          '<img src="' + esc(x.capa || x.v + '.jpg') + '" alt="" width="160" height="90" loading="lazy">' +
          '<span><strong>' + esc(x.titulo) + '</strong><small>' + esc(rotulo(x)) + (x.duracao ? ' · ' + esc(x.duracao) : '') + '</small></span></button></li>';
      }).join('') + '</ol></div>'
    );
  }

  function abrirVideo(id, gatilho) {
    var v = (C && C.videos || []).find(function (x) { return x.id === id; });
    if (!v) return;
    track('central_video', { video: v.titulo, categoria: v.categoria, tema: v.tema || null });
    gatilhoVideo = gatilho || null;
    var m = document.getElementById('c-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'c-modal'; m.className = 'c-modal';
      document.body.appendChild(m);
    }
    m.innerHTML =
      '<div class="c-mcard" role="dialog" aria-modal="true" aria-labelledby="c-mtitle">' +
        '<div class="c-mhead"><h2 id="c-mtitle">' + esc(v.titulo) + '</h2><button type="button" class="c-close" data-c-close>Fechar<span class="sr-only"> o vídeo</span></button></div>' +
        (v.yt
          ? '<div class="c-yt"><iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(v.yt) + '?autoplay=1&rel=0" title="' + esc(v.titulo) + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>'
          : '<video controls autoplay playsinline preload="metadata" poster="' + esc(v.capa || v.v + '.jpg') + '"><source src="' + esc(v.v) + '.mp4" type="video/mp4"></video>') +
        (v.id === 'acesso-email-senha' ? '<div class="c-mdados" data-dados-acesso-slot="faixa" data-dados-acesso-onde="central" hidden></div>' : '') +
        avaliacao('video', v.id) +
        linkTrilha(v) +
        aSeguir(v) +
      '</div>';
    m.hidden = false;
    if (window.DadosAcesso) window.DadosAcesso.render(m);
    document.documentElement.classList.add('c-modal-open');
    m.querySelector('[data-c-close]').focus();
  }
  function fecharVideo() {
    var m = document.getElementById('c-modal');
    if (!m || m.hidden) return;
    var vid = m.querySelector('video'); if (vid) vid.pause();
    m.hidden = true; m.innerHTML = '';
    document.documentElement.classList.remove('c-modal-open');
    var g = gatilhoVideo; gatilhoVideo = null;
    if (g && document.contains(g) && g.offsetParent !== null) g.focus();
  }
  // Tab e Shift+Tab ficam dentro do vídeo aberto.
  function prenderFoco(e) {
    var m = document.getElementById('c-modal');
    if (!m || m.hidden || e.key !== 'Tab') return;
    var f = Array.prototype.filter.call(m.querySelectorAll('button, a[href], video[controls], iframe'), function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!m.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }

  // FAQ: uma resposta aberta por vez.
  function alternarPergunta(btn) {
    var abrir = btn.getAttribute('aria-expanded') !== 'true';
    var res = document.getElementById('c-res');
    if (res) res.querySelectorAll('.c-qbtn[aria-expanded="true"]').forEach(function (b) {
      b.setAttribute('aria-expanded', 'false');
      var r = document.getElementById(b.getAttribute('aria-controls')); if (r) r.hidden = true;
      b.closest('.c-q').classList.remove('is-open');
    });
    if (!abrir) return;
    btn.setAttribute('aria-expanded', 'true');
    var resp = document.getElementById(btn.getAttribute('aria-controls')); if (resp) resp.hidden = false;
    btn.closest('.c-q').classList.add('is-open');
    track('faq_aberta', { pergunta: btn.textContent, busca: busca || null });
  }

  var carregamento = null;
  function carregar() {
    if (C) return Promise.resolve(C);
    if (!carregamento) {
      carregamento = window.Api.getCentral().then(function (r) {
        C = (r && r.conteudo) || null;
        return C;
      }).finally(function () { carregamento = null; });
    }
    return carregamento;
  }

  async function refresh() {
    if (!document.body.classList.contains('trilha-on') || !window.Auth.isAuthenticated() || carregando) return;
    var box = document.getElementById('central-ajuda');
    if (box && !C) box.innerHTML = '<p class="c-empty">Carregando a central de ajuda…</p>';
    carregando = true;
    try {
      var res = await Promise.all([
        carregar(),
        window.Api.getTrilhaResumo().catch(function () { return null; }),
        window.Avaliacao ? window.Avaliacao.totais('video') : null,
      ]);
      resumoTrilha = res[1];
      render(false);
    } catch (err) {
      if (box) box.innerHTML = '<p class="c-empty">Não foi possível carregar a central de ajuda agora. Tente de novo em instantes.</p>';
    } finally {
      carregando = false;
    }
  }

  function aplicarBusca(valor) {
    buscaTexto = valor;
    busca = semAcento(valor).trim();
    renderResultados();
  }

  function buscarPor(valor) {
    var inp = document.getElementById('c-busca');
    if (inp) inp.value = valor;
    aplicarBusca(valor);
    clearTimeout(buscaTimer);
    rastreiaBusca(valor.trim());
    var res = document.getElementById('c-res');
    if (res && busca) res.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function init() {
    window.addEventListener('resize', medirTopo);
    document.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'c-busca') {
        aplicarBusca(e.target.value);
        // Só registra a busca depois que o aluno parou de digitar.
        clearTimeout(buscaTimer);
        var termo = e.target.value.trim();
        buscaTimer = setTimeout(function () { rastreiaBusca(termo); }, 1500);
      }
    });
    // Enter ou "Buscar": mesmo resultado da digitação, e leva o aluno até os resultados.
    document.addEventListener('submit', function (e) {
      if (!e.target || e.target.id !== 'c-busca-form') return;
      e.preventDefault();
      var inp = document.getElementById('c-busca');
      buscarPor(inp ? inp.value : '');
    });
    document.addEventListener('click', function (e) {
      var t = e.target;
      var q0 = t.closest('#central-ajuda [data-c-q]');
      if (q0) { buscarPor(q0.getAttribute('data-c-q')); return; }
      var tema = t.closest('#central-ajuda [data-c-tema]');
      if (tema) {
        e.preventDefault();
        irParaTema(tema.getAttribute('data-c-tema'), true);
        return;
      }
      var mv = t.closest('#central-ajuda [data-c-mais-videos]');
      if (mv) {
        var idv = mv.getAttribute('data-c-mais-videos');
        maisVideos[idv] = !maisVideos[idv];
        renderResultados();
        var bv = document.querySelector('#central-ajuda [data-c-mais-videos="' + idv + '"]');
        if (bv) bv.focus({ preventScroll: true });
        return;
      }
      var mf = t.closest('#central-ajuda [data-c-mais-faq]');
      if (mf) {
        var idf = mf.getAttribute('data-c-mais-faq');
        maisFaq[idf] = !maisFaq[idf];
        renderResultados();
        var bf = document.querySelector('#central-ajuda [data-c-mais-faq="' + idf + '"]');
        if (bf) bf.focus({ preventScroll: true });
        return;
      }
      if (t.closest('#central-ajuda [data-c-limpar]')) {
        var inp = document.getElementById('c-busca'); if (inp) inp.value = '';
        aplicarBusca('');
        if (inp) inp.focus();
        return;
      }
      var q = t.closest('#central-ajuda .c-qbtn');
      if (q) { alternarPergunta(q); return; }
      var vid = t.closest('[data-c-video]');
      if (vid) {
        // Dentro do vídeo aberto ("A seguir"), o foco continua voltando para quem abriu o primeiro.
        if (vid.closest('#c-modal')) { abrirVideo(vid.getAttribute('data-c-video'), gatilhoVideo); return; }
        // Clique na capa: o foco volta depois para o "Assistir ao vídeo" do mesmo card.
        var card = vid.closest('.portal-vcard');
        var gatilho = (card && card.querySelector('.portal-vwatch')) || vid;
        abrirVideo(vid.getAttribute('data-c-video'), gatilho);
        return;
      }
      if (t.closest('[data-c-close]') || t.id === 'c-modal') { fecharVideo(); return; }
      if (t.closest('#c-modal [data-open-trilha]')) fecharVideo();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var m = document.getElementById('c-modal');
        if (m && !m.hidden) fecharVideo();
        return;
      }
      prenderFoco(e);
    });
  }

  // Abre um vídeo da Central de qualquer tela (aplicativos, painel de ajuda), carregando o conteúdo se preciso.
  async function assistir(id, gatilho) {
    try { await carregar(); } catch (err) { window.showScreen('tutoriais-page'); return; }
    if (!(C && C.videos || []).some(function (v) { return v.id === id; })) { window.showScreen('tutoriais-page'); return; }
    abrirVideo(id, gatilho || document.activeElement);
  }

  return { init: init, refresh: refresh, close: fecharVideo, renderInicio: renderInicio, assistir: assistir,
    // Painel de ajuda já na Central: só leva ao campo de busca.
    focarBusca: function () { var i = document.getElementById('c-busca'); if (i) { i.scrollIntoView({ block: 'center' }); i.focus(); return true; } return false; } };
})();
