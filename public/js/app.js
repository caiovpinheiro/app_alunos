/* Orquestração do portal: login, emissão, geração do PDF, preview, download e impressão. */
(function () {
  'use strict';

  var GENERIC_ERROR = 'Não foi possível gerar seu certificado. Verifique seus dados e tente novamente.';

  var currentPdf = { blobUrl: null, fileName: null };
  var assetPromises = null;

  function loadAssets() {
    if (!assetPromises) {
      assetPromises = Promise.all([
        fetch('/assets/certificado-modelo.jpg?v=1').then(function (r) {
          if (!r.ok) throw new Error('modelo do certificado não encontrado');
          return r.arrayBuffer();
        }),
        fetch('/assets/fonts/Montserrat-Regular.ttf').then(function (r) {
          if (!r.ok) throw new Error('fonte não encontrada');
          return r.arrayBuffer();
        }),
        fetch('/assets/fonts/Montserrat-Bold.ttf').then(function (r) {
          if (!r.ok) throw new Error('fonte não encontrada');
          return r.arrayBuffer();
        }),
      ]).then(function (results) {
        return {
          backgroundBytes: new Uint8Array(results[0]),
          fontBytes: new Uint8Array(results[1]),
          boldBytes: new Uint8Array(results[2]),
        };
      });
      assetPromises.catch(function () { assetPromises = null; });
    }
    return assetPromises;
  }

  function sanitizeFileName(name) {
    return name
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_.-]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'aluno';
  }

  function releaseCurrentPdf() {
    if (currentPdf.blobUrl) {
      URL.revokeObjectURL(currentPdf.blobUrl);
      currentPdf = { blobUrl: null, fileName: null };
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    var UI = window.UI;
    UI.hideLoginError();

    var identifier = document.getElementById('f_login_identifier').value.trim();
    var password = document.getElementById('f_login_password').value;
    if (!identifier || !password) {
      UI.showLoginError('Informe seu RGM/e-mail e a senha.');
      return;
    }

    UI.setLoginLoading(true);
    try {
      var res = await window.Api.login(identifier, password);
      window.Auth.setSession(res.token, res.user);
      UI.setUserName(window.Auth.getUserName());
      document.getElementById('login-form').reset();
      var afterLogin = window.UI.takeReturnPath();
      var nextScreen = afterLogin ? window.UI.screenFromPath(afterLogin) : 'dashboard-page';
      if (nextScreen === 'login-page' || nextScreen === 'first-access-page') nextScreen = 'dashboard-page';
      window.showScreen(nextScreen, { replace: true });
      window.Avisos.refresh();
      if (window.MeuSemestre) window.MeuSemestre.refresh();
      carregarRecursos();
    } catch (err) {
      UI.showLoginError(err.status === 401
        ? 'RGM ou senha incorretos. A senha inicial é o seu primeiro nome com a inicial maiúscula + 123@. Se já trocou a senha e não lembra, use "Esqueci minha senha".'
        : (err.message || 'Não foi possível entrar. Tente novamente em instantes.'));
    } finally {
      UI.setLoginLoading(false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    var UI = window.UI;
    UI.hideRegisterError();
    UI.clearFieldErrors();

    var payload = {
      nome: document.getElementById('f_reg_nome').value,
      email: document.getElementById('f_reg_email').value,
      rgm: document.getElementById('f_reg_rgm').value,
      password: document.getElementById('f_reg_password').value,
      confirmPassword: document.getElementById('f_reg_confirm').value,
    };

    UI.setRegisterLoading(true);
    try {
      var res = await window.Api.register(payload);
      window.Auth.setSession(res.token, res.user);
      UI.setUserName(window.Auth.getUserName());
      document.getElementById('register-form').reset();
      window.showScreen('dashboard-page', { replace: true });
      if (res.cadastro_pendente) {
        UI.showDashboardNotice('Acesso criado! Seu RGM ainda não apareceu no relatório de matriculados: curso, polo e certificado serão liberados quando o cadastro chegar, em até 2 dias úteis.');
      }
      window.Avisos.refresh();
      if (window.MeuSemestre) window.MeuSemestre.refresh();
      carregarRecursos();
    } catch (err) {
      if (err.details) UI.showFieldErrors(mapRegisterErrors(err.details));
      UI.showRegisterError(err.message || 'Não foi possível concluir o cadastro. Tente novamente.');
    } finally {
      UI.setRegisterLoading(false);
    }
  }

  function mapRegisterErrors(details) {
    var mapped = {};
    Object.keys(details).forEach(function (key) {
      mapped['reg_' + key] = details[key];
    });
    return mapped;
  }

  // Emite o certificado direto (sem formulário). opts.btn = botão que mostra "Gerando..." (padrão:
  // #btn-gerar-certificado do Início sem trilha); opts.erro = caixa onde aparece o erro.
  async function generateCertificateNow(opts) {
    opts = opts || {};
    var UI = window.UI;
    var btn = opts.btn || null;
    var erroEl = opts.erro || null;
    var txtEl = btn && btn.querySelector('[data-cert-txt]');
    var txtOriginal = txtEl ? txtEl.textContent : '';
    if (erroEl) erroEl.classList.add('hidden'); else UI.hideDashboardCertError();
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); if (txtEl) txtEl.textContent = 'Gerando certificado...'; }
    else UI.setDashboardCertLoading(true);
    try {
      var confirmation = await window.Api.emitCertificate({});
      if (!confirmation || !confirmation.success) throw new Error('emissão não confirmada');

      var assets = await loadAssets();
      var pdfBytes = await window.CertificateGenerator.generateCertificate({
        nome: confirmation.nome,
        rgm: confirmation.rgm,
        unidade: confirmation.unidade,
        dataAulaISO: confirmation.data_aula_inaugural,
        emissaoISO: confirmation.created_at,
      }, assets);

      releaseCurrentPdf();
      var blob = new Blob([pdfBytes], { type: 'application/pdf' });
      currentPdf.blobUrl = URL.createObjectURL(blob);
      currentPdf.fileName = 'Certificado_Aula_Inaugural_' + sanitizeFileName(confirmation.nome) + '.pdf';

      UI.showPreview(currentPdf.blobUrl, confirmation.certificate_id);
      window.Rastreio && window.Rastreio.track('certificado_gerado', { protocolo: confirmation.certificate_id, origem: opts.origem || 'painel' });
      if (window.Trilha && document.body.classList.contains('trilha-on')) window.Trilha.refreshDashboard();
      window.showScreen('success-page');
    } catch (err) {
      if (err.status === 401) {
        window.Auth.clear();
        window.showScreen('login-page', { replace: true });
        UI.showLoginError('Sua sessão expirou. Entre novamente.');
      } else {
        window.Rastreio && window.Rastreio.track('certificado_erro', { mensagem: err.message || GENERIC_ERROR, origem: opts.origem || 'painel' }, { importante: true });
        if (erroEl) { erroEl.textContent = err.message || GENERIC_ERROR; erroEl.classList.remove('hidden'); }
        else UI.showDashboardCertError(err.message || GENERIC_ERROR);
      }
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); if (txtEl) txtEl.textContent = txtOriginal; }
      else UI.setDashboardCertLoading(false);
    }
  }

  async function handleGenerate(event) {
    event.preventDefault();
    var UI = window.UI;
    UI.clearFieldErrors();
    UI.hideFormAlert();

    var raw = {
      email: document.getElementById('f_email').value,
      nome: document.getElementById('f_nome').value,
      rgm: document.getElementById('f_rgm').value,
      data_aula_inaugural: document.getElementById('f_data').value,
      curso: document.getElementById('f_curso').value,
      unidade: document.getElementById('f_unidade').value,
    };

    var result = window.Validation.validateCertificateForm(raw);
    if (!result.valid) {
      UI.showFieldErrors(result.errors);
      return;
    }

    UI.setSubmitLoading(true);
    try {
      var confirmation = await window.Api.emitCertificate(result.sanitized);
      if (!confirmation || !confirmation.success) throw new Error('emissão não confirmada');

      var assets = await loadAssets();
      var pdfBytes = await window.CertificateGenerator.generateCertificate({
        nome: result.sanitized.nome,
        rgm: result.sanitized.rgm,
        unidade: result.sanitized.unidade,
        dataAulaISO: result.sanitized.data_aula_inaugural,
        emissaoISO: confirmation.created_at,
      }, assets);

      releaseCurrentPdf();
      var blob = new Blob([pdfBytes], { type: 'application/pdf' });
      currentPdf.blobUrl = URL.createObjectURL(blob);
      currentPdf.fileName = 'Certificado_Aula_Inaugural_' + sanitizeFileName(result.sanitized.nome) + '.pdf';

      UI.showPreview(currentPdf.blobUrl, confirmation.certificate_id);
      window.showScreen('success-page');
    } catch (err) {
      if (err.status === 401) {
        window.Auth.clear();
        window.showScreen('login-page', { replace: true });
        UI.showLoginError('Sua sessão expirou. Entre novamente.');
      } else if (err.status === 422 && err.details) {
        UI.showFieldErrors(err.details);
        UI.showFormAlert(GENERIC_ERROR);
      } else {
        UI.showFormAlert(GENERIC_ERROR);
      }
    } finally {
      UI.setSubmitLoading(false);
    }
  }

  function downloadPDF() {
    if (!currentPdf.blobUrl || !currentPdf.fileName) return;
    if (!/\.pdf$/i.test(currentPdf.fileName)) return;
    var link = document.createElement('a');
    link.href = currentPdf.blobUrl;
    link.download = currentPdf.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function printCert() {
    if (!currentPdf.blobUrl) return;
    var frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '100%';
    frame.style.bottom = '100%';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.src = currentPdf.blobUrl;
    frame.onload = function () {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (err) {
        window.open(currentPdf.blobUrl, '_blank');
      }
    };
    document.body.appendChild(frame);
  }

  // Trilha em teste: mostra a trilha e os links para ela só se a conta estiver liberada.
  var recursosCarregados = false;
  function carregarRecursos() {
    if (!window.Auth.isAuthenticated()) return Promise.resolve();
    return window.Api.getRecursos().then(function (r) {
      recursosCarregados = true;
      var on = !!(r && r.trilha);
      document.body.classList.toggle('trilha-on', on);
      // Acesso em preparação (conta sem RGM): telas levam à Aula Inaugural; volta ao normal quando o RGM chega.
      document.body.classList.toggle('acesso-preparo', !!(r && r.preparo));
      carregarWebchat(r && r.webchat);
      if (r && (r.webchat || r.rastreio) && window.Rastreio) {
        window.Rastreio.iniciar({ chat: r.webchat, servidor: !!r.rastreio });
        rastreiaTela(window.UI.screenFromPath(window.location.pathname));
      }
      if (on && window.Trilha) window.Trilha.refreshDashboard();
      if (on && window.Central) window.Central.renderInicio();
      if (window.Inicio) window.Inicio.render();
      if (!on && window.UI.screenFromPath(window.location.pathname) === 'trilha-page') {
        window.showScreen('dashboard-page', { replace: true });
      }
      if (window.MeuSemestre) window.MeuSemestre.refresh();
      if (window.Tutoriais) window.Tutoriais.refresh();
      if (on && window.Central && window.UI.screenFromPath(window.location.pathname) === 'tutoriais-page') window.Central.refresh();
    }).catch(function () { /* sem a informação, fica tudo como antes (trilha escondida) */ });
  }

  // Chat do CRM: só entra na página para quem o servidor liberou (WEBCHAT_LIBERADO_PARA).
  var webchatCarregado = false;
  function carregarWebchat(cfg) {
    if (webchatCarregado || !cfg || !cfg.src || !cfg.key) return;
    webchatCarregado = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = cfg.src;
    s.setAttribute('data-key', cfg.key);
    document.body.appendChild(s);
  }

  // Nome curto de cada tela para a linha do tempo do atendente.
  var NOMES_TELA = {
    'dashboard-page': 'Início', 'meu-semestre-page': 'Meu Semestre', 'avisos-page': 'Avisos',
    'tutoriais-page': 'Central de ajuda', 'trilha-page': 'Aula Inaugural', 'atendimento-page': 'Atendimento',
    'form-page': 'Certificado (formulário)', 'success-page': 'Certificado gerado',
  };
  function rastreiaTela(id) {
    if (!NOMES_TELA[id]) return;
    window.Rastreio && window.Rastreio.track('tela_aberta', { tela: NOMES_TELA[id], caminho: window.location.pathname });
  }

  async function logout() {
    if (window.Rastreio) await window.Rastreio.parar();
    if (window.Ajuda) window.Ajuda.limpar();
    await window.Api.logout();
    window.Auth.clear();
    if (webchatCarregado) {
      // O widget do chat não tem "descarregar": recarrega a página já na tela de entrada.
      window.location.replace('/login');
      return;
    }
    document.body.classList.remove('trilha-on', 'acesso-preparo');
    recursosCarregados = false;
    if (window.Avisos) window.Avisos.closeDropdown();
    releaseCurrentPdf();
    window.UI.clearPreview();
    document.getElementById('login-form').reset();
    window.showScreen('login-page', { replace: true });
  }

  function prefillForm() {
    var user = window.Auth.getUser();
    if (user.email && !document.getElementById('f_email').value) {
      document.getElementById('f_email').value = user.email;
    }
    if (user.name && user.name !== 'Aluno' && !document.getElementById('f_nome').value) {
      document.getElementById('f_nome').value = user.name;
    }
    if (user.rgm && !document.getElementById('f_rgm').value) {
      document.getElementById('f_rgm').value = user.rgm;
    }
  }

  function bindPasswordToggles() {
    document.querySelectorAll('[data-password-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = document.getElementById(btn.getAttribute('data-password-toggle'));
        if (!input) return;
        var visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        btn.setAttribute('aria-pressed', visible ? 'true' : 'false');
        btn.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
        btn.innerHTML = visible
          ? '<i data-lucide="eye-off" class="w-5 h-5"></i>'
          : '<i data-lucide="eye" class="w-5 h-5"></i>';
        if (window.lucide) window.lucide.createIcons();
      });
    });
  }

  function init() {
    lucide.createIcons();
    window.AppConfig.load();

    var today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    document.getElementById('f_data').max = today;

    window.UI.initCubeFlip(document.getElementById('btn-login'));
    bindPasswordToggles();
    // "Esqueci minha senha": abre o WhatsApp acadêmico padrão (antes do login não há polo).
    var esqueci = document.getElementById('btn-esqueci-senha');
    if (esqueci) {
      window.Api.getAtendimentoPadrao().then(function (r) {
        if (r && r.academico && r.academico.url) esqueci.href = r.academico.url;
        else esqueci.parentNode.classList.add('hidden');
      }).catch(function () { esqueci.parentNode.classList.add('hidden'); });
    }
    // Cliques que levam para fora do portal (WhatsApp) entram na linha do tempo do atendente.
    document.addEventListener('click', function (event) {
      var link = event.target.closest('a[href*="wa.me/"]');
      if (!link) return;
      var origem = link.id || (link.closest('#central-ajuda') ? 'central' : link.closest('#trilha-root') ? 'trilha' : 'portal');
      window.Rastreio && window.Rastreio.track('whatsapp_clicado', { origem: origem });
    }, true);
    // Menu do topo e links internos com data-nav / data-go: troca de tela sem recarregar.
    // Ctrl/Cmd+clique continua abrindo em outra aba (o href é a rota real).
    document.addEventListener('click', function (event) {
      var link = event.target.closest('a[data-nav], [data-go]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
      event.preventDefault();
      window.showScreen(link.getAttribute('data-nav') || link.getAttribute('data-go'));
    });
    // "Assistir à aula completa": abre o bloco da aula completa na tela da Aula Inaugural.
    document.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-open-aula]');
      if (!btn) return;
      event.preventDefault();
      // A aula completa (capítulos em sequência, sem pontos) fica na tela da Aula Inaugural.
      if (window.Trilha) window.Trilha.abrirAulaCompleta();
    });
    // Botões de certificado da Aula Inaugural (card do Início e encerramento da trilha).
    document.addEventListener('click', function (event) {
      var b = event.target.closest('[data-gerar-certificado]');
      if (!b || b.disabled) return;
      event.preventDefault();
      var caixa = b.closest('[data-cert-area]') || b.closest('#home-aula');
      var erro = caixa && caixa.querySelector('[data-cert-erro], #home-aula-erro');
      generateCertificateNow({ btn: b, erro: erro, origem: b.closest('#trilha-root') ? 'aula inaugural' : 'card do início' });
    });
    var certBtn = document.getElementById('btn-gerar-certificado');
    if (certBtn) {
      certBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        generateCertificateNow();
      });
    }
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('cert-form').addEventListener('submit', handleGenerate);
    window.CursoAutocomplete.init();
    window.Avisos.init();
    window.Tutoriais.init();
    if (window.Trilha) window.Trilha.init();
    if (window.Central) window.Central.init();
    if (window.Apps) window.Apps.init();
    if (window.Ajuda) window.Ajuda.init();
    window.Atendimento.init();
    if (window.MeuSemestre) window.MeuSemestre.init();

    if (window.Auth.isAuthenticated()) {
      carregarRecursos();
      window.UI.setUserName(window.Auth.getUserName());
      var startScreen = window.UI.screenFromPath(window.location.pathname);
      if (startScreen === 'login-page' || startScreen === 'first-access-page') startScreen = 'dashboard-page';
      window.showScreen(startScreen, { replace: true });
    } else {
      window.showScreen(window.UI.screenFromPath(window.location.pathname), { replace: true });
    }
  }

  window.handleLogin = handleLogin;
  window.handleGenerate = handleGenerate;
  window.generateCertificateNow = generateCertificateNow;
  window.downloadPDF = downloadPDF;
  window.printCert = printCert;
  window.logout = logout;
  window.showScreen = function (id, options) {
    if (id === 'trilha-page' && recursosCarregados && !document.body.classList.contains('trilha-on')) id = 'dashboard-page';
    if (id === 'form-page') prefillForm();
    if (window.Avisos) window.Avisos.closeDropdown();
    if (window.Tutoriais) window.Tutoriais.closeModal();
    window.UI.showScreen(id, options);
    rastreiaTela(id);
    if ((id === 'dashboard-page' || id === 'avisos-page') && window.Avisos) {
      window.Avisos.refresh();
    }
    if ((id === 'dashboard-page' || id === 'meu-semestre-page') && window.MeuSemestre) {
      window.MeuSemestre.refresh();
    }
    if (id === 'tutoriais-page' && window.Tutoriais) window.Tutoriais.refresh();
    if (id === 'tutoriais-page' && window.Central) window.Central.refresh();
    if (id !== 'tutoriais-page' && window.Central) window.Central.close();
    if (id === 'trilha-page' && window.Trilha) window.Trilha.refresh();
    if (id === 'dashboard-page' && window.Trilha && document.body.classList.contains('trilha-on')) window.Trilha.refreshDashboard();
    if (id === 'dashboard-page' && window.Central && document.body.classList.contains('trilha-on')) window.Central.renderInicio();
    if (id !== 'trilha-page' && window.Trilha) window.Trilha.pause();
    if ((id === 'atendimento-page' || id === 'dashboard-page') && window.Atendimento) window.Atendimento.refresh();
    if (window.DadosAcesso && window.Auth.isAuthenticated()) window.DadosAcesso.render();
  };

  window.addEventListener('popstate', function () {
    var id = window.UI.screenFromPath(window.location.pathname);
    window.showScreen(id, { skipHistory: true });
  });

  document.addEventListener('DOMContentLoaded', init);
})();
