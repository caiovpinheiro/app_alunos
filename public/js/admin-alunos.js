/* Admin · Dados de acesso à faculdade (aba "Alunos"): o polo sobe curso + RGM + e-mail acadêmico
   (opcional), colando do Excel / CSV ou um a um, e busca/corrige por RGM, nome ou e-mail.
   Cria o próprio bloco antes de #admin-alunos-preparo; rotas em server/dadosAcesso.js. */
window.AdminAlunos = (function () {
  'use strict';

  var TOKEN_KEY = 'csu_admin_token';
  var INPUT = 'w-full px-3 py-2 rounded-lg border text-sm';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var root = null;
  var linhasOk = [];
  var timerBusca = null;

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
    if (!res.ok) throw new Error((data && data.message) || 'Não foi possível concluir.');
    return data;
  }

  // ---------- leitura da planilha ----------
  function separador(texto) {
    var l = texto.split(/\r?\n/).filter(function (x) { return x.trim(); })[0] || '';
    if (l.indexOf('\t') !== -1) return '\t';
    return (l.split(';').length >= l.split(',').length) ? ';' : ',';
  }

  function celulas(linha, sep) {
    var out = []; var cur = ''; var q = false;
    for (var i = 0; i < linha.length; i++) {
      var c = linha[i];
      if (q) {
        if (c === '"' && linha[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
      } else if (c === '"') q = true;
      else if (c === sep) { out.push(cur.trim()); cur = ''; } else cur += c;
    }
    out.push(cur.trim());
    return out;
  }

  function semAcento(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  // Cabeçalho opcional. Com cabeçalho: colunas pelo nome. Sem: cada célula pelo jeito
  // (tem @ = e-mail; só números = RGM; o resto = curso), em qualquer ordem.
  function interpretar(texto) {
    var sep = separador(texto);
    var brutas = texto.split(/\r?\n/).map(function (l, i) { return { n: i + 1, c: celulas(l, sep) }; })
      .filter(function (x) { return x.c.some(Boolean); });
    if (!brutas.length) return [];
    var cab = brutas[0].c.map(semAcento);
    var idx = { rgm: -1, curso: -1, email: -1 };
    cab.forEach(function (h, i) {
      if (/rgm|matricula/.test(h) && idx.rgm < 0) idx.rgm = i;
      else if (/mail/.test(h) && idx.email < 0) idx.email = i;
      else if (/curso/.test(h) && idx.curso < 0) idx.curso = i;
    });
    var temCab = idx.rgm >= 0;
    if (temCab) brutas.shift();
    return brutas.map(function (x) {
      var l = { n: x.n, rgm: '', curso: '', email_academico: '' };
      if (temCab) {
        l.rgm = x.c[idx.rgm] || '';
        l.curso = idx.curso >= 0 ? (x.c[idx.curso] || '') : '';
        l.email_academico = idx.email >= 0 ? (x.c[idx.email] || '') : '';
      } else {
        x.c.forEach(function (v) {
          if (!v) return;
          if (v.indexOf('@') !== -1 && !l.email_academico) l.email_academico = v;
          else if (/^[\d.\-\s]+$/.test(v) && !l.rgm) l.rgm = v;
          else if (!l.curso) l.curso = v;
        });
      }
      return l;
    });
  }

  function validar(l) {
    var rgm = String(l.rgm || '').replace(/\D+/g, '');
    var email = String(l.email_academico || '').trim().toLowerCase();
    if (!rgm) return 'RGM vazio.';
    if (rgm.length < 4 || rgm.length > 15) return 'RGM deve ter de 4 a 15 números.';
    if (email && !EMAIL_RE.test(email)) return 'E-mail acadêmico inválido.';
    return '';
  }

  // ---------- telas ----------
  function shell() {
    return (
      '<section class="bg-white border rounded-xl p-4 sm:p-5 mb-6" aria-labelledby="dac-h">' +
        '<h2 id="dac-h" class="text-xl font-bold">Dados de acesso à faculdade</h2>' +
        '<p class="text-sm text-gray-500 mt-1 mb-4">Curso, RGM e e-mail acadêmico (opcional) de cada aluno. O aluno vê os próprios dados no Início, no módulo 1 da Aula Inaugural e na Central de ajuda, para fazer o primeiro acesso ao Duda e ao portal. Quem ainda não entrou no app recebe os dados quando entrar.</p>' +
        '<h3 class="font-bold mb-1">Importar planilha</h3>' +
        '<p class="text-xs text-gray-500 mb-2">Cole as colunas do Excel ou escolha um .csv. Colunas: <b>RGM</b> (obrigatório), <b>Curso</b> e <b>E-mail acadêmico</b>, em qualquer ordem, com ou sem cabeçalho. Célula vazia não apaga o que já está salvo.</p>' +
        '<textarea id="dac-texto" rows="5" class="' + INPUT + ' font-mono" placeholder="RGM;Curso;E-mail acadêmico&#10;12345678;Pedagogia;ana.souza@cs.cruzeirodosul.edu.br&#10;23456789;Administração;" aria-label="Linhas da planilha"></textarea>' +
        '<div class="flex flex-wrap items-center gap-3 mt-2">' +
          '<label class="text-sm font-semibold text-blue-700 underline cursor-pointer">Escolher arquivo .csv<input id="dac-arquivo" type="file" accept=".csv,.txt,text/csv,text/plain" class="sr-only"></label>' +
          '<button type="button" id="dac-conferir" class="border border-gray-300 text-sm font-semibold px-4 py-2 rounded-lg">Conferir</button>' +
          '<button type="button" id="dac-salvar" class="bg-cruzeiro text-white text-sm font-semibold px-4 py-2 rounded-lg hidden">Salvar</button>' +
          '<p id="dac-msg" class="text-sm" role="status" aria-live="polite"></p>' +
        '</div>' +
        '<div id="dac-previa" class="mt-3"></div>' +
        '<h3 class="font-bold mt-6 mb-2">Buscar aluno</h3>' +
        '<input id="dac-busca" type="search" class="' + INPUT + ' sm:max-w-md" placeholder="RGM, nome, curso ou e-mail" aria-label="Buscar por RGM, nome, curso ou e-mail" autocomplete="off">' +
        '<p id="dac-total" class="text-xs text-gray-500 mt-2"></p>' +
        '<div id="dac-lista" class="space-y-3 mt-2"></div>' +
      '</section>'
    );
  }

  function previa(linhas) {
    linhasOk = [];
    var erros = [];
    linhas.forEach(function (l) {
      var m = validar(l);
      if (m) erros.push({ n: l.n, rgm: l.rgm, motivo: m }); else linhasOk.push(l);
    });
    var box = root.querySelector('#dac-previa');
    var amostra = linhasOk.slice(0, 15).map(function (l) {
      return '<tr class="border-t"><td class="py-1 pr-3">' + esc(l.rgm) + '</td><td class="py-1 pr-3">' + (esc(l.curso) || '<span class="text-gray-400">—</span>') +
        '</td><td class="py-1 break-all">' + (esc(l.email_academico) || '<span class="text-gray-400">—</span>') + '</td></tr>';
    }).join('');
    box.innerHTML =
      '<p class="text-sm"><b>' + linhas.length + '</b> linhas · <b class="text-green-700">' + linhasOk.length + ' ok</b>' +
        (erros.length ? ' · <b class="text-red-700">' + erros.length + ' com erro</b> (não serão salvas)' : '') + '</p>' +
      (erros.length ? '<ul class="text-xs text-red-700 mt-1 list-disc pl-5">' + erros.slice(0, 20).map(function (e) {
        return '<li>Linha ' + e.n + (e.rgm ? ' (RGM ' + esc(e.rgm) + ')' : '') + ': ' + esc(e.motivo) + '</li>';
      }).join('') + (erros.length > 20 ? '<li>e mais ' + (erros.length - 20) + '…</li>' : '') + '</ul>' : '') +
      (amostra ? '<div class="overflow-x-auto mt-2"><table class="text-xs w-full"><thead><tr class="text-left text-gray-500"><th class="pr-3">RGM</th><th class="pr-3">Curso</th><th>E-mail acadêmico</th></tr></thead><tbody>' + amostra + '</tbody></table>' +
        (linhasOk.length > 15 ? '<p class="text-xs text-gray-500 mt-1">Mostrando 15 de ' + linhasOk.length + '.</p>' : '') + '</div>' : '');
    var salvar = root.querySelector('#dac-salvar');
    salvar.classList.toggle('hidden', !linhasOk.length);
    salvar.textContent = 'Salvar ' + linhasOk.length + (linhasOk.length === 1 ? ' linha' : ' linhas');
  }

  // Envia em lotes pequenos (o servidor aceita corpos de até 20 KB).
  function lotes(linhas) {
    var out = []; var atual = []; var tam = 0;
    linhas.forEach(function (l) {
      var t = JSON.stringify(l).length + 1;
      if (atual.length && (tam + t > 15000 || atual.length >= 200)) { out.push(atual); atual = []; tam = 0; }
      atual.push(l); tam += t;
    });
    if (atual.length) out.push(atual);
    return out;
  }

  async function salvar() {
    var msg = root.querySelector('#dac-msg');
    var btn = root.querySelector('#dac-salvar');
    var partes = lotes(linhasOk);
    var tot = { salvos: 0, com_acesso: 0, sem_acesso: 0, erros: [] };
    btn.disabled = true;
    msg.className = 'text-sm text-gray-600';
    try {
      for (var i = 0; i < partes.length; i++) {
        msg.textContent = 'Salvando… ' + (i + 1) + ' de ' + partes.length;
        var r = await api('POST', '/api/admin/dados-acesso/importar', { linhas: partes[i] });
        tot.salvos += r.salvos; tot.com_acesso += r.com_acesso; tot.sem_acesso += r.sem_acesso;
        tot.erros = tot.erros.concat(r.erros || []);
      }
      msg.className = 'text-sm text-green-700';
      msg.textContent = tot.salvos + ' salvos: ' + tot.com_acesso + ' já usam o app, ' + tot.sem_acesso +
        ' ainda não entraram (veem os dados quando entrarem).' + (tot.erros.length ? ' ' + tot.erros.length + ' recusados.' : '');
      btn.classList.add('hidden');
      root.querySelector('#dac-texto').value = '';
      root.querySelector('#dac-previa').innerHTML = '';
      linhasOk = [];
      buscar();
    } catch (err) {
      msg.className = 'text-sm text-red-600';
      msg.textContent = err.message + (tot.salvos ? ' (' + tot.salvos + ' já tinham sido salvos.)' : '');
    } finally {
      btn.disabled = false;
    }
  }

  function item(a) {
    var cursoApp = a.curso_app && a.curso_app !== a.curso ? '<span class="text-gray-400"> (relatório: ' + esc(a.curso_app) + ')</span>' : '';
    return (
      '<article class="border rounded-xl p-3 text-sm" data-dac-rgm="' + esc(a.rgm) + '">' +
        '<div class="flex flex-wrap justify-between gap-2"><div class="min-w-0">' +
          '<b>RGM ' + esc(a.rgm) + '</b>' + (a.nome ? ' · ' + esc(a.nome) : '') +
          '<p class="text-xs ' + (a.tem_acesso ? 'text-gray-500' : 'text-amber-700') + '">' + (a.tem_acesso ? 'Usa o app' : 'Ainda não entrou no app') + '</p>' +
        '</div></div>' +
        '<form class="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] items-end mt-2" data-dac-form novalidate>' +
          '<label class="text-xs font-medium text-gray-700">Curso' + cursoApp + '<input class="' + INPUT + ' mt-1" data-f="curso" value="' + esc(a.curso || '') + '" autocomplete="off"></label>' +
          '<label class="text-xs font-medium text-gray-700">E-mail acadêmico<input type="email" class="' + INPUT + ' mt-1" data-f="email_academico" value="' + esc(a.email_academico || '') + '" autocomplete="off"></label>' +
          '<button type="submit" class="bg-cruzeiro text-white text-xs font-semibold px-3 py-2 rounded-lg">Salvar</button>' +
        '</form>' +
        '<p class="text-xs mt-1" role="status" aria-live="polite" data-dac-st></p>' +
      '</article>'
    );
  }

  function totalTxt(total, termo) {
    root.querySelector('#dac-total').textContent = total + (total === 1 ? ' aluno com dados enviados pelo polo.' : ' alunos com dados enviados pelo polo.') +
      (termo ? '' : ' Abaixo, os últimos atualizados.');
  }

  async function buscar() {
    if (!root) return;
    var termo = root.querySelector('#dac-busca').value.trim();
    var lista = root.querySelector('#dac-lista');
    try {
      var r = await api('GET', '/api/admin/dados-acesso' + (termo ? '?busca=' + encodeURIComponent(termo) : ''));
      totalTxt(r.total, termo);
      lista.innerHTML = r.itens.length ? r.itens.map(item).join('')
        : '<p class="text-sm text-gray-500">' + (termo ? 'Nada encontrado. Para um RGM novo, use a importação acima (pode ser uma linha só).' : 'Nenhum dado enviado ainda.') + '</p>';
    } catch (err) {
      lista.innerHTML = '<p class="text-sm text-red-600">' + esc(err.message) + '</p>';
    }
  }

  async function salvarUm(form) {
    var card = form.closest('[data-dac-rgm]');
    var st = card.querySelector('[data-dac-st]');
    var body = { curso: form.querySelector('[data-f="curso"]').value, email_academico: form.querySelector('[data-f="email_academico"]').value };
    var m = validar({ rgm: card.dataset.dacRgm, email_academico: body.email_academico });
    if (m) { st.className = 'text-xs mt-1 text-red-600'; st.textContent = m; return; }
    try {
      await api('PUT', '/api/admin/dados-acesso/' + encodeURIComponent(card.dataset.dacRgm), body);
      st.className = 'text-xs mt-1 text-green-700';
      st.textContent = body.curso.trim() || body.email_academico.trim() ? 'Salvo.' : 'Dados apagados.';
      var termo = root.querySelector('#dac-busca').value.trim();
      api('GET', '/api/admin/dados-acesso' + (termo ? '?busca=' + encodeURIComponent(termo) : ''))
        .then(function (r) { totalTxt(r.total, termo); }).catch(function () { /* o total atualiza na próxima busca */ });
    } catch (err) {
      st.className = 'text-xs mt-1 text-red-600';
      st.textContent = err.message;
    }
  }

  function lerArquivo(file) {
    var msg = root.querySelector('#dac-msg');
    var ler = function (enc) {
      return new Promise(function (ok, erro) {
        var fr = new FileReader();
        fr.onload = function () { ok(String(fr.result || '')); };
        fr.onerror = erro;
        fr.readAsText(file, enc);
      });
    };
    ler('utf-8').then(function (t) { return t.indexOf('�') !== -1 ? ler('windows-1252') : t; }).then(function (t) {
      root.querySelector('#dac-texto').value = t.replace(/^﻿/, '');
      msg.textContent = '';
      previa(interpretar(root.querySelector('#dac-texto').value));
    }).catch(function () {
      msg.className = 'text-sm text-red-600';
      msg.textContent = 'Não foi possível ler o arquivo.';
    });
  }

  function montar() {
    var prep = document.getElementById('admin-alunos-preparo');
    var aba = document.getElementById('tab-alunos');
    if (!aba) return;
    root = document.createElement('div');
    root.id = 'admin-alunos-dados';
    root.innerHTML = shell();
    if (prep) aba.insertBefore(root, prep); else aba.appendChild(root);

    root.querySelector('#dac-conferir').addEventListener('click', function () {
      var t = root.querySelector('#dac-texto').value;
      root.querySelector('#dac-msg').textContent = t.trim() ? '' : 'Cole as linhas ou escolha um arquivo.';
      if (t.trim()) previa(interpretar(t));
    });
    root.querySelector('#dac-salvar').addEventListener('click', salvar);
    root.querySelector('#dac-arquivo').addEventListener('change', function (ev) {
      if (ev.target.files && ev.target.files[0]) lerArquivo(ev.target.files[0]);
      ev.target.value = '';
    });
    root.querySelector('#dac-busca').addEventListener('input', function () {
      clearTimeout(timerBusca);
      timerBusca = setTimeout(buscar, 300);
    });
    root.addEventListener('submit', function (ev) {
      if (!ev.target.matches('[data-dac-form]')) return;
      ev.preventDefault();
      salvarUm(ev.target);
    });
    // Carrega quando a aba fica visível (a troca de abas é do admin.js).
    document.addEventListener('click', function (ev) {
      if (!ev.target.closest('.admin-tab')) return;
      setTimeout(function () { if (root.offsetParent !== null) buscar(); }, 0);
    });
    if (root.offsetParent !== null) buscar();
  }

  document.addEventListener('DOMContentLoaded', montar);
  return { buscar: buscar, interpretar: interpretar };
})();
