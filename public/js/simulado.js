/* Área de simulado (oculta, SIMULADO_ATIVA_PARA). Página própria em /simulado.
   Sem sessão vai para o login; sem a área liberada (/api/recursos sem simulado: true ou API 404)
   volta para o início. Sem integração com o CRM: a tela não carrega o chat, não chama
   Rastreio.contexto/track nem o setContext do Bwipo. Os eventos vão só para o nosso servidor
   (Rastreio.registrar -> csu_eventos, quando o rastreio está liberado para a conta).
   Nada digitado nas respostas vai para o rastreio. */
(function () {
  'use strict';

  var $ = function (sel, raiz) { return (raiz || document).querySelector(sel); };
  var $$ = function (sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function data(d) {
    return d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';
  }
  function letra(i) { return 'abcdefgh'.charAt(i); }

  var estado = { provedor: null, simulado: null, quiz: null, cards: [], cardAtual: 0 };

  // ---------------- API ----------------
  function api(metodo, caminho, corpo, extra) {
    var headers = { Authorization: 'Bearer ' + (window.Auth.getToken() || '') };
    var opts = { method: metodo, headers: headers };
    if (corpo instanceof Blob || corpo instanceof ArrayBuffer) {
      headers['Content-Type'] = 'application/octet-stream';
      Object.assign(headers, extra || {});
      opts.body = corpo;
    } else if (corpo !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(corpo);
    }
    return fetch('/api/simulado' + caminho, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.status === 404 && caminho === '/estado') { sair(); throw new Error('indisponível'); }
        if (res.status === 401) { sessaoExpirada(); throw new Error(body.message || 'Sua sessão expirou. Entre de novo para continuar.'); }
        if (!res.ok) { var e = new Error(body.message || 'Algo deu errado. Tente de novo.'); e.status = res.status; e.body = body; throw e; }
        return body;
      });
    }, function () { throw new Error('Sem conexão com o servidor. Confira sua internet.'); });
  }
  function sair() { window.location.replace('/inicio'); }
  // Sessão vencida: mostra a mensagem e leva ao login (de lá o aluno volta pelo menu).
  function sessaoExpirada() {
    try { window.Auth.clear(); } catch (e) { /* segue para o login */ }
    setTimeout(function () { window.location.replace('/login'); }, 2500);
  }

  // ---------------- rastreio (só servidor; nada vai para o CRM) ----------------
  function rastreio(cfg) {
    if (!window.Rastreio || !cfg || !cfg.rastreio) return;
    window.Rastreio.iniciar({ chat: null, servidor: true });
    track('tela_aberta', { tela: 'Simulado', caminho: '/simulado' });
  }
  function track(nome, dados) { if (window.Rastreio && window.Rastreio.registrar) window.Rastreio.registrar(nome, dados || {}); }

  // ---------------- abas ----------------
  var NOMES_ABA = { docs: 'Documentos', simulado: 'Simulado', melhorar: 'Pontos a melhorar', flash: 'Flashcards', quiz: 'Quiz relâmpago' };
  function abrirAba(aba, foco) {
    $$('[role="tab"]').forEach(function (b) {
      var on = b.getAttribute('data-aba') === aba;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on && foco) b.focus();
      document.getElementById(b.getAttribute('aria-controls')).hidden = !on;
    });
    track('simulado_aba', { aba: NOMES_ABA[aba] });
    if (aba === 'melhorar') carregarPainel();
    if (aba === 'flash') carregarFlash();
    if (aba === 'quiz' && !estado.quiz) renderQuizInicio();
  }
  function ligarAbas() {
    var abas = $$('[role="tab"]');
    abas.forEach(function (b, i) {
      b.addEventListener('click', function () { abrirAba(b.getAttribute('data-aba')); });
      b.addEventListener('keydown', function (e) {
        var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? abas.length - 1 : null;
        if (j === null) return;
        e.preventDefault();
        abrirAba(abas[(j + abas.length) % abas.length].getAttribute('data-aba'), true);
      });
    });
  }

  // ---------------- documentos ----------------
  function msg(alvo, tipo, html) { alvo.innerHTML = '<div class="sim-msg sim-msg-' + tipo + '">' + html + '</div>'; }

  function carregarEstado() {
    return api('GET', '/estado').then(function (r) {
      estado.provedor = r.provedor;
      var aviso = $('[data-provedor]');
      if (r.provedor && !r.provedor.real) {
        aviso.textContent = 'Modo de demonstração: resumos e questões são montados com as frases do seu próprio material, sem IA generativa. A qualidade melhora quando a IA for ligada.';
        aviso.hidden = false;
      }
      if (r.provedor && r.provedor.imagens) {
        $('[data-aceita-imagem]').hidden = false;
        $('[data-arquivo]').setAttribute('accept', $('[data-arquivo]').getAttribute('accept') + ',image/png,image/jpeg,image/webp');
      }
      renderDocs(r.documentos || []);
      if ($('#app').hidden === false) carregarHero();
      return r;
    });
  }

  var ICONE_DOC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';

  function renderDocs(docs) {
    var ul = $('[data-docs]');
    $('[data-docs-vazio]').hidden = docs.length > 0;
    var topicos = docs.reduce(function (n, d) { return n + (d.status === 'pendente' ? 0 : (d.topicos || 0)); }, 0);
    $('[data-docs-conta]').textContent = docs.length
      ? docs.length + (docs.length === 1 ? ' documento' : ' documentos') + ' · ' + topicos + (topicos === 1 ? ' tópico' : ' tópicos')
      : '';
    ul.innerHTML = docs.map(function (d) {
      var pend = d.status === 'pendente';
      return '<li class="sim-doc" data-doc="' + d.id + '"><span class="p-ico">' + ICONE_DOC + '</span>' +
        '<div><span class="sim-doc-nome">' + esc(d.nome) + '</span>' +
        '<span class="sim-doc-info">' + esc(String(d.tipo).toUpperCase()) + ' · ' + (d.topicos || 0) + ' tópico(s) · enviado em ' + data(d.criado_em) + '</span>' +
        (d.revisao && !pend ? '<span class="sim-selo">em revisão</span>' : '') +
        (pend ? '<span class="sim-selo">aguardando sua confirmação</span>' : '') + '</div>' +
        '<div class="sim-doc-acts">' +
        (pend ? '<button type="button" class="portal-btn portal-btn--ghost" data-confirmar="' + d.id + '">Confirmar que é material de estudo</button>'
              : '<button type="button" class="portal-btn portal-btn--ghost" data-resumo-doc="' + d.id + '">Ver resumo</button>') +
        '<button type="button" class="portal-link" data-apagar="' + d.id + '" aria-label="Apagar ' + esc(d.nome) + '">Apagar</button></div></li>';
    }).join('');
  }

  // Banner: domínio médio e revisões do dia (mesma barra de progresso do banner do Início).
  function carregarHero() {
    return api('GET', '/painel').then(function (r) {
      var caixa = $('[data-hero-progresso]');
      var topicos = r.topicos || [];
      if (!topicos.length) { caixa.hidden = true; return; }
      var avaliados = topicos.filter(function (t) { return t.dominio != null; });
      var vencidos = topicos.filter(function (t) { return t.vencido; }).length;
      var revisar = vencidos ? ' · ' + vencidos + (vencidos === 1 ? ' tópico para revisar hoje' : ' tópicos para revisar hoje') : '';
      if (!avaliados.length) {
        caixa.innerHTML = '<span>' + topicos.length + (topicos.length === 1 ? ' tópico pronto' : ' tópicos prontos') + ' para treinar. Faça o primeiro simulado.</span>';
      } else {
        var media = Math.round(avaliados.reduce(function (n, t) { return n + t.dominio; }, 0) / avaliados.length * 100);
        caixa.innerHTML = '<span class="p-bar" role="img" aria-label="Domínio médio ' + media + '%"><i style="width:' + media + '%"></i></span>' +
          '<span>Domínio médio <strong>' + media + '%</strong>' + revisar + '</span>';
      }
      caixa.hidden = false;
    }).catch(function () { /* o banner fica sem o progresso */ });
  }

  function preencherAluno() {
    var u = (window.Auth.getUser && window.Auth.getUser()) || {};
    $('[data-user-name]').textContent = u.name || 'Aluno';
    $('[data-acesso-rgm]').textContent = u.rgm ? 'RGM ' + u.rgm : '';
  }

  function sairDaConta() {
    var fim = function () { try { window.Auth.clear(); } catch (e) { /* segue */ } window.location.replace('/login'); };
    var parar = window.Rastreio && window.Rastreio.parar ? Promise.resolve(window.Rastreio.parar()).catch(function () {}) : Promise.resolve();
    parar.then(function () { return window.Api.logout(); }).catch(function () {}).then(fim);
  }

  function enviar(arquivo) {
    var status = $('[data-upload-status]');
    if (!arquivo) return;
    if (arquivo.size > 10 * 1024 * 1024) { msg(status, 'erro', '<p>O arquivo passa de 10 MB. Envie uma versão menor.</p>'); return; }
    msg(status, 'aviso', '<p>Lendo <strong>' + esc(arquivo.name) + '</strong>…</p>');
    var ext = (arquivo.name.split('.').pop() || '').toLowerCase();
    arquivo.arrayBuffer().then(function (buf) {
      return api('POST', '/documentos', buf, { 'X-Nome-Arquivo': encodeURIComponent(arquivo.name) });
    }).then(function (r) {
      if (r.status === 'confirmar') {
        track('simulado_documento_confirmar', { tipo: ext });
        msg(status, 'aviso', '<p>' + esc(r.message) + '</p>' +
          (r.sinais && r.sinais.length ? '<p>O que vimos no arquivo:</p><ul>' + r.sinais.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' : '') +
          '<div class="sim-acoes"><button type="button" class="portal-btn" data-confirmar="' + r.documento_id + '">É material de estudo</button>' +
          '<button type="button" class="portal-btn portal-btn--ghost" data-desistir="' + r.documento_id + '">Não enviar este arquivo</button></div>');
      } else {
        track('simulado_documento_enviado', { tipo: ext, topicos: r.topicos || 0 });
        msg(status, 'ok', '<p>' + (r.repetido ? 'Este arquivo já estava na sua lista.' : 'Pronto! Encontramos ' + (r.topicos || 0) + ' tópico(s) para estudar.') + '</p>' +
          '<div class="sim-acoes"><button type="button" class="portal-btn portal-btn--ghost" data-resumo-doc="' + r.documento_id + '">Ver resumo</button>' +
          '<button type="button" class="portal-btn" data-ir-simulado>Fazer um simulado</button></div>');
      }
      return carregarEstado();
    }).catch(function (e) {
      if (e.body && e.body.bloqueado) {
        track('simulado_documento_bloqueado', { tipo: ext });
        msg(status, 'erro', '<p><strong>Não deu para usar este arquivo.</strong></p><p>' + esc(e.message) + '</p>');
      } else {
        msg(status, 'erro', '<p>' + esc(e.message) + '</p>');
      }
    }).then(function () { $('[data-arquivo]').value = ''; });
  }

  function confirmar(id, ehEstudo) {
    var status = $('[data-upload-status]');
    return api('POST', '/documentos/' + id + '/confirmar', { material_estudo: ehEstudo }).then(function (r) {
      if (r.status === 'removido') msg(status, 'ok', '<p>Tudo bem, o arquivo não foi guardado.</p>');
      else msg(status, 'ok', '<p>Obrigado! O material foi liberado e encontramos ' + (r.topicos || 0) + ' tópico(s). A equipe pode dar uma olhada nele.</p>');
      return carregarEstado();
    }).catch(function (e) { msg(status, 'erro', '<p>' + esc(e.message) + '</p>'); });
  }

  function verResumo(id, botao) {
    var caixa = $('[data-resumo]');
    if (botao) botao.disabled = true;
    caixa.hidden = false;
    caixa.innerHTML = '<p class="p-muted">Preparando o resumo…</p>';
    api('POST', '/documentos/' + id + '/resumo', {}).then(function (r) {
      track('simulado_resumo', { documento: id });
      var res = r.resumo || {};
      caixa.innerHTML = '<h2 class="p-h2">Resumo: ' + esc(r.documento.nome) + '</h2>' +
        '<p>' + esc(res.resumo) + '</p>' +
        (res.pontos && res.pontos.length ? '<h3>Pontos principais</h3><ul class="sim-resumo-pontos">' + res.pontos.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
        (res.termos && res.termos.length ? '<h3>Termos-chave</h3><ul class="sim-chips">' + res.termos.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
        (r.topicos && r.topicos.length ? '<h3>Tópicos e habilidades</h3><ul class="sim-resumo-pontos">' + r.topicos.map(function (t) {
          return '<li><strong>' + esc(t.nome) + '</strong>: ' + esc((t.habilidades || []).join('; ')) + '</li>';
        }).join('') + '</ul>' : '');
      caixa.focus();
    }).catch(function (e) { caixa.innerHTML = '<div class="sim-msg sim-msg-erro"><p>' + esc(e.message) + '</p></div>'; })
      .then(function () { if (botao) botao.disabled = false; });
  }

  function apagar(id) {
    if (!window.confirm('Apagar este documento, os tópicos e os flashcards dele?')) return;
    api('DELETE', '/documentos/' + id).then(function () {
      $('[data-resumo]').hidden = true;
      return carregarEstado();
    }).catch(function (e) { window.alert(e.message); });
  }

  // ---------------- simulado ----------------
  function questaoHtml(q, nome) {
    var cab = '<legend><span class="sim-q-topico">' + esc(q.topico) + ' · ' + (q.tipo === 'objetiva' ? 'múltipla escolha' : 'discursiva') + '</span>' + (q.indice + 1) + '. ' + esc(q.enunciado) + '</legend>';
    if (q.tipo === 'objetiva') {
      return '<fieldset class="sim-questao" data-q="' + q.indice + '">' + cab + q.alternativas.map(function (a, i) {
        return '<label class="sim-alt"><input type="radio" name="' + nome + q.indice + '" value="' + i + '"><span><strong>' + letra(i) + ')</strong> ' + esc(a) + '</span></label>';
      }).join('') + '</fieldset>';
    }
    return '<fieldset class="sim-questao" data-q="' + q.indice + '">' + cab +
      '<label class="p-muted" for="disc-' + q.indice + '">Sua resposta</label><textarea id="disc-' + q.indice + '" name="d' + q.indice + '" maxlength="4000"></textarea></fieldset>';
  }

  function gerarSimulado(botao) {
    var status = $('[data-sim-status]');
    botao.disabled = true;
    status.innerHTML = '<p class="sim-carregando">Montando as questões…</p>';
    api('POST', '/simulados', { tipo: 'simulado' }).then(function (r) {
      estado.simulado = r.simulado;
      track('simulado_gerado', { questoes: r.simulado.questoes.length });
      status.innerHTML = '';
      var form = $('[data-sim-form]');
      form.innerHTML = '<h2 class="p-h2">Simulado</h2><p class="p-hint">Marque uma alternativa em cada questão. Questões em branco contam como erro.</p>' +
        r.simulado.questoes.map(function (q) { return questaoHtml(q, 's'); }).join('') +
        '<div class="sim-acoes"><button type="submit" class="portal-btn">Corrigir simulado</button></div>';
      form.hidden = false;
      $('[data-sim-resultado]').hidden = true;
      $('[data-sim-inicio]').hidden = true;
      var primeiro = form.querySelector('input, textarea');
      if (primeiro) primeiro.focus();
    }).catch(function (e) { status.innerHTML = '<div class="sim-msg sim-msg-erro"><p>' + esc(e.message) + '</p></div>'; })
      .then(function () { botao.disabled = false; });
  }

  function corrigirSimulado(e) {
    e.preventDefault();
    var form = $('[data-sim-form]');
    var sim = estado.simulado;
    var respostas = {};
    sim.questoes.forEach(function (q) {
      if (q.tipo === 'objetiva') {
        var m = form.querySelector('input[name="s' + q.indice + '"]:checked');
        respostas[q.indice] = m ? Number(m.value) : null;
      } else {
        respostas[q.indice] = form.querySelector('[name="d' + q.indice + '"]').value;
      }
    });
    var vazias = sim.questoes.filter(function (q) { var v = respostas[q.indice]; return v === null || v === ''; }).length;
    if (vazias && !window.confirm(vazias + ' questão(ões) em branco. Corrigir mesmo assim?')) return;
    var botao = form.querySelector('[type="submit"]');
    botao.disabled = true;
    botao.textContent = 'Corrigindo…';
    api('POST', '/simulados/' + sim.id + '/corrigir', { respostas: respostas }).then(function (r) {
      form.hidden = true;
      renderResultado(sim, r.resultado);
      carregarHero();
      track('simulado_corrigido', { nota: r.nota, questoes: sim.questoes.length });
      sinalizarDificuldade(r.resultado.por_topico);
    }).catch(function (err) { window.alert(err.message); botao.disabled = false; botao.textContent = 'Corrigir simulado'; });
  }

  function faixa(nota10) { return nota10 < 5 ? 'fraca' : nota10 < 7 ? 'media' : 'boa'; }

  // Tópico abaixo de 6: evento interno (csu_eventos) para o percurso do aluno no admin.
  function sinalizarDificuldade(porTopico) {
    var fracos = (porTopico || []).filter(function (t) { return t.nota < 6; }).sort(function (a, b) { return a.nota - b.nota; });
    fracos.slice(0, 3).forEach(function (t) {
      track('simulado_dificuldade', { topico: t.topico, nota: t.nota });
    });
  }

  function renderResultado(sim, res) {
    var caixa = $('[data-sim-resultado]');
    var porTopico = (res.por_topico || []).slice().sort(function (a, b) { return a.nota - b.nota; });
    caixa.innerHTML = '<h2 class="p-h2">Resultado</h2>' +
      '<div class="sim-nota"><strong>' + String(res.nota).replace('.', ',') + '</strong><span>de 10</span></div>' +
      '<h3>Nota por tópico</h3><ul class="sim-por-topico">' + porTopico.map(function (t) {
        return '<li><span>' + esc(t.topico) + '</span><strong>' + String(t.nota).replace('.', ',') + '</strong>' +
          '<div class="sim-barra ' + faixa(t.nota) + '" role="img" aria-label="' + esc(t.topico) + ': ' + t.nota + ' de 10"><span style="width:' + (t.nota * 10) + '%"></span></div></li>';
      }).join('') + '</ul>' +
      '<h3>Correção</h3>' + sim.questoes.map(function (q, i) {
        var c = res.correcoes[i] || {};
        var sua = q.tipo === 'objetiva'
          ? (c.sua_resposta == null ? 'em branco' : letra(c.sua_resposta) + ') ' + esc(q.alternativas[c.sua_resposta]))
          : (c.sua_resposta ? esc(c.sua_resposta) : 'em branco');
        return '<div class="sim-correcao ' + (c.certa ? 'certa' : 'errada') + '"><p><strong>' + (i + 1) + '. ' + esc(q.enunciado) + '</strong></p>' +
          '<p>Sua resposta: ' + sua + '</p>' +
          (q.tipo === 'discursiva' ? '<p>Nota: ' + Math.round((c.score || 0) * 100) + '%</p>' : '') +
          '<p>' + esc(c.feedback) + '</p>' +
          (c.referencia ? '<p class="sim-ref">No seu material: ' + esc(c.referencia) + '</p>' : '') + '</div>';
      }).join('') +
      '<div class="sim-acoes"><button type="button" class="portal-btn" data-ir-melhorar>Ver pontos a melhorar</button>' +
      '<button type="button" class="portal-btn portal-btn--ghost" data-novo-simulado>Fazer outro simulado</button></div>';
    caixa.hidden = false;
    caixa.focus();
  }

  // ---------------- pontos a melhorar ----------------
  function topicoHtml(t, completo) {
    var pct = t.dominio == null ? null : Math.round(t.dominio * 100);
    return '<li><div class="sim-topico-topo"><strong>' + esc(t.nome) + '</strong><span>' +
      (pct == null ? 'ainda não avaliado' : 'domínio ' + pct + '%') + '</span></div>' +
      (pct == null ? '' : '<div class="sim-barra ' + faixa(pct / 10) + '" role="img" aria-label="Domínio ' + pct + '%"><span style="width:' + pct + '%"></span></div>') +
      (completo ? '<p>' + esc(t.recomendacao) + '</p>' : '') +
      (completo && t.proxima_revisao ? '<p class="sim-topico-rev">Próxima revisão: ' + data(t.proxima_revisao) + (t.vencido ? ' (hoje)' : '') + ' · do documento ' + esc(t.documento) + '</p>' : '') +
      '</li>';
  }

  function carregarPainel() {
    api('GET', '/painel').then(function (r) {
      $('[data-melhorar]').innerHTML = r.melhorar.map(function (t) { return topicoHtml(t, true); }).join('');
      $('[data-melhorar-vazio]').hidden = r.melhorar.length > 0;
      $('[data-todos]').innerHTML = r.topicos.map(function (t) { return topicoHtml(t, false); }).join('') || '<li class="p-muted">Nenhum tópico ainda.</li>';
      $('[data-reler-card]').hidden = !r.reler.length;
      $('[data-reler]').innerHTML = r.reler.map(function (x) { return '<li><strong>' + esc(x.topico) + ':</strong> ' + esc(x.trecho) + '</li>'; }).join('');
      track('simulado_pontos_melhorar', { topicos_fracos: r.melhorar.length });
    }).catch(function (e) { $('[data-melhorar]').innerHTML = '<li class="sim-msg sim-msg-erro">' + esc(e.message) + '</li>'; });
  }

  // ---------------- flashcards ----------------
  function carregarFlash() {
    var caixa = $('[data-flash]');
    caixa.innerHTML = '<p class="p-muted">Carregando…</p>';
    api('GET', '/flashcards/hoje').then(function (r) {
      estado.cards = r.cards;
      estado.cardAtual = 0;
      if (!r.total) {
        caixa.innerHTML = '<h2 class="p-h2">Flashcards</h2><p class="p-hint">Cartões de pergunta e resposta tirados dos seus documentos. Você revisa cada um no dia certo: o que erra volta logo; o que acerta volta cada vez mais tarde.</p>' +
          '<button type="button" class="portal-btn" data-gerar-flash>Criar flashcards</button>';
        return;
      }
      renderCard();
    }).catch(function (e) { caixa.innerHTML = '<div class="sim-msg sim-msg-erro"><p>' + esc(e.message) + '</p></div>'; });
  }

  function renderCard(mostrarVerso) {
    var caixa = $('[data-flash]');
    var c = estado.cards[estado.cardAtual];
    if (!c) {
      caixa.innerHTML = '<h2 class="p-h2">Flashcards</h2><div class="sim-msg sim-msg-ok"><p>Revisão de hoje concluída. Volte amanhã para os próximos cartões.</p></div>' +
        '<div class="sim-acoes"><button type="button" class="portal-btn portal-btn--ghost" data-gerar-flash>Criar cartões dos tópicos novos</button></div>';
      return;
    }
    caixa.innerHTML = '<h2 class="p-h2">Flashcards</h2><p class="sim-progresso">Cartão ' + (estado.cardAtual + 1) + ' de ' + estado.cards.length + ' para hoje · ' + esc(c.topico) + '</p>' +
      '<div class="sim-flash"><div class="sim-flash-frente">' + esc(c.frente) + '</div>' +
      (mostrarVerso ? '<div class="sim-flash-verso" tabindex="-1" data-verso>' + esc(c.verso) + '</div>' : '') + '</div>' +
      (mostrarVerso
        ? '<p class="sim-pergunta">Como foi?</p><div class="sim-acoes" style="margin-top:8px">' +
          ['Errei', 'Difícil', 'Bom', 'Fácil'].map(function (n, i) { return '<button type="button" class="portal-btn' + (i === 2 ? '' : ' portal-btn--ghost') + '" data-revisar="' + i + '">' + n + '</button>'; }).join('') + '</div>'
        : '<div class="sim-acoes"><button type="button" class="portal-btn" data-virar>Mostrar resposta</button></div>');
    var alvo = mostrarVerso ? caixa.querySelector('[data-verso]') : caixa.querySelector('[data-virar]');
    if (alvo) alvo.focus();
  }

  function revisarCard(nota) {
    var c = estado.cards[estado.cardAtual];
    api('POST', '/flashcards/' + c.id + '/revisar', { nota: nota }).then(function () {
      track('flashcard_revisado', { topico: c.topico, nota: nota });
      estado.cardAtual += 1;
      renderCard();
    }).catch(function (e) { window.alert(e.message); });
  }

  // ---------------- quiz relâmpago ----------------
  function renderQuizInicio() {
    $('[data-quiz]').innerHTML = '<h2 class="p-h2">Quiz relâmpago</h2><p class="p-hint">5 perguntas rápidas dos tópicos que estão na hora de revisar ou em que você está mais fraco. A correção sai na hora, uma por uma.</p>' +
      '<button type="button" class="portal-btn" data-iniciar-quiz>Começar</button><div data-quiz-status role="status" aria-live="polite"></div>';
  }

  function iniciarQuiz(botao) {
    botao.disabled = true;
    api('POST', '/simulados', { tipo: 'relampago' }).then(function (r) {
      estado.quiz = { sim: r.simulado, i: 0, acertos: 0 };
      track('simulado_relampago_iniciado', { questoes: r.simulado.questoes.length });
      renderQuizQuestao();
    }).catch(function (e) {
      botao.disabled = false;
      $('[data-quiz-status]').innerHTML = '<div class="sim-msg sim-msg-erro"><p>' + esc(e.message) + '</p></div>';
    });
  }

  function renderQuizQuestao() {
    var qz = estado.quiz;
    var q = qz.sim.questoes[qz.i];
    $('[data-quiz]').innerHTML = '<h2 class="p-h2">Quiz relâmpago</h2><p class="sim-progresso">Pergunta ' + (qz.i + 1) + ' de ' + qz.sim.questoes.length + '</p>' +
      '<form data-quiz-form novalidate>' + questaoHtml(q, 'r') +
      '<div data-quiz-feedback role="status" aria-live="polite"></div>' +
      '<div class="sim-acoes"><button type="submit" class="portal-btn">Conferir</button></div></form>';
    var p = $('[data-quiz] input');
    if (p) p.focus();
  }

  function conferirQuiz(e) {
    e.preventDefault();
    var qz = estado.quiz;
    var q = qz.sim.questoes[qz.i];
    var form = $('[data-quiz-form]');
    var m = form.querySelector('input:checked');
    if (!m) { $('[data-quiz-feedback]').innerHTML = '<div class="sim-msg sim-msg-aviso"><p>Escolha uma alternativa.</p></div>'; return; }
    var botao = form.querySelector('[type="submit"]');
    botao.disabled = true;
    api('POST', '/simulados/' + qz.sim.id + '/conferir', { indice: q.indice, resposta: Number(m.value) }).then(function (r) {
      var c = r.correcao;
      if (c.certa) qz.acertos += 1;
      track('simulado_relampago_resposta', { topico: q.topico, certa: !!c.certa });
      $$('.sim-alt', form).forEach(function (lab, i) {
        lab.querySelector('input').disabled = true;
        if (i === c.correta) lab.classList.add('certa');
        else if (i === c.sua_resposta) lab.classList.add('errada');
      });
      $('[data-quiz-feedback]').innerHTML = '<div class="sim-msg sim-msg-' + (c.certa ? 'ok' : 'erro') + '"><p><strong>' + esc(c.feedback) + '</strong></p>' +
        (c.referencia ? '<p class="sim-ref">No seu material: ' + esc(c.referencia) + '</p>' : '') + '</div>';
      var ultimo = qz.i >= qz.sim.questoes.length - 1;
      botao.outerHTML = '<button type="button" class="portal-btn" data-quiz-proxima>' + (ultimo ? 'Ver resultado' : 'Próxima') + '</button>';
      $('[data-quiz-proxima]').focus();
    }).catch(function (err) { botao.disabled = false; window.alert(err.message); });
  }

  function proximaQuiz() {
    var qz = estado.quiz;
    if (qz.i < qz.sim.questoes.length - 1) { qz.i += 1; renderQuizQuestao(); return; }
    api('POST', '/simulados/' + qz.sim.id + '/corrigir', {}).then(function (r) {
      track('simulado_relampago_concluido', { nota: r.nota });
      carregarHero();
      sinalizarDificuldade(r.resultado.por_topico);
      $('[data-quiz]').innerHTML = '<h2 class="p-h2">Quiz relâmpago</h2><div class="sim-nota"><strong>' + qz.acertos + '</strong><span>de ' + qz.sim.questoes.length + ' certas</span></div>' +
        '<p class="p-hint">Seu domínio por tópico foi atualizado e as próximas revisões foram reagendadas.</p>' +
        '<div class="sim-acoes"><button type="button" class="portal-btn" data-iniciar-quiz>Outro quiz</button><button type="button" class="portal-btn portal-btn--ghost" data-ir-melhorar>Pontos a melhorar</button></div>';
      estado.quiz = null;
    }).catch(function (e) { window.alert(e.message); });
  }

  // ---------------- eventos ----------------
  function ligar() {
    ligarAbas();
    var input = $('[data-arquivo]');
    input.addEventListener('change', function () { enviar(input.files && input.files[0]); });
    var drop = $('[data-drop]');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('arrastando'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('arrastando'); }); });
    drop.addEventListener('drop', function (e) { enviar(e.dataTransfer.files && e.dataTransfer.files[0]); });

    $('[data-sim-form]').addEventListener('submit', corrigirSimulado);

    document.addEventListener('submit', function (e) { if (e.target.matches('[data-quiz-form]')) conferirQuiz(e); });
    document.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.hasAttribute('data-confirmar')) confirmar(t.getAttribute('data-confirmar'), true);
      else if (t.hasAttribute('data-desistir')) confirmar(t.getAttribute('data-desistir'), false);
      else if (t.hasAttribute('data-resumo-doc')) verResumo(t.getAttribute('data-resumo-doc'), t);
      else if (t.hasAttribute('data-apagar')) apagar(t.getAttribute('data-apagar'));
      else if (t.hasAttribute('data-ir-simulado')) abrirAba('simulado', true);
      else if (t.hasAttribute('data-ir-docs')) { abrirAba('docs'); $('[data-drop]').scrollIntoView({ block: 'center' }); $('[data-arquivo]').focus(); }
      else if (t.hasAttribute('data-sair')) sairDaConta();
      else if (t.hasAttribute('data-gerar-simulado')) gerarSimulado(t);
      else if (t.hasAttribute('data-novo-simulado')) { $('[data-sim-resultado]').hidden = true; $('[data-sim-inicio]').hidden = false; $('[data-gerar-simulado]').focus(); }
      else if (t.hasAttribute('data-ir-melhorar')) abrirAba('melhorar', true);
      else if (t.hasAttribute('data-gerar-flash')) {
        t.disabled = true;
        api('POST', '/flashcards/gerar', {}).then(function (r) { track('flashcards_criados', { criados: r.criados }); carregarFlash(); })
          .catch(function (err) { t.disabled = false; window.alert(err.message); });
      }
      else if (t.hasAttribute('data-virar')) renderCard(true);
      else if (t.hasAttribute('data-revisar')) revisarCard(Number(t.getAttribute('data-revisar')));
      else if (t.hasAttribute('data-iniciar-quiz')) iniciarQuiz(t);
      else if (t.hasAttribute('data-quiz-proxima')) proximaQuiz();
    });
  }

  // ---------------- início ----------------
  function iniciar() {
    if (!window.Auth || !window.Auth.isAuthenticated()) { window.location.replace('/login'); return; }
    window.Api.getRecursos().then(function (r) {
      if (!r || !r.simulado) { sair(); return; }
      preencherAluno();
      return carregarEstado().then(function () {
        carregarHero();
        $('#app').hidden = false;
        ligar();
        rastreio(r);
      });
    }).catch(function (e) {
      if (e && e.status === 401) window.location.replace('/login'); else if (e && e.message !== 'indisponível') sair();
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
