/* Avaliação "joinha pra cima / pra baixo" nos vídeos e respostas (Central de ajuda e Aula Inaugural).
   Avaliacao.html(tipo, id) devolve a linha com os dois botões; o clique é tratado aqui (delegação).
   tipo: 'video' (vídeos da Central), 'faq' (respostas) ou 'aula' (vídeos da Aula Inaugural).
   Os votos do aluno vêm uma vez de GET /api/avaliacoes/minhas e são salvos com POST /api/avaliacoes
   (voto 1, -1 ou 0 para desfazer). Atualização otimista: se o POST falhar, o botão volta como estava.
   Depois de um 👎 abre a caixa "O que não ficou bom?": o texto vai para POST /api/avaliacoes/comentario
   e aparece para a equipe no admin. Trocar o voto para 👍 ou desfazer apaga o comentário.
   Só aparece para quem tem a trilha liberada (body.trilha-on, ver avaliacao.css). */
window.Avaliacao = (function () {
  'use strict';

  var votos = {};          // { "video:tut_11": 1, "faq:dp-adaptacao": -1 }
  var comentarios = {};    // { "aula:modulo-4": "texto do aluno" } (só nos 👎)
  var tokenVotos = null;   // sessão dona dos votos carregados (troca de conta recarrega)
  var carregando = null;
  var salvando = {};
  var seq = 0;

  var PERGUNTA = { video: 'Este vídeo ajudou?', faq: 'Esta resposta ajudou?', aula: 'Este vídeo ajudou?' };

  // Ícones Lucide thumbs-up / thumbs-down (SVG em linha: não depende de lucide.createIcons).
  var ICO_UP = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>';
  var ICO_DOWN = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>';

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function chave(tipo, id) { return tipo + ':' + id; }
  function token() { return window.Auth && window.Auth.getToken ? window.Auth.getToken() : null; }

  // Carrega os votos uma vez por sessão. Erro de rede ou rota ausente: segue sem marcar nada.
  function carregar() {
    var tk = token();
    if (!tk || !window.Api || !window.Api.getMinhasAvaliacoes) return Promise.resolve(votos);
    if (tokenVotos === tk) return carregando || Promise.resolve(votos);
    tokenVotos = tk; votos = {}; comentarios = {}; salvando = {};
    carregando = window.Api.getMinhasAvaliacoes().then(function (r) {
      if (tokenVotos !== tk) return;
      var v = (r && r.votos) || {};
      Object.keys(v).forEach(function (k) { if (v[k] === 1 || v[k] === -1) votos[k] = v[k]; });
      var c = (r && r.comentarios) || {};
      Object.keys(c).forEach(function (k) { if (votos[k] === -1 && typeof c[k] === 'string') comentarios[k] = c[k]; });
      pintarTodos();
    }).catch(function () { /* sem os votos salvos: os botões começam desmarcados */ })
      .then(function () { carregando = null; return votos; });
    return carregando;
  }

  function html(tipo, id, opts) {
    if (!tipo || !id) return '';
    carregar();
    var k = chave(tipo, id);
    var atual = votos[k] || 0;
    var qid = 'aval-q-' + (++seq);
    var cid = 'aval-c-' + seq;
    var enviado = atual === -1 && !!comentarios[k];
    var pergunta = (opts && opts.pergunta) || PERGUNTA[tipo] || 'Isto ajudou?';
    function botao(v, rotulo, ico) {
      return '<button type="button" class="aval-btn" data-aval-voto="' + v + '" aria-pressed="' + (atual === v) + '" aria-label="' + rotulo + '" title="' + rotulo + '">' + ico + '</button>';
    }
    return (
      '<div class="aval" data-aval="' + esc(k) + '" data-aval-tipo="' + esc(tipo) + '" data-aval-id="' + esc(id) + '">' +
        '<div class="aval-linha">' +
          '<p class="aval-q" id="' + qid + '">' + esc(pergunta) + '</p>' +
          '<div class="aval-btns" role="group" aria-labelledby="' + qid + '">' +
            botao(1, 'Gostei', ICO_UP) + botao(-1, 'Não gostei', ICO_DOWN) +
          '</div>' +
          '<p class="aval-st" role="status" aria-live="polite"></p>' +
        '</div>' +
        '<div class="aval-coment"' + (atual === -1 ? '' : ' hidden') + '>' +
          '<form class="aval-coment-form" data-aval-form novalidate' + (enviado ? ' hidden' : '') + '>' +
            '<label class="aval-coment-q" for="' + cid + '">O que não ficou bom? Conte para a gente melhorar.</label>' +
            '<textarea id="' + cid + '" class="aval-coment-txt" rows="3" maxlength="500" placeholder="Ex.: a explicação ficou rápida demais"></textarea>' +
            '<div class="aval-coment-acoes"><button type="submit" class="aval-coment-enviar">Enviar comentário</button>' +
              '<span class="aval-coment-st" role="status" aria-live="polite"></span></div>' +
          '</form>' +
          '<p class="aval-coment-ok"' + (enviado ? '' : ' hidden') + '>Recebemos o seu comentário. Obrigado por ajudar a melhorar! ' +
            '<button type="button" class="aval-link" data-aval-editar>Editar</button></p>' +
        '</div>' +
      '</div>'
    );
  }

  function pintar(box) {
    var k = box.getAttribute('data-aval');
    var v = votos[k] || 0;
    box.querySelectorAll('[data-aval-voto]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-aval-voto')) === v));
    });
    var coment = box.querySelector('.aval-coment');
    if (!coment) return;
    coment.hidden = v !== -1;
    if (v !== -1) delete box.dataset.editando;
    var enviado = !!comentarios[k] && !box.dataset.editando;
    coment.querySelector('[data-aval-form]').hidden = enviado;
    coment.querySelector('.aval-coment-ok').hidden = !enviado;
  }
  function caixas(k) {
    return Array.prototype.filter.call(document.querySelectorAll('[data-aval]'), function (b) { return !k || b.getAttribute('data-aval') === k; });
  }
  function pintarTodos() { caixas().forEach(pintar); }

  function aviso(box, texto) {
    var st = box.querySelector('.aval-st');
    if (!st) return;
    st.classList.toggle('is-erro', texto === ERRO);
    st.textContent = '';
    // Pequena pausa para o leitor de tela anunciar mesmo quando o texto se repete.
    setTimeout(function () { st.textContent = texto; }, 30);
  }
  var ERRO = 'Não foi possível salvar agora.';

  function votar(btn) {
    var box = btn.closest('[data-aval]');
    if (!box) return;
    var k = box.getAttribute('data-aval');
    if (salvando[k]) return;
    var tipo = box.getAttribute('data-aval-tipo'), id = box.getAttribute('data-aval-id');
    var clicado = Number(btn.getAttribute('data-aval-voto'));
    var anterior = votos[k] || 0;
    var novo = anterior === clicado ? 0 : clicado;   // clicar no já marcado desmarca
    var comentarioAntes = comentarios[k];
    if (novo) votos[k] = novo; else delete votos[k];
    if (novo !== -1) delete comentarios[k];          // o servidor apaga o comentário quando sai do 👎
    caixas(k).forEach(pintar);
    salvando[k] = true;
    var tk = token();
    // O botão muda na hora; o "Obrigado!" só depois de salvo (o leitor de tela não ouve um agradecimento desmentido).
    window.Api.avaliar(tipo, id, novo).then(function () {
      if (document.contains(box)) aviso(box, novo ? 'Obrigado!' : 'Avaliação removida.');
      somarJoinha(tipo, id, (novo === 1 ? 1 : 0) - (anterior === 1 ? 1 : 0));
    }).catch(function () {
      if (tk !== tokenVotos) return;
      if (anterior) votos[k] = anterior; else delete votos[k];
      if (comentarioAntes) comentarios[k] = comentarioAntes;
      caixas(k).forEach(pintar);
      aviso(box, ERRO);
    }).then(function () { delete salvando[k]; });
  }

  // ---------- total de 👍 por conteúdo (selo na capa dos vídeos da Central) ----------
  var totaisCache = {};    // tipo -> { id: n }
  var totaisPromessa = {};

  // Uma busca por tipo e por sessão. Erro ou rota ausente: {} (sem selo, ordem normal).
  function totais(tipo) {
    var tk = token();
    if (totaisCache[tipo] && totaisCache[tipo].tk === tk) return Promise.resolve(totaisCache[tipo].mapa);
    if (!tk || !window.Api || !window.Api.getTotaisAvaliacoes) return Promise.resolve({});
    if (!totaisPromessa[tipo]) {
      totaisPromessa[tipo] = window.Api.getTotaisAvaliacoes(tipo).then(function (r) {
        var t = (r && r.totais) || {}, mapa = {};
        Object.keys(t).forEach(function (id) { var n = Math.floor(Number(t[id]) || 0); if (n > 0) mapa[id] = n; });
        totaisCache[tipo] = { tk: tk, mapa: mapa };
        return mapa;
      }).catch(function () { return {}; })
        .then(function (m) { delete totaisPromessa[tipo]; return m; });
    }
    return totaisPromessa[tipo];
  }
  function joinhas(tipo, id) {
    var c = totaisCache[tipo];
    return (c && c.tk === token() && c.mapa[id]) || 0;
  }
  // Selo "👍 ×N" (só com N > 0). Fica escondido do leitor de tela: o total vai no texto do botão do card.
  function selo(tipo, id) {
    var n = joinhas(tipo, id);
    return '<span class="aval-selo" data-aval-selo="' + esc(tipo + ':' + id) + '"' + (n ? '' : ' hidden') + ' aria-hidden="true">' +
      ICO_UP + '<span>×' + n + '</span></span>';
  }
  // O voto do próprio aluno muda o selo na hora (a ordem da lista não pula).
  function somarJoinha(tipo, id, delta) {
    var c = totaisCache[tipo];
    if (!delta || !c || c.tk !== token()) return;
    var n = Math.max(0, (c.mapa[id] || 0) + delta);
    if (n) c.mapa[id] = n; else delete c.mapa[id];
    document.querySelectorAll('[data-aval-selo]').forEach(function (s) {
      if (s.getAttribute('data-aval-selo') !== tipo + ':' + id) return;
      s.hidden = !n; s.querySelector('span').textContent = '×' + n;
    });
  }

  // ---------- comentário do 👎 ----------
  function enviarComentario(form) {
    var box = form.closest('[data-aval]');
    if (!box) return;
    var k = box.getAttribute('data-aval');
    var txt = form.querySelector('textarea');
    var st = form.querySelector('.aval-coment-st');
    var btn = form.querySelector('.aval-coment-enviar');
    var texto = txt.value.trim();
    st.classList.remove('is-erro');
    if (!texto) { st.classList.add('is-erro'); st.textContent = 'Escreva o que não ficou bom.'; txt.focus(); return; }
    if (btn.disabled) return;
    btn.disabled = true; st.textContent = 'Enviando...';
    window.Api.comentarAvaliacao(box.getAttribute('data-aval-tipo'), box.getAttribute('data-aval-id'), texto).then(function () {
      comentarios[k] = texto;
      st.textContent = '';
      caixas(k).forEach(function (b) { delete b.dataset.editando; pintar(b); });
      var ok = box.querySelector('.aval-coment-ok');
      if (ok && document.contains(ok)) { ok.setAttribute('tabindex', '-1'); ok.focus(); }
    }).catch(function () {
      st.classList.add('is-erro'); st.textContent = 'Não foi possível enviar agora. Tente de novo.';
    }).then(function () { btn.disabled = false; });
  }

  function editarComentario(btn) {
    var box = btn.closest('[data-aval]');
    if (!box) return;
    box.dataset.editando = '1';
    pintar(box);
    var txt = box.querySelector('[data-aval-form] textarea');
    if (txt) { txt.value = comentarios[box.getAttribute('data-aval')] || ''; txt.focus(); }
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var b = t.closest('[data-aval] [data-aval-voto]');
    if (b) { votar(b); return; }
    var ed = t.closest('[data-aval] [data-aval-editar]');
    if (ed) { e.preventDefault(); editarComentario(ed); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target && e.target.closest && e.target.closest('[data-aval] [data-aval-form]');
    if (!f) return;
    e.preventDefault();
    enviarComentario(f);
  });

  return { html: html, carregar: carregar, totais: totais, joinhas: joinhas, selo: selo };
})();
