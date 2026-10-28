/* Painel único "Como podemos ajudar?". Todo botão com [data-help-open] abre esta mesma
   instância (aba lateral no computador, folha inteira no celular), por cima da página.
   Três caminhos: Não consigo entrar (subpainel com os 3 vídeos de acesso), Tenho uma dúvida
   (Central de ajuda) e Falar com a equipe (WhatsApp acadêmico do polo, o mesmo da tela de
   Atendimento). Comercial e indicação ficam fora daqui, na tela de Atendimento. */
window.Ajuda = (function () {
  'use strict';

  var el = null;
  var gatilho = null;
  var waUrl = null;     // WhatsApp acadêmico do polo (GET /api/atendimento)
  var waPromessa = null;

  // Vídeos reais da Central (server/assets/central/videos.json).
  var ACESSO = [
    { video: 'acesso-email-senha', titulo: 'Descobrir o e-mail e a senha', sub: 'O e-mail acadêmico e a primeira senha' },
    { video: 'acesso-entrar-duda', titulo: 'Entrar no Duda', sub: 'O número na tela e a confirmação' },
    { video: 'acesso-authenticator', titulo: 'Ligar o Authenticator', sub: 'Deixar o app pronto para o login' },
  ];

  function carregarWhatsapp() {
    if (waUrl || waPromessa || !window.Api || !window.Auth.isAuthenticated()) return waPromessa;
    waPromessa = window.Api.getAtendimento().then(function (r) {
      waUrl = (r && r.academico && r.academico.url) || null;
      atualizarLinkEquipe();
    }).catch(function () { /* sem o número: o botão leva à tela de Atendimento */ })
      .then(function () { waPromessa = null; });
    return waPromessa;
  }

  function atualizarLinkEquipe() {
    if (!el) return;
    var a = el.querySelector('[data-ajuda-equipe]');
    if (!a) return;
    if (waUrl) {
      a.href = waUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.removeAttribute('data-go');
      a.querySelector('.sr-only').textContent = ' (abre o WhatsApp em nova aba)';
    }
  }

  function opcao(attrs, icone, titulo, sub, extra) {
    return '<li><' + (attrs.href ? 'a' : 'button type="button"') + ' class="ajuda-op" ' + attrs.str + '>' +
      '<span class="ajuda-op-ico' + (extra || '') + '" aria-hidden="true"><i data-lucide="' + icone + '"></i></span>' +
      '<span class="ajuda-op-t"><strong>' + titulo + '</strong><span>' + sub + '</span></span>' +
      '<i data-lucide="chevron-right" class="ajuda-op-go" aria-hidden="true"></i>' +
      (attrs.href ? '<span class="sr-only"></span></a>' : '</button>') + '</li>';
  }

  function montar() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'ajuda';
    el.hidden = true;
    el.innerHTML =
      '<div class="ajuda-fundo" data-ajuda-fechar></div>' +
      '<div class="ajuda-painel" role="dialog" aria-modal="true" aria-labelledby="ajuda-h">' +
        '<button type="button" class="ajuda-x" data-ajuda-fechar aria-label="Fechar a ajuda"><i data-lucide="x" aria-hidden="true"></i></button>' +
        '<div class="ajuda-tela" data-ajuda-tela="inicio">' +
          '<span class="ajuda-topo-ico" aria-hidden="true"><i data-lucide="messages-square"></i></span>' +
          '<h2 id="ajuda-h" tabindex="-1">Como podemos ajudar?</h2>' +
          '<p class="ajuda-sub">Escolha uma opção para continuar.</p>' +
          '<ul class="ajuda-ops">' +
            opcao({ str: 'data-ajuda-ir="acesso"' }, 'key-round', 'Não consigo entrar', 'Senha, Duda e Authenticator') +
            opcao({ str: 'data-ajuda-duvida' }, 'search', 'Tenho uma dúvida', 'Vídeos e perguntas frequentes') +
            opcao({ href: true, str: 'href="/atendimento" data-go="atendimento-page" data-ajuda-equipe' }, 'message-circle', 'Falar com a equipe', 'Atendimento do seu polo', ' ajuda-op-ico--wa') +
          '</ul>' +
          '<p class="ajuda-nota"><i data-lucide="users" aria-hidden="true"></i>Conte com a equipe do seu polo.</p>' +
        '</div>' +
        '<div class="ajuda-tela" data-ajuda-tela="acesso" hidden>' +
          '<button type="button" class="ajuda-voltar" data-ajuda-ir="inicio"><i data-lucide="chevron-left" aria-hidden="true"></i>Voltar</button>' +
          '<h2 id="ajuda-h-acesso" tabindex="-1">Não consigo entrar</h2>' +
          '<p class="ajuda-sub">Veja o passo a passo do que está travando.</p>' +
          '<ul class="ajuda-ops">' + ACESSO.map(function (x) {
            return opcao({ str: 'data-ajuda-video="' + x.video + '"' }, 'play-circle', x.titulo, x.sub);
          }).join('') + '</ul>' +
          '<p class="ajuda-nota">Ainda travado? <button type="button" class="ajuda-link" data-ajuda-ir="inicio" data-ajuda-foco-equipe>Falar com a equipe</button></p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    atualizarLinkEquipe();
    if (window.lucide) window.lucide.createIcons();
    return el;
  }

  function mostrarTela(nome, focarEquipe) {
    el.querySelectorAll('[data-ajuda-tela]').forEach(function (t) { t.hidden = t.getAttribute('data-ajuda-tela') !== nome; });
    var alvo = focarEquipe ? el.querySelector('[data-ajuda-equipe]') : el.querySelector('[data-ajuda-tela="' + nome + '"] h2');
    if (alvo) alvo.focus();
  }

  function abrir(origem) {
    montar();
    carregarWhatsapp();
    // Abrir de novo não empilha: é sempre a mesma instância.
    if (!el.hidden) return;
    gatilho = origem || document.activeElement;
    mostrarTela('inicio');
    el.hidden = false;
    document.documentElement.classList.add('ajuda-aberta');
    mostrarTela('inicio');
    if (window.Rastreio) window.Rastreio.track('ajuda_aberta', { tela: window.location.pathname });
  }

  // devolverFoco=false quando o painel fecha porque a tela mudou ou um vídeo abriu.
  function fechar(devolverFoco) {
    if (!el || el.hidden) return;
    el.hidden = true;
    document.documentElement.classList.remove('ajuda-aberta');
    var g = gatilho; gatilho = null;
    if (devolverFoco !== false && g && document.contains(g) && g.offsetParent !== null) g.focus();
  }

  function focaveis() {
    return Array.prototype.filter.call(
      el.querySelectorAll('.ajuda-painel button, .ajuda-painel a[href]'),
      function (x) { return x.offsetParent !== null; },
    );
  }

  function init() {
    document.addEventListener('click', function (e) {
      var abre = e.target.closest('[data-help-open]');
      if (abre) { e.preventDefault(); abrir(abre); return; }
      if (!el || el.hidden || !el.contains(e.target)) return;
      if (e.target.closest('[data-ajuda-fechar]')) { fechar(); return; }
      var ir = e.target.closest('[data-ajuda-ir]');
      if (ir) { mostrarTela(ir.getAttribute('data-ajuda-ir'), ir.hasAttribute('data-ajuda-foco-equipe')); return; }
      var vid = e.target.closest('[data-ajuda-video]');
      if (vid) {
        var g = gatilho;
        fechar(false);
        if (window.Apps) window.Apps.abrirTutorial(vid.getAttribute('data-ajuda-video'), g);
        return;
      }
      if (e.target.closest('[data-ajuda-duvida]')) {
        fechar(false);
        var naCentral = !document.getElementById('tutoriais-page').classList.contains('hidden');
        if (naCentral && window.Central && window.Central.focarBusca()) return;
        window.showScreen('tutoriais-page');
        setTimeout(function () { if (window.Central) window.Central.focarBusca(); }, 400);
        return;
      }
      var eq = e.target.closest('[data-ajuda-equipe]');
      if (eq) {
        // Com o pedido de ajuda ligado: grava o pedido com protocolo e a tela atual, e abre o canal com a mensagem.
        if (window.Dificuldade && window.Dificuldade.ativo()) {
          e.preventDefault();
          var janela = window.open('', '_blank');
          fechar(false);
          window.Dificuldade.falar({ origem: 'ajuda_painel' }, janela).catch(function () {
            if (janela) { if (waUrl) janela.location.href = waUrl; else janela.close(); }
          });
          return;
        }
        if (window.Rastreio) window.Rastreio.track('whatsapp_clicado', { origem: 'painel de ajuda' });
        fechar(false); // link externo abre em nova aba; interno troca de tela (o data-go cuida)
      }
    });
    document.addEventListener('keydown', function (e) {
      if (!el || el.hidden) return;
      if (e.key === 'Escape') {
        var vid = document.getElementById('c-modal');
        if (vid && !vid.hidden) return; // o vídeo fecha primeiro
        e.preventDefault();
        fechar();
        return;
      }
      if (e.key !== 'Tab') return;
      var f = focaveis();
      if (!f.length) return;
      var primeiro = f[0], ultimo = f[f.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
      else if (!el.contains(document.activeElement)) { e.preventDefault(); primeiro.focus(); }
    });
  }

  // Sair da conta: esquece o número do polo do aluno anterior.
  function limpar() { fechar(false); waUrl = null; if (el) { el.remove(); el = null; } }

  return { init: init, abrir: abrir, fechar: fechar, limpar: limpar };
})();
