/* Aplicativos da jornada (Duda e Microsoft Authenticator) e a ajuda do primeiro acesso: uma configuração
   e um componente para todas as telas do aluno logado. Cada tela tem um único lugar [data-apps-slot]
   (data-apps-variant="compacta" nas telas internas). Artes oficiais em /assets/portal/apps/
   (origem em docs/integracao/apps-fontes-assets.json): não recolorir, cortar nem esticar.

   Duas partes: "Aplicativos para sua jornada" (baixar os dois apps) e "Como podemos ajudar no acesso?",
   com quatro abas (a mesma ordem do módulo 1 da Aula Inaugural). Cada aba abre o vídeo da Central
   (sem a Central liberada, a tela de tutoriais) e a orientação completa no módulo 1.
   Aba "E-mail e senha": quando o aluno já tem RGM/e-mail acadêmico, dados-acesso.js preenche
   [data-dados-acesso-slot="aba"] com os dados dele e a primeira senha (o texto padrão some). */
window.Apps = (function () {
  'use strict';

  var BASE = '/assets/portal/apps/';
  var APPS = [
    {
      id: 'duda',
      nome: 'Duda',
      descricao: 'Sua vida acadêmica no celular.',
      icone: 'duda-icon.png',
      ios: 'https://apps.apple.com/br/app/duda/id6451416655',
      android: 'https://play.google.com/store/apps/details?id=br.com.cruzeirodosulvirtual',
    },
    {
      id: 'microsoft-authenticator',
      nome: 'Microsoft Authenticator',
      descricao: 'Confirme seu acesso com segurança.',
      icone: 'microsoft-authenticator-icon.png',
      ios: 'https://apps.apple.com/br/app/microsoft-authenticator/id983156458',
      android: 'https://play.google.com/store/apps/details?id=com.azure.authenticator',
    },
  ];

  // Abas da ajuda do acesso (módulo 1 da Aula Inaugural, partes 1 a 4).
  var ABAS = [
    { id: 'email', aba: 'E-mail e senha', icone: 'mail', titulo: 'Descubra seu e-mail e senha', sub: 'No Duda, com o seu CPF.', video: 'acesso-email-senha' },
    { id: 'senha', aba: 'Criar senha', icone: 'key-round', titulo: 'Crie a sua senha', sub: 'Troque a senha provisória por uma só sua.', video: 'acesso-criar-senha' },
    { id: 'auth', aba: 'Authenticator', icone: 'lock-keyhole', titulo: 'Ligue o Authenticator', sub: 'Emparelhe a sua conta com o aplicativo.', video: 'acesso-authenticator' },
    { id: 'duda', aba: 'Entrar no Duda', icone: 'smartphone', titulo: 'Entre no Duda', sub: 'Confirme o número no Authenticator.', video: 'acesso-entrar-duda' },
  ];

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function card(app) {
    return (
      '<li class="apps-card">' +
        '<img class="apps-icon" src="' + BASE + app.icone + '" alt="" width="84" height="84" loading="lazy" decoding="async">' +
        '<div class="apps-body">' +
          '<h3>' + esc(app.nome) + '</h3>' +
          '<p>' + esc(app.descricao) + '</p>' +
          '<div class="apps-badges">' +
            '<a class="apps-badge apps-badge--ios" href="' + app.ios + '" target="_blank" rel="noopener noreferrer" aria-label="Baixar ' + esc(app.nome) + ' na App Store para iPhone e iPad (abre em nova aba)">' +
              '<img src="' + BASE + 'app-store-pt-br.svg" alt="" width="120" height="40" loading="lazy"></a>' +
            '<a class="apps-badge apps-badge--android" href="' + app.android + '" target="_blank" rel="noopener noreferrer" aria-label="Baixar ' + esc(app.nome) + ' no Google Play para Android (abre em nova aba)">' +
              '<img src="' + BASE + 'google-play-pt-br.png" alt="" width="135" height="52" loading="lazy"></a>' +
          '</div>' +
        '</div>' +
      '</li>'
    );
  }

  function tab(a, i, id) {
    return (
      '<button type="button" role="tab" class="apps-tab" id="' + id + '-t' + i + '" aria-controls="' + id + '-p' + i + '"' +
        ' aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '" data-apps-tab="' + i + '">' +
        '<i data-lucide="' + a.icone + '" aria-hidden="true"></i><span>' + esc(a.aba) + '</span>' +
        (i === 0 ? '<span class="apps-tab-ok" aria-hidden="true"><i data-lucide="check"></i></span><span class="apps-tab-okt sr-only"> (seus dados estão aqui)</span>' : '') +
      '</button>'
    );
  }

  function painel(a, i, id) {
    return (
      '<div role="tabpanel" class="apps-pan" id="' + id + '-p' + i + '" aria-labelledby="' + id + '-t' + i + '"' + (i === 0 ? '' : ' hidden') + '>' +
        '<span class="apps-pan-ico" aria-hidden="true"><i data-lucide="' + a.icone + '"></i></span>' +
        '<div class="apps-pan-body">' +
          '<div class="apps-pan-padrao"><h3>' + esc(a.titulo) + '</h3><p>' + esc(a.sub) + '</p></div>' +
          (i === 0 ? '<div data-dados-acesso-slot="aba" hidden></div>' : '') +
          '<div class="apps-pan-acts">' +
            '<button type="button" class="apps-ver" data-apps-video="' + esc(a.video) + '"><i data-lucide="play" aria-hidden="true"></i>Assistir à orientação</button>' +
            // Só com a trilha liberada (classe so-trilha): o slot pode ser desenhado antes de /api/recursos.
            '<button type="button" class="apps-completa so-trilha" data-open-trilha="1">Ver orientação completa<i data-lucide="chevron-right" aria-hidden="true"></i></button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  var seq = 0; // ids únicos por instância (há uma por tela)
  function html(compacta) {
    var id = 'apps-' + (++seq);
    return (
      '<div class="apps' + (compacta ? ' apps--compacta' : '') + '">' +
        '<section class="apps-sec" aria-labelledby="' + id + '-h1">' +
          '<div class="apps-head"><h2 class="apps-title" id="' + id + '-h1">Aplicativos para sua jornada</h2>' +
            '<p class="apps-sub">Baixe os aplicativos e tenha mais praticidade no seu dia a dia acadêmico.</p></div>' +
          '<ul class="apps-grid">' + APPS.map(card).join('') + '</ul>' +
        '</section>' +
        '<section class="apps-ajuda" aria-labelledby="' + id + '-h2">' +
          '<div class="apps-head"><h2 class="apps-title" id="' + id + '-h2">Como podemos ajudar no acesso?</h2>' +
            '<p class="apps-sub">Escolha um dos assuntos abaixo e veja a orientação.</p></div>' +
          // Acesso em preparação (body.acesso-preparo): sem RGM, o Duda ainda não tem os dados do aluno.
          '<p class="apps-nota-preparo so-preparo" role="note"><i data-lucide="hourglass" aria-hidden="true"></i>' +
            '<span>Estes passos só funcionam depois que a faculdade criar o seu acesso. Já dá para baixar os dois aplicativos.</span></p>' +
          '<div class="apps-tabs" role="tablist" aria-label="Assuntos do acesso">' + ABAS.map(function (a, i) { return tab(a, i, id); }).join('') + '</div>' +
          ABAS.map(function (a, i) { return painel(a, i, id); }).join('') +
        '</section>' +
      '</div>'
    );
  }

  function selecionar(btn, foco) {
    var lista = btn.closest('[role="tablist"]');
    var box = btn.closest('.apps-ajuda');
    lista.querySelectorAll('[role="tab"]').forEach(function (t) {
      var on = t === btn;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      var p = box.querySelector('#' + t.getAttribute('aria-controls'));
      if (p) p.hidden = !on;
    });
    if (foco) btn.focus();
  }

  // Preenche os lugares vazios (ou os de uma raiz que acabou de ser redesenhada).
  function render(raiz) {
    (raiz || document).querySelectorAll('[data-apps-slot]').forEach(function (slot) {
      if (slot.getAttribute('data-apps-pronto') === '1') return;
      slot.innerHTML = html(slot.getAttribute('data-apps-variant') === 'compacta');
      slot.setAttribute('data-apps-pronto', '1');
      if (window.DadosAcesso) window.DadosAcesso.render(slot);
    });
    if (window.lucide) window.lucide.createIcons();
  }

  // "Assistir à orientação": o vídeo real da Central; sem Central, a tela de tutoriais.
  function abrirTutorial(videoId, gatilho) {
    if (document.body.classList.contains('trilha-on') && window.Central && window.Central.assistir) {
      window.Central.assistir(videoId, gatilho);
      return;
    }
    window.showScreen('tutoriais-page');
  }

  function init() {
    render();
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-apps-tab]');
      if (t) { selecionar(t, false); return; }
      var b = e.target.closest('[data-apps-video]');
      if (!b) return;
      e.preventDefault();
      abrirTutorial(b.getAttribute('data-apps-video'), b);
    });
    // Teclado nas abas: setas, Home e End.
    document.addEventListener('keydown', function (e) {
      var t = e.target.closest && e.target.closest('[data-apps-tab]');
      if (!t) return;
      var abas = Array.prototype.slice.call(t.closest('[role="tablist"]').querySelectorAll('[role="tab"]'));
      var i = abas.indexOf(t), n = abas.length, j = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = n - 1;
      if (j === null) return;
      e.preventDefault();
      selecionar(abas[j], true);
    });
  }

  return { init: init, render: render, abrirTutorial: abrirTutorial, APPS: APPS };
})();
