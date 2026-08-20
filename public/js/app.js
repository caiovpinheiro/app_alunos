/* Orquestração do portal: login, emissão, geração do PDF, preview, download e impressão. */
(function () {
  'use strict';

  var GENERIC_ERROR = 'Não foi possível gerar seu certificado. Verifique seus dados e tente novamente.';

  var currentPdf = { blobUrl: null, fileName: null };
  var assetPromises = null;

  function loadAssets() {
    if (!assetPromises) {
      assetPromises = Promise.all([
        fetch('/assets/certificado-template.pdf').then(function (r) {
          if (!r.ok) throw new Error('template não encontrado');
          return r.arrayBuffer();
        }),
        fetch('/assets/fonts/Montserrat-Regular.ttf').then(function (r) {
          if (!r.ok) throw new Error('fonte não encontrada');
          return r.arrayBuffer();
        }),
      ]).then(function (results) {
        return {
          templateBytes: new Uint8Array(results[0]),
          fontBytes: new Uint8Array(results[1]),
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
      UI.showScreen('dashboard-page');
    } catch (err) {
      UI.showLoginError(err.status === 401
        ? 'Credenciais inválidas. Verifique seu acesso e tente novamente.'
        : 'Não foi possível entrar. Tente novamente em instantes.');
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
      UI.showScreen('dashboard-page');
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
      UI.showScreen('success-page');
    } catch (err) {
      if (err.status === 401) {
        window.Auth.clear();
        UI.showScreen('login-page');
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
    if (!currentPdf.blobUrl) return;
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

  async function logout() {
    await window.Api.logout();
    window.Auth.clear();
    releaseCurrentPdf();
    window.UI.clearPreview();
    document.getElementById('login-form').reset();
    window.UI.showScreen('login-page');
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

  function init() {
    lucide.createIcons();
    window.AppConfig.load();

    var today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    document.getElementById('f_data').max = today;

    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('cert-form').addEventListener('submit', handleGenerate);
    window.CursoAutocomplete.init();

    if (window.Auth.isAuthenticated()) {
      window.UI.setUserName(window.Auth.getUserName());
      window.UI.showScreen('dashboard-page');
    } else {
      window.UI.showScreen('login-page');
    }
  }

  window.handleLogin = handleLogin;
  window.handleGenerate = handleGenerate;
  window.downloadPDF = downloadPDF;
  window.printCert = printCert;
  window.logout = logout;
  window.showScreen = function (id) {
    if (id === 'form-page') prefillForm();
    window.UI.showScreen(id);
  };

  document.addEventListener('DOMContentLoaded', init);
})();
