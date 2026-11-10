/* Admin › Fluxo do Acolhimento: desenho editável das mensagens Comercial → Acolhimento.
   Dados de GET/PUT /api/admin/fluxo-acolhimento (server/fluxo-acolhimento.js). Só desenho: salvar grava o
   fluxo no banco do app e mais nada (não envia mensagem, não fala com o CRM nem com o n8n).
   Duas vistas (#fluxo = lista, #fluxo/mapa = diagrama) e um editor em <dialog> para a etapa escolhida. */
window.AdminFluxo = (function () {
  'use strict';

  var C = function () { return window.AdminCore; };
  var esc = function (t) { return C().escapeHtml(t); };
  var $ = function (id) { return document.getElementById(id); };

  var TIPO = {
    trigger: 'Início', message: 'Mensagem ao aluno', decision: 'Decisão', action: 'Ação interna', success: 'Conclusão',
  };
  var LARG = 236;          // largura do cartão no mapa
  var PORTA_Y = 52;        // altura em que a seta sai/entra no cartão
  var COLUNA = 120;        // cartões com x a menos disto um do outro ficam no mesmo passo da lista
  var ZOOMS = [0.5, 0.75, 1];

  var st = {
    fluxo: null, base: null, inicial: true, por: null, limites: { botoes: 3, titulo: 120, conteudo: 4000, rotulo: 60, botao: 24 },
    sujo: false, salvando: false, carregando: false,
    aberta: null, zoom: 1, mover: false, conflito: false,
  };

  // ---------- utilidades ----------
  function no(id) { return st.fluxo && st.fluxo.nodes.find(function (n) { return n.id === id; }); }
  function novoId() { return 'etapa_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function quando(iso) {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  // Texto do WhatsApp: *negrito*, _itálico_ e {{variável}} destacada. Escapa antes de marcar.
  function zap(t) {
    return esc(t)
      .replace(/\{\{\s*([^}]+?)\s*\}\}/g, '<span class="fx-var">{{$1}}</span>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<b>$2</b>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
  }
  function ordenados() {
    return st.fluxo.nodes.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
  }
  // Passos da lista: colunas do mapa, da esquerda para a direita.
  function passos() {
    var out = [];
    ordenados().forEach(function (n) {
      var ult = out[out.length - 1];
      if (ult && n.x - ult.x0 < COLUNA) ult.nos.push(n);
      else out.push({ x0: n.x, nos: [n] });
    });
    return out;
  }
  function saidas(id) { return st.fluxo.edges.filter(function (e) { return e.from === id; }); }
  function entradas(id) { return st.fluxo.edges.filter(function (e) { return e.to === id; }); }

  function mensagem(texto, tipo) {
    var el = $('fluxo-msg');
    if (!el) return;
    el.className = 'fx-msg' + (tipo ? ' fx-msg--' + tipo : '');
    el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    el.innerHTML = texto || '';
  }

  // ---------- barra de ações ----------
  function barra() {
    var box = $('fluxo-barra');
    if (!box || !st.fluxo) return;
    var estado;
    if (st.sujo) estado = '<b class="fx-sujo">Alterações não salvas</b>';
    else if (st.inicial) estado = 'Fluxo inicial (ainda não editado)';
    else estado = 'Salvo' + (st.por ? ' por ' + esc(st.por) : '') + ' em ' + esc(quando(st.base));
    box.innerHTML =
      '<p class="fx-estado">' + estado + ' · ' + st.fluxo.nodes.length + ' etapas, ' + st.fluxo.edges.length + ' saídas</p>' +
      '<div class="fx-acoes">' +
        '<button type="button" class="fx-bt fx-bt--pri" data-acao="salvar"' + (st.sujo && !st.salvando ? '' : ' disabled') + '>' + (st.salvando ? 'Salvando...' : 'Salvar') + '</button>' +
        '<button type="button" class="fx-bt" data-acao="nova">+ Nova etapa</button>' +
        '<button type="button" class="fx-bt" data-acao="descartar"' + (st.sujo ? '' : ' disabled') + '>Descartar alterações</button>' +
        '<details class="fx-mais"><summary class="fx-bt">Mais</summary><div class="fx-mais-menu">' +
          '<button type="button" class="fx-bt" data-acao="exportar">Baixar JSON</button>' +
          '<label class="fx-bt">Importar JSON<input type="file" accept=".json,application/json" data-acao="importar" hidden></label>' +
          '<button type="button" class="fx-bt fx-bt--perigo" data-acao="restaurar">Voltar ao fluxo inicial</button>' +
        '</div></details>' +
      '</div>';
  }

  // ---------- lista ----------
  function cartaoHtml(n) {
    var tipo = TIPO[n.type] ? n.type : 'action';
    var corpo = n.type === 'message'
      ? '<div class="fx-balao">' + (n.content ? zap(n.content) : '<span class="fx-vazio">Sem texto</span>') + '</div>'
      : '<p class="fx-desc">' + (n.content ? zap(n.content) : '<span class="fx-vazio">Sem descrição</span>') + '</p>';
    var botoes = (n.buttons || []).length
      ? '<ul class="fx-botoes" aria-label="Botões da mensagem">' + n.buttons.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>'
      : '';
    var sai = saidas(n.id).map(function (e) {
      var alvo = no(e.to);
      return '<li><button type="button" class="fx-ir" data-ir="' + esc(e.to) + '">' +
        (e.label ? '<b>' + esc(e.label) + '</b> → ' : '→ ') + esc(alvo ? alvo.title : e.to) + '</button></li>';
    }).join('');
    var vem = entradas(n.id).map(function (e) {
      var de = no(e.from);
      return '<li><button type="button" class="fx-ir fx-ir--de" data-ir="' + esc(e.from) + '">' + esc(de ? de.title : e.from) + (e.label ? ' (' + esc(e.label) + ')' : '') + '</button></li>';
    }).join('');
    return '<article class="fx-card fx-t-' + tipo + '" id="fx-card-' + esc(n.id) + '" tabindex="-1" aria-labelledby="fx-tt-' + esc(n.id) + '">' +
      '<header class="fx-card-h"><span class="fx-tipo">' + esc(TIPO[tipo]) + '</span>' +
        '<h4 id="fx-tt-' + esc(n.id) + '" class="fx-tt">' + esc(n.title) + '</h4></header>' +
      corpo + botoes +
      (sai ? '<div class="fx-lig"><p class="fx-lig-t">Saídas</p><ul>' + sai + '</ul></div>' : '<p class="fx-fim">Fim do caminho</p>') +
      (vem ? '<details class="fx-vem"><summary>Vem de ' + entradas(n.id).length + ' etapa(s)</summary><ul>' + vem + '</ul></details>' : '') +
      '<button type="button" class="fx-bt fx-editar" data-editar="' + esc(n.id) + '">Editar etapa<span class="sr-only">: ' + esc(n.title) + '</span></button>' +
    '</article>';
  }
  function lista() {
    var box = $('fluxo-lista');
    if (!box) return;
    box.innerHTML = '<ol class="fx-passos">' + passos().map(function (p, i) {
      return '<li class="fx-passo"><p class="fx-passo-t">Passo ' + (i + 1) + (p.nos.length > 1 ? ' · ' + p.nos.length + ' caminhos' : '') + '</p>' +
        '<div class="fx-passo-nos' + (p.nos.length > 1 ? ' fx-passo-nos--var' : '') + '">' + p.nos.map(cartaoHtml).join('') + '</div></li>';
    }).join('') + '</ol>';
  }

  // ---------- mapa ----------
  function mundo() {
    var w = 0, h = 0;
    st.fluxo.nodes.forEach(function (n) { w = Math.max(w, n.x + LARG + 120); h = Math.max(h, n.y + 220); });
    return { w: Math.max(w, 900), h: Math.max(h, 500) };
  }
  function caminho(a, b) {
    var x = a.x + LARG, y = a.y + PORTA_Y, bx = b.x, by = b.y + PORTA_Y;
    if (bx < x + 15) { // volta para trás: curva por baixo
      return { d: 'M' + x + ' ' + y + ' C' + (x + 95) + ' ' + (y + 140) + ',' + (bx - 95) + ' ' + (by + 140) + ',' + bx + ' ' + by, lx: (x + bx) / 2, ly: Math.max(y, by) + 112 };
    }
    var m = Math.max(45, (bx - x) / 2);
    return { d: 'M' + x + ' ' + y + ' C' + (x + m) + ' ' + y + ',' + (bx - m) + ' ' + by + ',' + bx + ' ' + by, lx: (x + bx) / 2, ly: (y + by) / 2 - 8 };
  }
  function setas() {
    var g = $('fx-setas');
    if (!g) return;
    g.innerHTML = st.fluxo.edges.map(function (e) {
      var a = no(e.from), b = no(e.to);
      if (!a || !b) return '';
      var c = caminho(a, b);
      return '<path d="' + c.d + '" class="fx-seta" marker-end="url(#fx-ponta)"/>' +
        (e.label ? '<text x="' + c.lx + '" y="' + c.ly + '" text-anchor="middle" class="fx-seta-t">' + esc(e.label) + '</text>' : '');
    }).join('');
  }
  function mapa() {
    var box = $('fluxo-mapa');
    if (!box) return;
    var vp = $('fx-vp');
    var rolagem = vp ? { l: vp.scrollLeft, t: vp.scrollTop } : null;
    var m = mundo();
    var z = st.zoom;
    box.innerHTML =
      '<div class="fx-mapa-barra">' +
        '<div class="fx-zoom" role="group" aria-label="Zoom do mapa">' +
          '<button type="button" class="fx-bt" data-zoom="-1" aria-label="Diminuir"' + (z <= ZOOMS[0] ? ' disabled' : '') + '>−</button>' +
          '<span aria-live="polite">' + Math.round(z * 100) + '%</span>' +
          '<button type="button" class="fx-bt" data-zoom="1" aria-label="Aumentar"' + (z >= ZOOMS[ZOOMS.length - 1] ? ' disabled' : '') + '>+</button>' +
        '</div>' +
        '<button type="button" class="fx-bt" data-mover aria-pressed="' + st.mover + '">' + (st.mover ? 'Arrastar cartões: ligado' : 'Arrastar cartões: desligado') + '</button>' +
        '<p class="fx-mapa-dica">' + (st.mover ? 'Arraste um cartão para mudar o lugar. Toque para editar. Com o cartão em foco, as setas do teclado também movem.' : 'Toque num cartão para editar. Ligue "Arrastar cartões" para mudar os lugares.') + '</p>' +
      '</div>' +
      '<div class="fx-vp' + (st.mover ? ' is-mover' : '') + '" id="fx-vp" tabindex="0" aria-label="Mapa do fluxo; role para os lados para ver tudo">' +
        '<div class="fx-escala" style="width:' + Math.round(m.w * z) + 'px;height:' + Math.round(m.h * z) + 'px">' +
          '<div class="fx-mundo" id="fx-mundo" style="width:' + m.w + 'px;height:' + m.h + 'px;transform:scale(' + z + ')">' +
            '<svg class="fx-svg" width="' + m.w + '" height="' + m.h + '" aria-hidden="true"><defs><marker id="fx-ponta" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0,10 3.5,0 7"/></marker></defs><g id="fx-setas"></g></svg>' +
            ordenados().map(function (n) {
              var tipo = TIPO[n.type] ? n.type : 'action';
              return '<button type="button" class="fx-no fx-t-' + tipo + '" data-no="' + esc(n.id) + '" style="left:' + n.x + 'px;top:' + n.y + 'px">' +
                '<span class="fx-tipo">' + esc(TIPO[tipo]) + '</span><span class="fx-no-t">' + esc(n.title) + '</span>' +
                '<span class="fx-no-p">' + esc(n.content) + '</span>' +
                ((n.buttons || []).length ? '<span class="fx-no-b">' + n.buttons.map(esc).join(' · ') + '</span>' : '') +
              '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>';
    setas();
    vp = $('fx-vp');
    if (rolagem) { vp.scrollLeft = rolagem.l; vp.scrollTop = rolagem.t; }
  }

  function desenhar() {
    if (!st.fluxo) return;
    barra();
    lista();
    mapa();
  }
  var pendente = false;
  // Junta várias mudanças seguidas (digitação) num desenho só. O setTimeout cobre aba em segundo plano, onde o rAF espera.
  function redesenharDepois() {
    if (pendente) return;
    pendente = true;
    var feito = false;
    var vai = function () { if (feito) return; feito = true; pendente = false; desenhar(); };
    requestAnimationFrame(vai);
    setTimeout(vai, 150);
  }
  function mudou() {
    st.sujo = true;
    redesenharDepois();
  }

  // ---------- editor ----------
  function opcoesDestino(atual, menos) {
    return '<option value="">Escolha a etapa</option>' + ordenados().filter(function (n) { return n.id !== menos; }).map(function (n) {
      return '<option value="' + esc(n.id) + '"' + (n.id === atual ? ' selected' : '') + '>' + esc(n.title) + '</option>';
    }).join('');
  }
  function editorHtml(n) {
    var L = st.limites;
    var bts = n.buttons || [];
    var sai = saidas(n.id);
    return '<form method="dialog" class="fx-ed" novalidate>' +
      '<header class="fx-ed-h"><h3 id="fluxo-editor-h">Editar etapa</h3>' +
        '<button type="button" class="fx-bt fx-fechar" data-fechar aria-label="Fechar o editor">Fechar</button></header>' +
      '<div class="fx-ed-corpo">' +
        '<label class="fx-campo"><span>Título</span><input data-campo="title" maxlength="' + L.titulo + '" value="' + esc(n.title) + '" required></label>' +
        '<label class="fx-campo"><span>Tipo de etapa</span><select data-campo="type">' + Object.keys(TIPO).map(function (k) {
          return '<option value="' + k + '"' + (n.type === k ? ' selected' : '') + '>' + esc(TIPO[k]) + '</option>';
        }).join('') + '</select></label>' +
        '<label class="fx-campo"><span>' + (n.type === 'message' ? 'Texto da mensagem' : 'Descrição') + '</span>' +
          '<textarea data-campo="content" maxlength="' + L.conteudo + '" rows="' + (n.type === 'message' ? 9 : 4) + '">' + esc(n.content) + '</textarea>' +
          '<small>' + (n.type === 'message' ? '*negrito*, _itálico_ e variáveis como {{nome}} ficam como no WhatsApp.' : 'O que acontece nesta etapa.') + '</small></label>' +
        (n.type === 'message' ? '<div class="fx-prev"><p class="fx-lig-t">Prévia</p><div class="fx-balao" id="fx-prev">' + (n.content ? zap(n.content) : '<span class="fx-vazio">Sem texto</span>') + '</div></div>' : '') +
        (n.type === 'message'
          ? '<fieldset class="fx-grupo"><legend>Botões da mensagem <small>(até ' + L.botoes + ', ' + L.botao + ' letras cada)</small></legend>' +
              (bts.length ? '' : '<p class="fx-vazio">Sem botões. Se as opções estão no texto, dá para trazer para cá.</p>') +
              bts.map(function (b, i) {
                return '<div class="fx-linha"><label class="fx-campo fx-campo--flex"><span class="sr-only">Botão ' + (i + 1) + '</span>' +
                  '<input data-botao="' + i + '" maxlength="' + L.botao + '" value="' + esc(b) + '" placeholder="Texto do botão"></label>' +
                  '<button type="button" class="fx-bt fx-bt--perigo" data-tira-botao="' + i + '">Tirar<span class="sr-only"> o botão ' + (i + 1) + '</span></button></div>';
              }).join('') +
              (bts.length < L.botoes ? '<button type="button" class="fx-bt" data-poe-botao>+ Botão</button>' : '') +
            '</fieldset>'
          : '') +
        '<fieldset class="fx-grupo"><legend>Saídas <small>(para onde o fluxo segue)</small></legend>' +
          (sai.length ? '' : '<p class="fx-vazio">Nenhuma saída: o caminho termina aqui.</p>') +
          sai.map(function (e) {
            var i = st.fluxo.edges.indexOf(e);
            return '<div class="fx-saida">' +
              '<label class="fx-campo"><span>Rótulo <small>(opcional)</small></span><input data-rotulo="' + i + '" maxlength="' + L.rotulo + '" value="' + esc(e.label) + '" placeholder="Ex.: Sim, Depois"></label>' +
              '<label class="fx-campo"><span>Vai para</span><select data-destino="' + i + '">' + opcoesDestino(e.to, null) + '</select></label>' +
              '<button type="button" class="fx-bt fx-bt--perigo" data-tira-saida="' + i + '">Tirar saída</button></div>';
          }).join('') +
          '<button type="button" class="fx-bt" data-poe-saida>+ Saída</button>' +
        '</fieldset>' +
      '</div>' +
      '<footer class="fx-ed-pe">' +
        '<button type="button" class="fx-bt" data-depois>+ Etapa depois desta</button>' +
        '<button type="button" class="fx-bt" data-duplicar>Duplicar</button>' +
        '<button type="button" class="fx-bt fx-bt--perigo" data-excluir>Excluir etapa</button>' +
        '<button type="button" class="fx-bt fx-bt--pri" data-fechar>Pronto</button>' +
      '</footer>' +
    '</form>';
  }
  function abrir(id, foco) {
    var n = no(id);
    var dlg = $('fluxo-editor');
    if (!n || !dlg) return;
    st.aberta = id;
    dlg.innerHTML = editorHtml(n);
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    var alvo = foco ? dlg.querySelector(foco) : dlg.querySelector('[data-campo="title"]');
    if (alvo) alvo.focus();
  }
  function reabrir(foco) { if (st.aberta) abrir(st.aberta, foco); }
  // O evento close (Pronto, Fechar ou Esc) devolve o foco ao cartão da etapa.
  function fechar() {
    var dlg = $('fluxo-editor');
    if (dlg && dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  }
  // Leva ao cartão (na vista aberta) e põe o foco nele.
  function focar(id, rolar) {
    var naLista = !$('fluxo-lista').hidden;
    var el = naLista ? $('fx-card-' + id) : document.querySelector('.fx-no[data-no="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!el) return;
    if (rolar !== false) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    el.focus({ preventScroll: rolar !== false });
    if (naLista) { el.classList.add('is-destaque'); setTimeout(function () { el.classList.remove('is-destaque'); }, 1600); }
  }

  function novaEtapa(depoisDe) {
    var n;
    if (depoisDe) {
      n = { id: novoId(), title: 'Nova etapa', content: '', type: 'message', x: depoisDe.x + 150, y: depoisDe.y + 170 };
      st.fluxo.nodes.push(n);
      st.fluxo.edges.push({ from: depoisDe.id, to: n.id, label: '' });
    } else {
      var maxX = 0, y = 350;
      st.fluxo.nodes.forEach(function (x) { if (x.x >= maxX) { maxX = x.x; y = x.y; } });
      n = { id: novoId(), title: 'Nova etapa', content: '', type: 'message', x: maxX + 310, y: y };
      st.fluxo.nodes.push(n);
    }
    mudou();
    desenhar();
    abrir(n.id);
  }

  function ligarEditor() {
    var dlg = $('fluxo-editor');
    dlg.addEventListener('input', function (ev) {
      var n = no(st.aberta);
      var t = ev.target;
      if (!n) return;
      if (t.dataset.campo === 'title' || t.dataset.campo === 'content') {
        n[t.dataset.campo] = t.value;
        if (t.dataset.campo === 'content' && $('fx-prev')) $('fx-prev').innerHTML = t.value ? zap(t.value) : '<span class="fx-vazio">Sem texto</span>';
      } else if (t.dataset.botao != null) {
        n.buttons[Number(t.dataset.botao)] = t.value;
      } else if (t.dataset.rotulo != null) {
        st.fluxo.edges[Number(t.dataset.rotulo)].label = t.value;
      } else return;
      mudou();
    });
    dlg.addEventListener('change', function (ev) {
      var n = no(st.aberta);
      var t = ev.target;
      if (!n) return;
      if (t.dataset.campo === 'type') {
        n.type = t.value;
        if (n.type !== 'message') delete n.buttons;
        mudou();
        reabrir('[data-campo="type"]');
      } else if (t.dataset.destino != null && t.value) {
        st.fluxo.edges[Number(t.dataset.destino)].to = t.value;
        mudou();
      }
    });
    dlg.addEventListener('click', function (ev) {
      var t = ev.target.closest('button');
      var n = no(st.aberta);
      if (!t || !n) return;
      if (t.hasAttribute('data-fechar')) { ev.preventDefault(); fechar(); return; }
      if (t.hasAttribute('data-poe-botao')) {
        n.buttons = (n.buttons || []).concat(['']);
        mudou();
        reabrir('[data-botao="' + (n.buttons.length - 1) + '"]');
      } else if (t.dataset.tiraBotao != null) {
        n.buttons.splice(Number(t.dataset.tiraBotao), 1);
        if (!n.buttons.length) delete n.buttons;
        mudou();
        reabrir('[data-poe-botao]');
      } else if (t.hasAttribute('data-poe-saida')) {
        var outro = ordenados().find(function (x) { return x.x > n.x; }) || ordenados().find(function (x) { return x.id !== n.id; });
        if (!outro) return;
        st.fluxo.edges.push({ from: n.id, to: outro.id, label: '' });
        mudou();
        reabrir('[data-rotulo="' + (st.fluxo.edges.length - 1) + '"]');
      } else if (t.dataset.tiraSaida != null) {
        st.fluxo.edges.splice(Number(t.dataset.tiraSaida), 1);
        mudou();
        reabrir('[data-poe-saida]');
      } else if (t.hasAttribute('data-depois')) {
        novaEtapa(n);
      } else if (t.hasAttribute('data-duplicar')) {
        var copia = JSON.parse(JSON.stringify(n));
        copia.id = novoId();
        copia.title = (n.title + ' (cópia)').slice(0, st.limites.titulo);
        copia.x = n.x + 40;
        copia.y = n.y + 170;
        st.fluxo.nodes.push(copia);
        mudou();
        desenhar();
        abrir(copia.id);
      } else if (t.hasAttribute('data-excluir')) {
        if (st.fluxo.nodes.length <= 1) { window.alert('O fluxo precisa de pelo menos uma etapa.'); return; }
        if (!window.confirm('Excluir a etapa "' + n.title + '" e as setas ligadas a ela?')) return;
        st.fluxo.nodes = st.fluxo.nodes.filter(function (x) { return x.id !== n.id; });
        st.fluxo.edges = st.fluxo.edges.filter(function (e) { return e.from !== n.id && e.to !== n.id; });
        st.aberta = null;
        fechar();
        mudou();
      }
    });
    dlg.addEventListener('close', function () {
      var id = st.aberta;
      st.aberta = null;
      if (id && no(id)) setTimeout(function () { focar(id, false); }, 0);
    });
  }

  // ---------- mapa: arrastar e teclado ----------
  function ligarMapa() {
    var box = $('fluxo-mapa');
    var arr = null;
    box.addEventListener('click', function (ev) {
      var t = ev.target.closest('button');
      if (!t) return;
      if (t.dataset.zoom) {
        var i = ZOOMS.indexOf(st.zoom) + Number(t.dataset.zoom);
        st.zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i))];
        mapa();
      } else if (t.hasAttribute('data-mover')) {
        st.mover = !st.mover;
        mapa();
        var b = box.querySelector('[data-mover]');
        if (b) b.focus();
      } else if (t.dataset.no) {
        if (arr && arr.moveu) return; // fim de um arraste, não é toque
        abrir(t.dataset.no);
      }
    });
    box.addEventListener('pointerdown', function (ev) {
      var t = ev.target.closest('.fx-no');
      if (!t || !st.mover || ev.button !== 0) return;
      var n = no(t.dataset.no);
      arr = { n: n, el: t, x: ev.clientX, y: ev.clientY, x0: n.x, y0: n.y, moveu: false, id: ev.pointerId };
      t.setPointerCapture(ev.pointerId);
    });
    box.addEventListener('pointermove', function (ev) {
      if (!arr || ev.pointerId !== arr.id) return;
      var dx = (ev.clientX - arr.x) / st.zoom, dy = (ev.clientY - arr.y) / st.zoom;
      if (!arr.moveu && Math.abs(dx) + Math.abs(dy) < 5) return;
      arr.moveu = true;
      arr.n.x = Math.max(0, Math.round(arr.x0 + dx));
      arr.n.y = Math.max(0, Math.round(arr.y0 + dy));
      arr.el.style.left = arr.n.x + 'px';
      arr.el.style.top = arr.n.y + 'px';
      arr.el.classList.add('is-arrastando');
      setas();
    });
    function soltar(ev) {
      if (!arr || ev.pointerId !== arr.id) return;
      var a = arr;
      a.el.classList.remove('is-arrastando');
      if (a.moveu) {
        st.sujo = true;
        barra();
        lista();
        // o click que vem logo depois do arraste não abre o editor
        setTimeout(function () { if (arr === a) arr = null; mapa(); focar(a.n.id, false); }, 0);
      } else arr = null;
    }
    box.addEventListener('pointerup', soltar);
    box.addEventListener('pointercancel', soltar);
    box.addEventListener('keydown', function (ev) {
      var t = ev.target.closest && ev.target.closest('.fx-no');
      if (!t || !st.mover) return;
      var passo = ev.shiftKey ? 50 : 10;
      var d = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] }[ev.key];
      if (!d) return;
      ev.preventDefault();
      var n = no(t.dataset.no);
      n.x = Math.max(0, n.x + d[0]);
      n.y = Math.max(0, n.y + d[1]);
      t.style.left = n.x + 'px';
      t.style.top = n.y + 'px';
      setas();
      st.sujo = true;
      barra();
      clearTimeout(ligarMapa.t);
      ligarMapa.t = setTimeout(lista, 300);
    });
  }

  // ---------- servidor ----------
  function aplicar(r) {
    st.fluxo = r.fluxo;
    st.base = r.atualizado_em;
    st.inicial = r.inicial;
    st.por = r.atualizado_por;
    if (r.limites) st.limites = r.limites;
    st.sujo = false;
    st.conflito = false;
  }
  async function buscar() {
    if (st.carregando) return;
    st.carregando = true;
    if (!st.fluxo) mensagem('Carregando...');
    try {
      aplicar(await C().request('/api/admin/fluxo-acolhimento'));
      mensagem('');
      desenhar();
    } catch (err) {
      mensagem(esc(err.message || 'Não foi possível carregar o fluxo.'), 'erro');
    } finally {
      st.carregando = false;
    }
  }
  async function salvar() {
    if (!st.sujo || st.salvando) return;
    st.salvando = true;
    barra();
    try {
      var r = await C().request('/api/admin/fluxo-acolhimento', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fluxo: st.fluxo, base: st.base }),
      });
      aplicar(r);
      mensagem('Fluxo salvo. Só o desenho foi gravado: nenhuma mensagem foi enviada.', 'ok');
    } catch (err) {
      var conflito = /Outra pessoa/.test(err.message || '');
      st.conflito = conflito;
      mensagem(esc(err.message || 'Não foi possível salvar.') +
        (conflito ? ' <button type="button" class="fx-bt" data-acao="recarregar">Recarregar a versão salva</button> Para não perder o que fez, use antes Mais › Baixar JSON.' : ''), 'erro');
    } finally {
      st.salvando = false;
      desenhar();
    }
  }
  async function restaurar() {
    if (!window.confirm('Voltar ao fluxo inicial? A versão salva no painel será apagada para todos.')) return;
    try {
      aplicar(await C().request('/api/admin/fluxo-acolhimento', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }),
      }));
      mensagem('Fluxo inicial restaurado.', 'ok');
      desenhar();
    } catch (err) {
      mensagem(esc(err.message || 'Não foi possível restaurar.'), 'erro');
    }
  }
  function exportar() {
    var blob = new Blob([JSON.stringify(st.fluxo, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'fluxo-acolhimento.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  async function importar(arquivo) {
    try {
      var d = JSON.parse(await arquivo.text());
      if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.edges) || !d.nodes.length) throw new Error('o arquivo precisa ter "nodes" e "edges".');
      // Mesmo formato que o servidor aceita: números nas posições e texto no resto (o servidor confere de novo ao salvar).
      var txt = function (v) { return v == null ? '' : String(v); };
      var num = function (v) { var x = Math.round(Number(v)); return isFinite(x) ? Math.max(0, x) : 0; };
      st.fluxo = {
        nodes: d.nodes.filter(function (n) { return n && typeof n === 'object'; }).map(function (n) {
          var o = { id: txt(n.id), title: txt(n.title), content: txt(n.content), type: TIPO[n.type] ? n.type : 'action', x: num(n.x), y: num(n.y) };
          if (Array.isArray(n.buttons) && n.buttons.length) o.buttons = n.buttons.map(txt);
          return o;
        }),
        edges: d.edges.filter(function (e) { return e && typeof e === 'object'; }).map(function (e) { return { from: txt(e.from), to: txt(e.to), label: txt(e.label) }; }),
      };
      st.sujo = true;
      desenhar();
      mensagem('Fluxo importado de ' + esc(arquivo.name) + '. Confira e toque em Salvar para gravar.', 'ok');
    } catch (err) {
      mensagem('Não foi possível importar: ' + esc(err.message), 'erro');
    }
  }

  var ligado = false;
  function ligar() {
    ligado = true;
    st.mover = window.matchMedia ? window.matchMedia('(pointer: fine)').matches : true;
    var tab = $('tab-fluxo');
    tab.addEventListener('click', function (ev) {
      var t = ev.target.closest('button');
      if (!t) return;
      var acao = t.dataset.acao;
      if (acao === 'salvar') salvar();
      else if (acao === 'nova') novaEtapa(null);
      else if (acao === 'descartar') { if (window.confirm('Descartar as alterações não salvas?')) { st.sujo = false; buscar(); mensagem(''); } }
      else if (acao === 'recarregar') { st.sujo = false; buscar(); }
      else if (acao === 'exportar') exportar();
      else if (acao === 'restaurar') restaurar();
      else if (t.dataset.editar) abrir(t.dataset.editar);
      else if (t.dataset.ir) focar(t.dataset.ir);
      if (acao) { var m = t.closest('details.fx-mais'); if (m) m.open = false; }
    });
    tab.addEventListener('change', function (ev) {
      if (ev.target.dataset.acao === 'importar' && ev.target.files[0]) {
        importar(ev.target.files[0]);
        ev.target.value = '';
        var m = ev.target.closest('details.fx-mais'); if (m) m.open = false;
      }
    });
    ligarEditor();
    ligarMapa();
    window.addEventListener('beforeunload', function (ev) {
      if (st.sujo) { ev.preventDefault(); ev.returnValue = ''; }
    });
  }

  // Abrir a aba de novo não apaga o que ainda não foi salvo.
  function load() {
    if (!ligado) ligar();
    if (st.sujo) { desenhar(); return; }
    buscar();
  }

  return { load: load, _zap: zap };
})();
