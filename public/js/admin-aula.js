/* Admin › Aula Inaugural: blocos "Uso" (dashboard) e "Por aluno" (matriz aluno × módulo).
   Carregado por loadTrilha() em admin.js (window.AdminAula.load(resumo)); monta as seções nas sub-abas "Uso" e "Por aluno" de #tab-trilha.
   Dados: GET /api/admin/trilha/uso e GET /api/admin/trilha/alunos; CSV em /api/admin/trilha/alunos.csv. */
window.AdminAula = (function () {
  'use strict';

  var C = function () { return window.AdminCore; };
  var esc = function (t) { return C().escapeHtml(t); };
  var num = function (n) { return Number(n || 0).toLocaleString('pt-BR'); };
  var alunos = [];
  var totalModulos = 7;

  function card(rotulo, valor, dica) {
    return '<div class="bg-white border rounded-xl p-4"><p class="text-xs text-gray-500">' + esc(rotulo) + '</p><p class="text-2xl font-bold text-gray-800">' + esc(valor) + '</p>' +
      (dica ? '<p class="text-xs text-gray-500 mt-1">' + esc(dica) + '</p>' : '') + '</div>';
  }

  function montar() {
    if (document.getElementById('admin-aula-uso')) return;
    var tab = document.getElementById('tab-trilha');
    var msg = document.getElementById('trilha-msg');
    var uso = document.createElement('div');
    uso.id = 'admin-aula-uso';
    uso.innerHTML = '<h3 class="text-lg font-bold mb-1">Uso</h3><p id="admin-aula-uso-nota" class="text-sm text-gray-500 mb-2"></p>' +
      '<div id="admin-aula-uso-cards" class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4"></div>' +
      '<div class="grid lg:grid-cols-2 gap-6 mb-6">' +
      '<div><h4 class="font-bold mb-2">Vídeos mais vistos</h4><div class="overflow-x-auto bg-white border rounded-xl"><table class="w-full text-sm"><thead class="bg-slate-50 text-left"><tr><th class="px-3 py-2">Vídeo</th><th class="px-3 py-2">Alunos</th><th class="px-3 py-2">Terminaram</th><th class="px-3 py-2">👍 / 👎</th></tr></thead><tbody id="admin-aula-videos"></tbody></table></div></div>' +
      '<div><h4 class="font-bold mb-2">Joinha</h4><div id="admin-aula-joinha" class="bg-white border rounded-xl p-4 text-sm"></div></div></div>';
    var subUso = document.getElementById('trilha-sub-uso');
    if (subUso) subUso.appendChild(uso); else msg.parentNode.insertBefore(uso, msg.nextSibling);

    var por = document.createElement('div');
    por.id = 'admin-aula-por';
    por.innerHTML = '<div class="flex flex-wrap justify-between items-center gap-3 mb-1"><h3 class="text-lg font-bold">Por aluno</h3>' +
      '<div class="flex flex-wrap gap-2 items-center"><input id="admin-aula-busca" type="search" placeholder="Nome ou RGM" class="border rounded-lg px-3 py-2 text-sm">' +
      '<button type="button" id="admin-aula-csv" class="bg-white border text-sm font-semibold px-4 py-2 rounded-lg">CSV aluno × módulo</button></div></div>' +
      '<p class="text-sm text-gray-500 mb-2">Uma linha por aluno, uma coluna por módulo: o que fez e onde parou. O CSV traz uma linha por aluno × módulo (etapa, vídeo, acertos, erros, Travei, pontos, joinha, tempo), para o CRM cruzar sem precisar ler eventos.</p>' +
      '<p id="admin-aula-por-msg" class="text-sm text-gray-500 mb-2"></p>' +
      '<div class="overflow-x-auto bg-white border rounded-xl mb-2"><table class="w-full text-sm whitespace-nowrap"><thead id="admin-aula-por-head" class="bg-slate-50 text-left"></thead><tbody id="admin-aula-por-body"></tbody></table></div>' +
      '<p class="text-xs text-gray-500 mb-6">✔ concluído (pontos) · ▶ no vídeo (% visto) · ? respondendo (acertos/perguntas) · ○ abriu · — não abriu · ✋ tocou em Travei · 👎 avaliou mal · ⏱ minutos no módulo (só com rastreio).</p>';
    var subPor = document.getElementById('trilha-sub-por-aluno');
    (subPor || tab).appendChild(por);

    document.getElementById('admin-aula-busca').addEventListener('input', function () { renderPor(); });
    document.getElementById('admin-aula-csv').addEventListener('click', baixarCsv);
  }

  function renderUso(u, resumo) {
    var nota = document.getElementById('admin-aula-uso-nota');
    var ac = u.acessos;
    var vd = u.videos || {};
    var av = u.avaliacoes || {};
    var ot = (resumo && resumo.onde_trava) || null;
    var pior = ot && ot.modulos.length ? ot.modulos.reduce(function (m, x) { return x.atrito > m.atrito ? x : m; }, ot.modulos[0]) : null;
    nota.textContent = 'Tempo ativo e vídeos vêm do rastreio' + (vd.rastreados ? ' (' + num(vd.rastreados) + ' aluno(s) rastreado(s)' + (vd.videos_sem_duracao ? '; ' + vd.videos_sem_duracao + ' vídeo(s) sem duração conhecida só contam play' : '') + ')' : ' (ainda ninguém rastreado)') +
      '. Minutos de vídeo = % assistido × duração. Joinha vale para todos os alunos.';
    document.getElementById('admin-aula-uso-cards').innerHTML =
      card('Tempo ativo por aluno', ac ? num(ac.tempo_ativo_medio_min) + ' min' : '—', ac ? num(ac.alunos) + ' aluno(s) · ' + num(ac.acessos_por_aluno) + ' acessos cada · ' + num(ac.tempo_medio_por_acesso_min) + ' min por acesso' : 'sem acessos rastreados') +
      card('Vídeo assistido por aluno', vd.rastreados ? num(vd.minutos_por_aluno) + ' min' : '—', vd.rastreados ? num(vd.minutos_assistidos_total) + ' min no total · ' + num(vd.plays) + ' plays' : '') +
      card('Vídeos vistos até o fim', vd.plays ? vd.pct_conclusao + '%' : '—', vd.plays ? num(vd.terminados) + ' de ' + num(vd.plays) + ' plays' : '') +
      card('Índice 👍', av.total ? av.pct_positivo + '%' : '—', av.total ? num(av.positivos) + ' 👍 · ' + num(av.negativos) + ' 👎' : 'sem votos') +
      card('Onde mais travam', pior && pior.atrito ? 'Módulo ' + pior.modulo : '—', pior && pior.atrito ? pior.titulo + ' · atrito ' + pior.atrito : 'sem sinais de atrito');
    document.getElementById('admin-aula-videos').innerHTML = (vd.top || []).length
      ? vd.top.map(function (v) {
        return '<tr class="border-t"><td class="px-3 py-2">' + esc(v.titulo) + (v.duracao_s ? ' <span class="text-gray-500">· ' + Math.floor(v.duracao_s / 60) + ':' + String(v.duracao_s % 60).padStart(2, '0') + '</span>' : '') + '</td>' +
          '<td class="px-3 py-2">' + v.alunos + '</td><td class="px-3 py-2">' + v.terminaram + ' <span class="text-gray-500">(' + (v.pct_conclusao == null ? '—' : v.pct_conclusao + '%') + ' · média ' + v.pct_medio_assistido + '% visto)</span></td>' +
          '<td class="px-3 py-2">' + v.positivos + ' / ' + v.negativos + '</td></tr>';
      }).join('')
      : '<tr><td class="px-3 py-2 text-gray-500" colspan="4">Sem plays rastreados ainda.</td></tr>';
    var TIPOS = { video: 'Vídeos', faq: 'Perguntas da Central', aula: 'Aula Inaugural (módulos e abertura)' };
    document.getElementById('admin-aula-joinha').innerHTML = av.total
      ? '<ul class="space-y-1">' + av.por_tipo.map(function (t) {
        return '<li class="flex justify-between gap-3"><span>' + esc(TIPOS[t.tipo] || t.tipo) + '</span><b>' + (t.pct_positivo == null ? '—' : t.pct_positivo + '% 👍') + ' <span class="font-normal text-gray-500">(' + t.positivos + ' / ' + t.negativos + ')</span></b></li>';
      }).join('') + '</ul>' +
        (av.piores.length ? '<p class="font-semibold mt-3 mb-1">Mais 👎</p><ol class="space-y-1">' + av.piores.map(function (p) {
          return '<li><b>' + p.negativos + ' 👎</b> · ' + esc(p.titulo) + ' <span class="text-gray-500">(' + p.positivos + ' 👍)</span></li>';
        }).join('') + '</ol>' : '<p class="text-gray-500 mt-3">Nenhum 👎 até agora.</p>')
      : '<p class="text-gray-500">Ninguém avaliou ainda.</p>';
  }

  function celula(m) {
    var extra = (m.travei ? ' ✋' : '') + (m.avaliacao < 0 ? ' 👎' : '') + (m.tempo_min != null ? ' <span class="text-gray-400">⏱' + m.tempo_min + '</span>' : '');
    if (m.etapa === 'concluido') return '<td class="px-2 py-2 bg-green-50 text-green-800">✔ ' + m.pontos + extra + '</td>';
    if (m.etapa === 'perguntas') return '<td class="px-2 py-2 bg-amber-50 text-amber-800">? ' + m.acertos + '/' + m.perguntas + (m.erros ? ' <span class="text-red-600">' + m.erros + 'x</span>' : '') + extra + '</td>';
    if (m.etapa === 'video') return '<td class="px-2 py-2 bg-amber-50 text-amber-800">▶ ' + (m.video_pulou ? 'pulou' : m.video_pct + '%') + extra + '</td>';
    if (m.etapa === 'abriu') return '<td class="px-2 py-2 bg-slate-50 text-gray-600">○' + extra + '</td>';
    return '<td class="px-2 py-2 text-gray-400">—</td>';
  }

  function renderPor() {
    var termo = (document.getElementById('admin-aula-busca').value || '').trim().toLowerCase();
    var head = '<tr><th class="px-3 py-2">Aluno</th><th class="px-2 py-2">Pontos</th><th class="px-2 py-2">Cert.</th>';
    for (var i = 1; i <= totalModulos; i++) head += '<th class="px-2 py-2">M' + i + '</th>';
    head += '<th class="px-2 py-2">Último acesso</th></tr>';
    document.getElementById('admin-aula-por-head').innerHTML = head;
    var lista = alunos.filter(function (a) { return !termo || a.nome.toLowerCase().indexOf(termo) > -1 || String(a.rgm).indexOf(termo) > -1; });
    document.getElementById('admin-aula-por-body').innerHTML = lista.length
      ? lista.map(function (a) {
        var cert = a.certificado_emitido ? '<span class="text-green-700">emitido</span>' : a.certificado_liberado ? '<span class="text-amber-700">liberado</span>' : '<span class="text-gray-400">—</span>';
        return '<tr class="border-t"><td class="px-3 py-2"><b>' + esc(a.nome) + '</b><br><span class="text-gray-500">RGM ' + esc(a.rgm) + '</span></td>' +
          '<td class="px-2 py-2">' + num(a.pontos) + '<br><span class="text-gray-500">' + a.concluidos + '/' + totalModulos + '</span></td><td class="px-2 py-2">' + cert + '</td>' +
          a.modulos.map(celula).join('') +
          '<td class="px-2 py-2 text-gray-500">' + (a.ultimo_acesso ? new Date(a.ultimo_acesso).toLocaleDateString('pt-BR') : '—') + (a.parou_em ? '<br>parou no M' + a.parou_em : '') + '</td></tr>';
      }).join('')
      : '<tr><td class="px-3 py-2 text-gray-500" colspan="' + (totalModulos + 4) + '">' + (alunos.length ? 'Nenhum aluno com esse nome ou RGM.' : 'Ninguém começou a Aula Inaugural ainda.') + '</td></tr>';
  }

  async function baixarCsv() {
    var msg = document.getElementById('admin-aula-por-msg');
    msg.textContent = 'Gerando CSV...';
    try {
      var res = await fetch('/api/admin/trilha/alunos.csv', { headers: C().token() ? { Authorization: 'Bearer ' + C().token() } : {} });
      if (res.status === 401) { C().showLogin(); throw new Error('Sessão expirada.'); }
      if (!res.ok) throw new Error('Não foi possível exportar o CSV.');
      var url = URL.createObjectURL(await res.blob());
      var link = document.createElement('a'); link.href = url; link.download = 'aula-inaugural-por-aluno-modulo.csv';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      msg.textContent = 'CSV baixado.';
    } catch (err) {
      msg.textContent = err.message || 'Não foi possível exportar o CSV.';
    }
  }

  async function load(resumo) {
    montar();
    var msg = document.getElementById('admin-aula-por-msg');
    msg.textContent = 'Carregando...';
    try {
      var r = await Promise.all([C().request('/api/admin/trilha/uso'), C().request('/api/admin/trilha/alunos')]);
      renderUso(r[0], resumo);
      alunos = r[1].alunos || [];
      totalModulos = r[1].total_modulos || 7;
      renderPor();
      msg.textContent = '';
    } catch (err) {
      msg.textContent = err.message || 'Não foi possível carregar.';
    }
  }

  return { load: load };
})();
