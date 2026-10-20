/* Dados de acesso à faculdade (RGM, e-mail acadêmico, curso) e a primeira senha do Duda/portal.
   Um componente, quatro lugares:
   - [data-dados-acesso-slot="aba"]: aba "E-mail e senha" da ajuda do acesso (public/js/apps.js), no Início e nas telas internas;
   - [data-dados-acesso-slot="cartao"]: cartão "Seus dados de acesso" (o Início não usa mais; ficou para outras telas);
   - [data-dados-acesso-slot="faixa"]: faixa compacta no módulo 1 da Aula Inaugural e na Central;
   - [data-acesso-rgm]: linha embaixo do nome no cabeçalho ("RGM 123456").
   Primeira senha (regra da faculdade): 3 primeiras letras do nome + @ + 3 primeiros números do RGM
   + 4 primeiros números do CPF. O Duda NÃO mostra a senha. O servidor manda só o começo (senha_inicio,
   ex. "Ana@512"); o aluno digita os 4 números do CPF e a tela junta. O CPF não sai do aparelho.
   Conta sem RGM (acesso em preparação): só a regra e o exemplo.
   Dados de GET /api/meu-acesso (server/dadosAcesso.js), uma vez por sessão (token). */
window.DadosAcesso = (function () {
  'use strict';

  var dados = null;
  var tokenDosDados = null;
  var carregando = null;
  var seq = 0;

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function token() { return window.Auth && window.Auth.getToken ? window.Auth.getToken() : null; }

  function carregar() {
    var tok = token();
    if (!tok) { dados = null; tokenDosDados = null; return Promise.resolve(null); }
    if (dados && tokenDosDados === tok) return Promise.resolve(dados);
    if (carregando) return carregando;
    carregando = window.Api.getMeuAcesso().then(function (r) {
      dados = r || null;
      tokenDosDados = tok;
      return dados;
    }).catch(function () { return null; }).finally(function () { carregando = null; });
    return carregando;
  }

  function copiar(valor, rotulo) {
    return '<button type="button" class="dac-copy" data-dac-copiar="' + esc(valor) + '" aria-label="Copiar ' + esc(rotulo) + '">' +
      '<i data-lucide="copy" aria-hidden="true"></i><span>Copiar</span></button>';
  }

  // ---------- primeira senha ----------
  function blocos(nome, rgm, cpf, visivelAoLeitor) {
    return '<span class="dac-pw"' + (visivelAoLeitor ? '' : ' aria-hidden="true"') + '><b>' + esc(nome) + '</b><b>@</b><b>' + esc(rgm) + '</b><b>' + esc(cpf) + '</b></span>';
  }
  var REGRA = 'as <b>3 primeiras letras do seu nome</b> (a primeira maiúscula) + <b>@</b> + os <b>3 primeiros números do RGM</b> + os <b>4 primeiros números do CPF</b>.';
  function exemplo() {
    return '<p class="dac-ex"><span class="dac-ex-l">Exemplo: Ana Souza, RGM 512…, CPF 9876…</span>' +
      blocos('Ana', '512', '9876') + '<span class="sr-only">dá a senha Ana@5129876</span><span class="dac-ex-r" aria-hidden="true">= Ana@5129876</span></p>';
  }

  // Área que monta a senha: começo vindo do servidor + 4 números do CPF digitados pelo aluno (ficam só na tela).
  function montador() {
    var id = 'dac-cpf-' + (++seq);
    return (
      '<div class="dac-montar" data-dac-montar-area hidden>' +
        '<p class="dac-m-l"><span class="dac-pw-ini" data-dac-ini></span> + <label for="' + id + '">os 4 primeiros números do seu CPF</label></p>' +
        '<input id="' + id + '" class="dac-cpf" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="0000" data-dac-cpf>' +
        '<div class="dac-m-res" data-dac-res hidden>' +
          '<p class="dac-m-t">Sua primeira senha:</p>' +
          '<div class="dac-m-pw"><span class="dac-val" data-dac-pw></span><button type="button" class="dac-copy" data-dac-copiar="" aria-label="Copiar a primeira senha"><i data-lucide="copy" aria-hidden="true"></i><span>Copiar</span></button></div>' +
          '<p class="dac-m-dica">Confira: a primeira letra é maiúscula e as outras duas, minúsculas (com acento, se o seu nome tiver).</p>' +
        '</div>' +
        '<p class="dac-m-aviso"><i data-lucide="lock" aria-hidden="true"></i><span>O CPF que você digita aqui não é enviado nem guardado.</span></p>' +
        '<button type="button" class="dac-link" data-dac-ocultar>Ocultar a senha</button>' +
        '<p class="dac-st sr-only" role="status" aria-live="polite"></p>' +
      '</div>'
    );
  }

  function blocoSenha(d) {
    var podeMontar = !d.preparo && d.senha_inicio;
    return (
      '<div class="dac-senha">' +
        '<h3 class="dac-h3">Sua primeira senha <span class="dac-tag">só para o primeiro acesso</span></h3>' +
        '<p class="dac-txt">O Duda mostra o seu e-mail acadêmico, mas <b>a primeira senha você monta</b>: ' + REGRA + '</p>' +
        exemplo() +
        (podeMontar
          ? '<button type="button" class="portal-btn portal-btn--primary dac-btn" data-dac-montar aria-expanded="false">Montar a minha primeira senha</button>' + montador()
          : (d.preparo ? '<p class="dac-txt">O seu RGM chega quando a faculdade criar o seu acesso.</p>' : '')) +
        '<p class="dac-nota"><i data-lucide="info" aria-hidden="true"></i><span>Use só no primeiro acesso. Depois de entrar, a Microsoft pede para você criar a sua senha nova; a partir daí vale a nova. Não é a senha deste app.</span></p>' +
      '</div>'
    );
  }

  // ---------- cartão do Início ----------
  function cartao(d) {
    if (d.preparo) {
      return (
        '<section class="dac-card is-preparo" aria-labelledby="dac-h">' +
          '<span class="dac-ico" aria-hidden="true"><i data-lucide="hourglass"></i></span>' +
          '<div class="dac-body">' +
            '<h2 id="dac-h">Seus dados de acesso à faculdade</h2>' +
            '<p class="dac-sub">Seu acesso está sendo preparado pelo polo. Assim que o RGM e o e-mail chegarem, eles aparecem aqui. Enquanto isso, comece pela Aula Inaugural.</p>' +
            '<button type="button" class="portal-btn portal-btn--primary dac-cta" data-open-trilha="1">Começar a Aula Inaugural <i data-lucide="chevron-right" aria-hidden="true"></i></button>' +
            blocoSenha(d) +
          '</div>' +
        '</section>'
      );
    }
    var email = d.email_academico
      ? '<dd><span class="dac-val dac-email">' + esc(d.email_academico) + '</span>' + copiar(d.email_academico, 'e-mail acadêmico') + '</dd>'
      : '<dd class="dac-falta">O Duda mostra, em <b>Não sei meus dados de acesso</b>.</dd>';
    return (
      '<section class="dac-card" aria-labelledby="dac-h">' +
        '<span class="dac-ico" aria-hidden="true"><i data-lucide="key-round"></i></span>' +
        '<div class="dac-body">' +
          '<h2 id="dac-h">Seus dados de acesso à faculdade</h2>' +
          '<p class="dac-sub">Use no app Duda e no portal da Cruzeiro do Sul.</p>' +
          '<dl class="dac-list">' +
            '<div><dt>RGM</dt><dd><span class="dac-val">' + esc(d.rgm) + '</span>' + copiar(d.rgm, 'RGM') + '</dd></div>' +
            '<div><dt>E-mail acadêmico</dt>' + email + '</div>' +
            (d.curso ? '<div><dt>Curso</dt><dd><span class="dac-val dac-curso">' + esc(d.curso) + '</span></dd></div>' : '') +
          '</dl>' +
          blocoSenha(d) +
          '<button type="button" class="dac-link" data-apps-video="acesso-email-senha">Ver o vídeo: descubra seu e-mail e senha <i data-lucide="chevron-right" aria-hidden="true"></i></button>' +
        '</div>' +
        '<p class="dac-st sr-only" role="status" aria-live="polite"></p>' +
      '</section>'
    );
  }

  // ---------- faixa do módulo 1 / Central ----------
  function faixa(d, onde) {
    if (d.preparo) {
      return (
        '<div class="dac-faixa is-preparo"><i data-lucide="hourglass" aria-hidden="true"></i><div>' +
          (onde === 'modulo' ? '<p>Os passos de e-mail e senha só funcionam depois que a faculdade criar o seu acesso. Por enquanto, baixe os dois aplicativos (Duda e Microsoft Authenticator).</p>' : '') +
          '<p><b>Primeira senha:</b> ' + REGRA + '</p>' + exemplo() +
        '</div></div>'
      );
    }
    var email = d.email_academico
      ? '<dd><span class="dac-val dac-email">' + esc(d.email_academico) + '</span>' + copiar(d.email_academico, 'e-mail acadêmico') + '</dd>'
      : '<dd class="dac-falta">o Duda mostra, em <b>Não sei meus dados de acesso</b></dd>';
    var senha = d.senha_inicio
      ? '<div class="dac-faixa-pw"><p><b>Primeira senha:</b> <span class="dac-pw-ini">' + esc(d.senha_inicio) + '</span> + os 4 primeiros números do seu CPF</p>' +
        '<button type="button" class="dac-copy dac-montar-btn" data-dac-montar aria-expanded="false"><i data-lucide="key-round" aria-hidden="true"></i><span>Montar a senha</span></button></div>' + montador()
      : '';
    return (
      '<div class="dac-faixa" role="group" aria-label="Seus dados para o primeiro acesso">' +
        '<p class="dac-faixa-t"><i data-lucide="key-round" aria-hidden="true"></i><b>Seus dados para o primeiro acesso</b></p>' +
        '<dl class="dac-faixa-l">' +
          '<div><dt>RGM</dt><dd><span class="dac-val">' + esc(d.rgm) + '</span>' + copiar(d.rgm, 'RGM') + '</dd></div>' +
          '<div><dt>E-mail</dt>' + email + '</div>' +
        '</dl>' +
        senha +
        '<p class="dac-faixa-n">Nos vídeos, use os seus dados no lugar dos da Ana Souza. A primeira senha é: 3 letras do nome + @ + 3 números do RGM + 4 do CPF.</p>' +
        '<p class="dac-st sr-only" role="status" aria-live="polite"></p>' +
      '</div>'
    );
  }

  // ---------- aba "E-mail e senha" da ajuda do acesso (public/js/apps.js) ----------
  // Sem dados: vazio (fica o texto padrão "Descubra seu e-mail e senha"). Com RGM: os dados do aluno.
  function aba(d) {
    if (d.preparo) {
      return (
        '<div class="dac-aba is-preparo">' +
          '<h3>Seu acesso está sendo preparado</h3>' +
          '<p class="dac-aba-sub">Assim que o RGM e o e-mail acadêmico chegarem, eles aparecem aqui.</p>' +
          '<p class="dac-aba-pw"><b>Primeira senha:</b> ' + REGRA + '</p>' + exemplo() +
        '</div>'
      );
    }
    var email = d.email_academico
      ? '<div class="dac-aba-l"><span class="dac-aba-k">E-mail acadêmico</span><span class="dac-aba-v"><span class="dac-val dac-email">' + esc(d.email_academico) + '</span>' + copiar(d.email_academico, 'e-mail acadêmico') + '</span></div>'
      : '<div class="dac-aba-l"><span class="dac-aba-k">E-mail acadêmico</span><span class="dac-falta">O Duda mostra, em <b>Não sei meus dados de acesso</b>.</span></div>';
    var senha = d.senha_inicio
      ? '<div class="dac-faixa-pw"><p><b>Primeira senha:</b> <span class="dac-pw-ini">' + esc(d.senha_inicio) + '</span> + os 4 primeiros números do seu CPF</p>' +
        '<button type="button" class="dac-copy dac-montar-btn" data-dac-montar aria-expanded="false"><i data-lucide="key-round" aria-hidden="true"></i><span>Montar a senha</span></button></div>' + montador()
      : '<p class="dac-aba-pw"><b>Primeira senha:</b> ' + REGRA + '</p>';
    return (
      '<div class="dac-aba">' +
        '<h3>' + (d.email_academico ? 'Seu e-mail acadêmico e a primeira senha' : 'Seus dados de acesso') + '</h3>' +
        email +
        '<div class="dac-aba-l"><span class="dac-aba-k">RGM</span><span class="dac-aba-v"><span class="dac-val">' + esc(d.rgm) + '</span>' + copiar(d.rgm, 'RGM') + '</span></div>' +
        (d.curso ? '<div class="dac-aba-l"><span class="dac-aba-k">Curso</span><span class="dac-aba-v"><span class="dac-val dac-curso">' + esc(d.curso) + '</span></span></div>' : '') +
        senha +
        '<p class="dac-st sr-only" role="status" aria-live="polite"></p>' +
      '</div>'
    );
  }

  function pintar(raiz) {
    var d = dados;
    (raiz || document).querySelectorAll('[data-dados-acesso-slot]').forEach(function (slot) {
      var tipo = slot.getAttribute('data-dados-acesso-slot');
      // Os dados do aluno só aparecem no Início (pedido do usuário em 20/10): fora dele, o lugar fica vazio.
      var noInicio = !!slot.closest('#dashboard-page');
      var html = !d || !noInicio ? '' : tipo === 'cartao' ? cartao(d) : tipo === 'aba' ? aba(d) : faixa(d, slot.getAttribute('data-dados-acesso-onde'));
      // Aba da ajuda do acesso: com dados, some o texto padrão; com e-mail, a aba ganha o ✓.
      if (tipo === 'aba') {
        var pan = slot.closest('.apps-pan');
        if (pan) pan.classList.toggle('tem-dados', !!html);
        var box = slot.closest('.apps-ajuda');
        if (box) box.classList.toggle('tem-email', !!(d && d.email_academico));
      }
      // Mesmo conteúdo: não redesenha (preserva a senha aberta e o que o aluno digitou).
      var chave = html.replace(/dac-cpf-\d+/g, '');
      if (slot.getAttribute('data-dac-chave') === chave) return;
      slot.innerHTML = html;
      slot.setAttribute('data-dac-chave', chave);
      slot.hidden = !html;
    });
    document.querySelectorAll('[data-acesso-rgm]').forEach(function (el) {
      if (!el.hasAttribute('data-dac-padrao')) el.setAttribute('data-dac-padrao', el.textContent);
      el.textContent = !d ? el.getAttribute('data-dac-padrao') : d.preparo ? 'Acesso em preparação' : 'RGM ' + d.rgm;
    });
    if (window.lucide) window.lucide.createIcons();
  }

  // Preenche os lugares (de uma raiz que acabou de ser redesenhada, ou da página toda).
  function render(raiz) {
    if (dados && tokenDosDados === token()) { pintar(raiz); return Promise.resolve(); }
    return carregar().then(function () { pintar(raiz); });
  }

  // ---------- interações ----------
  function caixa(el) { return el.closest('.dac-card, .dac-faixa, .dac-aba'); }

  function anunciar(box, txt) {
    var st = box && box.querySelector('.dac-st');
    if (st) st.textContent = txt;
  }

  function abrirMontador(btn) {
    var box = caixa(btn);
    var area = box && box.querySelector('[data-dac-montar-area]');
    if (!area || !dados || !dados.senha_inicio) return;
    if (!area.hidden) { fecharMontador(area); return; }
    area.querySelector('[data-dac-ini]').textContent = dados.senha_inicio;
    area.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    area.querySelector('[data-dac-cpf]').focus();
  }

  function fecharMontador(area) {
    var box = caixa(area);
    var inp = area.querySelector('[data-dac-cpf]');
    inp.value = '';
    area.querySelector('[data-dac-pw]').innerHTML = '';
    area.querySelector('[data-dac-res] [data-dac-copiar]').setAttribute('data-dac-copiar', '');
    area.querySelector('[data-dac-res]').hidden = true;
    area.querySelector('[data-dac-ini]').textContent = '';
    area.hidden = true;
    var btn = box && box.querySelector('[data-dac-montar]');
    if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
  }

  function aoDigitarCpf(inp) {
    var limpo = inp.value.replace(/\D+/g, '').slice(0, 4);
    if (inp.value !== limpo) inp.value = limpo;
    var area = inp.closest('[data-dac-montar-area]');
    var res = area.querySelector('[data-dac-res]');
    var copy = res.querySelector('[data-dac-copiar]');
    if (limpo.length < 4 || !dados || !dados.senha_inicio) {
      res.hidden = true;
      area.querySelector('[data-dac-pw]').innerHTML = '';
      copy.setAttribute('data-dac-copiar', '');
      return;
    }
    var ini = dados.senha_inicio.split('@');
    var senha = dados.senha_inicio + limpo;
    area.querySelector('[data-dac-pw]').innerHTML = blocos(ini[0], ini[1], limpo, true);
    copy.setAttribute('data-dac-copiar', senha);
    res.hidden = false;
    anunciar(caixa(area), 'Sua primeira senha está montada.');
  }

  function aoCopiar(btn) {
    var valor = btn.getAttribute('data-dac-copiar');
    if (!valor) return;
    var box = caixa(btn);
    var ok = function () {
      var span = btn.querySelector('span');
      if (span) span.textContent = 'Copiado!';
      btn.classList.add('is-ok');
      anunciar(box, 'Copiado.');
      setTimeout(function () { if (span) span.textContent = 'Copiar'; btn.classList.remove('is-ok'); }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(valor).then(ok, function () { selecionar(btn); });
    } else selecionar(btn);
  }
  // Sem acesso à área de transferência: seleciona o texto para o aluno copiar.
  function selecionar(btn) {
    var val = btn.parentElement && btn.parentElement.querySelector('.dac-val');
    if (!val || !window.getSelection) return;
    var r = document.createRange();
    r.selectNodeContents(val);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  function init() {
    document.addEventListener('click', function (e) {
      var c = e.target.closest('[data-dac-copiar]');
      if (c) { e.preventDefault(); aoCopiar(c); return; }
      var m = e.target.closest('[data-dac-montar]');
      if (m) { e.preventDefault(); abrirMontador(m); return; }
      var o = e.target.closest('[data-dac-ocultar]');
      if (o) { e.preventDefault(); fecharMontador(o.closest('[data-dac-montar-area]')); }
    });
    document.addEventListener('input', function (e) {
      if (e.target.matches && e.target.matches('[data-dac-cpf]')) aoDigitarCpf(e.target);
    });
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
  return { render: render, recarregar: function () { dados = null; return render(); } };
})();
