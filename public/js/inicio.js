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

  function pontinhos(feitos, atual) {
    return '<span class="ai-dots" aria-hidden="true">' + (feitos || []).map(function (f, i) {
      return '<i class="' + (f ? 'on' : (i === atual ? 'now' : '')) + '"></i>';
    }).join('') + '</span>';
  }

  function renderCard() {
    var card = $('home-aula');
    if (!card) return;
    var txt = card.querySelector('.ai-txt');
    var acts = card.querySelector('.ai-acts');
    var ico = card.querySelector('.ai-ico');
    card.classList.remove('is-ok', 'is-done');
    var r = trilha;
    if (!r || !r.total) {
      txt.innerHTML = '<span class="ai-k">Aula Inaugural · certificado de 4 horas</span><h2 id="home-aula-h">Comece pela Aula Inaugural</h2>' +
        '<p>' + (r === false ? 'Não foi possível carregar o seu progresso agora.' : 'Carregando o seu progresso...') + '</p>';
      acts.innerHTML = '<button type="button" class="portal-btn portal-btn--primary" data-open-trilha="">Abrir a Aula Inaugural<i data-lucide="chevron-right" aria-hidden="true"></i></button>';
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
      ico.innerHTML = '<i data-lucide="award"></i>';
      txt.innerHTML = '<span class="ai-k">Aula Inaugural concluída</span><h2 id="home-aula-h">Certificado emitido em ' + esc(new Date(c.emitido_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })) + '</h2>' +
        '<p>Pode rever qualquer módulo quando quiser. ' + (c.liberado ? '' : 'O seu progresso continua salvo. ') + '<button type="button" class="portal-link" data-gerar-certificado>Gerar o PDF de novo</button></p>';
      acts.innerHTML = '<button type="button" class="portal-btn portal-btn--ghost" data-open-trilha="">Rever a Aula Inaugural<i data-lucide="chevron-right" aria-hidden="true"></i></button>';
    } else if (c.liberado && preparo()) {
      // Sem RGM o certificado não sai: o servidor responde "sem_rgm". Mostra isso antes do clique.
      card.classList.add('is-ok');
      ico.innerHTML = '<i data-lucide="badge-check"></i>';
      txt.innerHTML = '<span class="ai-k">Aula Inaugural concluída</span><h2 id="home-aula-h">Parabéns! Você concluiu a Aula Inaugural</h2>' +
        '<p>' + r.concluidos + ' de ' + r.total + ' módulos e ' + num(r.pontos) + ' pontos. Seu certificado de ' + horas + ' horas sai assim que o seu RGM chegar: o polo já está providenciando. Seu progresso fica salvo.</p>';
      acts.innerHTML = '<button type="button" class="portal-btn portal-btn--ghost" data-open-trilha="">Rever os módulos<i data-lucide="chevron-right" aria-hidden="true"></i></button>';
    } else if (c.liberado) {
      card.classList.add('is-ok');
      ico.innerHTML = '<i data-lucide="badge-check"></i>';
      txt.innerHTML = '<span class="ai-k">Certificado liberado</span><h2 id="home-aula-h">Parabéns! Você concluiu a Aula Inaugural</h2>' +
        '<p>' + r.concluidos + ' de ' + r.total + ' módulos e ' + num(r.pontos) + ' pontos. Seu certificado de ' + horas + ' horas está pronto.</p>';
      acts.innerHTML = '<button type="button" class="portal-btn" data-gerar-certificado><span data-cert-txt>Emitir certificado</span><i data-lucide="chevron-right" aria-hidden="true"></i></button>' +
        '<button type="button" class="portal-link" data-open-trilha="">Rever os módulos</button>';
    } else if (novo) {
      ico.innerHTML = '<i data-lucide="award"></i>';
      txt.innerHTML = '<span class="ai-k">' + k + '</span><h2 id="home-aula-h">Comece pela Aula Inaugural</h2>' +
        '<p>' + r.total + ' módulos curtos: assista, responda e ganhe pontos. Cerca de 5 minutos cada.</p>' +
        '<div class="ai-prog">' + pontinhos(r.feitos, -1) + '<span>0 de ' + r.total + ' módulos</span></div>';
      acts.innerHTML = '<button type="button" class="portal-btn portal-btn--primary" data-open-trilha="">Começar a aula<i data-lucide="chevron-right" aria-hidden="true"></i></button>' + verModulos;
    } else {
      ico.innerHTML = '<i data-lucide="award"></i>';
      var atual = r.atual ? r.atual.nivel : null;
      // Cada módulo concluído vale 10 pontos: faltar módulos é o mesmo que faltar pontos.
      var falta = (c.faltam_modulos > 1 ? 'Faltam ' + c.faltam_modulos + ' módulos' : 'Falta 1 módulo') +
        ' (' + num(c.faltam_pontos) + ' pontos) para liberar o certificado.';
      var pct = Math.min(100, Math.round((r.pontos || 0) / meta * 100));
      txt.innerHTML = '<span class="ai-k">' + k + '</span>' +
        '<h2 id="home-aula-h">' + (atual ? 'Módulo ' + atual + ' de ' + r.total + ': ' + esc(r.atual.titulo) : 'Aula Inaugural') + '</h2>' +
        '<p>' + falta + '</p>' +
        '<div class="ai-prog">' + pontinhos(r.feitos, atual ? atual - 1 : -1) + '<span>' + r.concluidos + ' de ' + r.total + ' módulos</span>' +
          '<span class="ai-pts"><span class="ai-bar" role="progressbar" aria-label="Pontos para o certificado" aria-valuemin="0" aria-valuemax="' + meta + '" aria-valuenow="' + Number(r.pontos || 0) + '" aria-valuetext="' + num(r.pontos) + ' de ' + num(meta) + ' pontos"><i style="width:' + pct + '%"></i></span>' + num(r.pontos) + ' de ' + num(meta) + ' pontos</span></div>';
      acts.innerHTML = '<button type="button" class="portal-btn portal-btn--primary" data-open-trilha="' + (atual || '') + '">' + (atual ? 'Continuar o módulo ' + atual : 'Abrir a Aula Inaugural') + '<i data-lucide="chevron-right" aria-hidden="true"></i></button>' + verModulos;
    }
    if (window.lucide) window.lucide.createIcons();
  }

  function render() { renderBanner(); renderCard(); }

  function setTrilha(resumo) { trilha = resumo === null ? false : (resumo || null); render(); }
  function setSemestre(frase, sem) { fraseSemestre = frase || ''; semPlano = !!sem; renderBanner(); }
  function limpar() { trilha = null; fraseSemestre = ''; semPlano = false; render(); }

  return { render: render, setTrilha: setTrilha, setSemestre: setSemestre, limpar: limpar };
})();
