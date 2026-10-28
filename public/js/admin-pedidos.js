/* Admin › Quem contatar: pedidos de ajuda (Travei / dificuldade) no topo, com protocolo, onde o aluno
   travou, o contexto completo e as ações (WhatsApp, Ver percurso, Em atendimento, Resolvido).
   Dados de GET /api/admin/pedidos. Link direto para o percurso: /admin#acompanhamento/aluno/{id}. */
window.AdminPedidos = (function () {
  'use strict';

  var C = function () { return window.AdminCore; };
  var esc = function (t) { return C().escapeHtml(t); };
  var mostrarTodos = false;
  var SITUACAO = { aberto: 'Aberto', em_atendimento: 'Em atendimento', resolvido: 'Resolvido', cancelado: 'Cancelado' };

  function haQuanto(iso) {
    var min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.round(min / 60);
    return h < 24 ? 'há ' + h + ' h' : 'há ' + Math.round(h / 24) + ' dia(s)';
  }

  function linha(p) {
    var wa = p.whatsapp_url ? '<a class="ac-wa" target="_blank" rel="noopener noreferrer" href="' + esc(p.whatsapp_url) + '?text=' +
      encodeURIComponent('Oi, ' + String(p.nome || '').split(' ')[0] + '! Aqui é da equipe do seu polo. Vi o seu pedido ' + p.protocolo + '. Vamos resolver juntos?') + '">Responder no WhatsApp</a>' : '';
    var acoes = p.situacao === 'aberto'
      ? '<button type="button" class="bg-white border font-semibold px-3 py-2 rounded-lg" data-ped-sit="em_atendimento" data-ped="' + p.id + '">Marcar em atendimento</button>'
      : '';
    if (p.situacao === 'aberto' || p.situacao === 'em_atendimento') acoes += '<button type="button" class="bg-white border font-semibold px-3 py-2 rounded-lg" data-ped-sit="resolvido" data-ped="' + p.id + '">Resolvido</button>';
    return (
      '<article class="ped ped--' + esc(p.situacao) + '">' +
        '<div class="ped-top">' +
          '<div><p class="ped-k"><b>' + esc(p.protocolo) + '</b> · ' + esc(haQuanto(p.criado_em)) + ' · <span class="ped-sit">' + esc(SITUACAO[p.situacao] || p.situacao) + '</span>' +
            (p.crm_enviado ? ' · <span class="ped-crm">enviado ao CRM</span>' : '') + '</p>' +
          '<h4>' + esc(p.nome) + ' <span>' + (p.rgm ? 'RGM ' + esc(p.rgm) : esc(p.email || '')) + '</span></h4>' +
          '<p class="ped-motivo">' + esc(p.motivo) + ', ' + esc(p.onde) + '</p></div>' +
        '</div>' +
        '<details class="ped-nota"><summary>O que a equipe precisa saber</summary><pre>' + esc(p.nota) + '</pre></details>' +
        '<div class="ac-acts">' + wa +
          '<button type="button" class="bg-white border font-semibold px-3 py-2 rounded-lg" data-acomp-percurso="' + p.aluno_id + '">Ver percurso</button>' + acoes +
        '</div>' +
      '</article>'
    );
  }

  async function load() {
    var box = document.getElementById('acomp-pedidos');
    if (!box) return;
    try {
      var r = await C().request('/api/admin/pedidos?situacao=' + (mostrarTodos ? 'todos' : 'abertos'));
      var abertos = r.pedidos.filter(function (p) { return p.situacao === 'aberto'; }).length;
      box.hidden = !r.pedidos.length && !mostrarTodos;
      box.innerHTML =
        '<div class="ped-head"><h3>Pedidos de ajuda' + (abertos ? ' <span class="ped-n">' + abertos + ' aberto(s)</span>' : '') + '</h3>' +
          '<button type="button" class="pn-ir" data-ped-todos>' + (mostrarTodos ? 'Só os abertos' : 'Ver também os resolvidos') + '</button></div>' +
        '<p class="pn-sub">O aluno tocou em "Travei" ou teve dificuldade e pediu para falar com a equipe. Responda pelo protocolo.</p>' +
        (r.pedidos.length ? '<div class="ped-lista">' + r.pedidos.map(linha).join('') + '</div>' : '<p class="pn-vazio">Nenhum pedido.</p>');
    } catch (err) {
      box.hidden = false;
      box.innerHTML = '<p class="text-sm text-red-700">' + esc(err.message || 'Não foi possível carregar os pedidos de ajuda.') + '</p>';
    }
  }

  async function mudar(id, situacao, btn) {
    btn.disabled = true;
    try {
      await C().request('/api/admin/pedidos/' + id + '/situacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ situacao: situacao }) });
      await load();
    } catch (err) {
      btn.disabled = false;
      window.alert(err.message || 'Não foi possível salvar.');
    }
  }

  // /admin#acompanhamento/aluno/123 abre o percurso desse aluno (link que vai na nota do pedido).
  function abrirDoEndereco() {
    var m = /^#acompanhamento\/aluno\/(\d+)/.exec(location.hash || '');
    if (m && window.AdminAcomp && window.AdminAcomp.percurso) window.AdminAcomp.percurso(m[1]);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var box = document.getElementById('acomp-pedidos');
    if (!box) return;
    box.addEventListener('click', function (e) {
      if (e.target.closest('[data-ped-todos]')) { mostrarTodos = !mostrarTodos; load(); return; }
      var b = e.target.closest('[data-ped-sit]');
      if (b) { mudar(b.getAttribute('data-ped'), b.getAttribute('data-ped-sit'), b); return; }
      var pc = e.target.closest('[data-acomp-percurso]');
      if (pc && window.AdminAcomp && window.AdminAcomp.percurso) window.AdminAcomp.percurso(pc.getAttribute('data-acomp-percurso'));
    });
  });

  return { load: load, abrirDoEndereco: abrirDoEndereco };
})();
