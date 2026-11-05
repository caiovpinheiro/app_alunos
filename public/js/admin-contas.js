/* Admin · Contas (aba "Contas"). Duas partes:
   1. Tabela de todas as contas pelas 3 vias de criação: oficial (relatório de matriculados D-1),
      provisória (aceite da venda pelo webhook) e teste (criada aqui). Filtro por via, situação e busca.
   2. Criar conta teste na mão, escolhendo caixa por caixa as áreas do portal que ela vê,
      e editar as contas teste (ativar/desativar, senha, áreas).
   Preenche #admin-contas; rotas em server/contas.js. */
window.AdminContas = (function () {
  'use strict';

  var TOKEN_KEY = 'csu_admin_token';
  var INPUT = 'w-full px-3 py-2 rounded-lg border text-sm';
  var root = null;
  var catalogo = [];
  var usuarios = [];
  var editando = null; // id da conta teste no formulário (null = nova)
  var filtro = { via: '', situacao: '', q: '', pagina: 1 };
  var timerBusca = null;

  var VIAS = [
    { via: 'oficial', nome: 'Oficial', origem: 'Relatório de matriculados (D-1)', cor: 'bg-blue-50 border-blue-200 text-blue-900', tag: 'bg-blue-100 text-blue-800' },
    { via: 'provisoria', nome: 'Provisória', origem: 'Aceite da venda (webhook), antes do D-1', cor: 'bg-amber-50 border-amber-200 text-amber-900', tag: 'bg-amber-100 text-amber-800' },
    { via: 'teste', nome: 'Teste', origem: 'Criada na mão aqui no admin', cor: 'bg-purple-50 border-purple-200 text-purple-900', tag: 'bg-purple-100 text-purple-800' },
  ];
  function infoVia(v) { return VIAS.filter(function (x) { return x.via === v; })[0] || VIAS[0]; }

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function api(method, url, body) {
    var headers = { 'Content-Type': 'application/json' };
    var tok = sessionStorage.getItem(TOKEN_KEY);
    if (tok) headers.Authorization = 'Bearer ' + tok;
    var res = await fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401 && window.AdminCore) window.AdminCore.showLogin();
    if (!res.ok) {
      var err = new Error((data && data.message) || 'Não foi possível concluir.');
      err.errors = (data && data.errors) || {};
      throw err;
    }
    return data;
  }

  function primeiroErro(err) {
    var e = (err && err.errors) || {};
    return e.nome || e.email || e.rgm || e.senha || (err && err.message) || 'Não foi possível concluir.';
  }

  function caixas(perms) {
    return catalogo.map(function (p) {
      var on = perms && typeof perms[p.chave] === 'boolean' ? perms[p.chave] : p.padrao;
      return '<label class="flex items-start gap-2 border rounded-lg p-2 cursor-pointer hover:bg-slate-50">' +
        '<input type="checkbox" class="mt-1" data-perm="' + esc(p.chave) + '"' + (on ? ' checked' : '') + '>' +
        '<span><span class="font-medium text-gray-800">' + esc(p.rotulo) + '</span>' +
        (p.ajuda ? '<span class="block text-xs text-gray-500">' + esc(p.ajuda) + '</span>' : '') + '</span></label>';
    }).join('');
  }

  function shellTabela() {
    return (
      '<section class="bg-white border rounded-xl p-4 sm:p-5 mb-6" aria-labelledby="ct-h">' +
        '<h2 id="ct-h" class="text-xl font-bold">Contas do portal: 3 vias de criação</h2>' +
        '<p class="text-sm text-gray-500 mt-1 mb-4">Clique numa via para filtrar a tabela. A contagem respeita a busca e a situação.</p>' +
        '<div id="ct-vias" class="grid gap-3 sm:grid-cols-3 mb-4"></div>' +
        '<form id="ct-filtros" class="flex flex-wrap items-end gap-3 mb-3 text-sm">' +
          '<label class="flex flex-col gap-1"><span class="text-gray-600">Via</span>' +
            '<select data-ct="via" class="border rounded-lg px-3 py-2 bg-white"><option value="">Todas</option>' +
            VIAS.map(function (v) { return '<option value="' + v.via + '">' + esc(v.nome) + '</option>'; }).join('') + '</select></label>' +
          '<label class="flex flex-col gap-1"><span class="text-gray-600">Situação</span>' +
            '<select data-ct="situacao" class="border rounded-lg px-3 py-2 bg-white"><option value="">Todas</option><option value="ativas">Ativas</option><option value="inativas">Inativas</option></select></label>' +
          '<label class="flex flex-col gap-1 flex-1 min-w-[200px]"><span class="text-gray-600">Buscar</span>' +
            '<input data-ct="q" type="search" placeholder="Nome, e-mail ou RGM" class="border rounded-lg px-3 py-2"></label>' +
        '</form>' +
        '<p id="ct-msg" class="text-sm text-gray-500 mb-2" role="status" aria-live="polite"></p>' +
        '<div class="overflow-x-auto border rounded-lg">' +
          '<table class="min-w-full text-sm">' +
            '<thead class="bg-slate-50 text-left text-gray-600"><tr>' +
              '<th class="px-3 py-2 font-semibold">Via</th><th class="px-3 py-2 font-semibold">Nome</th>' +
              '<th class="px-3 py-2 font-semibold">E-mail</th><th class="px-3 py-2 font-semibold">RGM</th>' +
              '<th class="px-3 py-2 font-semibold">Origem</th><th class="px-3 py-2 font-semibold">Situação</th>' +
              '<th class="px-3 py-2 font-semibold">Criada em</th><th class="px-3 py-2 font-semibold">Último acesso</th>' +
            '</tr></thead>' +
            '<tbody id="ct-corpo"><tr><td colspan="8" class="px-3 py-4 text-gray-500">Carregando...</td></tr></tbody>' +
          '</table>' +
        '</div>' +
        '<div class="flex items-center justify-between gap-3 mt-3 text-sm">' +
          '<button type="button" id="ct-ant" class="bg-white border font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40">Anterior</button>' +
          '<span id="ct-pag" class="text-gray-600"></span>' +
          '<button type="button" id="ct-prox" class="bg-white border font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40">Próxima</button>' +
        '</div>' +
      '</section>'
    );
  }

  function dataBr(d, comHora) {
    if (!d) return '—';
    var o = { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' };
    if (comHora) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return new Date(d).toLocaleString('pt-BR', o);
  }

  function pintarVias(totais) {
    root.querySelector('#ct-vias').innerHTML = VIAS.map(function (v, i) {
      var t = (totais && totais[v.via]) || { total: 0, ativas: 0 };
      var sel = filtro.via === v.via;
      return '<button type="button" data-ct-via="' + v.via + '" aria-pressed="' + sel + '" class="text-left border rounded-xl p-3 ' + v.cor + (sel ? ' ring-2 ring-offset-1 ring-blue-500' : '') + '">' +
        '<span class="block text-xs font-semibold uppercase tracking-wide opacity-80">Via ' + (i + 1) + ' · ' + esc(v.nome) + '</span>' +
        '<span class="block text-2xl font-bold mt-1">' + t.total.toLocaleString('pt-BR') + '</span>' +
        '<span class="block text-xs mt-1">' + t.ativas.toLocaleString('pt-BR') + ' ativas · ' + esc(v.origem) + '</span></button>';
    }).join('');
  }

  function linhaTabela(c) {
    var v = infoVia(c.via);
    return '<tr class="border-t' + (c.ativo ? '' : ' text-gray-400') + '">' +
      '<td class="px-3 py-2"><span class="inline-block text-xs font-semibold px-2 py-0.5 rounded-full ' + v.tag + '">' + esc(v.nome) + '</span></td>' +
      '<td class="px-3 py-2 font-medium">' + esc(c.nome) + '</td>' +
      '<td class="px-3 py-2 whitespace-nowrap">' + esc(c.email) + '</td>' +
      '<td class="px-3 py-2 whitespace-nowrap">' + esc(c.rgm || '—') + '</td>' +
      '<td class="px-3 py-2">' + esc(c.detalhe) + '</td>' +
      '<td class="px-3 py-2">' + (c.ativo ? '<span class="text-green-700 font-semibold">Ativa</span>' : '<span class="text-red-600 font-semibold">Inativa</span>') + '</td>' +
      '<td class="px-3 py-2 whitespace-nowrap">' + esc(dataBr(c.created_at)) + '</td>' +
      '<td class="px-3 py-2 whitespace-nowrap">' + esc(c.ultimo_login_em ? dataBr(c.ultimo_login_em, true) : 'nunca') + '</td>' +
    '</tr>';
  }

  async function carregarTabela() {
    if (!root) return;
    var corpo = root.querySelector('#ct-corpo');
    var msg = root.querySelector('#ct-msg');
    var qs = Object.keys(filtro).filter(function (k) { return filtro[k]; })
      .map(function (k) { return k + '=' + encodeURIComponent(filtro[k]); }).join('&');
    msg.textContent = 'Carregando...';
    try {
      var r = await api('GET', '/api/admin/contas' + (qs ? '?' + qs : ''));
      pintarVias(r.totais);
      corpo.innerHTML = r.contas.length
        ? r.contas.map(linhaTabela).join('')
        : '<tr><td colspan="8" class="px-3 py-4 text-gray-500">Nenhuma conta com esse filtro.</td></tr>';
      var paginas = Math.max(1, Math.ceil(r.total / r.por_pagina));
      msg.textContent = r.total.toLocaleString('pt-BR') + ' conta(s)' + (filtro.via ? ' na via ' + infoVia(filtro.via).nome : '') + '.';
      root.querySelector('#ct-pag').textContent = 'Página ' + r.pagina + ' de ' + paginas;
      root.querySelector('#ct-ant').disabled = r.pagina <= 1;
      root.querySelector('#ct-prox').disabled = r.pagina >= paginas;
    } catch (err) {
      msg.textContent = '';
      corpo.innerHTML = '<tr><td colspan="8" class="px-3 py-4 text-red-600">' + esc(err.message) + '</td></tr>';
    }
  }

  function mudarFiltro(campo, valor) {
    filtro[campo] = valor;
    filtro.pagina = 1;
    if (campo === 'via') root.querySelector('[data-ct="via"]').value = valor;
    carregarTabela();
  }

  function shell() {
    return shellTabela() + (
      '<section class="bg-white border rounded-xl p-4 sm:p-5 mb-6" aria-labelledby="usr-h">' +
        '<div class="flex flex-wrap justify-between items-center gap-2">' +
          '<h2 id="usr-h" class="text-xl font-bold">Via 3 · Criar conta teste</h2>' +
          '<button type="button" id="usr-novo" class="hidden text-sm font-semibold text-blue-700 underline">+ Nova conta teste</button>' +
        '</div>' +
        '<p class="text-sm text-gray-500 mt-1 mb-4">A conta entra no portal com o <b>e-mail</b> (ou o RGM, se informar) e a senha abaixo. Em branco, a senha é a inicial de sempre (primeiro nome + 123@). Marque só as áreas que ela pode ver. A sincronização do relatório de matriculados não desativa essas contas.</p>' +
        '<form id="usr-form" class="grid gap-3 sm:grid-cols-3" novalidate>' +
          '<label class="text-sm font-medium text-gray-700">Nome completo*<input data-f="nome" class="' + INPUT + ' mt-1" autocomplete="off" required></label>' +
          '<label class="text-sm font-medium text-gray-700">E-mail*<input data-f="email" type="email" class="' + INPUT + ' mt-1" autocomplete="off" required></label>' +
          '<label class="text-sm font-medium text-gray-700">RGM (opcional)<input data-f="rgm" inputmode="numeric" class="' + INPUT + ' mt-1" autocomplete="off"></label>' +
          '<label class="text-sm font-medium text-gray-700">Curso (opcional)<input data-f="curso" class="' + INPUT + ' mt-1" autocomplete="off"></label>' +
          '<label class="text-sm font-medium text-gray-700">Polo (opcional)<input data-f="unidade" class="' + INPUT + ' mt-1" autocomplete="off"></label>' +
          '<label class="text-sm font-medium text-gray-700"><span id="usr-senha-rot">Senha (opcional)</span><input data-f="senha" type="text" class="' + INPUT + ' mt-1" autocomplete="new-password" placeholder="mín. 6 caracteres"></label>' +
          '<fieldset class="sm:col-span-3"><legend class="text-sm font-semibold text-gray-800 mb-2">O que essa conta pode acessar</legend>' +
            '<div id="usr-perms" class="grid gap-2 sm:grid-cols-2 text-sm"></div>' +
            '<div class="flex flex-wrap gap-3 mt-2 text-xs">' +
              '<button type="button" class="text-blue-700 underline" data-usr-todas="1">Marcar todas</button>' +
              '<button type="button" class="text-blue-700 underline" data-usr-todas="0">Desmarcar todas</button>' +
            '</div>' +
          '</fieldset>' +
          '<label class="sm:col-span-3 flex items-center gap-2 text-sm font-medium text-gray-700"><input type="checkbox" data-f="ativo" checked> Conta ativa (desmarcado, não consegue entrar)</label>' +
          '<div class="sm:col-span-3 flex flex-wrap items-center gap-3">' +
            '<button type="submit" id="usr-salvar" class="bg-cruzeiro text-white text-sm font-semibold px-4 py-2 rounded-lg">Criar conta teste</button>' +
            '<button type="button" id="usr-cancelar" class="hidden bg-white border text-sm font-semibold px-4 py-2 rounded-lg">Cancelar edição</button>' +
            '<p id="usr-msg" class="text-sm" role="status" aria-live="polite"></p>' +
          '</div>' +
        '</form>' +
        '<div id="usr-ok" class="hidden mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900"></div>' +
        '<h3 class="font-bold mt-6 mb-2">Contas teste</h3>' +
        '<div id="usr-lista" class="space-y-3"><p class="text-sm text-gray-500">Carregando...</p></div>' +
      '</section>'
    );
  }

  function resumoPerms(perms) {
    var on = catalogo.filter(function (p) { return perms && perms[p.chave]; }).map(function (p) { return p.rotulo; });
    return on.length ? on.join(' · ') : 'nenhuma área';
  }

  function linha(u) {
    var criado = u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
    var login = u.ultimo_login_em ? new Date(u.ultimo_login_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'nunca entrou';
    return (
      '<article class="border rounded-xl p-3 text-sm' + (u.ativo ? '' : ' bg-gray-50 opacity-75') + '" data-usr-id="' + u.id + '">' +
        '<div class="flex flex-wrap justify-between gap-2">' +
          '<div class="min-w-0"><b>' + esc(u.nome) + '</b>' +
            (u.ativo ? '' : ' <span class="text-xs font-semibold text-red-600">desativado</span>') +
            '<p class="text-xs text-gray-500 break-all">' + esc(u.email) + (u.rgm ? ' · RGM ' + esc(u.rgm) : '') +
              (u.curso ? ' · ' + esc(u.curso) : '') + ' · criado em ' + esc(criado) + ' · último acesso: ' + esc(login) + '</p>' +
            '<p class="text-xs text-gray-600 mt-1">Senha: ' + (u.senha_propria ? 'definida no admin' : 'inicial (primeiro nome + 123@)') + '</p>' +
            '<p class="text-xs text-gray-700 mt-1"><span class="font-semibold">Acessa:</span> ' + esc(resumoPerms(u.permissoes)) + '</p></div>' +
          '<div class="flex flex-wrap gap-3 self-start text-xs font-semibold">' +
            '<button type="button" class="text-blue-700 underline" data-usr-editar>Editar</button>' +
            '<button type="button" class="text-blue-700 underline" data-usr-ativo>' + (u.ativo ? 'Desativar' : 'Ativar') + '</button>' +
            (u.senha_propria ? '<button type="button" class="text-blue-700 underline" data-usr-reset>Voltar senha inicial</button>' : '') +
          '</div>' +
        '</div>' +
        '<p class="text-xs mt-2" role="status" aria-live="polite" data-usr-st></p>' +
      '</article>'
    );
  }

  function form() { return root.querySelector('#usr-form'); }

  function preencher(u) {
    editando = u ? u.id : null;
    var f = form();
    ['nome', 'email', 'rgm', 'curso', 'unidade'].forEach(function (k) {
      f.querySelector('[data-f="' + k + '"]').value = u ? (u[k] || '') : '';
    });
    f.querySelector('[data-f="senha"]').value = '';
    f.querySelector('[data-f="ativo"]').checked = u ? !!u.ativo : true;
    root.querySelector('#usr-perms').innerHTML = caixas(u ? u.permissoes : null);
    root.querySelector('#usr-salvar').textContent = u ? 'Salvar alterações' : 'Criar conta teste';
    root.querySelector('#usr-senha-rot').textContent = u ? 'Nova senha (em branco = mantém)' : 'Senha (opcional)';
    root.querySelector('#usr-cancelar').classList.toggle('hidden', !u);
    root.querySelector('#usr-novo').classList.toggle('hidden', !u);
    root.querySelector('#usr-msg').textContent = '';
    if (u) {
      root.querySelector('#usr-ok').classList.add('hidden');
      root.querySelector('#usr-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function corpo() {
    var f = form();
    var body = { permissoes: {} };
    f.querySelectorAll('[data-f]').forEach(function (i) {
      body[i.getAttribute('data-f')] = i.type === 'checkbox' ? i.checked : i.value;
    });
    f.querySelectorAll('[data-perm]').forEach(function (i) { body.permissoes[i.getAttribute('data-perm')] = i.checked; });
    return body;
  }

  async function carregar() {
    if (!root) return;
    carregarTabela();
    var lista = root.querySelector('#usr-lista');
    try {
      var r = await api('GET', '/api/admin/contas-teste');
      var primeira = !catalogo.length;
      catalogo = r.catalogo || [];
      usuarios = r.usuarios || [];
      if (primeira && editando === null) root.querySelector('#usr-perms').innerHTML = caixas(null);
      lista.innerHTML = usuarios.length
        ? usuarios.map(linha).join('')
        : '<p class="text-sm text-gray-500">Nenhuma conta teste ainda.</p>';
    } catch (err) {
      lista.innerHTML = '<p class="text-sm text-red-600">' + esc(err.message) + '</p>';
    }
  }

  async function salvar(ev) {
    ev.preventDefault();
    var msg = root.querySelector('#usr-msg');
    var body = corpo();
    msg.className = 'text-sm text-gray-500';
    msg.textContent = 'Salvando...';
    try {
      if (editando) {
        await api('PUT', '/api/admin/contas-teste/' + editando, body);
        preencher(null);
        msg.className = 'text-sm text-green-700';
        msg.textContent = 'Alterações salvas.';
      } else {
        var r = await api('POST', '/api/admin/contas-teste', body);
        var box = root.querySelector('#usr-ok');
        var url = window.location.origin + '/login';
        box.innerHTML = '<p><b>Conta teste criada.</b> Entrar em <b>' + esc(url) + '</b> com o e-mail <b>' + esc(r.usuario.email) + '</b>' +
          (r.senha_inicial ? ' e a senha inicial <b>' + esc(r.senha_inicial) + '</b>.' : ' e a senha definida agora.') + '</p>' +
          '<p class="mt-1">Acessa: ' + esc(resumoPerms(r.usuario.permissoes)) + '.</p>';
        box.classList.remove('hidden');
        preencher(null);
        msg.textContent = '';
      }
      carregar();
    } catch (err) {
      msg.className = 'text-sm text-red-600';
      msg.textContent = primeiroErro(err);
    }
  }

  function achar(card) {
    var id = Number(card.getAttribute('data-usr-id'));
    return usuarios.filter(function (u) { return u.id === id; })[0];
  }

  async function alternarAtivo(card) {
    var u = achar(card);
    if (!u) return;
    var st = card.querySelector('[data-usr-st]');
    try {
      await api('PUT', '/api/admin/contas-teste/' + u.id, {
        nome: u.nome, email: u.email, rgm: u.rgm, curso: u.curso, unidade: u.unidade,
        ativo: !u.ativo, permissoes: u.permissoes,
      });
      carregar();
    } catch (err) {
      st.className = 'text-xs mt-2 text-red-600';
      st.textContent = primeiroErro(err);
    }
  }

  async function voltarSenha(card) {
    var u = achar(card);
    if (!u || !window.confirm('Voltar a senha de ' + u.nome + ' para a inicial (primeiro nome + 123@)?')) return;
    var st = card.querySelector('[data-usr-st]');
    try {
      var r = await api('POST', '/api/admin/contas-teste/' + u.id + '/senha-inicial');
      await carregar();
      var novo = root.querySelector('[data-usr-id="' + u.id + '"] [data-usr-st]');
      if (novo) { novo.className = 'text-xs mt-2 text-green-700'; novo.textContent = 'Senha voltou para ' + r.senha_inicial + '.'; }
    } catch (err) {
      st.className = 'text-xs mt-2 text-red-600';
      st.textContent = primeiroErro(err);
    }
  }

  function montar() {
    root = document.getElementById('admin-contas');
    if (!root) return;
    root.innerHTML = shell();
    form().addEventListener('submit', salvar);
    var filtros = root.querySelector('#ct-filtros');
    filtros.addEventListener('submit', function (ev) { ev.preventDefault(); });
    filtros.addEventListener('change', function (ev) {
      var campo = ev.target.getAttribute('data-ct');
      if (campo === 'via' || campo === 'situacao') mudarFiltro(campo, ev.target.value);
    });
    filtros.querySelector('[data-ct="q"]').addEventListener('input', function (ev) {
      clearTimeout(timerBusca);
      var valor = ev.target.value.trim();
      timerBusca = setTimeout(function () { mudarFiltro('q', valor); }, 350);
    });
    root.querySelector('#ct-ant').addEventListener('click', function () { filtro.pagina -= 1; carregarTabela(); });
    root.querySelector('#ct-prox').addEventListener('click', function () { filtro.pagina += 1; carregarTabela(); });
    root.addEventListener('click', function (ev) {
      var cardVia = ev.target.closest('[data-ct-via]');
      if (cardVia) {
        var v = cardVia.getAttribute('data-ct-via');
        mudarFiltro('via', filtro.via === v ? '' : v);
        return;
      }
      var todas = ev.target.closest('[data-usr-todas]');
      if (todas) {
        var on = todas.getAttribute('data-usr-todas') === '1';
        root.querySelectorAll('#usr-perms [data-perm]').forEach(function (i) { i.checked = on; });
        return;
      }
      if (ev.target.closest('#usr-cancelar') || ev.target.closest('#usr-novo')) { preencher(null); return; }
      var card = ev.target.closest('[data-usr-id]');
      if (!card) return;
      if (ev.target.closest('[data-usr-editar]')) preencher(achar(card));
      if (ev.target.closest('[data-usr-ativo]')) alternarAtivo(card);
      if (ev.target.closest('[data-usr-reset]')) voltarSenha(card);
    });
    // Carrega quando a aba fica visível (a troca de abas é do admin.js).
    document.addEventListener('click', function (ev) {
      if (!ev.target.closest('.admin-tab')) return;
      setTimeout(function () { if (root.offsetParent !== null) carregar(); }, 0);
    });
    if (root.offsetParent !== null) carregar();
  }

  document.addEventListener('DOMContentLoaded', montar);
  return { carregar: carregar };
})();
