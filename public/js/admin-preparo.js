/* Admin · Acessos em preparação: o polo cria o acesso de quem ainda não tem RGM
   (nome + e-mail pessoal + curso opcional) e informa o RGM quando a faculdade gerar.
   O aluno entra com o e-mail e a senha inicial (primeiro nome + 123@) e é levado à Aula Inaugural.
   Preenche #admin-alunos-preparo (aba "Alunos"); rotas em server/preparo.js. */
window.AdminPreparo = (function () {
  'use strict';

  var TOKEN_KEY = 'csu_admin_token';
  var root = null;
  var carregou = false;

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
    if (!res.ok) {
      var err = new Error((data && data.message) || 'Não foi possível concluir.');
      err.errors = (data && data.errors) || {};
      throw err;
    }
    return data;
  }

  function primeiroErro(err) {
    var e = err && err.errors ? err.errors : {};
    return e.rgm || e.email || e.nome || (err && err.message) || 'Não foi possível concluir.';
  }

  var INPUT = 'w-full px-3 py-2 rounded-lg border text-sm';

  function shell() {
    return (
      '<section class="bg-white border rounded-xl p-4 sm:p-5 mb-6" aria-labelledby="prep-h">' +
        '<h2 id="prep-h" class="text-xl font-bold">Acessos em preparação</h2>' +
        '<p class="text-sm text-gray-500 mt-1 mb-4">Para quem ainda não tem RGM nem e-mail acadêmico. O aluno entra com o <b>e-mail pessoal</b> e a senha inicial (primeiro nome + 123@) e começa pela Aula Inaugural. Quando o RGM sair, informe na lista abaixo: o app volta ao normal e o progresso continua.</p>' +
        '<form id="prep-form" class="grid gap-3 sm:grid-cols-3" novalidate>' +
          '<label class="text-sm font-medium text-gray-700">Nome completo*<input id="prep-nome" class="' + INPUT + ' mt-1" autocomplete="off" required></label>' +
          '<label class="text-sm font-medium text-gray-700">E-mail pessoal*<input id="prep-email" type="email" class="' + INPUT + ' mt-1" autocomplete="off" required></label>' +
          '<label class="text-sm font-medium text-gray-700">Curso (se souber)<input id="prep-curso" class="' + INPUT + ' mt-1" autocomplete="off"></label>' +
          '<div class="sm:col-span-3 flex flex-wrap items-center gap-3">' +
            '<button type="submit" class="bg-cruzeiro text-white text-sm font-semibold px-4 py-2 rounded-lg">Criar acesso</button>' +
            '<p id="prep-msg" class="text-sm" role="status" aria-live="polite"></p>' +
          '</div>' +
        '</form>' +
        '<div id="prep-ok" class="hidden mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900"></div>' +
        '<h3 class="font-bold mt-6 mb-2">Aguardando RGM</h3>' +
        '<div id="prep-lista" class="space-y-3"><p class="text-sm text-gray-500">Carregando...</p></div>' +
      '</section>'
    );
  }

  function linha(a) {
    var criado = a.created_at ? new Date(a.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
    return (
      '<article class="border rounded-xl p-3 text-sm" data-prep-id="' + a.id + '">' +
        '<div class="flex flex-wrap justify-between gap-2">' +
          '<div class="min-w-0"><b>' + esc(a.nome) + '</b>' +
            '<p class="text-xs text-gray-500 break-all">' + esc(a.email) + (a.curso ? ' · ' + esc(a.curso) : '') + ' · criado em ' + esc(criado) + '</p>' +
            '<p class="text-xs text-gray-600 mt-1">Aula Inaugural: ' + Number(a.modulos || 0) + ' de 7 módulos</p></div>' +
          '<button type="button" class="text-xs font-semibold text-blue-700 underline self-start" data-prep-editar>Editar</button>' +
        '</div>' +
        '<div class="flex flex-wrap items-end gap-2 mt-3">' +
          '<label class="text-xs font-medium text-gray-700">RGM<input class="' + INPUT + ' mt-1 w-36" inputmode="numeric" autocomplete="off" data-prep-rgm></label>' +
          '<button type="button" class="bg-cruzeiro text-white text-xs font-semibold px-3 py-2 rounded-lg" data-prep-salvar-rgm>Informar RGM</button>' +
          '<p class="text-xs" role="status" aria-live="polite" data-prep-st></p>' +
        '</div>' +
        '<form class="hidden grid gap-2 sm:grid-cols-3 mt-3" data-prep-form-edit novalidate>' +
          '<input class="' + INPUT + '" aria-label="Nome completo" data-f="nome" value="' + esc(a.nome) + '">' +
          '<input class="' + INPUT + '" aria-label="E-mail pessoal" type="email" data-f="email" value="' + esc(a.email) + '">' +
          '<input class="' + INPUT + '" aria-label="Curso" data-f="curso" value="' + esc(a.curso || '') + '">' +
          '<div class="sm:col-span-3"><button type="submit" class="bg-cruzeiro text-white text-xs font-semibold px-3 py-2 rounded-lg">Salvar</button></div>' +
        '</form>' +
      '</article>'
    );
  }

  async function carregar() {
    if (!root) return;
    var lista = root.querySelector('#prep-lista');
    try {
      var r = await api('GET', '/api/admin/preparo');
      carregou = true;
      lista.innerHTML = r.alunos && r.alunos.length
        ? r.alunos.map(linha).join('')
        : '<p class="text-sm text-gray-500">Nenhum aluno aguardando RGM.</p>';
    } catch (err) {
      lista.innerHTML = '<p class="text-sm text-red-600">' + esc(err.message) + '</p>';
    }
  }

  function mostrarCriado(r) {
    var box = root.querySelector('#prep-ok');
    var url = window.location.origin + '/login';
    box.innerHTML = '<p><b>Acesso criado.</b> Passe ao aluno: entrar em <b>' + esc(url) + '</b> com o e-mail <b>' + esc(r.aluno.email) + '</b> e a senha inicial <b>' + esc(r.senha_inicial) + '</b>. O app leva direto à Aula Inaugural.</p>';
    box.classList.remove('hidden');
  }

  async function criar(ev) {
    ev.preventDefault();
    var msg = root.querySelector('#prep-msg');
    var body = {
      nome: root.querySelector('#prep-nome').value,
      email: root.querySelector('#prep-email').value,
      curso: root.querySelector('#prep-curso').value,
    };
    msg.className = 'text-sm text-gray-500';
    msg.textContent = 'Salvando...';
    try {
      var r = await api('POST', '/api/admin/preparo', body);
      msg.textContent = '';
      ev.target.reset();
      mostrarCriado(r);
      carregar();
    } catch (err) {
      msg.className = 'text-sm text-red-600';
      msg.textContent = primeiroErro(err);
    }
  }

  async function informarRgm(card) {
    var st = card.querySelector('[data-prep-st]');
    var rgm = card.querySelector('[data-prep-rgm]').value;
    st.className = 'text-xs text-gray-500';
    st.textContent = 'Salvando...';
    try {
      var r = await api('PUT', '/api/admin/preparo/' + card.getAttribute('data-prep-id') + '/rgm', { rgm: rgm });
      st.className = 'text-xs text-green-700';
      st.textContent = 'RGM ' + r.aluno.rgm + ' salvo. O app do aluno volta ao normal na próxima vez que ele abrir.';
      setTimeout(carregar, 2500);
    } catch (err) {
      st.className = 'text-xs text-red-600';
      st.textContent = primeiroErro(err);
    }
  }

  async function editar(form) {
    var card = form.closest('[data-prep-id]');
    var st = card.querySelector('[data-prep-st]');
    var body = {};
    form.querySelectorAll('[data-f]').forEach(function (i) { body[i.getAttribute('data-f')] = i.value; });
    try {
      await api('PUT', '/api/admin/preparo/' + card.getAttribute('data-prep-id'), body);
      carregar();
    } catch (err) {
      st.className = 'text-xs text-red-600';
      st.textContent = primeiroErro(err);
    }
  }

  function montar() {
    root = document.getElementById('admin-alunos-preparo');
    if (!root) return;
    root.innerHTML = shell();
    root.querySelector('#prep-form').addEventListener('submit', criar);
    root.addEventListener('click', function (ev) {
      var card = ev.target.closest('[data-prep-id]');
      if (!card) return;
      if (ev.target.closest('[data-prep-salvar-rgm]')) informarRgm(card);
      if (ev.target.closest('[data-prep-editar]')) card.querySelector('[data-prep-form-edit]').classList.toggle('hidden');
    });
    root.addEventListener('submit', function (ev) {
      if (!ev.target.matches('[data-prep-form-edit]')) return;
      ev.preventDefault();
      editar(ev.target);
    });
    // Carrega quando a aba que contém o bloco fica visível (a troca de abas é do admin.js).
    document.addEventListener('click', function (ev) {
      if (!ev.target.closest('.admin-tab')) return;
      setTimeout(function () { if (root.offsetParent !== null) carregar(); }, 0);
    });
    if (root.offsetParent !== null) carregar();
  }

  document.addEventListener('DOMContentLoaded', montar);
  return { carregar: carregar, carregou: function () { return carregou; } };
})();
