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
        // Assinatura: se não carregar, o certificado sai sem ela (não trava a emissão).
        fetch('/assets/certificado-assinatura.png?v=1').then(function (r) {
          return r.ok ? r.arrayBuffer() : null;
        }).catch(function () { return null; }),
      ]).then(function (results) {
        return {
          backgroundBytes: new Uint8Array(results[0]),
          fontBytes: new Uint8Array(results[1]),
          boldBytes: new Uint8Array(results[2]),
          assinaturaBytes: results[3] ? new Uint8Array(results[3]) : null,
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

  // Depois de entrar, quem ainda não começou a Aula Inaugural vai direto para ela.
  function irParaAulaSeNaoComecou() {
    if (!document.body.classList.contains('trilha-on')) return Promise.resolve();
    return window.Api.getTrilhaResumo().then(function (r) {
      var emitido = r && r.certificado && r.certificado.emitido;
      if (!r || r.comecou || r.concluidos || emitido) return;
      if (window.UI.screenFromPath(window.location.pathname) !== 'dashboard-page') return;
      window.Rastreio && window.Rastreio.track('aula_aberta_apos_login', {});
      window.showScreen('trilha-page', { replace: true });
    }).catch(function () { /* sem o resumo, fica no Início */ });
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
      if (nextScreen === 'login-page' || nextScreen === 'first-access-page' || nextScreen === 'senha-page') nextScreen = 'dashboard-page';
      if (res.troca_senha) {
        // Entrou com a senha inicial: cria a senha própria antes de qualquer outra tela (server/senha.js).
        telaDepoisDaSenha = nextScreen;
        abrirCriarSenha(identifier);
        return;
      }
      entrarNoPortal(nextScreen);
    } catch (err) {
      UI.showLoginError(err.status === 401
        ? 'RGM ou senha incorretos. A senha inicial é o seu primeiro nome com a inicial maiúscula + 123@. Se já trocou a senha e não lembra, use "Esqueci minha senha".'
        : (err.message || 'Não foi possível entrar. Tente novamente em instantes.'));
    } finally {
      UI.setLoginLoading(false);
    }
  }

  var telaDepoisDaSenha = 'dashboard-page';

  // Link de acesso (/a/<token>): lê o token e já tira da barra de endereço, antes de qualquer
  // rastreio ou navegação registrar o caminho. A origem (?o=) foi guardada pelo api.js ao carregar.
  function tokenDoLink() {
    var m = /^\/a\/([A-Za-z0-9_-]{40,60})\/?$/.exec(window.location.pathname);
    if (!m) return null;
    try { window.history.replaceState(null, '', '/inicio'); } catch (e) { /* segue */ }
    return m[1];
  }

  async function entrarPeloLink(token) {
    var UI = window.UI;
    if (window.Auth.isAuthenticated()) {
      // Já tinha sessão nesta aba: troca pela do link (o link é de quem o recebeu).
      window.Auth.clear();
    }
    UI.showScreen('login-page', { replace: true });
    UI.setLoginLoading(true);
    try {
      var res = await window.Api.entrarPorLink(token);
      window.Auth.setSession(res.token, res.user);
      UI.setUserName(window.Auth.getUserName());
      if (res.troca_senha) {
        telaDepoisDaSenha = 'dashboard-page';
        abrirCriarSenha(res.user && res.user.rgm);
        return;
      }
      entrarNoPortal('dashboard-page');
    } catch (err) {
      var comRgm = false;
      if (err.status === 401) {
        var campo = document.getElementById('f_login_identifier');
        if (campo && err.rgm) { campo.value = err.rgm; comRgm = true; }
      }
      UI.showLoginError(err.message || 'Não foi possível entrar pelo link. Entre com o seu RGM e a sua senha.');
      window.showScreen('login-page', { replace: true });
      // Com o RGM já preenchido, falta só a senha: o cursor vai direto para ela.
      if (comRgm) {
        var senha = document.getElementById('f_login_password');
        if (senha) setTimeout(function () { try { senha.focus(); } catch (e) { /* segue */ } }, 0);
      }
    } finally {
      UI.setLoginLoading(false);
    }
  }

  function entrarNoPortal(nextScreen) {
    window.showScreen(nextScreen, { replace: true });
    window.Avisos.refresh();
    if (window.MeuSemestre) window.MeuSemestre.refresh();
    carregarRecursos().then(function () { if (nextScreen === 'dashboard-page') irParaAulaSeNaoComecou(); });
  }

  function abrirCriarSenha(usuario) {
    window.Auth.marcarCriarSenha(true);
    var campo = document.getElementById('f_senha_usuario');
    if (campo) campo.value = usuario || (window.Auth.getUser().rgm || '');
    window.showScreen('senha-page', { replace: true });
    window.Rastreio && window.Rastreio.track('criar_senha_vista', {});
    setTimeout(function () {
      var nova = document.getElementById('f_senha_nova');
      if (nova) nova.focus();
    }, 50);
  }

  function setSenhaLoading(loading) {
    var btn = document.getElementById('btn-senha');
    if (!btn) return;
    btn.disabled = loading;
    btn.classList.toggle('is-loading', loading);
    var label = btn.querySelector('.btn-plastic-label');
    if (label) label.textContent = loading ? 'Salvando...' : 'Salvar e continuar';
  }

  async function handleCriarSenha(event) {
    event.preventDefault();
    var erro = document.getElementById('senha-error');
    erro.classList.add('hidden');
    ['err_senha_password', 'err_senha_confirmPassword'].forEach(function (id) {
      document.getElementById(id).classList.add('hidden');
    });
    var nova = document.getElementById('f_senha_nova').value;
    var confirma = document.getElementById('f_senha_confirma').value;
    var local = {};
    if (nova.length < 8) local.password = 'Use pelo menos 8 caracteres.';
    else if (nova !== confirma) local.confirmPassword = 'As senhas não são iguais.';
    if (local.password || local.confirmPassword) {
      mostrarErrosSenha(local);
      return;
    }
    setSenhaLoading(true);
    try {
      await window.Api.criarSenha(nova, confirma);
      window.Auth.marcarCriarSenha(false);
      document.getElementById('senha-form').reset();
      window.Rastreio && window.Rastreio.track('criar_senha_concluida', {});
      window.UI.showDashboardNotice && window.UI.showDashboardNotice('Senha criada. Da próxima vez, entre com ela.');
      entrarNoPortal(telaDepoisDaSenha || 'dashboard-page');
    } catch (err) {
      if (err.status === 401) { logout(); return; }
      if (err.details) mostrarErrosSenha(err.details);
      else {
        erro.textContent = err.message || 'Não foi possível salvar a senha. Tente de novo.';
        erro.classList.remove('hidden');
      }
    } finally {
      setSenhaLoading(false);
    }
  }

  function mostrarErrosSenha(errors) {
    Object.keys(errors).forEach(function (campo) {
      var el = document.getElementById('err_senha_' + campo);
      if (!el) return;
      el.textContent = errors[campo];
      el.classList.remove('hidden');
    });
    var primeiro = errors.password ? 'f_senha_nova' : 'f_senha_confirma';
    var input = document.getElementById(primeiro);
    if (input) input.focus();
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
      carregarRecursos().then(function () { if (!res.cadastro_pendente) irParaAulaSeNaoComecou(); });
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

  // Caixa de erro do certificado: algumas usam a classe .hidden, a da Aula usa o atributo hidden. Mexe nos dois.
  function mostrarErroCert(el, msg) {
    el.textContent = msg;
    el.hidden = false;
    el.classList.remove('hidden');
  }
  function esconderErroCert(el) {
    el.hidden = true;
    el.classList.add('hidden');
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
    if (erroEl) esconderErroCert(erroEl); else UI.hideDashboardCertError();
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

      UI.showPreview(currentPdf.blobUrl, confirmation.certificate_id, confirmation.aviso);
      window.Rastreio && window.Rastreio.track('certificado_gerado', { protocolo: confirmation.certificate_id, origem: opts.origem || 'painel', sem_polo: !!confirmation.polo_pendente });
      if (window.Trilha && document.body.classList.contains('trilha-on')) window.Trilha.refreshDashboard();
      window.showScreen('success-page');
    } catch (err) {
      if (err.status === 401) {
        window.Auth.clear();
        window.showScreen('login-page', { replace: true });
        UI.showLoginError('Sua sessão expirou. Entre novamente.');
      } else {
        window.Rastreio && window.Rastreio.track('certificado_erro', { mensagem: err.message || GENERIC_ERROR, origem: opts.origem || 'painel' }, { importante: true });
        // Esperando o RGM: o card do Início passa a mostrar esse estado.
        if (err.codigo === 'sem_rgm' && window.Trilha && document.body.classList.contains('trilha-on')) {
          window.Trilha.refreshDashboard();
        }
        if (erroEl) mostrarErroCert(erroEl, err.message || GENERIC_ERROR);
        else UI.showDashboardCertError(err.message || GENERIC_ERROR);
        // Erro técnico (não a regra "faltam módulos", que vem como 422): oferece falar com a equipe.
        var ancoraErro = erroEl || document.getElementById('dashboard-cert-error') || document.getElementById('home-aula-erro');
        if (err.status !== 422 && window.Dificuldade && ancoraErro) {
          window.Dificuldade.oferecer({ origem: 'certificado_erro', ancora: ancoraErro, automatica: true, titulo: 'Quer ajuda com o certificado?' });
        }
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
      if (window.Dificuldade) window.Dificuldade.configurar(!!(r && r.ajuda));
      mostrarSimulado(!!(r && r.simulado));
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

  // Área de simulado (oculta, SIMULADO_ATIVA_PARA): o link no menu só existe para quem o servidor liberou.
  function mostrarSimulado(on) {
    document.querySelectorAll('.portal-nav').forEach(function (nav) {
      var link = nav.querySelector('[data-simulado-link]');
      if (on && !link) {
        link = document.createElement('a');
        link.href = '/simulado';
        link.setAttribute('data-simulado-link', '');
        link.textContent = 'Simulado';
        nav.appendChild(link);
      } else if (!on && link) {
        link.remove();
      }
    });
  }

  // Chat do CRM: só entra na página para quem o servidor liberou (WEBCHAT_LIBERADO_PARA).
  var webchatCarregado = false;
  function carregarWebchat(cfg) {
    if (webchatCarregado || !cfg || !cfg.src || !cfg.key) return;
    webchatCarregado = true;
    // O botão do chat flutua no canto: ds.css dá folga no fim das telas para ele não cobrir a última linha.
    document.body.classList.add('tem-chat');
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
    // Contexto do chat: trocou de tela, sai o módulo e fica o último sinal de dificuldade.
    window.Rastreio && window.Rastreio.contexto && window.Rastreio.contexto({ tela: NOMES_TELA[id], modulo: null, parte: null });
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
    mostrarSimulado(false);
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
      esqueci.addEventListener('click', function () {
        var campo = document.getElementById('f_login_identifier');
        if (window.Api.esqueciSenha) window.Api.esqueciSenha(campo ? campo.value : '');
      });
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
    document.getElementById('senha-form').addEventListener('submit', handleCriarSenha);
    // Uma chamada barrada pelo servidor (sessão aberta com a senha inicial) leva à tela de criar senha.
    window.addEventListener('csu:criar-senha', function () { abrirCriarSenha(); });
    document.getElementById('cert-form').addEventListener('submit', handleGenerate);
    window.CursoAutocomplete.init();
    window.Avisos.init();
    window.Tutoriais.init();
    if (window.Trilha) window.Trilha.init();
    if (window.Central) window.Central.init();
    if (window.Apps) window.Apps.init();
    if (window.Ajuda) window.Ajuda.init();
    if (window.Dificuldade) window.Dificuldade.init();
    window.Atendimento.init();
    if (window.MeuSemestre) window.MeuSemestre.init();

    var linkToken = tokenDoLink();
    if (linkToken) {
      entrarPeloLink(linkToken);
    } else if (window.Auth.isAuthenticated() && window.Auth.precisaCriarSenha()) {
      window.UI.setUserName(window.Auth.getUserName());
      abrirCriarSenha();
    } else if (window.Auth.isAuthenticated()) {
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
    // Sem a senha própria criada, nenhuma outra tela carrega dados (o servidor responderia 403).
    if (window.Auth.isAuthenticated() && window.Auth.precisaCriarSenha()) {
      window.UI.showScreen('senha-page', options);
      rastreiaTela('senha-page');
      return;
    }
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
    if (id === 'meu-semestre-page' && window.MeuSemestre) window.MeuSemestre.avisoAula();
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
