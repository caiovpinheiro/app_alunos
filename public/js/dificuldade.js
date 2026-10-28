/* Ajuda na hora da dificuldade. Quando o aluno toca em "Travei" ou mostra que está empacado
   (2 erros na mesma pergunta, muitas pausas no vídeo, buscas sem resultado, erro no certificado,
   parado no módulo), aparece no próprio lugar a oferta "Quer falar com a equipe agora?".
   O chat nunca abre sozinho: o aluno escolhe. Ao aceitar, o servidor grava um pedido com
   protocolo e o contexto (POST /api/ajuda/pedidos) e o aluno segue pelo canal disponível:
   o chat do CRM, se ele aceitar abrir com mensagem (contrato em docs/integracao/bwipo-eventos.md),
   ou o WhatsApp do polo com a mensagem pronta.
   Só liga para quem recebe ajuda: true em /api/recursos (AJUDA_ATIVA_PARA).
   Contra o excesso: nada com vídeo tocando; no máximo 2 ofertas automáticas por sessão;
   "Agora não" cala aquela oferta por 24 h; com pedido aberto, mostra o protocolo. */
window.Dificuldade = (function () {
  'use strict';

  var ativo = false;
  var AUTO_MAX = 2;
  var RECUSA_MS = 24 * 3600 * 1000;
  var PARADO_MS = 4 * 60 * 1000;
  var CHAVE_RECUSA = 'csu-ajuda-recusa';
  var CHAVE_AUTO = 'csu-ajuda-auto';
  var pedidos = {};          // 'n3' (módulo) ou origem -> { protocolo, mensagem, whatsapp_url } do pedido aberto
  var pausas = {};           // src do vídeo -> pausas antes do fim
  var buscas = [];           // { termo, em } sem resultado, últimos 10 min
  var desde = {};            // nível -> quando o aluno começou a mexer nele (tempo naquela parte)
  var paradoTimer = null;
  var paradoUsado = false;
  var ultimoNivel = null;

  function track(nome, dados, opts) { if (window.Rastreio) window.Rastreio.track(nome, dados, opts); }
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function ler(chave, padrao, sessao) {
    try { var v = (sessao ? sessionStorage : localStorage).getItem(chave); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; }
  }
  function gravar(chave, valor, sessao) {
    try { (sessao ? sessionStorage : localStorage).setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem storage: vale só nesta página */ }
  }
  function chaveDe(o) { return o.origem + ':' + (o.nivel || o.tela || ''); }
  // Mesmo critério do servidor para não duplicar: um pedido aberto por módulo (ou por origem, fora dos módulos).
  function chavePedido(o) { return o.nivel ? 'n' + o.nivel : o.origem; }
  function recusada(o) { var r = ler(CHAVE_RECUSA, {}); return r[chaveDe(o)] && Date.now() - r[chaveDe(o)] < RECUSA_MS; }
  function videoTocando() {
    return Array.prototype.some.call(document.querySelectorAll('video'), function (v) { return !v.paused && !v.ended && v.offsetParent !== null; });
  }
  function dispositivo() { var w = window.innerWidth || 0; return w < 640 ? 'celular' : w < 1024 ? 'tablet' : 'computador'; }
  function navegador() {
    var u = navigator.userAgent || '';
    var n = /Edg\//.test(u) ? 'Edge' : /SamsungBrowser/.test(u) ? 'Samsung Internet' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : 'outro';
    var so = /Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iOS' : /Windows/.test(u) ? 'Windows' : /Mac OS/.test(u) ? 'Mac' : '';
    return so ? n + ' ' + so : n;
  }

  // ---------- canal ----------
  // O chat do CRM, quando aceitar abrir com a mensagem; senão, o WhatsApp do polo.
  function chatComMensagem() {
    var b = window.BwipoWebchat;
    return b && typeof b.open === 'function' && b.capabilities && b.capabilities.prefill ? b : null;
  }
  function abrirCanal(r, janela) {
    var chat = chatComMensagem();
    if (chat) {
      if (janela) janela.close();
      try { chat.open({ message: r.mensagem, ref: r.protocolo }); return 'chat'; } catch (e) { /* cai para o WhatsApp */ }
    }
    if (r.whatsapp_url) {
      if (janela && !janela.closed) { janela.location.href = r.whatsapp_url; }
      else window.open(r.whatsapp_url, '_blank', 'noopener');
      return 'whatsapp';
    }
    if (janela) janela.close();
    return null;
  }

  // Cria o pedido (ou reaproveita o aberto) e abre o canal. A janela nova é aberta no clique,
  // antes da resposta do servidor, para o navegador não bloquear o WhatsApp.
  async function pedir(o, janela) {
    if (window.Rastreio && window.Rastreio.enviar) { try { await window.Rastreio.enviar(false); } catch (e) { /* segue */ } }
    var corpo = {
      origem: o.origem, tela: window.location.pathname.slice(0, 60), nivel: o.nivel || null,
      parte: o.parte == null ? null : o.parte, pergunta: o.pergunta == null ? null : o.pergunta,
      dispositivo: dispositivo(), navegador: navegador(),
      sinais: Object.assign({ tempo_s: o.nivel && desde[o.nivel] ? Math.round((Date.now() - desde[o.nivel]) / 1000) : null }, o.sinais || {}),
    };
    var r = await window.Api.criarPedidoAjuda(corpo);
    pedidos[chavePedido(o)] = r;
    track('ajuda_aceita', { origem: o.origem, nivel: o.nivel || null, protocolo: r.protocolo });
    // Para o chat do CRM (vira nota interna quando o widget aceitar track): o protocolo liga a conversa ao pedido.
    track('pedido_ajuda', { protocolo: r.protocolo, origem: o.origem, nivel: o.nivel || null, mensagem: r.mensagem }, { importante: true });
    var canal = abrirCanal(r, janela);
    return { r: r, canal: canal };
  }

  // ---------- cartão da oferta ----------
  function cartao(o) {
    var d = document.createElement('div');
    d.className = 'dif';
    d.setAttribute('role', 'status');
    d.setAttribute('data-dif', chaveDe(o));
    var pedidoAberto = pedidos[chavePedido(o)];
    if (pedidoAberto) {
      d.innerHTML = '<p class="dif-t">Seu pedido <b>' + esc(pedidoAberto.protocolo) + '</b> já está com a equipe.</p>' +
        '<p class="dif-s">Se precisar, abra a conversa de novo. A equipe já sabe em que parte você está.</p>' +
        '<div class="dif-acts"><button type="button" class="dif-sim" data-dif-reabrir>Abrir a conversa</button></div>';
      d.addEventListener('click', function (e) {
        if (!e.target.closest('[data-dif-reabrir]')) return;
        if (pedidoAberto.whatsapp_url || chatComMensagem()) { abrirCanal(pedidoAberto, null); return; }
        // Pedido de outra visita (sem o link guardado): o servidor devolve o mesmo pedido, com o link.
        var janela = window.open('', '_blank');
        pedir(o, janela).catch(function () { if (janela) janela.close(); });
      });
      return d;
    }
    d.innerHTML =
      '<p class="dif-t">' + esc(o.titulo || 'Quer falar com a equipe agora?') + '</p>' +
      '<p class="dif-s">' + esc(o.texto || 'A equipe do seu polo vai ver em que parte do portal você está, para ajudar mais rápido.') + '</p>' +
      '<div class="dif-acts"><button type="button" class="dif-sim" data-dif-sim>Falar com a equipe</button>' +
      '<button type="button" class="dif-nao" data-dif-nao>Agora não</button></div>';
    d.addEventListener('click', function (e) {
      if (e.target.closest('[data-dif-nao]')) {
        var r = ler(CHAVE_RECUSA, {}); r[chaveDe(o)] = Date.now(); gravar(CHAVE_RECUSA, r);
        track('ajuda_recusada', { origem: o.origem, nivel: o.nivel || null });
        d.remove();
        return;
      }
      if (!e.target.closest('[data-dif-sim]')) return;
      var janela = chatComMensagem() ? null : window.open('', '_blank');
      if (janela) { try { janela.opener = null; janela.document.title = 'Abrindo o WhatsApp…'; } catch (er) { /* ok */ } }
      var btn = e.target.closest('[data-dif-sim]');
      btn.disabled = true; btn.textContent = 'Enviando…';
      pedir(o, janela).then(function (x) {
        var onde = x.canal === 'chat' ? 'Abrimos o chat com a mensagem pronta.' : x.canal === 'whatsapp' ? 'Abrimos o WhatsApp do seu polo com a mensagem pronta. É só enviar.' : 'A equipe vai entrar em contato.';
        d.innerHTML = '<p class="dif-t">Pedido <b>' + esc(x.r.protocolo) + '</b> enviado para a equipe.</p><p class="dif-s">' + esc(onde) + '</p>' +
          (x.r.whatsapp_url ? '<div class="dif-acts"><a class="dif-link" href="' + esc(x.r.whatsapp_url) + '" target="_blank" rel="noopener noreferrer">Abrir o WhatsApp de novo</a></div>' : '');
      }).catch(function (err) {
        if (janela) janela.close();
        btn.disabled = false; btn.textContent = 'Falar com a equipe';
        var p = d.querySelector('.dif-s'); if (p) p.textContent = (err && err.message) || 'Não foi possível enviar agora. Toque em Ajuda, no topo, para falar com a equipe.';
      });
    });
    return d;
  }

  // Mostra a oferta logo depois de `ancora`. automatica: conta no limite da sessão e respeita "Agora não".
  function oferecer(o) {
    if (!ativo || !o || !o.ancora || !document.contains(o.ancora)) return false;
    if (o.ancora.parentNode && o.ancora.parentNode.querySelector('[data-dif="' + chaveDe(o) + '"]')) return false;
    if (o.automatica) {
      if (recusada(o)) return false;
      var n = ler(CHAVE_AUTO, 0, true);
      if (n >= AUTO_MAX) return false;
      if (videoTocando()) {
        // Espera o vídeo parar para não interromper.
        var v = Array.prototype.find.call(document.querySelectorAll('video'), function (x) { return !x.paused && !x.ended; });
        if (v) v.addEventListener('pause', function () { oferecer(o); }, { once: true });
        return false;
      }
      gravar(CHAVE_AUTO, n + 1, true);
    }
    o.ancora.insertAdjacentElement('afterend', cartao(o));
    track('ajuda_oferecida', { origem: o.origem, nivel: o.nivel || null, automatica: !!o.automatica });
    return true;
  }

  // "Falar com a equipe" do painel de ajuda: cria o pedido e abre o canal direto.
  function falar(o, janela) {
    if (!ativo) return null;
    return pedir(Object.assign({ origem: 'ajuda_painel' }, o || {}), janela);
  }

  // ---------- detectores ----------
  function nivelDoElemento(el) {
    var sec = el && el.closest ? el.closest('[id^="tlv"]') : null;
    var n = sec ? parseInt(sec.id.replace('tlv', ''), 10) : NaN;
    return Number.isFinite(n) ? n + 1 : null;
  }

  // 3 pausas no mesmo vídeo antes de 90% (só os vídeos da Aula Inaugural).
  function aoPausar(e) {
    var v = e.target;
    if (!ativo || !v || v.tagName !== 'VIDEO' || !v.closest('#trilha-root') || v.ended || !v.duration) return;
    var pct = v.currentTime / v.duration;
    if (pct >= 0.9 || v.currentTime < 2) return;
    var src = v.currentSrc || '';
    pausas[src] = (pausas[src] || 0) + 1;
    if (pausas[src] < 3) return;
    var nivel = nivelDoElemento(v);
    var ancora = v.closest('.lvpair') || v.closest('.vidwrap') || v.parentElement;
    oferecer({ origem: 'video_pausas', nivel: nivel, ancora: ancora, automatica: true,
      titulo: 'Esse vídeo está difícil de acompanhar?', sinais: { pausas: pausas[src], video_pct: Math.round(pct * 100), video: src.split('/').pop() } });
  }

  // 2 termos diferentes sem resultado na Central em 10 min ("matr" e "matricula" contam como um).
  function buscaVazia(termo) {
    if (!ativo || !termo) return;
    var t = String(termo).toLowerCase().trim();
    var agora = Date.now();
    buscas = buscas.filter(function (b) { return agora - b.em < 10 * 60 * 1000; });
    var igual = buscas.filter(function (b) { return b.termo.indexOf(t) === 0 || t.indexOf(b.termo) === 0; })[0];
    if (igual) { igual.termo = t.length > igual.termo.length ? t : igual.termo; igual.em = agora; }
    else buscas.push({ termo: t, em: agora });
    if (buscas.length < 2) return;
    var ancora = document.querySelector('#c-res .c-vazio-acts') || document.querySelector('#c-res .c-vazio');
    oferecer({ origem: 'busca_vazia', ancora: ancora, automatica: true, titulo: 'Não achou o que precisava?',
      texto: 'Fale com a equipe do seu polo. Vamos mandar o que você procurou, para ajudar mais rápido.',
      sinais: { termos: buscas.map(function (b) { return b.termo; }).slice(-3) } });
  }

  // Parado no módulo: 4 min com a página visível, sem tocar em nada e sem vídeo tocando. Uma vez por sessão.
  function reiniciarParado() {
    if (paradoTimer) clearTimeout(paradoTimer);
    if (!ativo || paradoUsado || !ultimoNivel) return;
    paradoTimer = setTimeout(function () {
      var tela = document.getElementById('trilha-page');
      if (document.hidden || !tela || tela.classList.contains('hidden') || videoTocando()) { reiniciarParado(); return; }
      var sec = document.getElementById('tlv' + (ultimoNivel - 1));
      var ancora = sec && (sec.querySelector('.s3 .part') || sec.querySelector('.part'));
      if (oferecer({ origem: 'parado', nivel: ultimoNivel, ancora: ancora, automatica: true, titulo: 'Precisa de uma mão neste módulo?' })) paradoUsado = true;
    }, PARADO_MS);
  }
  function aoInteragir(e) {
    var n = nivelDoElemento(e.target);
    if (n) { ultimoNivel = n; if (!desde[n]) desde[n] = Date.now(); }
    reiniciarParado();
  }

  function init() {
    document.addEventListener('pause', aoPausar, true);
    ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, aoInteragir, true); });
  }

  // Liga/desliga com o retorno de /api/recursos e lembra o pedido aberto (para não duplicar).
  function configurar(on) {
    ativo = !!on;
    if (!ativo) { pedidos = {}; return; }
    if (window.Api && window.Api.getPedidoAjudaAberto) {
      window.Api.getPedidoAjudaAberto().then(function (r) {
        var p = r && r.pedido;
        if (p && !pedidos[p.nivel ? 'n' + p.nivel : p.origem]) pedidos[p.nivel ? 'n' + p.nivel : p.origem] = { protocolo: p.protocolo, mensagem: null, whatsapp_url: null };
      }).catch(function () { /* sem a informação: oferece normalmente */ });
    }
  }

  return { init: init, configurar: configurar, oferecer: oferecer, falar: falar, buscaVazia: buscaVazia, ativo: function () { return ativo; } };
})();
