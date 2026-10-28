/* Admin › Visão geral: como está a turma (Bom / Regular / Ruim), o que fazer agora e a situação dos alunos.
   Dados de GET /api/admin/painel. Cada ação leva para a lista já filtrada (Quem contatar) ou para a aba certa. */
window.AdminPainel = (function () {
  'use strict';

  var C = function () { return window.AdminCore; };
  var esc = function (t) { return C().escapeHtml(t); };
  var FAIXA = { bom: 'Bom', regular: 'Regular', ruim: 'Ruim', sem_dados: 'Poucos dados', conteudo: 'Conteúdo' };
  // Tons por situação: verdes = bom, âmbar = regular, vermelhos = ruim (sempre com o nome ao lado).
  var COR = { certificado: '#1d7a4b', em_andamento: '#5aa77f', sem_certificado: '#c98a00', parou: '#e0ad35', sem_aula: '#efcf7a', travado: '#b42318', sumiu: '#d65a50', nunca_entrou: '#8f1c13' };

  function selo(faixa) {
    return '<span class="pn-selo pn-selo--' + esc(faixa) + '">' + esc(FAIXA[faixa] || faixa) + '</span>';
  }

  function botao(b) {
    if (!b) return '';
    return '<button type="button" class="pn-ir" data-pn-ir="' + esc(JSON.stringify(b)) + '">' + esc(b.texto) + '</button>';
  }

  function hora(iso) {
    return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  }

  function acoesHtml(acoes) {
    var turma = acoes.filter(function (a) { return a.gravidade !== 'conteudo'; });
    var conteudo = acoes.filter(function (a) { return a.gravidade === 'conteudo'; });
    var item = function (a, i) {
      return '<li class="pn-acao pn-acao--' + esc(a.gravidade) + '">' +
        '<span class="pn-acao-n" aria-hidden="true">' + (i + 1) + '</span>' +
        '<div class="pn-acao-t"><p class="pn-acao-h">' + selo(a.gravidade) + ' ' + esc(a.titulo) + '</p><p class="pn-acao-p">' + esc(a.porque) + '</p></div>' +
        botao(a.botao) + '</li>';
    };
    return '<section class="pn-sec" aria-labelledby="pn-h-acoes">' +
      '<h3 id="pn-h-acoes" class="pn-h3">O que fazer agora</h3>' +
      '<p class="pn-sub">Em ordem: primeiro o que impede o aluno de seguir. Cada botão abre a lista já filtrada, com a mensagem de WhatsApp pronta.</p>' +
      (turma.length ? '<ol class="pn-acoes">' + turma.map(item).join('') + '</ol>'
        : '<p class="pn-vazio">Nenhum aluno precisando de ação agora. 🎉</p>') +
      (conteudo.length ? '<h4 class="pn-h4">Para melhorar o conteúdo</h4><ol class="pn-acoes">' + conteudo.map(function (a, i) { return item(a, turma.length + i); }).join('') + '</ol>' : '') +
      '</section>';
  }

  function regua(ind) {
    // Barra de 0 a 100% com as marcas de "regular" e "bom" (nos indicadores "menos é melhor" as marcas são tetos).
    var v = ind.valor == null ? 0 : Math.max(0, Math.min(100, ind.valor));
    return '<div class="pn-regua" aria-hidden="true"><i class="pn-regua-v pn-regua-v--' + esc(ind.faixa) + '" style="width:' + v + '%"></i></div>';
  }

  function indicadoresHtml(lista) {
    return '<section class="pn-sec" aria-labelledby="pn-h-ind">' +
      '<h3 id="pn-h-ind" class="pn-h3">Como está a turma</h3>' +
      '<div class="pn-inds">' + lista.map(function (i) {
        var valor = i.valor == null ? '—' : i.valor + '%';
        return '<article class="pn-ind pn-ind--' + esc(i.faixa) + '">' +
          '<div class="pn-ind-top"><h4>' + esc(i.rotulo) + '</h4>' + selo(i.faixa) + '</div>' +
          '<p class="pn-ind-v"><strong>' + esc(valor) + '</strong> <span>' + esc(i.n + ' de ' + i.de) + '</span></p>' +
          regua(i) +
          '<p class="pn-ind-x">' + esc(i.explica) + '</p>' +
          '<p class="pn-ind-meta">' + esc(i.meta) + '</p>' +
          (i.acao ? '<div class="pn-ind-a">' + botao(i.acao) + '</div>' : '') +
        '</article>';
      }).join('') + '</div></section>';
  }

  function situacoesHtml(sits, total) {
    var barra = sits.filter(function (s) { return s.total; }).map(function (s) {
      return '<i style="flex:' + s.total + ';background:' + (COR[s.id] || '#999') + '" title="' + esc(s.rotulo + ': ' + s.total) + '"></i>';
    }).join('');
    return '<section class="pn-sec" aria-labelledby="pn-h-sit">' +
      '<h3 id="pn-h-sit" class="pn-h3">Situação dos alunos</h3>' +
      '<p class="pn-sub">Cada aluno aparece em uma situação só, na ordem da tabela. ' + total + ' aluno(s) ativo(s).</p>' +
      '<div class="pn-barra" role="img" aria-label="Distribuição dos alunos por situação">' + (barra || '<i style="flex:1;background:#e8edf4"></i>') + '</div>' +
      '<div class="overflow-x-auto"><table class="pn-sits"><thead><tr><th scope="col">Situação</th><th scope="col" class="pn-num">Alunos</th><th scope="col">O que fazer</th><th scope="col"><span class="sr-only">Abrir</span></th></tr></thead><tbody>' +
      sits.map(function (s) {
        var p = total ? Math.round(s.total / total * 100) : 0;
        return '<tr><th scope="row"><span class="pn-dot" style="background:' + (COR[s.id] || '#999') + '"></span>' + esc(s.rotulo) + ' ' + selo(s.faixa) + '<small>' + esc(s.descricao) + '</small></th>' +
          '<td class="pn-num"><b>' + s.total + '</b> <span>' + p + '%</span></td>' +
          '<td>' + esc(s.acao) + '</td>' +
          '<td class="pn-num">' + (s.total ? botao({ texto: 'Ver alunos', aba: 'acompanhamento', situacao: s.id }) : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  async function load() {
    var box = document.getElementById('painel-conteudo');
    var msg = document.getElementById('painel-msg');
    var dias = document.getElementById('painel-dias').value || '30';
    msg.textContent = 'Carregando...';
    try {
      if (window.AdminAcomp) window.AdminAcomp.carregarFunil(dias);
      var r = await C().request('/api/admin/painel?dias=' + encodeURIComponent(dias));
      var f = r.resumo_faixas;
      msg.innerHTML = '<b>' + r.total_alunos + '</b> aluno(s) ativo(s) · indicadores: ' +
        '<span class="pn-conta pn-conta--bom">' + f.bom + ' bom</span> ' +
        '<span class="pn-conta pn-conta--regular">' + f.regular + ' regular</span> ' +
        '<span class="pn-conta pn-conta--ruim">' + f.ruim + ' ruim</span> · atualizado às ' + esc(hora(r.gerado_em));
      box.innerHTML = acoesHtml(r.acoes) + indicadoresHtml(r.indicadores) + situacoesHtml(r.situacoes, r.total_alunos) +
        (r.rastreio ? '' : '<p class="pn-nota">Tempo de uso, vídeos e buscas só aparecem para as contas com rastreio ligado (RASTREIO_LIBERADO_PARA).</p>');
    } catch (err) {
      msg.textContent = err.message || 'Não foi possível carregar a visão geral.';
    }
  }

  function ir(b) {
    if (b.aba === 'acompanhamento' && window.AdminAcomp) window.AdminAcomp.filtrar({ situacao: b.situacao, sinal: b.sinal });
    C().irPara(b.aba, b.sub);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var sel = document.getElementById('painel-dias');
    if (sel) sel.addEventListener('change', load);
    var at = document.getElementById('painel-atualizar');
    if (at) at.addEventListener('click', load);
    // O login pode terminar antes deste arquivo carregar: se a aba já está aberta e vazia, carrega agora.
    var aba = document.getElementById('tab-painel');
    if (!document.getElementById('admin-app').classList.contains('hidden') && !aba.classList.contains('hidden') &&
      !document.getElementById('painel-conteudo').innerHTML) load();
    aba.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pn-ir]');
      if (!b) return;
      try { ir(JSON.parse(b.getAttribute('data-pn-ir'))); } catch (err) { /* botão sem destino */ }
    });
    var cf = document.getElementById('config-faixas');
    if (cf) {
      cf.addEventListener('submit', function (e) {
        if (e.target.id !== 'faixas-form') return;
        e.preventDefault();
        salvarFaixas(lerFaixas(e.target));
      });
      cf.addEventListener('click', function (e) {
        if (!e.target.closest('[data-faixas-padrao]')) return;
        if (window.confirm('Voltar todas as faixas ao padrão?')) salvarFaixas({ reset: true });
      });
    }
  });

  // ---------- Configurações › Faixas da Visão geral ----------
  function campo(nome, valor) {
    return '<input type="number" name="' + nome + '" min="0" max="100" step="1" value="' + Number(valor) + '" class="fx-n" required><span>%</span>';
  }

  function formFaixas(r) {
    var f = r.faixas;
    var linhas = r.catalogo.map(function (c) {
      var v = f.ind[c.id];
      var sentido = c.menor ? 'até' : 'a partir de';
      return '<tr data-faixa="' + esc(c.id) + '">' +
        '<th scope="row">' + esc(c.rotulo) + '<small>' + (c.menor ? 'Menos é melhor' : 'Mais é melhor') + ' · padrão ' + c.padrao.bom + '% / ' + c.padrao.regular + '%</small></th>' +
        '<td><label><span class="pn-selo pn-selo--bom">Bom</span><span class="fx-q">' + sentido + '</span>' + campo('bom', v.bom) + '</label></td>' +
        '<td><label><span class="pn-selo pn-selo--regular">Regular</span><span class="fx-q">' + sentido + '</span>' + campo('regular', v.regular) + '</label></td>' +
        '<td class="fx-ruim"><span class="pn-selo pn-selo--ruim">Ruim</span> ' + (c.menor ? 'acima do Regular' : 'abaixo do Regular') + '</td></tr>';
    }).join('');
    return '<form id="faixas-form" class="fx">' +
      '<div class="overflow-x-auto"><table class="fx-t"><thead><tr><th scope="col">Indicador</th><th scope="col">Bom</th><th scope="col">Regular</th><th scope="col">Ruim</th></tr></thead><tbody>' +
      linhas + '</tbody></table></div>' +
      '<label class="fx-dias"><span>Aluno conta como <b>sumiu</b> depois de</span> <input type="number" name="dias_sumiu" min="1" max="90" value="' + Number(f.dias_sumiu) + '" class="fx-n" required> dias sem acessar ' +
        '<small>Vale para a situação "Sumiu" e para o indicador "Acessaram nos últimos dias". Padrão: ' + r.padrao.dias_sumiu + '.</small></label>' +
      '<p class="fx-nota">Se "Bom" e "Regular" ficarem na ordem errada, o sistema troca os dois; se ficarem iguais, volta ao padrão.</p>' +
      '<p id="faixas-msg" class="fx-msg" role="status"></p>' +
      '<div class="fx-acts"><button type="submit" class="bg-cruzeiro text-white font-semibold px-4 py-2 rounded-lg">Salvar faixas</button>' +
      '<button type="button" data-faixas-padrao class="bg-white border font-semibold px-4 py-2 rounded-lg">Voltar ao padrão</button></div>' +
      '</form>';
  }

  function lerFaixas(form) {
    var out = { faixas: { dias_sumiu: Number(form.querySelector('[name="dias_sumiu"]').value), ind: {} } };
    form.querySelectorAll('[data-faixa]').forEach(function (tr) {
      out.faixas.ind[tr.getAttribute('data-faixa')] = {
        bom: Number(tr.querySelector('[name="bom"]').value),
        regular: Number(tr.querySelector('[name="regular"]').value),
      };
    });
    return out;
  }

  async function loadFaixas(aviso) {
    var box = document.getElementById('config-faixas');
    if (!box) return;
    try {
      box.innerHTML = formFaixas(await C().request('/api/admin/painel/faixas'));
      if (aviso) document.getElementById('faixas-msg').textContent = aviso;
    } catch (err) {
      box.innerHTML = '<p class="text-red-600">' + esc(err.message || 'Não foi possível carregar as faixas.') + '</p>';
    }
  }

  async function salvarFaixas(corpo) {
    var msg = document.getElementById('faixas-msg');
    if (msg) msg.textContent = 'Salvando...';
    try {
      await C().request('/api/admin/painel/faixas', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      await loadFaixas(corpo.reset ? 'Faixas de volta ao padrão.' : 'Faixas salvas. A Visão geral já usa os novos limites.');
      document.getElementById('painel-conteudo').innerHTML = ''; // recarrega ao voltar para a Visão geral
    } catch (err) {
      if (msg) msg.textContent = err.message || 'Não foi possível salvar.';
    }
  }

  return { load: load, loadFaixas: loadFaixas };
})();
