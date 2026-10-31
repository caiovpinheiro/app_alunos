/* Grupo de estudo do curso (docs/grupo-estudo.md).
   Área oculta: só existe se GET /api/grupos/meu responder 200 (GRUPO_ESTUDO_ATIVA_PARA). Aí o módulo
   registra a tela /grupo, monta a seção, põe "Grupo" no menu do topo e uma entrada no Início.

   Layout no estilo WhatsApp Web: lista à esquerda (o grupo do curso e os colegas, com prévia e não lidas)
   e a conversa à direita. No celular a lista é a primeira tela e a conversa ocupa a tela inteira (com
   voltar, inclusive o botão do aparelho). Conversa privada 1:1 entre colegas do mesmo curso.
   Escrever: emojis, foto (reduzida no aparelho) e áudio (até 2 min). Tudo passa pela moderação no
   servidor antes de aparecer: "Verificando…" e depois publicada, não publicada (com a explicação) ou em
   análise. Fotos e áudios passam pela equipe e são apagados depois de N dias (aviso na tela).
   Atualiza por polling a cada 5 s com a tela aberta e a aba visível. */
window.GrupoEstudo = (function () {
  'use strict';

  var TELA = 'grupo-page';
  var PATH = '/grupo';
  var INTERVALO = 5000;
  var CHAVE_BOAS_VINDAS = 'grupo_boas_vindas_ok';
  var EMOJIS = ['😀', '😂', '😅', '😊', '😍', '🤩', '😎', '🤓', '😉', '🤔', '😴', '😭', '😱', '🥲', '🙏', '👏', '👍', '👎',
    '💪', '🤝', '👋', '🙌', '❤️', '💙', '💛', '🔥', '✨', '🎉', '🥳', '✅', '❌', '⚠️', '📚', '📖', '✏️', '📝',
    '📌', '📎', '🧠', '💡', '🎯', '⏰', '📅', '☕', '🍀', '🚀', '🏆', '⭐'];
  var pathInicial = String(window.location.pathname || '').replace(/\/+$/, '');
  var celular = window.matchMedia ? window.matchMedia('(max-width: 899px)') : { matches: false };
  var toque = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };

  var estado = novoEstado();
  function novoEstado() {
    return {
      verificado: false, ativo: false, dados: null, lista: null, atual: null, msgs: {}, cursor: null, timer: null,
      enviando: false, rolou: false, tmp: 0, blobs: {}, gravacao: null, filtro: '', empurrou: false, foto: null,
    };
  }

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function guardado(chave) { try { return window.localStorage.getItem(chave); } catch (e) { return null; } }
  function guardar(chave, valor) { try { window.localStorage.setItem(chave, valor); } catch (e) { /* modo privado */ } }
  function icone(nome) { return '<i data-lucide="' + nome + '" aria-hidden="true"></i>'; }
  function icones() { if (window.lucide) window.lucide.createIcons(); }
  function $(id) { return document.getElementById(id); }

  async function api(url, opts) {
    opts = opts || {};
    var headers = { Authorization: 'Bearer ' + window.Auth.getToken() };
    var body;
    if (opts.blob) { headers['Content-Type'] = opts.tipoBlob; body = opts.blob; } else if (opts.body) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
    var res = await fetch(url, { method: opts.method || 'GET', headers: headers, body: body });
    var dados = null;
    try { dados = await res.json(); } catch (e) { /* sem corpo */ }
    if (!res.ok) {
      var err = new Error((dados && dados.message) || 'Falha na comunicação com o servidor.');
      err.status = res.status;
      err.codigo = dados && dados.codigo;
      throw err;
    }
    return dados;
  }

  // ---------- Datas ----------
  function hora(iso) { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function dia(iso) {
    var d = new Date(iso);
    var hoje = new Date();
    var ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
    if (d.toDateString() === hoje.toDateString()) return 'Hoje';
    if (d.toDateString() === ontem.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  }
  function curto(iso) {
    var d = dia(iso);
    return d === 'Hoje' ? hora(iso) : d === 'Ontem' ? 'Ontem' : new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  function quando(iso) {
    return dia(iso) === 'Hoje' ? 'hoje às ' + hora(iso) : new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' + hora(iso);
  }
  function pessoas(n) { return n + (n === 1 ? ' pessoa' : ' pessoas'); }
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  // Cor do avatar: sempre a mesma para o mesmo nome (4 tons da marca).
  function tom(nome) {
    var h = 0;
    String(nome || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return 'ge-av--' + (h % 4);
  }
  function avatar(nome, extra) {
    return '<span class="ge-av ' + tom(nome) + (extra || '') + '" aria-hidden="true">' + esc(String(nome || '?').charAt(0)) + '</span>';
  }

  // ---------- Montagem (só depois de a API liberar) ----------
  function montarSecao() {
    if ($(TELA)) return;
    var sec = document.createElement('section');
    sec.id = TELA;
    sec.className = 'hidden';
    sec.setAttribute('aria-hidden', 'true');
    sec.setAttribute('data-modo', 'lista');
    var modelo = document.querySelector('#meu-semestre-page > header');
    if (modelo) sec.appendChild(modelo.cloneNode(true));
    var main = document.createElement('main');
    main.className = 'ge';
    main.id = 'ge-root';
    sec.appendChild(main);
    ['ge-sheet', 'ge-visor'].forEach(function (id) {
      var d = document.createElement('dialog');
      d.id = id;
      d.className = id === 'ge-visor' ? 'ge-visor' : 'ge-sheet';
      sec.appendChild(d);
    });
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.id = 'ge-arquivo';
    input.hidden = true;
    sec.appendChild(input);
    var antes = $('avisos-page');
    $('app').insertBefore(sec, antes || null);
  }

  function linkNoMenu() {
    document.querySelectorAll('.portal-nav').forEach(function (nav) {
      if (nav.querySelector('[data-grupo-nav]')) return;
      var a = document.createElement('a');
      a.href = PATH;
      a.setAttribute('data-nav', TELA);
      a.setAttribute('data-grupo-nav', '');
      a.textContent = 'Grupo';
      a.title = 'Grupo de estudo do seu curso';
      nav.appendChild(a);
    });
  }

  // No celular o menu do topo rola e "Grupo" fica fora da tela: o Início ganha uma entrada logo depois do banner.
  function entradaNoInicio() {
    var hero = document.querySelector('#dashboard-page .portal-hero');
    var d = estado.dados;
    if (!hero || !d || !d.grupo || $('ge-entrada')) return;
    var membro = !d.aceite_pendente;
    var a = document.createElement('a');
    a.id = 'ge-entrada';
    a.className = 'ge-entrada';
    a.href = PATH;
    a.setAttribute('data-go', TELA);
    a.innerHTML =
      '<span class="ge-entrada-ico">' + icone('users') + '</span>' +
      '<span class="ge-entrada-txt"><b>' + (membro ? 'Grupo de ' : 'Entrar no grupo de ') + esc(d.grupo.nome) + '</b>' +
      '<span>' + (membro
        ? 'Tire dúvidas e estude com ' + (d.grupo.membros > 1 ? (d.grupo.membros - 1) + (d.grupo.membros === 2 ? ' colega' : ' colegas') : 'a sua turma') + ' do seu curso'
        : d.situacao === 'regras_novas' ? 'As regras mudaram: aceite a versão nova para continuar'
          : 'Opcional: tire dúvidas e estude com colegas do seu curso') + '</span></span>' +
      icone('chevron-right');
    hero.insertAdjacentElement('afterend', a);
    icones();
  }

  function atualizarEntrada() {
    var e = $('ge-entrada');
    if (e) e.remove();
    entradaNoInicio();
  }

  function desmontar() {
    parar();
    pararGravacao(true);
    var entrada = $('ge-entrada');
    if (entrada) entrada.remove();
    document.querySelectorAll('[data-grupo-nav]').forEach(function (a) { a.remove(); });
    var sec = $(TELA);
    if (sec) sec.remove();
    Object.keys(estado.blobs).forEach(function (k) { if (estado.blobs[k]) URL.revokeObjectURL(estado.blobs[k]); });
    document.body.classList.remove('ge-on');
    estado = novoEstado();
  }

  function modo(m) {
    var sec = $(TELA);
    if (sec) sec.setAttribute('data-modo', m);
  }

  // ---------- Aceite das regras (termo versionado, server/grupo-termo.js) ----------
  function secoesHtml(t) {
    return t.secoes.map(function (sec) {
      return '<h3>' + esc(sec.titulo) + '</h3><ul>' + sec.itens.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
    }).join('');
  }
  function dataVersao(t) { return t.data || String(t.versao || '').slice(0, 10).split('-').reverse().join('/'); }

  // O que a tela de entrada diz em cada situação (server: situacao()).
  var ENTRADA = {
    novo: { tit: 'Entrar no grupo de ', lede: 'Aqui você estuda com a sua turma e conversa com colegas do curso. Participar é opcional e você pode sair quando quiser. Para entrar, leia e aceite as regras: elas protegem você e seguem a lei.', ok: 'Entrar no grupo' },
    saiu: { tit: 'Você saiu do grupo de ', lede: 'Você não aparece mais para os colegas e ninguém pode mandar mensagem para você. Para voltar, leia e aceite as regras de novo.', ok: 'Voltar para o grupo' },
    regras_novas: { tit: 'As regras do grupo de ', titFim: ' mudaram', lede: 'Leia a versão nova e aceite para continuar no grupo. Se não quiser aceitar, você fica fora do grupo até mudar de ideia.', ok: 'Aceitar e continuar' },
  };

  function renderTermo() {
    var root = $('ge-root');
    var d = estado.dados;
    var t = d.termo;
    var e = ENTRADA[d.situacao] || ENTRADA.novo;
    root.innerHTML =
      '<div class="ge-termo"><div class="ge-termo-in">' +
        '<span class="ge-intro-ico' + (d.situacao === 'saiu' ? ' ge-intro-ico--saiu' : '') + '">' + icone(d.situacao === 'saiu' ? 'log-out' : 'users') + '</span>' +
        '<h1>' + esc(e.tit) + esc(d.grupo.nome) + esc(e.titFim || '') + '</h1>' +
        '<p class="ge-termo-lede">' + esc(e.lede) + '</p>' +
        '<ul class="ge-termo-lista">' + t.resumo.map(function (r) {
          return '<li><span class="ge-termo-ico">' + icone(r.icone) + '</span><div>' +
            '<p class="ge-termo-tit">' + esc(r.titulo) + '</p>' +
            '<p>' + esc(r.texto) + '</p>' +
            '<p class="ge-termo-lei">' + icone('landmark') + '<span>' + esc(r.lei) + '</span></p></div></li>';
        }).join('') + '</ul>' +
        '<details class="ge-termo-completo"><summary>' + icone('file-text') + '<span>Ler o termo completo</span></summary>' +
          '<div class="ge-termo-texto">' + secoesHtml(t) + '</div></details>' +
        '<form class="ge-termo-form" id="ge-termo-form" novalidate>' +
          '<label class="ge-opcao ge-opcao--check ge-termo-check"><input type="checkbox" id="ge-termo-li">' +
            '<span>Li e aceito as regras do grupo e o uso dos meus dados descrito acima.</span></label>' +
          '<p class="ge-erro" id="ge-termo-erro" role="alert" hidden></p>' +
          '<button type="submit" class="ge-sheet-ok" id="ge-termo-ok">' + esc(e.ok) + '</button>' +
          '<a href="/inicio" class="ge-termo-depois" data-go="dashboard-page">Agora não</a>' +
        '</form>' +
        '<p class="ge-termo-versao">Versão de ' + esc(dataVersao(t)) + '</p>' +
      '</div></div>';
    icones();
    $('ge-root').scrollTop = 0;
  }

  async function aceitarTermo(ev) {
    ev.preventDefault();
    var li = $('ge-termo-li');
    var err = $('ge-termo-erro');
    var ok = $('ge-termo-ok');
    err.hidden = true;
    if (!li.checked) { err.textContent = 'Marque que leu e aceita as regras para entrar.'; err.hidden = false; li.focus(); return; }
    ok.disabled = true;
    try {
      await api('/api/grupos/termo/aceite', { method: 'POST', body: { versao: estado.dados.termo.versao, li: true } });
      abrir();
    } catch (e) {
      ok.disabled = false;
      err.textContent = e.message;
      err.hidden = false;
      if (e.status === 409) abrir(); // versão nova: mostra o texto atualizado
    }
  }

  function abrirTermoCompleto() {
    var sheet = $('ge-sheet');
    var t = estado.dados && estado.dados.termo;
    if (!sheet || !t) return;
    sheet.setAttribute('aria-labelledby', 'ge-sheet-tit');
    sheet.innerHTML = '<div class="ge-sheet-in">' +
      '<div class="ge-sheet-topo"><h2 id="ge-sheet-tit">' + esc(t.titulo) + '</h2>' +
        '<button type="button" class="ge-sheet-x" data-ge-fechar aria-label="Fechar">' + icone('x') + '</button></div>' +
      '<div class="ge-termo-texto">' + secoesHtml(t) + '</div>' +
      '<p class="ge-termo-versao">Versão de ' + esc(dataVersao(t)) + ', aceita por você.</p>' +
      '<button type="button" class="ge-sheet-ok" data-ge-fechar>Voltar à conversa</button></div>';
    icones();
    mostrarDialogo(sheet);
  }

  // ---------- Estrutura: lista + conversa ----------
  function renderEstrutura() {
    var root = $('ge-root');
    var d = estado.dados;
    if (!d.grupo) {
      root.innerHTML = '<div class="ge-sem-curso"><span class="ge-intro-ico">' + icone('users') + '</span>' +
        '<h1>Seu curso ainda não chegou ao portal</h1>' +
        '<p>Assim que ele aparecer no cadastro, você entra automaticamente no grupo da sua turma. Isso costuma levar até 2 dias úteis depois da matrícula.</p></div>';
      icones();
      return;
    }
    root.innerHTML =
      '<aside class="ge-lado" aria-label="Conversas">' +
        '<div class="ge-lado-topo">' +
          '<div><h1>Conversas</h1><p>' + esc(d.grupo.nome) + ' · você aparece como ' +
            '<button type="button" class="ge-eu" id="ge-eu" data-ge-perfil aria-label="Mudar nome ou apelido (você aparece como ' + esc(d.eu.nome) + ')">' +
            '<b>' + esc(d.eu.nome) + '</b>' + icone('pencil') + '</button></p></div>' +
          '<button type="button" class="ge-sair-btn" data-ge-sair>' + icone('log-out') + '<span>Sair do grupo</span></button>' +
        '</div>' +
        '<div class="ge-busca">' + icone('search') +
          '<label for="ge-busca" class="ge-sr">Buscar colega</label>' +
          '<input id="ge-busca" type="search" placeholder="Buscar colega" autocomplete="off" value="' + esc(estado.filtro) + '"></div>' +
        '<nav class="ge-lista" id="ge-lista" aria-label="Lista de conversas"><p class="ge-carregando">Carregando…</p></nav>' +
        '<p class="ge-lado-aviso">' + icone('lock') + '<span>' + esc(d.aviso) + '</span></p>' +
      '</aside>' +
      '<section class="ge-chat" id="ge-chat" aria-label="Conversa aberta">' +
        '<div class="ge-vazio-chat"><span class="ge-intro-ico">' + icone('messages-square') + '</span>' +
          '<h2>Escolha uma conversa</h2><p>O grupo do curso ou um colega da lista.</p></div>' +
      '</section>';
    icones();
  }

  function previaTexto(u) {
    if (!u) return '';
    var base = u.midia === 'imagem' ? 'Foto' + (u.texto ? ': ' + u.texto : '') : u.midia === 'audio' ? 'Áudio' : u.texto;
    if (u.minha && u.status !== 'publicada') base = u.status === 'retida' ? 'Em análise: ' + base : 'Não publicada';
    return base;
  }

  function itemHtml(c) {
    var ativo = estado.atual && ((c.grupo && estado.atual.tipo === 'grupo') || (!c.grupo && estado.atual.ref === c.ref));
    var u = c.ultima;
    var quem = u ? (u.minha ? 'Você: ' : (c.grupo ? u.autor + ': ' : '')) : '';
    var prev = u ? quem + previaTexto(u) : (c.grupo ? 'Grupo do curso · ' + pessoas(c.membros) : 'Toque para conversar');
    var midiaIco = u && u.midia ? icone(u.midia === 'imagem' ? 'image' : 'mic') : '';
    return '<button type="button" class="ge-item' + (ativo ? ' is-ativo' : '') + (c.nao_lidas ? ' tem-novas' : '') + '"' +
        (c.grupo ? ' data-ge-abrir="grupo"' : ' data-ge-abrir="' + esc(c.ref) + '" data-ge-nome="' + esc(c.nome) + '"') +
        (ativo ? ' aria-current="true"' : '') + '>' +
      (c.grupo ? '<span class="ge-av ge-av--grupo" aria-hidden="true">' + icone('users') + '</span>' : avatar(c.nome)) +
      '<span class="ge-item-txt"><span class="ge-item-l1"><b>' + esc(c.grupo ? 'Grupo de ' + c.nome : c.nome) + '</b>' +
        (u ? '<time>' + esc(curto(u.em)) + '</time>' : '') + '</span>' +
        '<span class="ge-item-l2"><span class="ge-item-prev">' + midiaIco + esc(prev) + '</span>' +
        (c.bloqueado ? '<span class="ge-item-tag">Bloqueado</span>' : '') +
        (c.nao_lidas ? '<span class="ge-novas" aria-label="' + c.nao_lidas + ' não lidas">' + (c.nao_lidas > 99 ? '99+' : c.nao_lidas) + '</span>' : '') +
      '</span></span></button>';
  }

  function renderLista() {
    var el = $('ge-lista');
    if (!el || !estado.lista) return;
    var l = estado.lista;
    var f = estado.filtro.trim().toLowerCase();
    var colegas = l.colegas.filter(function (c) { return !f || c.nome.toLowerCase().indexOf(f) !== -1; });
    var html = f ? '' : itemHtml({ grupo: true, nome: l.grupo.nome, membros: l.grupo.membros, ultima: l.grupo.ultima, nao_lidas: l.grupo.nao_lidas });
    html += '<p class="ge-lista-sec">Colegas do curso</p>';
    html += colegas.length ? colegas.map(itemHtml).join('')
      : '<p class="ge-lista-vazia">' + (f ? 'Nenhum colega com esse nome.' : 'Quando outros colegas do seu curso entrarem, eles aparecem aqui.') + '</p>';
    var foco = document.activeElement && document.activeElement.closest && document.activeElement.closest('#ge-lista [data-ge-abrir]');
    var focoId = foco && foco.getAttribute('data-ge-abrir');
    el.innerHTML = html;
    if (focoId) { var novo = el.querySelector('[data-ge-abrir="' + focoId + '"]'); if (novo) novo.focus(); }
    icones();
  }

  async function carregarLista() {
    try {
      var r = await api('/api/grupos/meu/conversas');
      var antes = JSON.stringify(estado.lista);
      estado.lista = r;
      if (JSON.stringify(r) !== antes) renderLista();
    } catch (err) {
      if (err.status === 404 || err.status === 401) desmontar();
      if (err.codigo === 'aceite_pendente') abrir();
    }
  }

  // ---------- Conversa aberta ----------
  function base() {
    return estado.atual.tipo === 'grupo' ? '/api/grupos/meu' : '/api/grupos/conversas/' + encodeURIComponent(estado.atual.ref);
  }

  function renderChat() {
    var chat = $('ge-chat');
    var d = estado.dados;
    var a = estado.atual;
    var grupo = a.tipo === 'grupo';
    var silenciado = d.eu.silenciado_ate;
    var max = d.max_texto || 500;
    var rodape;
    if (silenciado) {
      rodape = '<div class="ge-pausa" role="status">' + icone('clock') + '<p>A equipe pausou seus envios até ' + esc(quando(silenciado)) + '. Você continua podendo ler.</p></div>';
    } else if (!grupo && a.bloqueado) {
      rodape = '<div class="ge-pausa ge-pausa--bloq" role="status">' + icone('ban') + '<p>Você bloqueou ' + esc(a.nome) + '.</p>' +
        '<button type="button" class="ge-link" data-ge-bloquear="0">Desbloquear</button></div>';
    } else {
      rodape =
        '<div class="ge-emojis" id="ge-emojis" role="dialog" aria-label="Emojis" hidden>' +
          EMOJIS.map(function (e) { return '<button type="button" data-ge-emoji="' + e + '" aria-label="Inserir ' + e + '">' + e + '</button>'; }).join('') +
        '</div>' +
        '<form class="ge-compor" id="ge-form" novalidate>' +
          '<button type="button" class="ge-ico-btn" id="ge-emoji-btn" aria-label="Emojis" aria-expanded="false" aria-controls="ge-emojis">' + icone('smile') + '</button>' +
          '<div class="ge-campo">' +
            '<label for="ge-texto" class="ge-sr">Mensagem</label>' +
            '<textarea id="ge-texto" rows="1" maxlength="' + max + '" placeholder="Mensagem"></textarea>' +
            '<span class="ge-cont" id="ge-cont" hidden></span>' +
            '<button type="button" class="ge-ico-btn ge-ico-btn--in" id="ge-foto-btn" aria-label="Enviar foto">' + icone('image') + '</button>' +
          '</div>' +
          '<button type="submit" class="ge-enviar" id="ge-enviar" aria-label="Enviar" hidden>' + icone('send-horizontal') + '</button>' +
          '<button type="button" class="ge-enviar" id="ge-mic" aria-label="Gravar áudio">' + icone('mic') + '</button>' +
          '<p class="ge-erro" id="ge-erro" role="alert" hidden></p>' +
        '</form>' +
        '<div class="ge-gravando" id="ge-gravando" hidden>' +
          '<button type="button" class="ge-ico-btn" id="ge-grav-cancelar" aria-label="Descartar áudio">' + icone('trash-2') + '</button>' +
          '<p class="ge-grav-tempo"><span class="ge-grav-ponto" aria-hidden="true"></span><span id="ge-grav-tempo">0:00</span>' +
            '<span class="ge-grav-max">/ ' + mmss(d.max_audio_seg || 120) + '</span></p>' +
          '<button type="button" class="ge-enviar" id="ge-grav-enviar" aria-label="Enviar áudio">' + icone('send-horizontal') + '</button>' +
          '<p class="ge-grav-aviso">Áudios passam pela equipe antes de aparecer e são apagados em ' + (d.midia_dias || 7) + ' dias.</p>' +
        '</div>';
    }
    chat.innerHTML =
      '<div class="ge-bar">' +
        '<button type="button" class="ge-voltar" data-ge-voltar aria-label="Voltar para as conversas">' + icone('arrow-left') + '</button>' +
        (grupo ? '<span class="ge-bar-ico">' + icone('users') + '</span>' : avatar(a.nome, ' ge-av--bar')) +
        '<div class="ge-bar-txt">' +
          '<h2>' + esc(grupo ? 'Grupo de ' + d.grupo.nome : a.nome) + '</h2>' +
          '<p>' + (grupo ? pessoas(estado.lista ? estado.lista.grupo.membros : d.grupo.membros) + ' · moderado' : 'Conversa privada · moderada') + '</p>' +
        '</div>' +
        '<button type="button" class="ge-bar-btn" id="ge-regras-btn" aria-expanded="false" aria-controls="ge-regras">' + icone('shield-check') + '<span class="ge-bar-btn-txt">Regras</span></button>' +
        (grupo ? '' : '<button type="button" class="ge-bar-btn ge-bar-btn--ico" data-ge-bloquear="' + (a.bloqueado ? '0' : '1') + '" aria-label="' + (a.bloqueado ? 'Desbloquear ' : 'Bloquear ') + esc(a.nome) + '">' + icone('ban') + '</button>') +
      '</div>' +
      '<div class="ge-regras" id="ge-regras" hidden>' +
        '<ul>' + d.regras.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
        '<p class="ge-regras-aviso">' + esc(d.aviso) + '</p>' +
        '<div class="ge-regras-acoes">' +
          '<button type="button" class="ge-link ge-link--regras" data-ge-termo>' + icone('file-text') + '<span>Ler o termo completo</span></button>' +
          '<button type="button" class="ge-link ge-link--regras ge-link--sair" data-ge-sair>' + icone('log-out') + '<span>Sair do grupo</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="ge-feed" id="ge-feed" role="log" aria-live="polite" aria-label="Mensagens"><p class="ge-carregando">Carregando a conversa…</p></div>' +
      rodape;
    icones();
  }

  async function abrirConversa(alvo, opts) {
    opts = opts || {};
    if (estado.gravacao) pararGravacao(true);
    var colega = alvo === 'grupo' ? null : (estado.lista && estado.lista.colegas.filter(function (c) { return c.ref === alvo; })[0]);
    estado.atual = alvo === 'grupo' ? { tipo: 'grupo' } : { tipo: 'dm', ref: alvo, nome: (colega && colega.nome) || opts.nome || 'Colega', bloqueado: Boolean(colega && colega.bloqueado) };
    estado.msgs = {};
    estado.cursor = null;
    estado.rolou = false;
    modo('conversa');
    document.body.classList.toggle('ge-conversa', true);
    if (celular.matches && !opts.semHistorico) {
      window.history.pushState({ screen: TELA, geConversa: alvo }, '', PATH);
      estado.empurrou = true;
    }
    renderChat();
    renderLista();
    await carregarMensagens();
    if (!toque.matches) { var t = $('ge-texto'); if (t) t.focus(); }
  }

  function voltarLista() {
    if (estado.gravacao) pararGravacao(true);
    estado.atual = celular.matches ? null : estado.atual;
    modo('lista');
    document.body.classList.remove('ge-conversa');
    renderLista();
    carregarLista();
  }

  // ---------- Mensagens ----------
  function boasVindasHtml() {
    var d = estado.dados;
    return '<div class="ge-intro">' +
      '<span class="ge-intro-ico">' + icone('users') + '</span>' +
      '<h3>Bem-vindo(a) ao grupo de ' + esc(d.grupo.nome) + '</h3>' +
      '<p>Um espaço para tirar dúvidas e estudar com a sua turma, sem sair do portal.</p>' +
      '<ul class="ge-intro-regras">' +
        '<li>' + icone('book-open') + '<span>Dúvidas, dicas, resumos e combinados de estudo.</span></li>' +
        '<li>' + icone('ban') + '<span>Prova, gabarito, cola, trabalho pronto, palavrões e xingamentos não entram.</span></li>' +
        '<li>' + icone('lock') + '<span>Sem telefone, e-mail, @, CPF ou endereço: aqui você aparece só como <b>' + esc(d.eu.nome) + '</b></span></li>' +
        '<li>' + icone('image') + '<span>' + esc(d.aviso) + '</span></li>' +
      '</ul>' +
      '<button type="button" class="ge-intro-ok" data-ge-boas-vindas>Entendi</button>' +
    '</div>';
  }

  function privadaHtml() {
    return '<div class="ge-intro ge-intro--privada">' +
      '<p>' + icone('lock') + '<span>Conversa entre você e <b>' + esc(estado.atual.nome) + '</b>, também moderada: a equipe só lê o que for denunciado ou retido. ' +
      'Se algo te incomodar, denuncie a mensagem ou bloqueie.</span></p></div>';
  }

  function vazioHtml() {
    var grupo = estado.atual.tipo === 'grupo';
    var ideias = grupo
      ? [['Oi, turma! Em que matéria vocês estão agora?', 'Em que matéria vocês estão?'], ['Alguém quer combinar de estudar junto esta semana?', 'Combinar de estudar junto'], ['Estou com uma dúvida: ', 'Postar uma dúvida']]
      : [['Oi! Tudo bem? Vi que estamos no mesmo curso.', 'Dizer oi'], ['Quer revisar a matéria junto?', 'Estudar junto']];
    return '<div class="ge-intro ge-intro--vazio">' +
      '<h3>' + (grupo ? 'Ninguém escreveu ainda' : 'Comece a conversa') + '</h3>' +
      '<p>Toque numa ideia:</p><div class="ge-ideias">' +
      ideias.map(function (i) { return '<button type="button" data-ge-ideia="' + esc(i[0]) + '">' + esc(i[1]) + '</button>'; }).join('') +
      '</div></div>';
  }

  function statusHtml(m) {
    if (m.status === 'enviando') return '<p class="ge-st ge-st--verif">' + icone('shield') + '<span>Verificando…</span></p>';
    if (!m.minha || m.status === 'publicada') return '';
    var tit = m.status === 'retida' ? 'Em análise' : m.status === 'removida' ? 'Removida pela equipe' : 'Não publicada';
    return '<div class="ge-st ge-st--' + m.status + '">' +
      '<p class="ge-st-tit">' + icone(m.status === 'retida' ? 'clock' : 'shield-alert') + '<span>' + tit + '</span><span class="ge-st-so">só você vê</span></p>' +
      '<p class="ge-st-exp">' + esc(m.explicacao) + '</p></div>';
  }

  function midiaHtml(m) {
    var md = m.midia;
    if (!md) return '';
    if (md.apagada || (!md.url && !md.local)) {
      var apagadaTxt = m.status === 'bloqueada' ? (md.tipo === 'imagem' ? 'Foto não enviada' : 'Áudio não enviado')
        : (md.tipo === 'imagem' ? 'Foto apagada' : 'Áudio apagado') + ' (fica ' + (estado.dados.midia_dias || 7) + ' dias)';
      return '<p class="ge-midia-off">' + icone(md.tipo === 'imagem' ? 'image-off' : 'mic-off') + '<span>' + esc(apagadaTxt) + '</span></p>';
    }
    var src = md.local || estado.blobs[m.id] || '';
    if (md.tipo === 'imagem') {
      var w = md.largura || 4;
      var h = md.altura || 3;
      return '<button type="button" class="ge-foto" data-ge-foto="' + esc(m.id) + '" aria-label="Abrir foto de ' + esc(m.minha ? 'você' : m.autor) + '" style="aspect-ratio:' + w + '/' + h + '">' +
        '<img alt="" ' + (src ? 'src="' + esc(src) + '"' : 'data-ge-src="' + esc(md.url) + '" data-ge-id="' + esc(m.id) + '"') + '></button>';
    }
    return '<div class="ge-audio">' + icone('mic') +
      '<audio controls preload="metadata" ' + (src ? 'src="' + esc(src) + '"' : 'data-ge-src="' + esc(md.url) + '" data-ge-id="' + esc(m.id) + '"') + '></audio>' +
      (md.duracao ? '<span class="ge-audio-dur">' + mmss(md.duracao) + '</span>' : '') + '</div>';
  }

  function msgHtml(m, anterior) {
    var mesmoAutor = anterior && anterior.minha === m.minha && anterior.autor === m.autor && dia(anterior.criado_em) === dia(m.criado_em) &&
      (new Date(m.criado_em) - new Date(anterior.criado_em)) < 10 * 60 * 1000;
    var grupo = estado.atual.tipo === 'grupo';
    var classes = 'ge-msg' + (m.minha ? ' ge-msg--minha' : '') + ' ge-msg--' + m.status + (mesmoAutor ? ' ge-msg--seq' : '') + (m.midia ? ' ge-msg--midia' : '');
    var nome = (m.minha || !grupo || mesmoAutor) ? '' : '<p class="ge-autor">' + esc(m.autor) + '</p>';
    var av = (m.minha || !grupo) ? '' : (mesmoAutor ? '<span class="ge-av ge-av--vazio" aria-hidden="true"></span>' : avatar(m.autor));
    var menu = (!m.minha && m.status === 'publicada')
      ? (m.denunciada
        ? '<span class="ge-den-ok" title="Você denunciou esta mensagem">' + icone('flag') + '<span class="ge-sr">Você denunciou esta mensagem</span></span>'
        : '<button type="button" class="ge-mais" data-ge-mais="' + m.id + '" aria-label="Denunciar mensagem de ' + esc(m.autor) + '">' + icone('ellipsis-vertical') + '</button>')
      : '';
    var texto = m.texto ? '<p class="ge-texto">' + esc(m.texto) + '<time class="ge-hora" datetime="' + esc(m.criado_em) + '">' + esc(hora(m.criado_em)) + '</time></p>'
      : '<p class="ge-texto ge-texto--so-hora"><time class="ge-hora" datetime="' + esc(m.criado_em) + '">' + esc(hora(m.criado_em)) + '</time></p>';
    return '<article class="' + classes + '" data-id="' + esc(m.id) + '">' + av +
      '<div class="ge-bolha">' + nome + midiaHtml(m) + texto + statusHtml(m) + '</div>' + menu + '</article>';
  }

  function renderFeed() {
    var feed = $('ge-feed');
    if (!feed || !estado.atual) return;
    var pertoDoFim = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
    var lista = Object.keys(estado.msgs).map(function (k) { return estado.msgs[k]; }).sort(function (a, b) {
      return (a.ordem || a.id) - (b.ordem || b.id);
    });
    var html = estado.atual.tipo === 'grupo' ? (guardado(CHAVE_BOAS_VINDAS) ? '' : boasVindasHtml()) : privadaHtml();
    var diaAtual = null;
    var anterior = null;
    lista.forEach(function (m) {
      var dd = dia(m.criado_em);
      if (dd !== diaAtual) { html += '<p class="ge-dia"><span>' + esc(dd) + '</span></p>'; diaAtual = dd; anterior = null; }
      html += msgHtml(m, anterior);
      anterior = m;
    });
    if (!lista.length) html += vazioHtml();
    // Áudio tocando não pode ser interrompido pelo redesenho.
    if (Array.prototype.some.call(feed.querySelectorAll('audio'), function (au) { return !au.paused; })) return;
    feed.innerHTML = html;
    icones();
    carregarMidias(feed);
    if (pertoDoFim || !estado.rolou) { feed.scrollTop = feed.scrollHeight; estado.rolou = true; }
  }

  // Mídia exige o token: baixa com fetch e usa URL local (guardada para não baixar de novo).
  function carregarMidias(raiz) {
    raiz.querySelectorAll('[data-ge-src]').forEach(function (el) {
      var id = el.getAttribute('data-ge-id');
      var url = el.getAttribute('data-ge-src');
      el.removeAttribute('data-ge-src');
      if (estado.blobs[id]) { el.src = estado.blobs[id]; return; }
      fetch(url, { headers: { Authorization: 'Bearer ' + window.Auth.getToken() } }).then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      }).then(function (b) {
        estado.blobs[id] = URL.createObjectURL(b);
        el.src = estado.blobs[id];
      }).catch(function () {
        var caixa = el.closest('.ge-foto, .ge-audio');
        if (caixa) caixa.outerHTML = '<p class="ge-midia-off">' + icone('image-off') + '<span>Não foi possível abrir</span></p>';
        icones();
      });
    });
  }

  // Devolve true só se algo mudou de fato (o cursor tem 2 s de folga e repete mensagens já vistas).
  function aplicar(mensagens) {
    var mudou = false;
    (mensagens || []).forEach(function (m) {
      if (m.oculta) { if (estado.msgs[m.id]) { delete estado.msgs[m.id]; mudou = true; } return; }
      var antes = estado.msgs[m.id];
      if (!antes || JSON.stringify(antes) !== JSON.stringify(m)) { estado.msgs[m.id] = m; mudou = true; }
    });
    return mudou;
  }

  async function carregarMensagens() {
    if (!estado.atual) return;
    var alvo = estado.atual;
    try {
      var r = await api(base() + '/mensagens' + (estado.cursor ? '?desde=' + encodeURIComponent(estado.cursor) : ''));
      if (alvo !== estado.atual) return; // trocou de conversa no meio
      var primeira = !estado.cursor;
      var mudou = aplicar(r.mensagens);
      estado.cursor = r.cursor || estado.cursor;
      if (primeira || mudou) renderFeed();
      if (mudou || primeira) carregarLista();
    } catch (err) {
      if (err.status === 401) { desmontar(); return; }
      if (err.codigo === 'aceite_pendente') { abrir(); return; }
      if (err.status === 404 && estado.atual && estado.atual.tipo === 'grupo') { desmontar(); return; }
      var feed = $('ge-feed');
      if (feed && !Object.keys(estado.msgs).length) feed.innerHTML = '<p class="ge-erro ge-erro--feed">' + esc(err.message) + '</p>';
    }
  }

  function tick() {
    if (document.visibilityState !== 'visible') return;
    var sec = $(TELA);
    if (!sec || sec.classList.contains('hidden')) { parar(); return; }
    carregarLista();
    if (estado.atual && sec.getAttribute('data-modo') === 'conversa' || (estado.atual && !celular.matches)) carregarMensagens();
  }

  function parar() {
    if (estado.timer) clearInterval(estado.timer);
    estado.timer = null;
  }

  async function abrir() {
    if (!estado.ativo) return;
    try {
      estado.dados = await api('/api/grupos/meu');
    } catch (err) {
      if (err.status === 404 || err.status === 401) { desmontar(); window.showScreen('dashboard-page', { replace: true }); }
      return;
    }
    atualizarEntrada();
    estado.atual = null;
    estado.msgs = {};
    estado.cursor = null;
    modo('lista');
    document.body.classList.remove('ge-conversa');
    if (estado.dados.grupo && estado.dados.aceite_pendente) { parar(); renderTermo(); return; }
    renderEstrutura();
    if (!estado.dados.grupo) return;
    modo('lista');
    document.body.classList.remove('ge-conversa');
    await carregarLista();
    renderLista();
    if (!celular.matches) abrirConversa('grupo', { semHistorico: true });
    parar();
    estado.timer = setInterval(tick, INTERVALO);
  }

  // ---------- Escrever ----------
  function ajustarCampo() {
    var campo = $('ge-texto');
    var cont = $('ge-cont');
    if (!campo) return;
    campo.style.height = 'auto';
    campo.style.height = Math.min(campo.scrollHeight, 132) + 'px';
    if (cont) { var resta = campo.maxLength - campo.value.length; cont.hidden = resta > 80; cont.textContent = resta; }
    var temTexto = campo.value.trim().length > 0;
    if ($('ge-enviar')) $('ge-enviar').hidden = !temTexto;
    if ($('ge-mic')) $('ge-mic').hidden = temTexto;
  }

  function erro(msg) {
    var e = $('ge-erro');
    if (!e) { window.alert(msg); return; }
    e.textContent = msg;
    e.hidden = !msg;
  }

  // Balão provisório "Verificando…" enquanto o servidor modera; depois troca pelo resultado.
  async function enviarComBalao(provisorio, chamada) {
    var tmpId = 'tmp-' + (++estado.tmp);
    provisorio.id = tmpId;
    provisorio.ordem = Number.MAX_SAFE_INTEGER - 1000 + estado.tmp;
    provisorio.minha = true;
    provisorio.autor = estado.dados.eu.nome;
    provisorio.criado_em = new Date().toISOString();
    provisorio.status = 'enviando';
    estado.msgs[tmpId] = provisorio;
    estado.rolou = false;
    renderFeed();
    var alvo = estado.atual;
    try {
      var r = await chamada();
      delete estado.msgs[tmpId];
      if (alvo === estado.atual) {
        if (provisorio.midia && provisorio.midia.local && r.mensagem.midia && r.mensagem.midia.url) estado.blobs[r.mensagem.id] = provisorio.midia.local;
        aplicar([r.mensagem]);
        estado.rolou = false;
        renderFeed();
        carregarLista();
      }
      return true;
    } catch (err) {
      delete estado.msgs[tmpId];
      renderFeed();
      if (err.status === 404 && alvo.tipo === 'grupo') { desmontar(); return false; }
      erro(err.message);
      return false;
    }
  }

  async function enviarTexto(ev) {
    ev.preventDefault();
    if (estado.enviando) return;
    var campo = $('ge-texto');
    var texto = campo.value.trim();
    erro('');
    if (!texto) { campo.focus(); return; }
    estado.enviando = true;
    campo.value = '';
    ajustarCampo();
    fecharEmojis();
    var ok = await enviarComBalao({ texto: texto }, function () {
      return api(base() + '/mensagens', { method: 'POST', body: { texto: texto } });
    });
    if (!ok && !campo.value) { campo.value = texto; ajustarCampo(); }
    estado.enviando = false;
    if (!toque.matches) campo.focus();
  }

  // ---------- Emojis ----------
  function fecharEmojis() {
    var p = $('ge-emojis');
    var b = $('ge-emoji-btn');
    if (p) p.hidden = true;
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function alternarEmojis() {
    var p = $('ge-emojis');
    var b = $('ge-emoji-btn');
    if (!p) return;
    p.hidden = !p.hidden;
    b.setAttribute('aria-expanded', String(!p.hidden));
    if (!p.hidden) { var primeiro = p.querySelector('button'); if (primeiro && !toque.matches) primeiro.focus(); }
  }
  function inserirEmoji(e) {
    var campo = $('ge-texto');
    if (!campo) return;
    var ini = campo.selectionStart == null ? campo.value.length : campo.selectionStart;
    var fim = campo.selectionEnd == null ? ini : campo.selectionEnd;
    if (campo.value.length - (fim - ini) + e.length > campo.maxLength) return;
    campo.value = campo.value.slice(0, ini) + e + campo.value.slice(fim);
    campo.selectionStart = campo.selectionEnd = ini + e.length;
    ajustarCampo();
    if (!toque.matches) campo.focus();
  }

  // ---------- Foto ----------
  function reduzirFoto(arquivo) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(arquivo);
      img.onload = function () {
        var max = 1600;
        var esc1 = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * esc1);
        c.height = Math.round(img.naturalHeight * esc1);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { if (b) resolve({ blob: b, largura: c.width, altura: c.height }); else reject(new Error('Não foi possível ler essa foto.')); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler essa foto. Use JPG, PNG ou WebP.')); };
      img.src = url;
    });
  }

  async function escolherFoto(arquivo) {
    if (!arquivo) return;
    if (!/^image\//.test(arquivo.type)) { erro('Escolha uma foto (JPG, PNG ou WebP).'); return; }
    try {
      var f = await reduzirFoto(arquivo);
      estado.foto = { blob: f.blob, url: URL.createObjectURL(f.blob), largura: f.largura, altura: f.altura };
      abrirFotoSheet();
    } catch (err) { erro(err.message); }
  }

  function abrirFotoSheet() {
    var sheet = $('ge-sheet');
    var f = estado.foto;
    var d = estado.dados;
    sheet.setAttribute('aria-labelledby', 'ge-sheet-tit');
    sheet.innerHTML =
      '<form method="dialog" class="ge-sheet-in" id="ge-foto-form">' +
        '<div class="ge-sheet-topo"><h2 id="ge-sheet-tit">Enviar foto' + (estado.atual.tipo === 'grupo' ? ' para o grupo' : ' para ' + esc(estado.atual.nome)) + '</h2>' +
          '<button type="button" class="ge-sheet-x" data-ge-fechar aria-label="Cancelar">' + icone('x') + '</button></div>' +
        '<img class="ge-foto-prev" src="' + esc(f.url) + '" alt="Foto escolhida" style="aspect-ratio:' + f.largura + '/' + f.altura + '">' +
        '<label for="ge-legenda" class="ge-sr">Legenda</label>' +
        '<input id="ge-legenda" class="ge-legenda" type="text" maxlength="' + (d.max_texto || 500) + '" placeholder="Legenda (opcional)" autocomplete="off">' +
        '<p class="ge-aviso-midia">' + icone('shield-check') + '<span>' + esc(d.aviso) + ' A foto aparece depois que a equipe aprovar.</span></p>' +
        '<p class="ge-erro" role="alert" hidden></p>' +
        '<button type="submit" class="ge-sheet-ok">Enviar foto</button>' +
      '</form>';
    icones();
    sheet.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var legenda = $('ge-legenda').value.trim();
      fecharSheet();
      enviarFoto(legenda);
    });
    mostrarDialogo(sheet);
  }

  async function enviarFoto(legenda) {
    var f = estado.foto;
    estado.foto = null;
    if (!f) return;
    erro('');
    await enviarComBalao({ texto: legenda, midia: { tipo: 'imagem', local: f.url, largura: f.largura, altura: f.altura } }, function () {
      return api(base() + '/midia?tipo=imagem&legenda=' + encodeURIComponent(legenda), { method: 'POST', blob: f.blob, tipoBlob: 'image/jpeg' });
    });
  }

  function abrirVisor(id) {
    var src = estado.blobs[id] || (estado.msgs[id] && estado.msgs[id].midia && estado.msgs[id].midia.local);
    if (!src) return;
    var v = $('ge-visor');
    var m = estado.msgs[id];
    v.setAttribute('aria-label', 'Foto de ' + (m && !m.minha ? m.autor : 'você'));
    v.innerHTML = '<button type="button" class="ge-visor-x" data-ge-fechar-visor aria-label="Fechar foto">' + icone('x') + '</button>' +
      '<img src="' + esc(src) + '" alt="' + esc(m && m.texto ? m.texto : 'Foto enviada na conversa') + '">' +
      (m && m.texto ? '<p>' + esc(m.texto) + '</p>' : '');
    icones();
    mostrarDialogo(v);
  }

  // ---------- Áudio ----------
  function tipoGravacao() {
    if (!window.MediaRecorder) return null;
    var op = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < op.length; i++) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(op[i])) return op[i];
    return '';
  }

  async function iniciarGravacao() {
    erro('');
    var tipo = tipoGravacao();
    if (tipo === null || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      erro('Este navegador não grava áudio. Tente pelo Chrome ou Safari atualizados.');
      return;
    }
    var stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      erro(err && err.name === 'NotAllowedError' ? 'Permita o uso do microfone no navegador para gravar áudio.' : 'Não foi possível usar o microfone.');
      return;
    }
    var rec = new MediaRecorder(stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 32000 } : undefined);
    var g = { rec: rec, stream: stream, partes: [], inicio: Date.now(), timer: null, enviar: false, max: (estado.dados.max_audio_seg || 120) };
    estado.gravacao = g;
    rec.ondataavailable = function (e) { if (e.data && e.data.size) g.partes.push(e.data); };
    rec.onstop = function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      clearInterval(g.timer);
      if (estado.gravacao === g) estado.gravacao = null;
      mostrarGravando(false);
      if (!g.enviar || !g.partes.length) return;
      var mime = (rec.mimeType || tipo || 'audio/webm').split(';')[0];
      var blob = new Blob(g.partes, { type: mime });
      var dur = Math.max(1, Math.round((Date.now() - g.inicio) / 1000));
      enviarAudio(blob, mime, Math.min(dur, g.max));
    };
    rec.start(250);
    mostrarGravando(true);
    g.timer = setInterval(function () {
      var s = (Date.now() - g.inicio) / 1000;
      var t = $('ge-grav-tempo');
      if (t) t.textContent = mmss(s);
      if (s >= g.max) pararGravacao(false);
    }, 250);
  }

  function pararGravacao(descartar) {
    var g = estado.gravacao;
    if (!g) return;
    g.enviar = !descartar;
    try { if (g.rec.state !== 'inactive') g.rec.stop(); } catch (e) { /* já parado */ }
    if (descartar) { g.stream.getTracks().forEach(function (t) { t.stop(); }); clearInterval(g.timer); estado.gravacao = null; mostrarGravando(false); }
  }

  function mostrarGravando(sim) {
    var f = $('ge-form');
    var gr = $('ge-gravando');
    if (!f || !gr) return;
    f.hidden = sim;
    gr.hidden = !sim;
    fecharEmojis();
    if (sim) { var t = $('ge-grav-tempo'); if (t) t.textContent = '0:00'; $('ge-grav-enviar').focus(); } else if ($('ge-mic') && !toque.matches) { $('ge-mic').focus(); }
  }

  async function enviarAudio(blob, mime, dur) {
    var local = URL.createObjectURL(blob);
    await enviarComBalao({ texto: '', midia: { tipo: 'audio', local: local, duracao: dur } }, function () {
      return api(base() + '/midia?tipo=audio&duracao=' + dur, { method: 'POST', blob: blob, tipoBlob: mime });
    });
  }

  // ---------- Denúncia e bloqueio ----------
  function mostrarDialogo(d) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
  function fecharDialogo(d) { if (d && d.open) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); } }
  function fecharSheet() { fecharDialogo($('ge-sheet')); }

  function abrirDenuncia(id) {
    var m = estado.msgs[id];
    var sheet = $('ge-sheet');
    if (!m || !sheet) return;
    var motivos = (estado.dados && estado.dados.motivos_denuncia) || {};
    var privada = estado.atual.tipo === 'dm';
    sheet.setAttribute('aria-labelledby', 'ge-sheet-tit');
    sheet.innerHTML =
      '<form method="dialog" class="ge-sheet-in" id="ge-den-form">' +
        '<div class="ge-sheet-topo"><h2 id="ge-sheet-tit">Denunciar mensagem</h2>' +
          '<button type="button" class="ge-sheet-x" data-ge-fechar aria-label="Fechar">' + icone('x') + '</button></div>' +
        '<blockquote class="ge-sheet-cit"><b>' + esc(m.autor) + '</b>' + esc(m.texto || (m.midia ? (m.midia.tipo === 'imagem' ? 'Foto' : 'Áudio') : '')) + '</blockquote>' +
        '<fieldset><legend>O que há de errado?</legend>' +
          Object.keys(motivos).map(function (k) {
            return '<label class="ge-opcao"><input type="radio" name="motivo" value="' + esc(k) + '"><span>' + esc(motivos[k]) + '</span></label>';
          }).join('') +
        '</fieldset>' +
        (privada ? '<label class="ge-opcao ge-opcao--check"><input type="checkbox" name="bloquear" checked><span>Bloquear ' + esc(m.autor) + ' também</span></label>' : '') +
        '<p class="ge-sheet-nota">A equipe analisa e quem escreveu não fica sabendo quem denunciou.</p>' +
        '<p class="ge-erro" role="alert" hidden></p>' +
        '<button type="submit" class="ge-sheet-ok">Enviar denúncia</button>' +
      '</form>';
    icones();
    var form = sheet.querySelector('form');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var escolhido = form.querySelector('input[name="motivo"]:checked');
      var err = form.querySelector('.ge-erro');
      if (!escolhido) { err.textContent = 'Escolha o que há de errado.'; err.hidden = false; return; }
      var ok = form.querySelector('.ge-sheet-ok');
      ok.disabled = true;
      try {
        await api('/api/grupos/mensagens/' + id + '/denuncia', { method: 'POST', body: { motivo: escolhido.value } });
        var bloquearTambem = form.querySelector('input[name="bloquear"]');
        if (bloquearTambem && bloquearTambem.checked) await bloquear(true, { silencioso: true });
        if (estado.msgs[id]) estado.msgs[id].denunciada = true;
        form.innerHTML =
          '<div class="ge-sheet-feito">' + icone('check') + '<h2 id="ge-sheet-tit">Obrigado por avisar</h2>' +
          '<p>A equipe vai olhar essa mensagem. Se ela quebrar as regras, sai da conversa.</p>' +
          '<button type="button" class="ge-sheet-ok" data-ge-fechar>Voltar à conversa</button></div>';
        icones();
        renderFeed();
      } catch (e2) {
        ok.disabled = false;
        err.textContent = e2.message;
        err.hidden = false;
      }
    });
    mostrarDialogo(sheet);
  }

  // ---------- Sair do grupo (revoga o aceite; opcionalmente apaga o que a pessoa enviou) ----------
  function abrirSair() {
    var sheet = $('ge-sheet');
    var d = estado.dados;
    if (!sheet || !d || !d.grupo) return;
    sheet.setAttribute('aria-labelledby', 'ge-sheet-tit');
    sheet.innerHTML =
      '<form method="dialog" class="ge-sheet-in" id="ge-sair-form">' +
        '<div class="ge-sheet-topo"><h2 id="ge-sheet-tit">Sair do grupo de ' + esc(d.grupo.nome) + '?</h2>' +
          '<button type="button" class="ge-sheet-x" data-ge-fechar aria-label="Cancelar">' + icone('x') + '</button></div>' +
        '<ul class="ge-sair-lista">' +
          '<li>' + icone('eye-off') + '<span>Você deixa de ver o grupo e as suas conversas privadas.</span></li>' +
          '<li>' + icone('user-x') + '<span>Os colegas deixam de ver você na lista e não podem mais mandar mensagem para você.</span></li>' +
          '<li>' + icone('rotate-ccw') + '<span>Você pode voltar quando quiser, aceitando as regras de novo.</span></li>' +
        '</ul>' +
        '<fieldset><legend>E o que você já enviou?</legend>' +
          '<label class="ge-opcao"><input type="radio" name="apagar" value="0" checked><span>Manter para quem ficou no grupo</span></label>' +
          '<label class="ge-opcao"><input type="radio" name="apagar" value="1"><span>Apagar minhas mensagens, fotos e áudios agora</span></label>' +
        '</fieldset>' +
        '<p class="ge-sheet-nota">Mensagens com denúncia em análise ficam guardadas até a equipe concluir.</p>' +
        '<p class="ge-erro" role="alert" hidden></p>' +
        '<button type="submit" class="ge-sheet-ok ge-sheet-ok--perigo">Sair do grupo</button>' +
        '<button type="button" class="ge-sheet-cancelar" data-ge-fechar>Continuar no grupo</button>' +
      '</form>';
    var form = sheet.querySelector('form');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var ok = form.querySelector('.ge-sheet-ok');
      var err = form.querySelector('.ge-erro');
      var apagar = form.querySelector('input[name="apagar"]:checked').value === '1';
      ok.disabled = true;
      err.hidden = true;
      try {
        await api('/api/grupos/sair', { method: 'POST', body: { apagar: apagar } });
        fecharSheet();
        parar();
        pararGravacao(true);
        estado.empurrou = false;
        abrir();
      } catch (er) {
        ok.disabled = false;
        err.textContent = er.message;
        err.hidden = false;
      }
    });
    icones();
    mostrarDialogo(sheet);
  }

  // ---------- Nome ou apelido (como os colegas veem o aluno) ----------
  function abrirPerfil() {
    var sheet = $('ge-sheet');
    var eu = estado.dados && estado.dados.eu;
    if (!sheet || !eu) return;
    var comApelido = Boolean(eu.apelido);
    sheet.setAttribute('aria-labelledby', 'ge-sheet-tit');
    sheet.innerHTML =
      '<form method="dialog" class="ge-sheet-in" id="ge-perfil-form" novalidate>' +
        '<div class="ge-sheet-topo"><h2 id="ge-sheet-tit">Como os colegas veem você</h2>' +
          '<button type="button" class="ge-sheet-x" data-ge-fechar aria-label="Fechar">' + icone('x') + '</button></div>' +
        '<fieldset><legend class="ge-sr">Nome exibido</legend>' +
          '<label class="ge-opcao"><input type="radio" name="tipo" value="nome"' + (comApelido ? '' : ' checked') + '><span>Meu nome: <b>' + esc(eu.nome_curto) + '</b></span></label>' +
          '<label class="ge-opcao"><input type="radio" name="tipo" value="apelido"' + (comApelido ? ' checked' : '') + '><span>Um apelido</span></label>' +
        '</fieldset>' +
        '<div class="ge-apelido" id="ge-apelido-box"' + (comApelido ? '' : ' hidden') + '>' +
          '<label for="ge-apelido" class="ge-sr">Apelido</label>' +
          '<input id="ge-apelido" class="ge-legenda" type="text" maxlength="20" autocomplete="nickname" autocapitalize="words" placeholder="Ex.: Bia, Zé, Estudante da noite" value="' + esc(eu.apelido || '') + '">' +
        '</div>' +
        '<p class="ge-sheet-nota">De 2 a 20 caracteres. Sem telefone, e-mail, @, palavrão ou nome de professor, equipe ou instituição. A equipe do polo vê o seu nome real se houver denúncia.</p>' +
        '<p class="ge-erro" role="alert" hidden></p>' +
        '<button type="submit" class="ge-sheet-ok">Salvar</button>' +
      '</form>';
    var form = sheet.querySelector('form');
    var box = $('ge-apelido-box');
    var campo = $('ge-apelido');
    form.addEventListener('change', function (e) {
      if (e.target.name !== 'tipo') return;
      box.hidden = e.target.value !== 'apelido';
      if (!box.hidden) campo.focus();
    });
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var ok = form.querySelector('.ge-sheet-ok');
      var err = form.querySelector('.ge-erro');
      var tipo = form.querySelector('input[name="tipo"]:checked').value;
      var apelido = tipo === 'apelido' ? campo.value.trim() : '';
      err.hidden = true;
      if (tipo === 'apelido' && !apelido) { err.textContent = 'Escreva o apelido ou escolha o seu nome.'; err.hidden = false; campo.focus(); return; }
      ok.disabled = true;
      try {
        var r = await api('/api/grupos/perfil', { method: 'POST', body: { apelido: apelido } });
        estado.dados.eu.nome = r.eu.nome;
        estado.dados.eu.apelido = r.eu.apelido;
        var b = $('ge-eu');
        if (b) { b.querySelector('b').textContent = r.eu.nome; b.setAttribute('aria-label', 'Mudar nome ou apelido (você aparece como ' + r.eu.nome + ')'); }
        fecharSheet();
        if (b) b.focus();
      } catch (er) {
        ok.disabled = false;
        err.textContent = er.message;
        err.hidden = false;
        if (tipo === 'apelido') campo.focus();
      }
    });
    icones();
    mostrarDialogo(sheet);
    if (comApelido) campo.focus();
  }

  async function bloquear(sim, opts) {
    opts = opts || {};
    var a = estado.atual;
    if (!a || a.tipo !== 'dm') return;
    if (sim && !opts.silencioso && !window.confirm('Bloquear ' + a.nome + '? Vocês não poderão trocar mensagens privadas até você desbloquear.')) return;
    try {
      await api('/api/grupos/conversas/' + encodeURIComponent(a.ref) + '/bloqueio', { method: 'POST', body: { bloquear: sim } });
      a.bloqueado = sim;
      renderChat();
      estado.rolou = false;
      renderFeed();
      carregarLista();
    } catch (err) { window.alert(err.message); }
  }

  // ---------- Liberação ----------
  async function verificar() {
    if (estado.verificado || !window.Auth.isAuthenticated()) return;
    estado.verificado = true;
    try {
      estado.dados = await api('/api/grupos/meu');
    } catch (err) {
      return; // 404 = área desligada para esta conta: nada aparece
    }
    estado.ativo = true;
    window.UI.registrarTela(TELA, PATH, 'Grupo do curso');
    montarSecao();
    linkNoMenu();
    entradaNoInicio();
    if (pathInicial === PATH) {
      pathInicial = null;
      window.showScreen(TELA, { replace: true });
    }
  }

  function init() {
    var original = window.showScreen;
    window.showScreen = function (id, options) {
      // Voltar do aparelho dentro de uma conversa (celular): volta para a lista sem recarregar a tela.
      var sec = $(TELA);
      if (id === TELA && options && options.skipHistory && sec && !sec.classList.contains('hidden') && sec.getAttribute('data-modo') === 'conversa') {
        estado.empurrou = false;
        voltarLista();
        return;
      }
      original(id, options);
      document.body.classList.toggle('ge-on', id === TELA && estado.ativo);
      if (id !== TELA) document.body.classList.remove('ge-conversa');
      if (!window.Auth.isAuthenticated()) { if (estado.verificado) desmontar(); return; }
      if (id === TELA && estado.ativo) abrir();
      else { parar(); pararGravacao(true); }
      verificar();
    };

    document.addEventListener('submit', function (e) {
      if (e.target && e.target.id === 'ge-form') enviarTexto(e);
      if (e.target && e.target.id === 'ge-termo-form') aceitarTermo(e);
    });
    document.addEventListener('input', function (e) {
      if (!e.target) return;
      if (e.target.id === 'ge-texto') ajustarCampo();
      if (e.target.id === 'ge-busca') { estado.filtro = e.target.value; renderLista(); }
    });
    document.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'ge-arquivo') { var f = e.target.files && e.target.files[0]; e.target.value = ''; escolherFoto(f); }
    });
    document.addEventListener('keydown', function (e) {
      // No computador, Enter envia e Shift+Enter quebra a linha. No celular, Enter quebra a linha (envia pelo botão).
      if (e.target && e.target.id === 'ge-texto' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && !toque.matches) {
        e.preventDefault();
        var f = $('ge-form');
        if (f) f.requestSubmit();
      }
      if (e.key === 'Escape' && $('ge-emojis') && !$('ge-emojis').hidden) { fecharEmojis(); $('ge-emoji-btn').focus(); }
    });
    document.addEventListener('click', function (e) {
      var t = e.target;
      var b;
      if ((b = t.closest('[data-ge-abrir]'))) { abrirConversa(b.getAttribute('data-ge-abrir'), { nome: b.getAttribute('data-ge-nome') }); return; }
      if (t.closest('[data-ge-voltar]')) { if (estado.empurrou) { estado.empurrou = false; window.history.back(); } else voltarLista(); return; }
      if ((b = t.closest('[data-ge-mais]'))) { abrirDenuncia(b.getAttribute('data-ge-mais')); return; }
      if ((b = t.closest('[data-ge-foto]'))) { abrirVisor(b.getAttribute('data-ge-foto')); return; }
      if ((b = t.closest('[data-ge-bloquear]'))) { bloquear(b.getAttribute('data-ge-bloquear') === '1'); return; }
      if (t.closest('[data-ge-termo]')) { abrirTermoCompleto(); return; }
      if (t.closest('[data-ge-sair]')) { abrirSair(); return; }
      if (t.closest('[data-ge-perfil]')) { abrirPerfil(); return; }
      if (t.closest('[data-ge-fechar]')) { fecharSheet(); return; }
      if (t.closest('[data-ge-fechar-visor]')) { fecharDialogo($('ge-visor')); return; }
      var sheet = $('ge-sheet');
      if (sheet && t === sheet) { fecharSheet(); return; } // toque fora da folha
      var visor = $('ge-visor');
      if (visor && t === visor) { fecharDialogo(visor); return; }
      if ((b = t.closest('[data-ge-emoji]'))) { inserirEmoji(b.getAttribute('data-ge-emoji')); return; }
      if (t.closest('#ge-emoji-btn')) { alternarEmojis(); return; }
      if (t.closest('#ge-foto-btn')) { erro(''); $('ge-arquivo').click(); return; }
      if (t.closest('#ge-mic')) { iniciarGravacao(); return; }
      if (t.closest('#ge-grav-cancelar')) { pararGravacao(true); return; }
      if (t.closest('#ge-grav-enviar')) { pararGravacao(false); return; }
      if (t.closest('[data-ge-boas-vindas]')) { guardar(CHAVE_BOAS_VINDAS, '1'); renderFeed(); return; }
      if ((b = t.closest('[data-ge-ideia]'))) {
        var campo = $('ge-texto');
        if (campo) { campo.value = b.getAttribute('data-ge-ideia'); ajustarCampo(); campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
        return;
      }
      if ((b = t.closest('#ge-regras-btn'))) {
        var painel = $('ge-regras');
        painel.hidden = !painel.hidden;
        b.setAttribute('aria-expanded', String(!painel.hidden));
        return;
      }
      // Clique fora do painel de emojis fecha.
      var p = $('ge-emojis');
      if (p && !p.hidden && !t.closest('#ge-emojis')) fecharEmojis();
    });
    document.addEventListener('visibilitychange', function () {
      var sec = $(TELA);
      if (document.visibilityState === 'visible' && sec && !sec.classList.contains('hidden')) { carregarLista(); carregarMensagens(); }
    });
    // Girou o celular ou redimensionou: no desktop sempre há uma conversa aberta.
    if (celular.addEventListener) celular.addEventListener('change', function () {
      var sec = $(TELA);
      if (!sec || sec.classList.contains('hidden') || !estado.lista) return;
      if (!celular.matches && !estado.atual) abrirConversa('grupo', { semHistorico: true });
    });
  }

  // Antes do init do app.js (este script vem antes dele), para envolver window.showScreen a tempo.
  document.addEventListener('DOMContentLoaded', init);

  return { abrir: abrir };
})();
