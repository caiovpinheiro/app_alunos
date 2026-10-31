/* Admin › Grupos de estudo: fila de moderação (docs/grupo-estudo.md §4).
   Dados de GET /api/admin/grupos/fila: retidas (e bloqueios graves que pedem decisão), denunciadas,
   bloqueadas recentes (auditoria de falso positivo) e publicadas sem IA (o classificador falhou).
   Ações: POST /api/admin/grupos/mensagens/:id/acao. Tudo fica registrado em csu_eventos.
   O botão do menu só aparece quando a API responde (GRUPO_ESTUDO_ATIVA_PARA ligada). */
window.AdminGrupos = (function () {
  'use strict';

  var C = function () { return window.AdminCore; };
  var esc = function (t) { return C().escapeHtml(t == null ? '' : String(t)); };
  var CAT = {
    ok: 'OK', fora_de_tema: 'Fora de tema', fraude_academica: 'Fraude acadêmica', assedio: 'Assédio/ofensa',
    odio: 'Ódio/preconceito', dados_pessoais: 'Dados pessoais', spam: 'Spam/link',
  };
  var QUEM = { regra: 'regra automática', stub: 'moderador (stub)', anthropic: 'moderador IA', fallback: 'sem IA (falha)', seed: 'seed', teste: 'teste' };
  var motivosDenuncia = {};

  function quando(iso) {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function botao(id, acao, rotulo, extra) {
    return '<button type="button" class="bg-white border font-semibold px-3 py-2 rounded-lg" data-gr-acao="' + acao + '" data-gr-id="' + id + '"' + (extra || '') + '>' + rotulo + '</button>';
  }

  function cartao(m, tipo) {
    var den = (m.denuncias_abertas || []).map(function (d) { return motivosDenuncia[d.motivo] || d.motivo; });
    var acoes = '';
    if (tipo === 'pendente') {
      acoes = botao(m.id, 'publicar', 'Publicar') +
        botao(m.id, m.status === 'bloqueada' ? 'manter_bloqueada' : 'remover', m.status === 'bloqueada' ? 'Manter bloqueada' : 'Remover');
    } else if (tipo === 'denunciada') {
      acoes = botao(m.id, 'descartar_denuncias', 'Manter publicada') + botao(m.id, 'remover', 'Remover');
    } else if (tipo === 'bloqueada') {
      acoes = botao(m.id, 'publicar', 'Publicar mesmo assim');
    } else if (tipo === 'sem_ia') {
      acoes = botao(m.id, 'conferida', 'Conferida') + botao(m.id, 'remover', 'Remover');
    }
    var silenciado = m.silenciado_ate && new Date(m.silenciado_ate) > new Date();
    acoes += silenciado
      ? '<span class="gr-sil">Autor silenciado até ' + esc(quando(m.silenciado_ate)) + '</span>'
      : botao(m.id, 'silenciar', 'Silenciar 24 h', ' data-gr-horas="24"') + botao(m.id, 'silenciar', 'Silenciar 7 dias', ' data-gr-horas="168"');
    return '<article class="gr-item gr-item--' + esc(m.status) + '">' +
      '<p class="gr-meta"><b>' + esc(CAT[m.categoria] || m.categoria) + '</b>' +
        (m.confianca ? ' · confiança ' + esc(m.confianca) : '') +
        ' · ' + esc(QUEM[m.moderador] || m.moderador) + ' · ' + esc(quando(m.criado_em)) +
        ' · <span class="gr-status">' + esc(m.status) + '</span></p>' +
      '<blockquote class="gr-texto">' + esc(m.texto) + '</blockquote>' +
      (m.motivo ? '<p class="gr-motivo">Motivo: ' + esc(m.motivo) + '</p>' : '') +
      (den.length ? '<p class="gr-den">' + den.length + ' denúncia(s): ' + esc(den.join(', ')) + '</p>' : '') +
      '<p class="gr-autor">' + esc(m.nome) + (m.rgm ? ' · RGM ' + esc(m.rgm) : '') + ' · ' + esc(m.grupo) + '</p>' +
      '<div class="ac-acts">' + acoes + '</div>' +
    '</article>';
  }

  function secao(titulo, sub, itens, tipo, vazio) {
    return '<section class="gr-sec"><h3>' + titulo + (itens.length ? ' <span class="ped-n">' + itens.length + '</span>' : '') + '</h3>' +
      '<p class="pn-sub">' + sub + '</p>' +
      (itens.length ? '<div class="gr-lista">' + itens.map(function (m) { return cartao(m, tipo); }).join('') + '</div>' : '<p class="pn-vazio">' + vazio + '</p>') +
    '</section>';
  }

  async function load() {
    var box = document.getElementById('tab-grupos');
    if (!box) return;
    box.innerHTML = '<p class="pn-sub">Carregando a fila…</p>';
    try {
      var r = await C().request('/api/admin/grupos/fila');
      motivosDenuncia = r.motivos_denuncia || {};
      var s = r.resumo || {};
      box.innerHTML =
        '<div class="gr-topo"><div><h2 class="text-2xl font-bold">Grupos de estudo</h2>' +
          '<p class="pn-sub">Toda mensagem passa pelo moderador antes de aparecer. Aqui ficam as que precisam de uma pessoa. ' +
          esc(s.grupos || 0) + ' grupo(s) · ' + esc(s.mensagens_7d || 0) + ' mensagem(ns) em 7 dias · ' + esc(s.bloqueadas_7d || 0) + ' bloqueada(s).</p></div>' +
          '<p class="gr-prov">Classificador: <b>' + esc(r.provedor) + '</b>' + (r.provedor_aviso ? ' · ' + esc(r.provedor_aviso) : '') + '</p></div>' +
        secao('Precisa de decisão', 'Retidas pelo moderador ou por 3 denúncias, e bloqueios graves (ódio, assédio). O aluno vê "em análise" ou "não publicada".', r.pendentes, 'pendente', 'Nada esperando decisão.') +
        secao('Denunciadas', 'Publicadas que algum aluno denunciou. Com 3 denúncias, saem do ar sozinhas e sobem para "Precisa de decisão".', r.denunciadas, 'denunciada', 'Nenhuma denúncia aberta.') +
        secao('Publicadas sem IA', 'O classificador falhou e a mensagem não tinha nenhum sinal suspeito. Confira se está tudo certo.', r.sem_ia, 'sem_ia', 'Nenhuma.') +
        secao('Bloqueadas nos últimos 7 dias', 'O que o robô barrou: confira se há falso positivo. O autor viu a explicação.', r.bloqueadas, 'bloqueada', 'Nenhum bloqueio recente.');
    } catch (err) {
      box.innerHTML = '<p class="text-sm text-red-700">' + esc(err.message || 'Não foi possível carregar a fila.') + '</p>';
    }
  }

  async function agir(btn) {
    var acao = btn.getAttribute('data-gr-acao');
    var corpo = { acao: acao };
    if (acao === 'silenciar') {
      corpo.horas = Number(btn.getAttribute('data-gr-horas')) || 24;
      corpo.remover = window.confirm('Remover também esta mensagem do grupo?');
    }
    if (acao === 'remover' && !window.confirm('Remover esta mensagem do grupo? O autor verá que a equipe removeu.')) return;
    btn.disabled = true;
    try {
      await C().request('/api/admin/grupos/mensagens/' + btn.getAttribute('data-gr-id') + '/acao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      });
      await load();
      revelar();
    } catch (err) {
      btn.disabled = false;
      window.alert(err.message || 'Não foi possível salvar.');
    }
  }

  // Mostra o botão do menu só se a área estiver ligada; o número é o que espera decisão.
  async function revelar() {
    var tab = document.querySelector('.admin-tab[data-tab="grupos"]');
    if (!tab || !C() || !C().token()) return;
    try {
      var res = await fetch('/api/admin/grupos/fila', { headers: { Authorization: 'Bearer ' + C().token() } });
      if (!res.ok) { tab.hidden = true; return; }
      var r = await res.json();
      var n = (r.pendentes || []).length + (r.denunciadas || []).length;
      tab.hidden = false;
      tab.textContent = 'Grupos de estudo' + (n ? ' (' + n + ')' : '');
    } catch (err) { /* sem rede: deixa como está */ }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var box = document.getElementById('tab-grupos');
    if (box) box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-gr-acao]');
      if (b) agir(b);
    });
    revelar();
    // Depois do login o painel aparece (admin-app sem "hidden"): confere de novo.
    var appEl = document.getElementById('admin-app');
    if (appEl && window.MutationObserver) {
      new MutationObserver(function () { if (!appEl.classList.contains('hidden')) revelar(); }).observe(appEl, { attributes: true, attributeFilter: ['class'] });
    }
  });

  return { load: load, revelar: revelar };
})();
