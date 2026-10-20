/* Início (/inicio): banner e card da Aula Inaugural, a partir de dados reais.

   Banner (uma ação principal):
   - Com a trilha liberada, a Aula Inaugural tem card próprio, e o banner fala do semestre:
     "Acompanhe seu semestre." + Meu Semestre (ou a frase do polo, sem dados do semestre).
   - Sem a trilha: "Seu polo está aqui para ajudar você a estudar." + "Conhecer os primeiros passos".

   Card "Aula Inaugural · certificado de 4 horas" (só com a trilha liberada), 4 estados:
   A) não começou   → Começar a aula
   B) em andamento  → Continuar o módulo N (módulos feitos + pontos/meta)
   C) liberado      → Emitir certificado (7 módulos + meta de pontos; a regra é do servidor)
   D) já emitido    → Rever a Aula Inaugural

   Acesso em preparação (body.acesso-preparo, conta sem RGM): o banner diz que o acesso está sendo
   preparado e leva à Aula Inaugural; com os 7 módulos feitos, o certificado espera o RGM chegar.
   Sem matérias do semestre (cadastro em atualização), o banner também leva à Aula Inaugural. */
window.Inicio = (function () {
  'use strict';

  var trilha = null;      // /api/trilha/resumo
  var fraseSemestre = ''; // "Você está em X. A prova abre em Y." (Meu Semestre)
  var semPlano = false;   // Meu Semestre carregou e ainda não há matérias do curso

  function $(id) { return document.getElementById(id); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(n) { return Number(n || 0).toLocaleString('pt-BR'); }

  function acao(texto, destino) {
    var btn = $('home-hero-cta');
    var txt = $('home-hero-cta-text');
    if (!btn || !txt) return;
    txt.textContent = texto;
    btn.removeAttribute('data-open-trilha');
    btn.removeAttribute('data-go');
    if (destino.trilha != null) btn.setAttribute('data-open-trilha', destino.trilha);
    else btn.setAttribute('data-go', destino.tela);
  }

  function preparo() { return document.body.classList.contains('acesso-preparo'); }

  // Ação do banner que leva à Aula Inaugural, no ponto em que o aluno parou.
  function acaoAula() {
    var r = trilha;
    var c = (r && r.certificado) || {};
    if (r && r.total && (c.emitido || r.concluidos >= r.total)) return acao('Rever a Aula Inaugural', { trilha: '' });
    if (r && r.atual && (r.comecou || r.concluidos)) return acao('Continuar o módulo ' + r.atual.nivel, { trilha: r.atual.nivel });
    acao('Começar a Aula Inaugural', { trilha: '' });
  }

  function renderBanner() {
    var tail = $('home-hero-tail');
    var lede = $('home-hero-lede');
    var prog = $('home-hero-progress');
    if (!tail || !lede) return;
    if (prog) { prog.hidden = true; prog.innerHTML = ''; }
    if (preparo()) {
      var r = trilha || {};
      tail.textContent = 'Seu acesso está sendo preparado.';
      lede.textContent = r.total && r.concluidos >= r.total
        ? 'Você já concluiu a Aula Inaugural. O certificado sai assim que o seu RGM chegar.'
        : (r.comecou || r.concluidos ? 'Enquanto isso, continue a Aula Inaugural.' : 'Enquanto isso, comece pela Aula Inaugural.');
      acaoAula();
      return;
    }
    if (document.body.classList.contains('trilha-on')) {
      if (!fraseSemestre && semPlano) {
        tail.textContent = 'Vamos começar?';
        lede.textContent = 'Suas matérias aparecem aqui assim que chegarem. Enquanto isso, comece pela Aula Inaugural.';
        acaoAula();
        return;
      }
      if (fraseSemestre) {
        tail.textContent = 'Acompanhe seu semestre.';
        lede.textContent = fraseSemestre;
      } else {
        tail.textContent = 'Vamos começar?';
        lede.textContent = 'Seu polo está aqui para ajudar você a estudar.';
      }
      acao('Ver meu semestre', { tela: 'meu-semestre-page' });
      return;
    }
    tail.textContent = 'Vamos começar?';
    lede.textContent = 'Seu polo está aqui para ajudar você a estudar.';
    acao('Conhecer os primeiros passos', { tela: 'tutoriais-page' });
  }

  // Medalha do certificado (painel azul da esquerda), desenhada em SVG: roseta dourada com estrela e fitas.
  var MEDALHA = (function () {
    var bolas = '';
    for (var i = 0; i < 16; i++) {
      var a = i * Math.PI / 8;
      bolas += '<circle cx="' + (60 + 38 * Math.cos(a)).toFixed(1) + '" cy="' + (56 + 38 * Math.sin(a)).toFixed(1) + '" r="9"/>';
    }
    return '<svg class="ai-medalha" viewBox="0 0 120 150" aria-hidden="true" focusable="false">' +
      '<path d="M38 86 22 140l17-9 9 17 14-50z" fill="#f5b400"/><path d="M82 86l16 54-17-9-9 17-14-50z" fill="#f5b400"/>' +
      '<path d="M38 86 22 140l17-9 9 17 14-50z" fill="#ffcf3a" opacity=".55"/>' +
      '<g fill="#ffc72c">' + bolas + '<circle cx="60" cy="56" r="40"/></g>' +
      '<circle cx="60" cy="56" r="30" fill="#ffb300" stroke="#ffe27a" stroke-width="3"/>' +
      '<path d="M60 36l6.2 12.6 13.9 2-10 9.8 2.4 13.8L60 67.7 47.5 74.2l2.4-13.8-10-9.8 13.9-2z" fill="#ffd84a" stroke="#e08a00" stroke-width="2" stroke-linejoin="round"/>' +
      '<g stroke="#ffd23f" stroke-width="4" stroke-linecap="round"><path d="M8 18l9 7"/><path d="M2 40h10"/><path d="M112 18l-9 7"/><path d="M110 92l-8-5"/></g>' +
      '</svg>';
  })();

  function painel(selo, horas, texto) {
    selo.innerHTML = MEDALHA + '<span class="ai-selo-t">' + (texto || 'Certificado<br>de <b>' + horas + ' horas</b>') + '</span>';
  }

  // Barra e números do progresso ("4 de 7 módulos | 40 de 70 pontos").
  function progresso(r, meta) {
    var feitos = Number(r.concluidos || 0);
    var pontos = Number(r.pontos || 0);
    var pct = Math.min(100, Math.round(pontos / meta * 100));
    return '<div class="ai-prog">' +
      '<span class="ai-bar" role="progressbar" aria-label="Progresso para o certificado" aria-valuemin="0" aria-valuemax="' + meta + '" aria-valuenow="' + pontos + '" aria-valuetext="' + num(pontos) + ' de ' + num(meta) + ' pontos"><i style="width:' + pct + '%"></i></span>' +
      '<div class="ai-stats"><span><b>' + feitos + ' de ' + r.total + '</b> módulos</span><span class="ai-sep" aria-hidden="true"></span><span><b>' + num(pontos) + ' de ' + num(meta) + '</b> pontos</span></div>' +
      '</div>';
  }

  function renderCard() {
    var card = $('home-aula');
    if (!card) return;
    var txt = card.querySelector('.ai-txt');
    var acts = card.querySelector('.ai-acts');
    var selo = card.querySelector('.ai-selo');
    card.classList.remove('is-ok', 'is-done');
    var r = trilha;
    var seta = '<i data-lucide="chevron-right" aria-hidden="true"></i>';
    if (!r || !r.total) {
      painel(selo, 4);
      txt.innerHTML = '<span class="ai-k">Aula Inaugural · certificado de 4 horas</span><h2 id="home-aula-h">Comece pela Aula Inaugural</h2>' +
        '<p>' + (r === false ? 'Não foi possível carregar o seu progresso agora.' : 'Carregando o seu progresso...') + '</p>';
      acts.innerHTML = '<button type="button" class="portal-btn portal-btn--primary" data-open-trilha="">Abrir a Aula Inaugural' + seta + '</button>';
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    var c = r.certificado || {};
    var meta = c.meta || 70; // 10 pontos por módulo concluído
    var horas = c.horas || 4;
    var k = 'Aula Inaugural · certificado de ' + horas + ' horas';
    var verModulos = '<button type="button" class="portal-link" data-open-trilha="">Ver os módulos</button>';
    var novo = !r.comecou && !r.concluidos;

    if (c.emitido) {
      card.classList.add('is-done');
      painel(selo, horas, 'Certificado<br><b>emitido</b>');
      txt.innerHTML = '<span class="ai-k">Aula Inaugural concluída</span><h2 id="home-aula-h">Certificado emitido em ' + esc(new Date(c.emitido_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })) + '</h2>' +
        '<p>Baixe de novo quando precisar. ' + (c.liberado ? 'Pode rever qualquer módulo quando quiser.' : 'O seu progresso continua salvo.') + '</p>' + progresso(r, meta);
      acts.innerHTML = '<button type="button" class="portal-btn portal-btn--primary" data-gerar-certificado><span data-cert-txt>Baixar o certificado</span>' + seta + '</button>' +
        '<button type="button" class="portal-link" data-open-trilha="">Rever a Aula Inaugural</button>';
    } else if (c.liberado && preparo()) {
      // Sem RGM o certificado não sai: o servidor responde "sem_rgm". Mostra isso antes do clique.
      card.classList.add('is-ok');
      painel(selo, horas, 'Certificado<br><b>quase lá</b>');
      txt.innerHTML = '<span class="ai-k">Aula Inaugural concluída</span><h2 id="home-aula-h">Parabéns! Você concluiu a Aula Inaugural</h2>' +
        '<p>Seu certificado de ' + horas + ' horas sai assim que o seu RGM chegar: o polo já está providenciando.</p>' + progresso(r, meta);
      acts.innerHTML = '<button type="button" class="portal-btn portal-btn--ghost" data-open-trilha="">Rever os módulos' + seta + '</button>';
    } else if (c.liberado) {
      card.classList.add('is-ok');
      painel(selo, horas, 'Certificado<br><b>liberado!</b>');
      txt.innerHTML = '<span class="ai-k">Certificado liberado</span><h2 id="home-aula-h">Parabéns! Você concluiu a Aula Inaugural</h2>' +
        '<p>Seu certificado de ' + horas + ' horas está pronto para emitir.</p>' + progresso(r, meta);
      acts.innerHTML = '<button type="button" class="portal-btn portal-btn--primary" data-gerar-certificado><span data-cert-txt>Emitir certificado</span>' + seta + '</button>' +
        '<button type="button" class="portal-link" data-open-trilha="">Rever os módulos</button>';
    } else if (novo) {
      painel(selo, horas);
      txt.innerHTML = '<span class="ai-k">' + k + '</span><h2 id="home-aula-h">Comece pela Aula Inaugural</h2>' +
        '<p>' + r.total + ' módulos curtos: assista, leia e responda. Cada módulo concluído vale 10 pontos.</p>' + progresso(r, meta);
      acts.innerHTML = '<button type="button" class="portal-btn portal-btn--primary" data-open-trilha="">Começar a aula' + seta + '</button>' + verModulos;
    } else {
      painel(selo, horas);
      var atual = r.atual ? r.atual.nivel : null;
      var falta = c.faltam_modulos > 1 ? 'Faltam ' + c.faltam_modulos + ' módulos para liberar o certificado.' : 'Falta 1 módulo para liberar o certificado.';
      txt.innerHTML = '<span class="ai-k">' + k + '</span>' +
        '<h2 id="home-aula-h">' + (atual ? 'Módulo ' + atual + ' de ' + r.total + ': ' + esc(r.atual.titulo) : 'Aula Inaugural') + '</h2>' +
        '<p>' + falta + '</p>' + progresso(r, meta);
      acts.innerHTML = '<button type="button" class="portal-btn portal-btn--primary" data-open-trilha="' + (atual || '') + '">' + (atual ? 'Continuar o módulo ' + atual : 'Abrir a Aula Inaugural') + seta + '</button>' + verModulos;
    }
    if (window.lucide) window.lucide.createIcons();
  }

  function render() { renderBanner(); renderCard(); }

  function setTrilha(resumo) { trilha = resumo === null ? false : (resumo || null); render(); }
  function setSemestre(frase, sem) { fraseSemestre = frase || ''; semPlano = !!sem; renderBanner(); }
  function limpar() { trilha = null; fraseSemestre = ''; semPlano = false; render(); }

  return { render: render, setTrilha: setTrilha, setSemestre: setSemestre, limpar: limpar };
})();
