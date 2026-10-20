/* Aplicativos da jornada (Duda e Microsoft Authenticator): uma configuração e um componente
   para todas as telas do aluno logado. Cada tela tem um único lugar [data-apps-slot]
   (data-apps-variant="compacta" nas telas internas). Artes oficiais em /assets/portal/apps/
   (origem em docs/integracao/apps-fontes-assets.json): não recolorir, cortar nem esticar.

   Linha do tempo do primeiro acesso: 1 e 2 baixar os apps; 3 a 6 abrem os vídeos que já existem
   na Central (a mesma ordem do Nível 1 da trilha). Sem a Central liberada, vão para os tutoriais. */
window.Apps = (function () {
  'use strict';

  var BASE = '/assets/portal/apps/';
  var APPS = [
    {
      id: 'duda',
      nome: 'Duda',
      descricao: 'Acesse os recursos da sua vida acadêmica.',
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

  // Passos depois de baixar os dois apps (Nível 1 da trilha, partes 1 a 4).
  var PASSOS = [
    { titulo: 'Descubra seu e-mail e senha', sub: 'No Duda, com o seu CPF', video: 'acesso-email-senha' },
    { titulo: 'Crie a sua senha', sub: 'Troque a senha provisória', video: 'acesso-criar-senha' },
    { titulo: 'Ligue o Authenticator', sub: 'Emparelhe a sua conta', video: 'acesso-authenticator' },
    { titulo: 'Entre no Duda', sub: 'Confirme o número no Authenticator', video: 'acesso-entrar-duda' },
  ];

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function card(app, i) {
    return (
      '<li class="apps-card">' +
        '<span class="apps-step" aria-hidden="true">' + (i + 1) + '</span>' +
        '<img class="apps-icon" src="' + BASE + app.icone + '" alt="" width="64" height="64" loading="lazy" decoding="async">' +
        '<div class="apps-body">' +
          '<h3><span class="sr-only">Passo ' + (i + 1) + ': </span>Baixe o ' + esc(app.nome) + '</h3>' +
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

  function passo(p, i) {
    var n = APPS.length + i + 1;
    return (
      '<li class="apps-passo">' +
        '<button type="button" class="apps-passo-btn" data-apps-video="' + esc(p.video) + '">' +
          '<span class="apps-step" aria-hidden="true">' + n + '</span>' +
          '<span class="apps-passo-t"><strong><span class="sr-only">Passo ' + n + ': </span>' + esc(p.titulo) + '</strong>' +
          '<span>' + esc(p.sub) + '</span></span>' +
          '<span class="apps-passo-play"><i data-lucide="play" aria-hidden="true"></i>Ver vídeo</span>' +
        '</button>' +
      '</li>'
    );
  }

  var seq = 0; // um id de título por instância (há uma por tela)
  function html(compacta) {
    var id = 'apps-h-' + (++seq);
    return (
      '<section class="apps' + (compacta ? ' apps--compacta' : '') + '" aria-labelledby="' + id + '">' +
        '<div class="apps-head"><h2 class="apps-title" id="' + id + '">Primeiro acesso em ' + (APPS.length + PASSOS.length) + ' passos</h2>' +
          // Só com a trilha liberada (classe so-trilha): o slot pode ser desenhado antes de /api/recursos.
          '<button type="button" class="apps-trilha so-trilha" data-open-trilha="1">Passo a passo no módulo 1 da Aula Inaugural<i data-lucide="chevron-right" aria-hidden="true"></i></button>' +
        '</div>' +
        // Acesso em preparação (body.acesso-preparo): sem RGM, o Duda ainda não tem os dados do aluno.
        '<p class="apps-nota-preparo so-preparo" role="note"><i data-lucide="hourglass" aria-hidden="true"></i>' +
          '<span>Os passos 3 a 6 só funcionam depois que a faculdade criar o seu acesso. Já dá para fazer os passos 1 e 2.</span></p>' +
        '<ol class="apps-linha">' +
          '<li class="apps-baixar"><ol class="apps-grid">' + APPS.map(card).join('') + '</ol></li>' +
          '<li class="apps-depois"><ol class="apps-passos" start="' + (APPS.length + 1) + '">' + PASSOS.map(passo).join('') + '</ol></li>' +
        '</ol>' +
      '</section>'
    );
  }

  // Preenche os lugares vazios (ou os de uma raiz que acabou de ser redesenhada).
  function render(raiz) {
    (raiz || document).querySelectorAll('[data-apps-slot]').forEach(function (slot) {
      if (slot.getAttribute('data-apps-pronto') === '1') return;
      slot.innerHTML = html(slot.getAttribute('data-apps-variant') === 'compacta');
      slot.setAttribute('data-apps-pronto', '1');
    });
    if (window.lucide) window.lucide.createIcons();
  }

  // "Como acessar" / "Como configurar": o vídeo real da Central; sem Central, a tela de tutoriais.
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
      var b = e.target.closest('[data-apps-video]');
      if (!b) return;
      e.preventDefault();
      abrirTutorial(b.getAttribute('data-apps-video'), b);
    });
  }

  return { init: init, render: render, abrirTutorial: abrirTutorial, APPS: APPS };
})();
