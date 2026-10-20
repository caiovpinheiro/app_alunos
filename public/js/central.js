/* Central de ajuda (tela /tutoriais para contas com a trilha liberada):
   busca única, assuntos, vídeos curtos (tarefa + "Entenda como funciona", que são capítulos
   da Aula Inaugural) e perguntas frequentes. A aula completa fica na tela da Aula Inaugural. */
window.Central = (function () {
  'use strict';

  var C = null;          // conteúdo vindo de /api/central
  var busca = '';       // termo normalizado (sem acento, minúsculo)
  var buscaTexto = '';  // o que o aluno digitou, para voltar ao campo
  var assunto = 0;       // 0 = todos; 1..7 = nível da trilha
  var carregando = false;
  var faqGrupo = '';     // grupo do FAQ aberto (id); vazio = o primeiro com perguntas
  var buscaTimer = null;
  var resumoTrilha = null; // progresso real da trilha (faixa "Está começando agora?")
  var gatilhoVideo = null; // botão que abriu o vídeo: o foco volta para ele ao fechar

  function track(nome, dados, opts) { if (window.Rastreio) window.Rastreio.track(nome, dados, opts); }

  // Busca sem nenhum resultado é sinal de que o aluno não achou a resposta: vai como aviso.
  function rastreiaBusca(termo) {
    if (!termo || termo.length < 3) return;
    var res = document.getElementById('c-res');
    var total = res ? res.querySelectorAll('.portal-vcard, .c-q').length : 0;
    if (total) track('central_busca', { termo: termo, resultados: total });
    else track('central_busca_sem_resultado', { termo: termo }, { importante: true });
  }

  var ICONES_FAQ = {
    acesso: 'log-in', 'area-aluno': 'folder-open', aulas: 'monitor-play', provas: 'clipboard-check',
    pagamentos: 'wallet', 'horas-formatura': 'graduation-cap', ajuda: 'message-circle'
  };

  // Assuntos = níveis da trilha. Cinco à vista; o resto em "Mais assuntos" (nenhum some).
  var ASSUNTOS = [[0, 'Todos'], [1, 'Primeiro acesso'], [3, 'Aulas'], [4, 'Provas e notas'], [5, 'Pagamentos']];
  var MAIS_ASSUNTOS = [[2, 'Área do Aluno'], [6, 'Horas complementares'], [7, 'Formatura']];
  var maisAberto = false;
  // Início: 3 vídeos escolhidos à mão (curadoria fixa, não é personalização).
  var DESTAQUES_INICIO = ['acesso-email-senha', 'acesso-entrar-duda', 'pagar-pix'];

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
      ? '<button type="button" class="c-trilha" data-open-trilha="' + item.trilha.nivel + '">Fazer o módulo ' + item.trilha.nivel + ' da Aula Inaugural</button>'
      : '';
  }

  // Joinha pra cima / pra baixo (public/js/avaliacao.js). Sem o helper, não mostra nada.
  function avaliacao(tipo, id) {
    return id && window.Avaliacao ? window.Avaliacao.html(tipo, id) : '';
  }

  function hero() {
    return (
      '<section class="portal-hero c-hero" aria-labelledby="c-h1">' +
        '<div class="portal-hero__content">' +
          '<p class="portal-eyebrow">Central de ajuda</p>' +
          '<h1 id="c-h1">Como podemos ajudar?</h1>' +
          '<p class="portal-hero__lede">Encontre a resposta e siga em frente.</p>' +
          '<form class="c-search" role="search" id="c-busca-form">' +
            '<label for="c-busca" class="sr-only">Buscar na Central de ajuda</label>' +
            '<i data-lucide="search" aria-hidden="true"></i>' +
            '<input id="c-busca" type="search" autocomplete="off" placeholder="Busque por senha, boleto, prova..." value="' + esc(buscaTexto) + '">' +
            '<button type="submit" class="portal-btn portal-btn--primary">Buscar</button>' +
          '</form>' +
        '</div>' +
        '<div class="portal-hero__art" aria-hidden="true"><img src="/assets/portal/hero-estudante-640.webp" srcset="/assets/portal/hero-estudante-640.webp 640w, /assets/portal/hero-estudante.webp 1310w" sizes="(min-width: 1024px) 360px, 260px" width="640" height="587" alt="" decoding="async"></div>' +
      '</section>'
    );
  }

  function chip(a) {
    return '<button type="button" class="c-chip" data-assunto="' + a[0] + '" aria-pressed="' + (assunto === a[0]) + '">' + esc(a[1]) + '</button>';
  }
  function chips() {
    var extra = MAIS_ASSUNTOS.filter(function (a) { return a[0] === assunto; })[0];
    return (
      '<div class="c-chips" role="group" aria-label="Filtrar por assunto">' +
        ASSUNTOS.map(chip).join('') +
        '<div class="c-more">' +
          '<button type="button" class="c-chip c-chip--more' + (extra ? ' is-on' : '') + '" aria-expanded="' + maisAberto + '" aria-controls="c-more-list">' +
            'Mais assuntos' + (extra ? '<span>: ' + esc(extra[1]) + '</span>' : '') + '<i data-lucide="chevron-down" aria-hidden="true"></i>' +
          '</button>' +
          '<div class="c-more-list" id="c-more-list"' + (maisAberto ? '' : ' hidden') + '>' + MAIS_ASSUNTOS.map(chip).join('') + '</div>' +
        '</div>' +
      '</div>'
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
  // comJoinhas: só na Central, a capa mostra o selo "👍 ×N" e o botão diz o total para o leitor de tela.
  function cardHtml(v, comJoinhas) {
    comJoinhas = comJoinhas === true && !!window.Avaliacao;
    var nJoinhas = comJoinhas ? window.Avaliacao.joinhas('video', v.id) : 0;
    var cat = v.categoria + (/\/videos\/nivel/.test(v.v || '') && v.trilha ? ' · passo a passo do módulo ' + v.trilha.nivel : '');
    return (
      '<article class="portal-vcard' + (v.tipo === 'entenda' ? ' portal-vcard--entenda' : '') + '">' +
        '<button type="button" class="portal-vthumb' + (v.capa ? ' has-capa' : '') + '" data-c-video="' + esc(v.id) + '" tabindex="-1" aria-hidden="true">' +
          '<img src="' + esc(v.capa || v.v + '.jpg') + '" alt="" loading="lazy" decoding="async" width="960" height="540"><span class="c-play"></span>' +
          (v.duracao ? '<span class="c-dur">' + esc(v.duracao) + '</span>' : '') +
          (comJoinhas ? window.Avaliacao.selo('video', v.id) : '') +
        '</button>' +
        '<div class="portal-vbody">' +
          (cat ? '<span class="portal-vcat">' + esc(cat) + '</span>' : '') +
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

  function listaVideos() {
    // Busca também na narração do vídeo (termos), além de título, resumo e categoria.
    return (C.videos || []).filter(function (v) { return bate(v.titulo + ' ' + v.resumo + ' ' + v.categoria + ' ' + (v.termos || ''), nivelDe(v)); })
      .map(function (v, i) { return { v: v, i: i }; })
      .sort(function (a, b) {
        // Mais curtidos primeiro (👍 dos alunos); no empate, a ordem da jornada.
        return joinhasDe(b.v) - joinhasDe(a.v) ||
          (nivelDe(a.v) || 99) - (nivelDe(b.v) || 99) || (a.v.tipo === 'entenda') - (b.v.tipo === 'entenda') || a.i - b.i;
      })
      .map(function (x) { return x.v; });
  }
  function joinhasDe(v) { return window.Avaliacao ? window.Avaliacao.joinhas('video', v.id) : 0; }
  function gruposFaq() {
    return (C.faq || []).map(function (g) {
      return { g: g, ps: g.perguntas.filter(function (p) { return bate(p.q + ' ' + p.a + ' ' + (p.tags || []).join(' '), nivelDe(p)); }) };
    }).filter(function (x) { return x.ps.length; });
  }

  function videos() {
    // Ordem da jornada (nível da trilha): quem está começando vê "Primeiros passos" primeiro.
    var todos = (C.videos || []).length;
    var lista = listaVideos();
    var corpo;
    if (!todos) corpo = '<p class="c-empty">Os vídeos novos estão sendo gravados. Enquanto isso, a trilha e as perguntas abaixo explicam tudo.</p>';
    else if (!lista.length) corpo = '<p class="c-empty">Nenhum vídeo sobre isso. Veja as perguntas abaixo.</p>';
    else corpo = '<div class="portal-video-grid">' + lista.map(function (v) { return cardHtml(v, true); }).join('') + '</div>';
    // Assunto "Primeiro acesso": RGM e e-mail acadêmico do próprio aluno, quando o app tem (dados-acesso.js).
    if (assunto === 1) corpo = '<div data-dados-acesso-slot="faixa" data-dados-acesso-onde="central" hidden></div>' + corpo;
    var conta = !todos ? '' : (lista.length === todos ? todos + ' vídeos' : lista.length + ' de ' + todos + ' vídeos');
    return (
      '<section class="c-block" aria-labelledby="c-h-videos">' +
        '<div class="portal-sec-head"><div><h2 id="c-h-videos">Vídeos rápidos</h2><p>Uma tarefa por vídeo. Sem complicação.</p></div>' +
        (conta ? '<span class="c-count">' + conta + '</span>' : '') + '</div>' + corpo +
      '</section>'
    );
  }

  // FAQ: assuntos à esquerda (no celular, faixa rolável) e as perguntas do assunto à direita.
  // Com busca, mostra o que bateu em todos os assuntos. Tudo começa fechado; uma resposta aberta por vez.
  function faq() {
    var grupos = gruposFaq();
    var titulo = '<h2 id="c-h-faq" class="c-h">Perguntas frequentes <span>escolha um assunto e toque na pergunta</span></h2>';
    if (!grupos.length) {
      return '<section id="c-faq" class="c-sec" aria-labelledby="c-h-faq">' + titulo +
        '<p class="c-empty">Não achamos essa dúvida nas perguntas. Fale com a equipe logo abaixo.</p></section>';
    }
    var atual = grupos.filter(function (x) { return x.g.id === faqGrupo; })[0] || grupos[0];
    var mostrar = busca ? grupos : [atual];
    var total = grupos.reduce(function (n, x) { return n + x.ps.length; }, 0);

    var nav = busca
      ? '<p class="c-fsum">' + total + (total === 1 ? ' resposta' : ' respostas') + ' para a sua busca</p>'
      : '<div class="c-ftabs" role="group" aria-label="Assuntos das perguntas">' + grupos.map(function (x) {
          return (
            '<button type="button" class="c-ftab" data-c-faq="' + esc(x.g.id) + '" aria-pressed="' + (x === atual) + '" aria-controls="c-fpanel">' +
              '<i data-lucide="' + (ICONES_FAQ[x.g.id] || 'circle-help') + '" aria-hidden="true"></i>' +
              '<span class="c-ftab-t">' + esc(x.g.titulo) + '</span>' +
              '<span class="c-fcount"><span aria-hidden="true">' + x.ps.length + '</span><span class="sr-only">, ' + x.ps.length + (x.ps.length === 1 ? ' pergunta' : ' perguntas') + '</span></span>' +
            '</button>'
          );
        }).join('') + '</div>';

    var painel = mostrar.map(function (x) {
      return (
        '<div class="c-fgroup">' +
          '<h3>' + esc(x.g.titulo) + (busca ? '' : ' <span>' + x.ps.length + (x.ps.length === 1 ? ' pergunta' : ' perguntas') + '</span>') + '</h3>' +
          x.ps.map(function (p, i) {
            var id = esc(x.g.id + '-' + (p.id || i));
            return (
              '<div class="c-q">' +
                '<h4><button type="button" class="c-qbtn" id="c-qb-' + id + '" aria-expanded="false" aria-controls="c-qa-' + id + '">' + esc(p.q) + '</button></h4>' +
                '<div class="c-a" id="c-qa-' + id + '" role="region" aria-labelledby="c-qb-' + id + '" hidden><p>' + p.a + '</p>' + linkTrilha(p) + avaliacao('faq', p.id) + '</div>' +
              '</div>'
            );
          }).join('') +
        '</div>'
      );
    }).join('');

    return (
      '<section id="c-faq" class="c-sec" aria-labelledby="c-h-faq">' + titulo +
        '<div class="c-faq' + (busca ? ' is-busca' : '') + '">' + nav +
          '<div class="c-fpanel" id="c-fpanel">' + painel + '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function alternarPergunta(btn) {
    var abrir = btn.getAttribute('aria-expanded') !== 'true';
    var painel = document.getElementById('c-fpanel');
    if (painel) painel.querySelectorAll('.c-qbtn[aria-expanded="true"]').forEach(function (b) {
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

  // No celular os assuntos rolam na horizontal: deixa o assunto aberto à vista, sem mexer na página.
  function mostrarAbaAtiva() {
    var faixa = document.querySelector('#central-ajuda .c-ftabs');
    var aba = faixa && faixa.querySelector('[aria-pressed="true"]');
    if (!aba || faixa.scrollWidth <= faixa.clientWidth) return;
    faixa.scrollLeft = aba.offsetLeft - faixa.offsetLeft - 18;
  }

  function renderFaq() {
    var sec = document.getElementById('c-faq');
    if (!sec || !C) return;
    sec.outerHTML = faq();
    if (window.lucide) window.lucide.createIcons();
    mostrarAbaAtiva();
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

  function contagem() {
    return { videos: listaVideos().length, faq: gruposFaq().reduce(function (n, x) { return n + x.ps.length; }, 0) };
  }

  function resultados() {
    var n = contagem();
    if ((busca || assunto) && !n.videos && !n.faq) return vazio();
    return videos() + faq();
  }

  // Anuncia o resultado para leitor de tela (busca e filtro).
  function anunciar() {
    var st = document.getElementById('c-status');
    if (!st) return;
    if (!busca && !assunto) { st.textContent = ''; return; }
    var n = contagem();
    st.textContent = (!n.videos && !n.faq)
      ? 'Não encontramos esse assunto.'
      : n.videos + (n.videos === 1 ? ' vídeo' : ' vídeos') + ' e ' + n.faq + (n.faq === 1 ? ' pergunta encontrada.' : ' perguntas encontradas.');
  }

  function render(foco) {
    var box = document.getElementById('central-ajuda');
    if (!box || !C) return;
    box.innerHTML = hero() + '<div id="c-chips-wrap">' + chips() + '</div>' + trilhaCard() +
      '<div data-apps-slot></div>' +
      '<p id="c-status" class="sr-only" role="status" aria-live="polite"></p>' +
      '<div id="c-res">' + resultados() + '</div>' + suporte();
    if (window.Apps) window.Apps.render(box);
    if (window.lucide) window.lucide.createIcons();
    if (window.DadosAcesso) window.DadosAcesso.render(box);
    mostrarAbaAtiva();
    if (foco) {
      var inp = document.getElementById('c-busca');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
  }
  // Ao digitar ou trocar de assunto, só chips e resultados mudam (o foco fica onde estava).
  function renderResultados() {
    var res = document.getElementById('c-res');
    if (!res || !C) return;
    var wrap = document.getElementById('c-chips-wrap');
    if (wrap) wrap.innerHTML = chips();
    res.innerHTML = resultados();
    if (window.lucide) window.lucide.createIcons();
    if (window.DadosAcesso) window.DadosAcesso.render(res);
    mostrarAbaAtiva();
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

  function abrirVideo(id, gatilho) {
    var v = (C && C.videos || []).find(function (x) { return x.id === id; });
    if (!v) return;
    track('central_video', { video: v.titulo, categoria: v.categoria });
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

  function fecharMais(focarBotao) {
    if (!maisAberto) return;
    maisAberto = false;
    var lista = document.getElementById('c-more-list');
    var btn = document.querySelector('#central-ajuda .c-chip--more');
    if (lista) lista.hidden = true;
    if (btn) { btn.setAttribute('aria-expanded', 'false'); if (focarBotao) btn.focus(); }
  }

  function init() {
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
      aplicarBusca(inp ? inp.value : '');
      clearTimeout(buscaTimer);
      rastreiaBusca(inp ? inp.value.trim() : '');
      var res = document.getElementById('c-chips-wrap');
      if (res && busca) res.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.addEventListener('click', function (e) {
      var t = e.target;
      var mais = t.closest('#central-ajuda .c-chip--more');
      if (mais) {
        maisAberto = !maisAberto;
        mais.setAttribute('aria-expanded', String(maisAberto));
        var lista = document.getElementById('c-more-list'); if (lista) lista.hidden = !maisAberto;
        if (maisAberto) { var pri = lista && lista.querySelector('button'); if (pri) pri.focus(); }
        return;
      }
      if (maisAberto && !t.closest('#central-ajuda .c-more')) fecharMais(false);
      var chipBtn = t.closest('#central-ajuda [data-assunto]');
      if (chipBtn) {
        var novo = Number(chipBtn.getAttribute('data-assunto')) || 0;
        var doMais = !!chipBtn.closest('.c-more-list');
        assunto = novo;
        maisAberto = false;
        renderResultados();
        var alvo = doMais
          ? document.querySelector('#central-ajuda .c-chip--more')
          : document.querySelector('#central-ajuda .c-chips > [data-assunto="' + novo + '"]');
        if (alvo) alvo.focus({ preventScroll: true });
        return;
      }
      if (t.closest('#central-ajuda [data-c-limpar]')) {
        assunto = 0; maisAberto = false;
        var inp = document.getElementById('c-busca'); if (inp) inp.value = '';
        aplicarBusca('');
        if (inp) inp.focus();
        return;
      }
      var tab = t.closest('#central-ajuda [data-c-faq]');
      if (tab) {
        faqGrupo = tab.getAttribute('data-c-faq') || '';
        renderFaq();
        var novaAba = document.querySelector('#central-ajuda [data-c-faq="' + faqGrupo + '"]');
        if (novaAba) novaAba.focus({ preventScroll: true });
        return;
      }
      var q = t.closest('#central-ajuda .c-qbtn');
      if (q) { alternarPergunta(q); return; }
      var vid = t.closest('[data-c-video]');
      if (vid) {
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
        if (m && !m.hidden) { fecharVideo(); return; }
        if (maisAberto) fecharMais(true);
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
