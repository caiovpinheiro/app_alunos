/* Painel /admin — autenticação própria, CRUD simples. */
(function () {
  'use strict';

  var TOKEN_KEY = 'csu_admin_token';
  var state = { avisos: [], tutoriais: [], categorias: [], contatos: [], indicacoes: [], editing: null };
  var TUT_CATEGORIAS = [
    'Primeiros passos',
    'Área do Aluno',
    'Blackboard',
    'Provas',
    'Atividades',
    'Financeiro',
    'Documentos',
  ];

  function token() { return sessionStorage.getItem(TOKEN_KEY); }
  function setToken(value) {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function request(url, options) {
    var opts = options || {};
    opts.headers = Object.assign({}, opts.headers || {});
    if (token()) opts.headers.Authorization = 'Bearer ' + token();
    var res = await fetch(url, opts);
    var body = null;
    try { body = await res.json(); } catch (e) { /* ignore */ }
    if (res.status === 401) {
      setToken(null);
      showLogin();
      throw new Error('Sessão expirada.');
    }
    if (!res.ok) {
      var err = new Error((body && body.message) || 'Falha na API.');
      err.details = body && body.errors;
      throw err;
    }
    return body;
  }

  function showLogin() {
    document.getElementById('admin-login').classList.remove('hidden');
    document.getElementById('admin-app').classList.add('hidden');
  }

  function showApp() {
    document.getElementById('admin-login').classList.add('hidden');
    document.getElementById('admin-app').classList.remove('hidden');
  }

  function switchTab(name) {
    document.querySelectorAll('.admin-tab').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.admin-panel').forEach(function (el) {
      el.classList.toggle('hidden', el.id !== 'tab-' + name);
    });
    if (name === 'avisos') loadAvisos();
    if (name === 'tutoriais') loadTuts();
    if (name === 'contatos') loadContatos();
    if (name === 'indicacoes') loadInds();
    if (name === 'planos') loadPlanos();
  }

  function closeModal() {
    document.getElementById('admin-modal').classList.add('hidden');
    document.getElementById('admin-modal-form').innerHTML = '';
    state.editing = null;
  }

  function openModal(title, html) {
    document.getElementById('admin-modal-title').textContent = title;
    document.getElementById('admin-modal-form').innerHTML = html;
    document.getElementById('admin-modal').classList.remove('hidden');
  }

  function field(name, label, value, type) {
    return '<label class="block text-sm font-medium">' + escapeHtml(label) +
      '<input name="' + name + '" type="' + (type || 'text') + '" value="' + escapeHtml(value || '') +
      '" class="mt-1 w-full px-3 py-2 rounded-lg border"></label>';
  }

  function area(name, label, value) {
    return '<label class="block text-sm font-medium">' + escapeHtml(label) +
      '<textarea name="' + name + '" rows="3" class="mt-1 w-full px-3 py-2 rounded-lg border">' +
      escapeHtml(value || '') + '</textarea></label>';
  }

  function select(name, label, options, value) {
    var list = (options && options.length) ? options : [];
    return '<label class="block text-sm font-medium">' + escapeHtml(label) +
      '<select name="' + name + '" required class="mt-1 w-full px-3 py-2 rounded-lg border bg-white">' +
      list.map(function (opt) {
        var sel = String(opt) === String(value) ? ' selected' : '';
        return '<option value="' + escapeHtml(opt) + '"' + sel + '>' + escapeHtml(opt) + '</option>';
      }).join('') +
      '</select></label>';
  }

  function formData(form) {
    var data = {};
    new FormData(form).forEach(function (value, key) { data[key] = value; });
    return data;
  }

  async function loadAvisos() {
    var res = await request('/api/admin/avisos');
    state.avisos = res.avisos || [];
    document.getElementById('admin-avisos-list').innerHTML = state.avisos.map(function (item) {
      return '<article class="bg-white border rounded-xl p-4">' +
        '<div class="flex justify-between gap-3">' +
          '<div><strong>' + escapeHtml(item.titulo) + '</strong>' +
          '<p class="text-sm text-gray-500">' + escapeHtml(item.categoria) + ' · ' + escapeHtml(item.prioridade) +
          ' · ' + (item.ativo ? 'ativo' : 'inativo') + '</p></div>' +
          '<div class="flex gap-2 text-sm">' +
            '<button type="button" data-aviso-edit="' + item.id + '">Editar</button>' +
            '<button type="button" data-aviso-toggle="' + item.id + '">' + (item.ativo ? 'Desativar' : 'Ativar') + '</button>' +
            '<button type="button" class="text-red-500" data-aviso-del="' + item.id + '">Excluir</button>' +
          '</div></div></article>';
    }).join('') || '<p class="text-sm text-gray-500">Nenhum aviso.</p>';
  }

  function avisoForm(item) {
    item = item || { titulo: '', descricao: '', categoria: 'Geral', prioridade: 'media', data_inicio: '', data_fim: '', publico: 'todos', polo: '', curso: '', recorrente: false, dia_recorrente: '', ativo: true };
    return field('titulo', 'Título', item.titulo) +
      area('descricao', 'Descrição', item.descricao) +
      select('categoria', 'Categoria', ['Geral', 'Acadêmico', 'Financeiro', 'Provas', 'Atividades'], item.categoria) +
      select('prioridade', 'Prioridade', ['alta', 'media', 'baixa'], item.prioridade) +
      field('data_inicio', 'Início', item.data_inicio, 'date') +
      field('data_fim', 'Fim', item.data_fim, 'date') +
      select('publico', 'Público', ['todos', 'polo', 'curso'], item.publico) +
      field('polo', 'Polo (se público=polo)', item.polo) +
      field('curso', 'Curso (se público=curso)', item.curso) +
      '<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="recorrente"' + (item.recorrente ? ' checked' : '') + '> Recorrente</label>' +
      field('dia_recorrente', 'Dia recorrente', item.dia_recorrente || '') +
      '<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="ativo"' + (item.ativo !== false ? ' checked' : '') + '> Ativo</label>' +
      '<button class="w-full bg-cruzeiro text-white font-semibold py-2 rounded-lg">Salvar</button>';
  }

  async function loadTuts() {
    var res = await request('/api/admin/tutoriais');
    state.tutoriais = res.tutoriais || [];
    state.categorias = res.categorias || [];
    document.getElementById('admin-tuts-list').innerHTML = state.tutoriais.map(function (item) {
      return '<article class="bg-white border rounded-xl p-4">' +
        '<div class="flex justify-between gap-3"><div><strong>' + escapeHtml(item.titulo) + '</strong>' +
        '<p class="text-sm text-gray-500">' + escapeHtml(item.categoria) + ' · ordem ' + item.ordem + ' · ' + (item.ativo ? 'ativo' : 'inativo') + '</p></div>' +
        '<div class="flex gap-2 text-sm">' +
          '<button type="button" data-tut-edit="' + item.id + '">Editar</button>' +
          '<button type="button" data-tut-toggle="' + item.id + '">' + (item.ativo ? 'Desativar' : 'Ativar') + '</button>' +
          '<button type="button" class="text-red-500" data-tut-del="' + item.id + '">Excluir</button>' +
        '</div></div></article>';
    }).join('') || '<p class="text-sm text-gray-500">Nenhum tutorial.</p>';
  }

  function tutForm(item) {
    item = item || { titulo: '', descricao: '', categoria: 'Primeiros passos', video_url: '', thumbnail_url: '', duracao: '', ordem: 0, ativo: true };
    var cats = (state.categorias && state.categorias.length) ? state.categorias : TUT_CATEGORIAS;
    return field('titulo', 'Título', item.titulo) +
      area('descricao', 'Descrição', item.descricao) +
      select('categoria', 'Tipo / Categoria', cats, item.categoria || cats[0]) +
      field('video_url', 'URL do YouTube', item.video_url) +
      field('thumbnail_url', 'Thumbnail (opcional)', item.thumbnail_url) +
      field('duracao', 'Duração', item.duracao) +
      field('ordem', 'Ordem', item.ordem, 'number') +
      '<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="ativo"' + (item.ativo !== false ? ' checked' : '') + '> Ativo</label>' +
      '<p id="admin-form-error" class="hidden text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"></p>' +
      '<button class="w-full bg-cruzeiro text-white font-semibold py-2 rounded-lg">Salvar</button>';
  }

  async function loadContatos() {
    var res = await request('/api/admin/contatos');
    state.contatos = res.contatos || [];
    document.getElementById('admin-contatos-list').innerHTML = state.contatos.map(function (item) {
      return '<form class="bg-white border rounded-xl p-4 grid sm:grid-cols-3 gap-3 items-end contato-form">' +
        '<input type="hidden" name="polo" value="' + escapeHtml(item.polo) + '">' +
        '<div><p class="font-semibold">' + escapeHtml(item.polo) + '</p><p class="text-xs text-gray-400">Padrão efetivo acad. ' + escapeHtml(item.academico_efetivo) + '</p></div>' +
        '<label class="text-sm">Acadêmico<input name="whatsapp_academico" value="' + escapeHtml(item.whatsapp_academico) + '" class="mt-1 w-full px-3 py-2 rounded-lg border"></label>' +
        '<label class="text-sm">Comercial<input name="whatsapp_comercial" value="' + escapeHtml(item.whatsapp_comercial) + '" class="mt-1 w-full px-3 py-2 rounded-lg border"></label>' +
        '<button class="bg-cruzeiro text-white text-sm font-semibold px-4 py-2 rounded-lg sm:col-span-3">Salvar polo</button></form>';
    }).join('');
  }

  async function loadInds() {
    var q = document.getElementById('ind-q').value.trim();
    var status = document.getElementById('ind-status').value;
    var res = await request('/api/admin/indicacoes?q=' + encodeURIComponent(q) + '&status=' + encodeURIComponent(status));
    state.indicacoes = res.indicacoes || [];
    document.getElementById('admin-inds-list').innerHTML = state.indicacoes.map(function (item) {
      return '<article class="bg-white border rounded-xl p-4 flex justify-between gap-3">' +
        '<div><strong>' + escapeHtml(item.indicado_nome) + '</strong>' +
        '<p class="text-sm text-gray-500">' + escapeHtml(item.indicado_whatsapp) + ' · indicado por ' + escapeHtml(item.indicador_nome) +
        ' (RGM ' + escapeHtml(item.indicador_rgm) + ')</p></div>' +
        '<div class="flex gap-2 items-center text-sm">' +
          '<select data-ind-status="' + item.id + '">' +
            ['novo', 'contatado', 'convertido', 'descartado'].map(function (st) {
              return '<option' + (item.status === st ? ' selected' : '') + '>' + st + '</option>';
            }).join('') +
          '</select>' +
          '<button type="button" data-ind-view="' + item.id + '">Ver</button>' +
        '</div></article>';
    }).join('') || '<p class="text-sm text-gray-500">Nenhuma indicação.</p>';
  }

  function renderPlanosStatus(data) {
    var cards = [
      ['Pendentes', data && data.pendentes],
      ['Processando', data && data.processando],
      ['Concluídas', data && data.concluidas],
      ['Erros', data && data.erros],
    ];
    document.getElementById('admin-planos-status').innerHTML = cards.map(function (item) {
      return '<article class="bg-white border rounded-xl p-4">' +
        '<p class="text-sm text-gray-500">' + escapeHtml(item[0]) + '</p>' +
        '<p class="text-2xl font-bold text-gray-800">' + Number(item[1] || 0) + '</p>' +
        '</article>';
    }).join('');
  }

  async function loadPlanos() {
    var res = await request('/api/admin/planos-imagens/status');
    renderPlanosStatus(res);
    var msg = document.getElementById('planos-lote-msg');
    if (msg && !msg.dataset.locked) {
      msg.textContent = res.running
        ? 'Geração em andamento. Atualize os totais para acompanhar.'
        : (msg.textContent || '');
    }
  }

  function showInd(item) {
    var el = document.getElementById('ind-detail');
    el.classList.remove('hidden');
    el.innerHTML = '<p><strong>Indicado:</strong> ' + escapeHtml(item.indicado_nome) + ' · ' + escapeHtml(item.indicado_whatsapp) + '</p>' +
      '<p><strong>E-mail:</strong> ' + escapeHtml(item.indicado_email || '—') + '</p>' +
      '<p><strong>Curso:</strong> ' + escapeHtml(item.curso_interesse || '—') + '</p>' +
      '<p><strong>Obs:</strong> ' + escapeHtml(item.observacao || '—') + '</p>' +
      '<p class="mt-2"><strong>Indicador:</strong> ' + escapeHtml(item.indicador_nome) + ' · RGM ' + escapeHtml(item.indicador_rgm) +
      ' · polo ' + escapeHtml(item.indicador_polo || '—') + '</p>' +
      '<p><strong>Status:</strong> ' + escapeHtml(item.status) + '</p>';
  }

  async function boot() {
    if (!token()) { showLogin(); return; }
    try {
      var me = await request('/api/admin/me');
      document.getElementById('admin-name').textContent = me.user.nome || me.user.email;
      showApp();
      switchTab('avisos');
    } catch (err) {
      showLogin();
    }
  }

  document.getElementById('admin-login-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var errEl = document.getElementById('admin-login-error');
    errEl.classList.add('hidden');
    try {
      var res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('admin-email').value,
          password: document.getElementById('admin-password').value,
        }),
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Falha no login.');
      setToken(body.token);
      document.getElementById('admin-name').textContent = body.user.name;
      showApp();
      switchTab('avisos');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('admin-logout').addEventListener('click', async function () {
    try { await request('/api/admin/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    setToken(null);
    showLogin();
  });

  document.querySelectorAll('.admin-tab').forEach(function (el) {
    el.addEventListener('click', function () { switchTab(el.getAttribute('data-tab')); });
  });

  document.getElementById('btn-planos-lote').addEventListener('click', async function () {
    var btn = document.getElementById('btn-planos-lote');
    var msg = document.getElementById('planos-lote-msg');
    btn.disabled = true;
    if (msg) {
      msg.dataset.locked = '1';
      msg.textContent = 'Iniciando geração em lote...';
    }
    try {
      var res = await request('/api/admin/planos-imagens/gerar-lote', { method: 'POST' });
      if (msg) msg.textContent = res.message || 'Geração em lote iniciada.';
      await loadPlanos();
    } catch (err) {
      if (msg) msg.textContent = err.message || 'Não foi possível iniciar o lote.';
    } finally {
      btn.disabled = false;
      if (msg) delete msg.dataset.locked;
    }
  });

  document.getElementById('btn-planos-status').addEventListener('click', async function () {
    try {
      await loadPlanos();
    } catch (err) {
      document.getElementById('planos-lote-msg').textContent = err.message || 'Não foi possível consultar o status.';
    }
  });

  document.getElementById('admin-modal-close').addEventListener('click', closeModal);

  document.addEventListener('click', async function (event) {
    if (event.target.closest('[data-aviso-new]')) {
      state.editing = { type: 'aviso' };
      openModal('Novo aviso', avisoForm());
    }
    var ae = event.target.closest('[data-aviso-edit]');
    if (ae) {
      var aviso = state.avisos.find(function (row) { return String(row.id) === ae.getAttribute('data-aviso-edit'); });
      state.editing = { type: 'aviso', id: aviso.id };
      openModal('Editar aviso', avisoForm(aviso));
    }
    var at = event.target.closest('[data-aviso-toggle]');
    if (at) { await request('/api/admin/avisos/' + at.getAttribute('data-aviso-toggle') + '/toggle', { method: 'POST' }); loadAvisos(); }
    var ad = event.target.closest('[data-aviso-del]');
    if (ad && confirm('Excluir este aviso?')) {
      await request('/api/admin/avisos/' + ad.getAttribute('data-aviso-del'), { method: 'DELETE' });
      loadAvisos();
    }
    if (event.target.closest('[data-tut-new]')) {
      state.editing = { type: 'tut' };
      if (!state.categorias.length) {
        loadTuts().then(function () { openModal('Novo tutorial', tutForm()); });
      } else {
        openModal('Novo tutorial', tutForm());
      }
      return;
    }
    var te = event.target.closest('[data-tut-edit]');
    if (te) {
      var tut = state.tutoriais.find(function (row) { return String(row.id) === te.getAttribute('data-tut-edit'); });
      state.editing = { type: 'tut', id: tut.id };
      openModal('Editar tutorial', tutForm(tut));
      return;
    }
    var tt = event.target.closest('[data-tut-toggle]');
    if (tt) { await request('/api/admin/tutoriais/' + tt.getAttribute('data-tut-toggle') + '/toggle', { method: 'POST' }); loadTuts(); }
    var td = event.target.closest('[data-tut-del]');
    if (td && confirm('Excluir este tutorial?')) {
      await request('/api/admin/tutoriais/' + td.getAttribute('data-tut-del'), { method: 'DELETE' });
      loadTuts();
    }
    var iv = event.target.closest('[data-ind-view]');
    if (iv) {
      var det = await request('/api/admin/indicacoes/' + iv.getAttribute('data-ind-view'));
      showInd(det.indicacao);
    }
  });

  document.addEventListener('change', async function (event) {
    var st = event.target.closest('[data-ind-status]');
    if (!st) return;
    await request('/api/admin/indicacoes/' + st.getAttribute('data-ind-status') + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: st.value }),
    });
    loadInds();
  });

  document.getElementById('ind-q').addEventListener('input', function () { loadInds(); });
  document.getElementById('ind-status').addEventListener('change', function () { loadInds(); });

  document.getElementById('admin-modal-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var data = formData(event.target);
    var errBox = event.target.querySelector('#admin-form-error');
    if (errBox) {
      errBox.classList.add('hidden');
      errBox.textContent = '';
    }
    var ativoEl = event.target.querySelector('[name="ativo"]');
    data.ativo = !!(ativoEl && ativoEl.checked);
    try {
      if (state.editing.type === 'aviso') {
        data.recorrente = event.target.querySelector('[name="recorrente"]').checked;
        if (data.dia_recorrente === '') data.dia_recorrente = null;
        if (state.editing.id) await request('/api/admin/avisos/' + state.editing.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        else await request('/api/admin/avisos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        closeModal();
        loadAvisos();
      } else if (state.editing.type === 'tut') {
        data.ordem = Number(data.ordem || 0);
        if (!data.categoria) throw new Error('Selecione o tipo/categoria do tutorial.');
        if (state.editing.id) await request('/api/admin/tutoriais/' + state.editing.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        else await request('/api/admin/tutoriais', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        closeModal();
        loadTuts();
      }
    } catch (err) {
      var msg = err.message || 'Não foi possível salvar.';
      if (err.details) {
        var parts = Object.keys(err.details).map(function (k) { return err.details[k]; });
        if (parts.length) msg = parts.join(' ');
      }
      if (errBox) {
        errBox.textContent = msg;
        errBox.classList.remove('hidden');
      } else {
        window.alert(msg);
      }
    }
  });

  document.addEventListener('submit', async function (event) {
    var form = event.target.closest('.contato-form');
    if (!form) return;
    event.preventDefault();
    var data = formData(form);
    await request('/api/admin/contatos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    loadContatos();
  });

  boot();
})();
