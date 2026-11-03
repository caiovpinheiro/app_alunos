/* Admin: de quando é a base de alunos, alertas e quem do relatório ficou sem conta.
   Dados de GET /api/admin/base. Desenha em todo [data-base-status] (Visão geral e Quem contatar). */
window.AdminBase = (function () {
  'use strict';

  var C = function () { return window.AdminCore; };
  var esc = function (t) { return C().escapeHtml(t); };

  function quando(d) {
    return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function idade(d) {
    var min = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.round(min / 60);
    return h < 48 ? 'há ' + h + ' h' : 'há ' + Math.round(h / 24) + ' dias';
  }

  function foraHtml(r) {
    if (!r.fora_total) return '';
    var linhas = r.fora.map(function (x) {
      return '<tr><td>' + esc(x.nome || '—') + '</td><td>' + esc(x.rgm || '—') + '</td><td>' + esc(x.email || '—') + '</td><td>' + esc(x.motivo_rotulo) + '</td></tr>';
    }).join('');
    return '<details class="bs-fora"><summary>' + r.fora_total + ' aluno(s) em curso no relatório sem conta no portal</summary>' +
      '<p>Eles não conseguem entrar. Corrija os dados no relatório: a conta é criada na conferência seguinte.' +
      (r.fora_total > r.fora.length ? ' Mostrando os ' + r.fora.length + ' primeiros.' : '') + '</p>' +
      '<div class="bs-rolagem"><table><thead><tr><th scope="col">Nome</th><th scope="col">RGM</th><th scope="col">E-mail</th><th scope="col">Motivo</th></tr></thead><tbody>' + linhas + '</tbody></table></div></details>';
  }

  function html(r) {
    var titulo = r.relatorio
      ? 'Base de alunos: relatório de <b>' + esc(quando(r.relatorio.em)) + '</b> (' + esc(idade(r.relatorio.em)) + ')'
      : 'Base de alunos: nenhum relatório aplicado ainda';
    var detalhes = [];
    if (r.verificado_em) detalhes.push('Conferida em ' + esc(quando(r.verificado_em)));
    if (r.ultima_carga) detalhes.push('na última carga: ' + r.ultima_carga.novos + ' novos, ' + r.ultima_carga.atualizados + ' atualizados, ' + r.ultima_carga.revogados + ' revogados');
    return '<section class="bs" aria-label="Atualização da base de alunos">' +
      '<div class="bs-topo"><div><p class="bs-t">' + titulo + '</p>' +
        (detalhes.length ? '<p class="bs-s">' + detalhes.join(' · ') + '</p>' : '') + '</div></div>' +
      r.alertas.map(function (a) {
        return '<p class="bs-alerta bs-alerta--' + esc(a.tipo) + '"' + (a.tipo === 'erro' ? ' role="alert"' : '') + '>' + esc(a.texto) + (a.em ? ' (' + esc(quando(a.em)) + ')' : '') + '</p>';
      }).join('') +
      foraHtml(r) +
    '</section>';
  }

  function caixas() { return document.querySelectorAll('[data-base-status]'); }

  async function carregar() {
    try {
      var r = await C().request('/api/admin/base');
      caixas().forEach(function (box) {
        // Mantém aberta a lista de quem ficou de fora quando a barra é redesenhada.
        var d = box.querySelector('.bs-fora');
        var aberta = Boolean(d && d.open);
        box.innerHTML = html(r);
        var novo = box.querySelector('.bs-fora');
        if (novo) novo.open = aberta;
      });
    } catch (err) {
      caixas().forEach(function (box) {
        box.innerHTML = '<p class="bs-alerta bs-alerta--erro">' + esc(err.message || 'Não foi possível ver a atualização da base.') + '</p>';
      });
    }
  }

  return { carregar: carregar };
})();
