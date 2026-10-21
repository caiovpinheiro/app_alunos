/*
 * Palavras do EaD explicadas no próprio texto da Aula Inaugural.
 *
 * Substitui o antigo "Dicionário do aluno" (bloco de cartões no fim da tela). Cada termo do
 * glossário (server/assets/trilha.json → glossario: [termo, explicação, variantes?]) vira um botão
 * discreto, com sublinhado pontilhado, na primeira vez que aparece em cada bloco (um módulo,
 * "Sua primeira semana", "Travou?"). Tocar abre um balão com a explicação.
 *
 * Acessibilidade (padrão "toggletip"): o termo é um <button> com aria-expanded; a explicação entra
 * numa região role="status", que o leitor de tela anuncia. Esc, tocar fora ou tocar de novo fecha.
 */
window.Glossario = (function () {
  'use strict';

  // Onde procurar os termos: só textos corridos (não títulos, botões, links nem o quiz).
  var BLOCOS = '.todo .tx, .help p, .level .topicos li, .level .learn li, .level .tip span';
  var PULAR = 'a, button, summary, label, h1, h2, h3, h4, code, .glo-t';
  var ESCOPO = '.level, .start, .help';
  var LETRA = '0-9A-Za-z_À-ÖØ-öø-ÿ';

  var lista = [];
  var pop = null;
  var aberto = null;
  var raf = 0;

  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Variantes: a 3ª coluna do JSON; sem ela, o próprio termo e as partes de "X ou Y" / "X (Y)".
  function variantes(g) {
    if (Array.isArray(g[2]) && g[2].length) return g[2];
    return String(g[0]).split(/\s+ou\s+|\s*[()]\s*/).filter(Boolean);
  }

  function compilar() {
    var itens = [];
    lista.forEach(function (g, id) {
      variantes(g).forEach(function (v) {
        var sigla = v === v.toUpperCase(); // A1, AF, DP, MB: só em maiúsculas
        itens.push({ id: id, len: v.length, re: new RegExp('(^|[^' + LETRA + '])(' + escRe(v) + ')(?![' + LETRA + '])', sigla ? '' : 'i') });
      });
    });
    return itens;
  }

  function botao(texto, id) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'glo-t';
    b.textContent = texto;
    b.setAttribute('data-glo', String(id));
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'gloPop');
    return b;
  }

  // Marca, num nó de texto, a ocorrência mais cedo de um termo ainda não marcado neste escopo.
  function marcarNo(no, itens, usados) {
    var texto = no.nodeValue;
    var melhor = null;
    itens.forEach(function (it) {
      if (usados[it.id]) return;
      var m = it.re.exec(texto);
      if (!m) return;
      var ini = m.index + m[1].length;
      if (!melhor || ini < melhor.ini || (ini === melhor.ini && m[2].length > melhor.len)) melhor = { ini: ini, len: m[2].length, id: it.id };
    });
    if (!melhor) return;
    usados[melhor.id] = true;
    var termo = no.splitText(melhor.ini);
    var depois = termo.splitText(melhor.len);
    termo.parentNode.replaceChild(botao(termo.nodeValue, melhor.id), termo);
    marcarNo(depois, itens, usados);
  }

  function marcarBlocos(root) {
    var itens = compilar();
    var escopos = [];
    var usadosPor = [];
    root.querySelectorAll(BLOCOS).forEach(function (bloco) {
      var esc = bloco.closest(ESCOPO) || root;
      var k = escopos.indexOf(esc);
      if (k < 0) { k = escopos.push(esc) - 1; usadosPor.push({}); }
      var nos = [];
      var w = document.createTreeWalker(bloco, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        var pular = w.currentNode.parentElement && w.currentNode.parentElement.closest(PULAR);
        if (pular && bloco.contains(pular)) continue;
        if (/\S/.test(w.currentNode.nodeValue)) nos.push(w.currentNode);
      }
      nos.forEach(function (no) { marcarNo(no, itens, usadosPor[k]); });
    });
  }

  // O balão fica no <body>: dentro da tela, um ancestral com transform mudaria a referência do position:fixed.
  function criarPop(root) {
    if (pop && pop.isConnected) { pop.classList.toggle('glo-big', root.classList.contains('big')); return; }
    pop = document.createElement('div');
    pop.className = 'glo-pop';
    pop.id = 'gloPop';
    // A região role=status fica sempre no DOM (vazia quando fechada) para o anúncio funcionar.
    pop.innerHTML = '<div class="glo-in" role="status" aria-live="polite"></div>' +
      '<button type="button" class="glo-x" tabindex="-1" aria-label="Fechar explicação">×</button>';
    document.body.appendChild(pop);
  }

  function posicionar() {
    if (!aberto || !pop) return;
    var r = aberto.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var vh = window.innerHeight;
    if (!aberto.isConnected || !r.width || r.bottom < 0 || r.top > vh) { fechar(false); return; }
    var w = pop.offsetWidth;
    var h = pop.offsetHeight;
    var centro = r.left + r.width / 2;
    var left = Math.max(16, Math.min(centro - w / 2, vw - w - 16));
    var emCima = r.bottom + 12 + h > vh - 12 && r.top - 12 - h > 12;
    pop.classList.toggle('em-cima', emCima);
    pop.style.left = left + 'px';
    pop.style.top = (emCima ? r.top - 12 - h : r.bottom + 12) + 'px';
    pop.style.setProperty('--seta', Math.max(18, Math.min(centro - left, w - 18)) + 'px');
  }

  // Enquanto aberto, acompanha a palavra a cada quadro: a página pode se mexer sem rolagem
  // (imagem carregando, vídeo abrindo, mudança de tamanho da janela).
  function acompanhar() {
    raf = 0;
    posicionar();
    if (aberto) raf = requestAnimationFrame(acompanhar);
  }

  function abrir(b) {
    if (aberto) fechar(false);
    var g = lista[Number(b.getAttribute('data-glo'))];
    if (!g || !pop) return;
    aberto = b;
    b.setAttribute('aria-expanded', 'true');
    var tela = b.closest('.trilha');
    pop.classList.toggle('glo-big', !!(tela && tela.classList.contains('big')));
    var inner = pop.querySelector('.glo-in');
    inner.innerHTML = '';
    // Preenche num segundo momento para o leitor de tela perceber a mudança e anunciar;
    // o balão só aparece já com o texto (sem piscar vazio).
    setTimeout(function () {
      if (aberto !== b) return;
      inner.innerHTML = '<b>' + g[0] + '</b>' + g[1];
      pop.classList.add('is-open');
      posicionar();
      if (aberto && !raf) raf = requestAnimationFrame(acompanhar);
    }, 30);
  }

  function fechar(devolverFoco) {
    if (!aberto) return;
    var b = aberto;
    aberto = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    b.setAttribute('aria-expanded', 'false');
    if (pop) {
      pop.classList.remove('is-open', 'em-cima');
      pop.querySelector('.glo-in').innerHTML = '';
    }
    if (devolverFoco && b.isConnected) b.focus();
  }

  var ligado = false;
  function ligarEventos() {
    if (ligado) return;
    ligado = true;
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.glo-t');
      if (b) { if (aberto === b) fechar(false); else abrir(b); return; }
      if (e.target.closest && e.target.closest('.glo-x')) { fechar(true); return; }
      if (aberto && pop && !pop.contains(e.target)) fechar(false);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && aberto) fechar(true); });
    window.addEventListener('scroll', posicionar, { passive: true, capture: true });
    window.addEventListener('resize', posicionar);
  }

  /**
   * Marca os termos do glossário nos textos da Aula Inaugural.
   * @param {HTMLElement} root  raiz da tela (.trilha), já montada
   * @param {Array} glossario    [[termo, explicação (HTML), variantes?], ...]
   */
  function marcar(root, glossario) {
    if (!root || !Array.isArray(glossario) || !glossario.length) return;
    lista = glossario;
    aberto = null;
    marcarBlocos(root);
    criarPop(root);
    ligarEventos();
  }

  return { marcar: marcar, fechar: function () { fechar(false); } };
})();
