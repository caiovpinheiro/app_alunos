/* Admin › Avaliações dos conteúdos: placar de joinha (👍/👎) por vídeo, pergunta e capítulo.
   Mais negativos primeiro, para saber o que precisa ser refeito.
   Autocontido: cria a própria aba e o painel (não depende de mudanças no admin.html/admin.js além do <script>). */
window.AdminAvaliacoes = (function () {
  'use strict';

  var C = function () { return window.AdminCore; };
  var esc = function (t) { return C().escapeHtml(t); };
  var itens = null;
  var TIPOS = { video: 'Vídeo', faq: 'Pergunta', aula: 'Aula Inaugural' };

  function quando(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function card(rotulo, valor, dica) {
    return '<div class="bg-white border rounded-xl p-4"><p class="text-xs text-gray-500">' + esc(rotulo) + '</p><p class="text-2xl font-bold text-gray-800">' + esc(valor) + '</p>' +
      (dica ? '<p class="text-xs text-gray-400 mt-1">' + esc(dica) + '</p>' : '') + '</div>';
  }

  function montarPainel() {
    // O botão e o painel ficam no admin.html (grupo "Acompanhar"); o admin.js troca de aba e chama load().
    var painel = document.getElementById('tab-avaliacoes');
    if (!painel || document.getElementById('aval-lista')) return false;
    painel.innerHTML =
      '<div class="admin-panel-head flex flex-wrap justify-between items-start gap-3"><div>' +
        '<h2 class="text-xl font-bold">Avaliações dos conteúdos</h2>' +
        '<p class="admin-panel-desc">Joinha que os alunos deram nos vídeos, perguntas frequentes e capítulos da Aula Inaugural. Os com mais 👎 aparecem primeiro: são os candidatos a refazer. Cada aluno vale um voto por conteúdo. Quem dá 👎 pode escrever o que não ficou bom: abra "comentários" na linha do conteúdo.</p></div>' +
        '<button type="button" id="btn-aval-atualizar" class="bg-white border text-sm font-semibold px-4 py-2 rounded-lg">Atualizar</button>' +
      '</div>' +
      '<div class="flex flex-wrap items-end gap-3 mb-4 text-sm">' +
        '<label class="flex flex-col gap-1">Tipo' +
          '<select id="aval-tipo" class="border rounded-lg px-3 py-2 bg-white">' +
            '<option value="">Todos</option><option value="video">Vídeos</option><option value="faq">Perguntas frequentes</option><option value="aula">Aula Inaugural</option>' +
          '</select></label>' +
        '<label class="flex items-center gap-2 pb-2"><input type="checkbox" id="aval-so-negativos"> Só os com mais 👎 que 👍</label>' +
      '</div>' +
      '<p id="aval-msg" class="text-sm text-gray-500 mb-3" role="status"></p>' +
      '<div id="aval-totais" class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6"></div>' +
      '<div class="overflow-x-auto bg-white border rounded-xl"><table class="w-full text-sm">' +
        '<thead class="bg-slate-50 text-left"><tr>' +
          '<th class="px-3 py-2">Conteúdo</th>' +
          '<th class="px-3 py-2 text-right" title="Gostaram">👍</th>' +
          '<th class="px-3 py-2 text-right" title="Não gostaram">👎</th>' +
          '<th class="px-3 py-2">% positivo</th>' +
          '<th class="px-3 py-2">Último voto</th>' +
        '</tr></thead>' +
        '<tbody id="aval-lista"></tbody>' +
      '</table></div>';
    document.getElementById('btn-aval-atualizar').addEventListener('click', load);
    document.getElementById('aval-tipo').addEventListener('change', render);
    document.getElementById('aval-so-negativos').addEventListener('change', render);
    return true;
  }

  function barra(pct) {
    var cor = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-400' : 'bg-red-500';
    return '<div class="flex items-center gap-2"><div class="w-24 h-2 rounded-full bg-slate-100 overflow-hidden"><div class="h-2 ' + cor + '" style="width:' + pct + '%"></div></div>' +
      '<span class="font-semibold tabular-nums">' + pct + '%</span></div>';
  }

  // Comentários dos 👎 ("o que não ficou bom"), sem identificar o aluno.
  function comentariosHtml(x) {
    var lista = x.comentarios || [];
    if (!lista.length) return '';
    return '<details class="mt-2"><summary class="text-xs font-semibold text-blue-700 cursor-pointer">💬 ' + lista.length + ' comentário(s) de quem não gostou</summary>' +
      '<ul class="mt-2 space-y-2">' + lista.map(function (c) {
        return '<li class="text-sm text-gray-700 bg-slate-50 border rounded-lg px-3 py-2"><p class="whitespace-pre-line">' + esc(c.texto) + '</p>' +
          '<p class="text-xs text-gray-400 mt-1">' + esc(quando(c.em)) + '</p></li>';
      }).join('') + '</ul></details>';
  }

  function linha(x) {
    var ruim = x.negativos > x.positivos;
    return '<tr class="border-t' + (ruim ? ' bg-red-50' : '') + '">' +
      '<td class="px-3 py-2"><p class="font-semibold text-gray-800">' + esc(x.titulo) + '</p>' +
        '<p class="text-xs text-gray-500">' + esc(TIPOS[x.tipo] || x.tipo) + ' · <code>' + esc(x.id) + '</code> · ' + x.total + ' voto(s)</p>' + comentariosHtml(x) + '</td>' +
      '<td class="px-3 py-2 text-right tabular-nums">' + x.positivos + '</td>' +
      '<td class="px-3 py-2 text-right tabular-nums' + (x.negativos ? ' font-semibold text-red-700' : '') + '">' + x.negativos + '</td>' +
      '<td class="px-3 py-2">' + barra(x.pct_positivo) + '</td>' +
      '<td class="px-3 py-2 whitespace-nowrap text-gray-600">' + esc(quando(x.ultimo_voto_em)) + '</td>' +
    '</tr>';
  }

  function render() {
    if (!itens) return;
    var tipo = document.getElementById('aval-tipo').value;
    var soNeg = document.getElementById('aval-so-negativos').checked;
    var lista = itens.filter(function (x) { return (!tipo || x.tipo === tipo) && (!soNeg || x.negativos > x.positivos); });

    var pos = 0; var neg = 0;
    lista.forEach(function (x) { pos += x.positivos; neg += x.negativos; });
    var tot = pos + neg;
    document.getElementById('aval-totais').innerHTML =
      card('Conteúdos avaliados', lista.length, tipo ? TIPOS[tipo] : 'todos os tipos') +
      card('Votos', tot, pos + ' 👍 · ' + neg + ' 👎') +
      card('Aprovação geral', tot ? Math.round(pos / tot * 100) + '%' : '—', 'dos votos são 👍') +
      card('Para revisar', lista.filter(function (x) { return x.negativos > x.positivos; }).length, 'mais 👎 que 👍');

    document.getElementById('aval-lista').innerHTML = lista.length
      ? lista.map(linha).join('')
      : '<tr><td colspan="5" class="px-3 py-6 text-center text-gray-500">' + (itens.length ? 'Nada nesse filtro.' : 'Ainda não há avaliações.') + '</td></tr>';
    document.getElementById('aval-msg').textContent = lista.length + ' conteúdo(s).';
  }

  async function load() {
    montarPainel(); // a aba pode abrir (pelo endereço #avaliacoes) antes do DOMContentLoaded
    var msg = document.getElementById('aval-msg');
    if (!msg) return;
    msg.textContent = 'Carregando...';
    try {
      var r = await C().request('/api/admin/avaliacoes');
      itens = (r && r.itens) || [];
      render();
    } catch (err) {
      msg.textContent = err.message || 'Não foi possível carregar.';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarPainel);
  else montarPainel();

  return { load: load };
})();
