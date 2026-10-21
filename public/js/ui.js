/* Navegação entre telas e feedback visual (erros, loading, preview). */
window.UI = (function () {
  'use strict';

  // Um vídeo por vez no app todo (Aula Inaugural, passo a passo, Central de ajuda, Início):
  // ao dar play em um <video>, pausa qualquer outro que esteja tocando. O evento 'play' não
  // borbulha, por isso a captura no document pega também os vídeos criados depois.
  document.addEventListener('play', function (e) {
    var atual = e.target;
    if (!atual || atual.tagName !== 'VIDEO') return;
    document.querySelectorAll('video').forEach(function (v) {
      if (v !== atual && !v.paused) v.pause();
    });
  }, true);

  var SCREENS = ['login-page', 'first-access-page', 'dashboard-page', 'meu-semestre-page', 'avisos-page', 'tutoriais-page', 'trilha-page', 'atendimento-page', 'form-page', 'success-page'];
  var PUBLIC_SCREENS = ['login-page', 'first-access-page'];
  var PATHS = {
    'login-page': '/login',
    'first-access-page': '/primeiro-acesso',
    'dashboard-page': '/inicio',
    'meu-semestre-page': '/meu-semestre',
    'avisos-page': '/avisos',
    'tutoriais-page': '/tutoriais',
    'trilha-page': '/trilha',
    'atendimento-page': '/atendimento',
    'form-page': '/certificado',
    'success-page': '/sucesso',
  };
  var TITLES = {
    'login-page': 'Entrar',
    'first-access-page': 'Primeiro acesso',
    'dashboard-page': 'Início',
    'meu-semestre-page': 'Meu Semestre',
    'avisos-page': 'Avisos',
    'tutoriais-page': 'Central de ajuda',
    'trilha-page': 'Aula Inaugural',
    'atendimento-page': 'Atendimento',
    'form-page': 'Certificado',
    'success-page': 'Certificado gerado',
  };
  var RETURN_KEY = 'csu_return_to';

  function normalizePath(pathname) {
    var raw = String(pathname || '/').split('?')[0].split('#')[0];
    var p = raw.replace(/\/+$/, '');
    return p || '/';
  }

  function screenFromPath(pathname) {
    var p = normalizePath(pathname);
    if (p === '/' || p === '/inicio') return 'dashboard-page';
    var found = null;
    Object.keys(PATHS).some(function (id) {
      if (PATHS[id] === p) {
        found = id;
        return true;
      }
      return false;
    });
    return found || 'dashboard-page';
  }

  function titleFor(screenId) {
    var label = TITLES[screenId] || 'Área do Aluno';
    return label + ' | Cruzeiro do Sul Educacional';
  }

  function syncUrl(screenId, options) {
    options = options || {};
    var path = PATHS[screenId];
    if (!path) return;
    document.title = titleFor(screenId);
    if (options.skipHistory) return;
    if (normalizePath(window.location.pathname) === path) return;
    var state = { screen: screenId };
    if (options.replace) window.history.replaceState(state, '', path);
    else window.history.pushState(state, '', path);
  }

  function rememberReturn(path) {
    try { sessionStorage.setItem(RETURN_KEY, path); } catch (err) { /* ignore */ }
  }

  function takeReturnPath() {
    try {
      var value = sessionStorage.getItem(RETURN_KEY);
      sessionStorage.removeItem(RETURN_KEY);
      return value;
    } catch (err) {
      return null;
    }
  }

  function showScreen(screenId, options) {
    options = options || {};
    if (SCREENS.indexOf(screenId) === -1) screenId = 'dashboard-page';
    if (PUBLIC_SCREENS.indexOf(screenId) === -1 && !window.Auth.isAuthenticated()) {
      rememberReturn(PATHS[screenId] || normalizePath(window.location.pathname));
      screenId = 'login-page';
    }
    if (window.Auth.isAuthenticated() && PUBLIC_SCREENS.indexOf(screenId) !== -1) {
      screenId = 'dashboard-page';
    }

    var previous = null;
    SCREENS.forEach(function (id) {
      var node = document.getElementById(id);
      if (!node) return;
      if (!node.classList.contains('hidden')) previous = id;
      node.classList.add('hidden');
      node.classList.remove('is-entering', 'from-auth');
      node.setAttribute('aria-hidden', 'true');
      node.inert = true;
    });

    var el = document.getElementById(screenId);
    if (!el) return;
    el.classList.remove('hidden');
    el.removeAttribute('aria-hidden');
    el.inert = false;
    if (previous === 'login-page' || previous === 'first-access-page') {
      el.classList.add('from-auth');
    }
    // reinicia a animação de entrada a cada troca de tela
    void el.offsetWidth;
    el.classList.add('is-entering');

    if (window.Ajuda) window.Ajuda.fechar(false); // trocar de tela fecha o painel de ajuda

    // Menu do topo: marca a seção atual (Avisos, Trilha e Atendimento não têm item próprio).
    var secao = screenId === 'trilha-page' ? 'dashboard-page' : screenId; // a Aula Inaugural começa no Início
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      if (a.getAttribute('data-nav') === secao) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    if (window.lucide) window.lucide.createIcons();
    window.scrollTo(0, 0);
    syncUrl(screenId, options);
  }

  function setUserName(name) {
    document.querySelectorAll('[data-user-name]').forEach(function (el) {
      el.textContent = name;
    });
    var first = String(name || '').trim().split(/\s+/)[0] || '';
    first = first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
    document.querySelectorAll('[data-user-first]').forEach(function (el) {
      el.textContent = first;
    });
    // Sem nome na sessão: "Olá! Vamos começar?" (some a vírgula e o nome).
    document.querySelectorAll('[data-user-first-wrap]').forEach(function (el) {
      el.hidden = !first;
    });
  }

  function setLoginLoading(loading) {
    var btn = document.getElementById('btn-login');
    var page = document.getElementById('login-page');
    btn.disabled = loading;
    btn.classList.toggle('is-loading', loading);
    if (page) page.classList.toggle('is-busy', loading);
    btn.setAttribute('aria-label', loading ? 'Entrando...' : 'Entrar');
    var front = btn.querySelector('[data-cube-front]');
    var second = btn.querySelector('[data-cube-second]');
    if (front) front.textContent = loading ? 'Entrando...' : 'Entrar';
    if (second) second.textContent = loading ? 'Entrando...' : 'Acessar';
    if (loading) btn.classList.remove('is-flipped');
  }

  function initCubeFlip(btn) {
    if (!btn) return;
    var cube = btn.querySelector('.cube-flip-cube');
    if (!cube) return;

    function measure() {
      btn.style.setProperty('--cube-d', (btn.offsetHeight / 2) + 'px');
    }
    measure();
    if (window.ResizeObserver) new ResizeObserver(measure).observe(btn);

    var hovered = false;
    var busy = false;

    function wantsFlip() {
      return !btn.disabled && (hovered || btn.matches(':focus-visible'));
    }

    function settle() {
      busy = false;
      var should = wantsFlip();
      if (should !== btn.classList.contains('is-flipped')) turn(should);
    }

    function turn(flipped) {
      if (btn.disabled && flipped) return;
      busy = true;
      btn.classList.toggle('is-flipped', flipped);
    }

    cube.addEventListener('transitionend', function (event) {
      if (event.propertyName === 'transform') settle();
    });

    btn.addEventListener('pointerenter', function () {
      hovered = true;
      if (!busy) turn(wantsFlip());
    });
    btn.addEventListener('pointerleave', function () {
      hovered = false;
      if (!busy) turn(wantsFlip());
    });
    btn.addEventListener('focusin', function () {
      if (!busy) turn(wantsFlip());
    });
    btn.addEventListener('focusout', function () {
      if (!busy) turn(wantsFlip());
    });
  }

  function showLoginError(message) {
    var el = document.getElementById('login-error');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function hideLoginError() {
    document.getElementById('login-error').classList.add('hidden');
  }

  function setRegisterLoading(loading) {
    var btn = document.getElementById('btn-register');
    var page = document.getElementById('first-access-page');
    btn.disabled = loading;
    btn.classList.toggle('is-loading', loading);
    if (page) page.classList.toggle('is-busy', loading);
    var label = btn.querySelector('.btn-plastic-label');
    if (label) label.textContent = loading ? 'Criando acesso...' : 'Criar acesso';
  }

  function showRegisterError(message) {
    var el = document.getElementById('register-error');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function hideRegisterError() {
    document.getElementById('register-error').classList.add('hidden');
  }

  function setDashboardCertLoading(loading) {
    var btn = document.getElementById('btn-gerar-certificado');
    var text = document.getElementById('btn-gerar-certificado-text');
    if (!btn || !text) return;
    btn.disabled = loading;
    btn.classList.toggle('is-loading', loading);
    text.textContent = loading ? 'Gerando certificado...' : 'Gerar certificado';
  }

  // Aviso informativo no topo do painel (mesma caixa do erro do certificado, em azul).
  // Aviso geral do painel (ex.: cadastro ainda em processamento): fica no topo.
  function showDashboardNotice(message) {
    var el = document.getElementById('dashboard-notice');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function showDashboardCertError(message) {
    // Erro do certificado: aparece dentro do card da Aula Inaugural, perto do botão.
    var el = document.getElementById('dashboard-cert-error');
    el.textContent = message;
    // Erro de cadastro incompleto: oferece o painel de ajuda (lá está o WhatsApp do polo).
    if (/cadastro|matrícula|polo/i.test(message)) {
      var link = document.createElement('button');
      link.type = 'button';
      link.className = 'p-link';
      link.setAttribute('data-help-open', '');
      link.textContent = 'Falar com a equipe';
      el.appendChild(document.createTextNode(' '));
      el.appendChild(link);
    }
    el.classList.remove('hidden');
  }

  function hideDashboardCertError() {
    document.getElementById('dashboard-cert-error').classList.add('hidden');
  }

  function setSubmitLoading(loading) {
    var btn = document.getElementById('btn-submit');
    var text = document.getElementById('btn-text');
    var loader = document.getElementById('btn-loader');
    btn.disabled = loading;
    btn.classList.toggle('is-loading', loading);
    btn.classList.toggle('opacity-70', loading);
    text.textContent = loading ? 'Gerando certificado...' : 'Gerar meu certificado';
    loader.classList.toggle('hidden', !loading);
  }

  function clearFieldErrors() {
    document.querySelectorAll('[id^="err_"]').forEach(function (el) {
      el.classList.add('hidden');
    });
  }

  function showFieldErrors(errors) {
    Object.keys(errors).forEach(function (field) {
      var el = document.getElementById('err_' + field);
      if (el) {
        el.textContent = errors[field];
        el.classList.remove('hidden');
      }
    });
  }

  function showFormAlert(message) {
    var el = document.getElementById('form-alert');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function hideFormAlert() {
    document.getElementById('form-alert').classList.add('hidden');
  }

  function showPreview(blobUrl, protocolo) {
    document.getElementById('preview-frame').src = blobUrl;
    if (protocolo) {
      document.getElementById('cert-protocol').textContent = 'Protocolo: ' + protocolo;
    }
  }

  function clearPreview() {
    document.getElementById('preview-frame').removeAttribute('src');
  }

  return {
    showScreen: showScreen,
    screenFromPath: screenFromPath,
    takeReturnPath: takeReturnPath,
    PATHS: PATHS,
    setUserName: setUserName,
    setLoginLoading: setLoginLoading,
    initCubeFlip: initCubeFlip,
    showLoginError: showLoginError,
    showDashboardNotice: showDashboardNotice,
    hideLoginError: hideLoginError,
    setRegisterLoading: setRegisterLoading,
    showRegisterError: showRegisterError,
    hideRegisterError: hideRegisterError,
    setDashboardCertLoading: setDashboardCertLoading,
    showDashboardCertError: showDashboardCertError,
    hideDashboardCertError: hideDashboardCertError,
    setSubmitLoading: setSubmitLoading,
    clearFieldErrors: clearFieldErrors,
    showFieldErrors: showFieldErrors,
    showFormAlert: showFormAlert,
    hideFormAlert: hideFormAlert,
    showPreview: showPreview,
    clearPreview: clearPreview,
  };
})();
