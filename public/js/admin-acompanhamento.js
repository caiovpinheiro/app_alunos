/* Admin › Acompanhamento: quem precisa de contato, por quê, e o percurso de cada aluno.
   O WhatsApp abre com a mensagem sugerida (o atendente revisa e envia) e o contato fica registrado. */
window.AdminAcomp = (function () {
  'use strict';

  var C = function () { return window.AdminCore; };
  var esc = function (t) { return C().escapeHtml(t); };
  var dados = null;
  var sinaisCarregados = false;
  var situacoes = {};
  var pendente = null; // filtro pedido pela Visão geral antes de as opções existirem

  var NOMES_EVENTO = {
    tela_aberta: 'Abriu a tela', clique: 'Clicou', saiu: 'Saiu do portal',
    video_inicio: 'Começou o vídeo', video_progresso: 'Assistiu', video_pausa: 'Pausou o vídeo', video_retomado: 'Voltou ao vídeo', video_fim: 'Terminou o vídeo',
    trilha_nivel_aberto: 'Abriu módulo da Aula Inaugural', trilha_video_assistido: 'Viu o vídeo do módulo', trilha_video_pulado: 'Pulou o vídeo do módulo',
    trilha_travei: 'Tocou em "Travei"', trilha_resposta: 'Respondeu pergunta', trilha_nivel_concluido: 'Concluiu módulo', trilha_tarefa: 'Marcou tarefa',
    central_busca: 'Buscou na Central', central_busca_sem_resultado: 'Busca sem resultado', central_video: 'Abriu vídeo da Central',
    faq_aberta: 'Abriu pergunta', aula_capitulo: 'Abriu capítulo da Aula Inaugural',
    certificado_gerado: 'Gerou certificado', certificado_erro: 'Erro no certificado', aviso_lido: 'Leu aviso', whatsapp_clicado: 'Clicou no WhatsApp',
  };
  var IMPORTANTES = { trilha_travei: 1, central_busca_sem_resultado: 1, certificado_erro: 1, trilha_video_pulado: 1 };

  function quando(d) {
    if (!d) return '—';
    var dt = new Date(d);
    return dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function haDias(n) {
    if (n == null) return 'nunca';
    if (n <= 0) return 'hoje';
    if (n === 1) return 'ontem';
    return 'há ' + n + ' dias';
  }
  function minutos(s) {
    var m = Math.round((s || 0) / 60);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  function filtros() {
    var f = document.getElementById('acomp-filtros');
    var fd = new FormData(f);
    var mostrar = String(fd.get('sinal') || 'com_sinal');
    // "sit:<id>" = filtro por situação (Visão geral); o resto é sinal ou grupo de sinais.
    var sit = mostrar.indexOf('sit:') === 0 ? mostrar.slice(4) : '';
    return new URLSearchParams({ dias: fd.get('dias') || '30', sinal: sit ? 'todos' : mostrar, situacao: sit, q: (fd.get('q') || '').trim() });
  }

  function card(rotulo, valor, dica) {
    return '<div class="bg-white border rounded-xl p-4"><p class="text-xs text-gray-500">' + esc(rotulo) + '</p><p class="text-2xl font-bold text-gray-800">' + esc(valor) + '</p>' +
      (dica ? '<p class="text-xs text-gray-400 mt-1">' + esc(dica) + '</p>' : '') + '</div>';
  }

  var FAIXA = { bom: 'Bom', regular: 'Regular', ruim: 'Ruim' }; // mesmas palavras da Visão geral

  // Jornada em 3 marcos: entrou no portal → Aula Inaugural (x de 7) → certificado.
  function jornada(a) {
    var entrou = Boolean(a.primeiro_acesso || a.trilha_ultima);
    var feitos = a.niveis_concluidos || 0;
    var total = a.total_niveis || 7;
    var p = Math.round(feitos / total * 100);
    var marco = function (ok, txt) { return '<li class="ac-marco' + (ok ? ' is-ok' : '') + '"><span aria-hidden="true">' + (ok ? '✓' : '') + '</span>' + txt + '</li>'; };
    return '<ol class="ac-jornada" aria-label="Jornada do aluno">' +
      marco(entrou, entrou ? 'Entrou' : 'Não entrou') +
      '<li class="ac-marco ac-marco--aula' + (feitos >= total ? ' is-ok' : '') + '"><span aria-hidden="true">' + (feitos >= total ? '✓' : '') + '</span>' +
        'Aula ' + feitos + '/' + total + '<i class="ac-mini" aria-hidden="true"><b style="width:' + p + '%"></b></i></li>' +
      marco(a.certificado_emitido, a.certificado_emitido ? 'Certificado' : 'Sem certificado') +
    '</ol>';
  }

  function linhaAluno(a) {
    var s = a.sinais[0];
    var sit = situacoes[a.situacao] || { rotulo: a.situacao, faixa: 'regular', acao: '' };
    var wa = a.whatsapp_numero && s
      ? '<a class="ac-wa" target="_blank" rel="noopener noreferrer" data-acomp-wa="' + a.id + '" data-motivo="' + esc(s.id) + '" href="https://wa.me/' + esc(a.whatsapp_numero) + '?text=' + encodeURIComponent(s.mensagem) + '">Abrir WhatsApp</a>'
      : (s ? '<span class="ac-semtel">Sem telefone no relatório</span>' : '');
    var j = a.joinhas || { positivos: 0, negativos: 0 };
    var dado = function (rotulo, valor, alerta) {
      return '<div' + (alerta ? ' class="is-alerta"' : '') + '><dt>' + esc(rotulo) + '</dt><dd>' + valor + '</dd></div>';
    };
    return (
      '<article class="ac-card ac-card--' + esc(sit.faixa) + '">' +
        '<div class="ac-top">' +
          '<div class="ac-quem">' +
            '<h3>' + esc(a.nome) + '</h3>' +
            '<p class="ac-meta">' + (a.rgm ? 'RGM ' + esc(a.rgm) : 'Em preparação (sem RGM)') + (a.curso ? ' · ' + esc(a.curso) : '') + (a.unidade ? ' · ' + esc(a.unidade) : '') + '</p>' +
          '</div>' +
          '<div class="ac-sit"><span class="ac-sit-chip ac-sit-chip--' + esc(sit.faixa) + '">' + esc(FAIXA[sit.faixa] || '') + ' · ' + esc(sit.rotulo) + '</span>' +
            (sit.acao ? '<p>' + esc(sit.acao) + '</p>' : '') + '</div>' +
        '</div>' +
        jornada(a) +
        '<dl class="ac-dados">' +
          dado('Último acesso', esc(haDias(a.dias_sem_acesso)), a.dias_sem_acesso == null || a.dias_sem_acesso >= 7) +
          dado('Acessos', a.acessos + ' no período <small>(' + a.acessos_total + ' no total)</small>') +
          dado('Tempo no período', esc(minutos(a.segundos))) +
          dado('"Travei"', a.travei_total ? a.travei_total + 'x' + (a.nivel_aberto ? ' <small>no módulo ' + esc(a.nivel_aberto) + '</small>' : '') : '—', a.travei_total > 0) +
          dado('Joinhas', (j.positivos || j.negativos) ? '👍 ' + j.positivos + ' · 👎 ' + j.negativos : '—', j.negativos > 0) +
          dado('Vídeos', a.videos_fim + ' de ' + a.videos_inicio + ' até o fim') +
          dado('Último contato', a.followup_em ? esc(quando(a.followup_em)) : 'nunca') +
        '</dl>' +
        (a.sinais.length ? '<div class="ac-sinais"><span>Por que chamar:</span>' + a.sinais.map(function (x, i) {
          return '<span class="ac-sinal' + (i === 0 ? ' is-1' : '') + '">' + esc(x.rotulo) + '</span>';
        }).join('') + '</div>' : '') +
        (s ? '<details class="ac-msg"><summary>Mensagem sugerida</summary><p>' + esc(s.mensagem) + '</p></details>' : '') +
        (a.em_espera ? '<p class="ac-espera">Contatado recentemente. Volta para a lista em ' + a.volta_em_dias + ' dia(s), se ainda tiver: ' + esc(a.sinais_em_espera.map(function (x) { return x.rotulo; }).join(', ')) + '.</p>' : '') +
        '<div class="ac-acts">' + wa +
          (s ? '<button type="button" class="bg-white border font-semibold px-3 py-2 rounded-lg" data-acomp-copiar="' + a.id + '">Copiar mensagem</button>' : '') +
          '<button type="button" class="bg-white border font-semibold px-3 py-2 rounded-lg" data-acomp-percurso="' + a.id + '">Ver percurso</button>' +
        '</div>' +
      '</article>'
    );
  }

  // Filtro pedido de fora (Visão geral): situação ou sinal. Se as opções ainda não existem, aplica no load.
  function aplicarFiltro(f) {
    var sel = document.getElementById('acomp-sinal');
    var valor = f.situacao ? 'sit:' + f.situacao : (f.sinal || 'com_sinal');
    if (!Array.prototype.some.call(sel.options, function (o) { return o.value === valor; })) return false;
    sel.value = valor;
    return true;
  }
  function filtrar(f) {
    if (!aplicarFiltro(f || {})) pendente = f;
  }

  // Funil por dia de matrícula (dia em que a conta foi criada). Dias antes de VERSAO_NOVA_DESDE ficam
  // marcados "versão antiga": quem está nela não vê a Aula Inaugural, então essas colunas ficam perto de zero.
  function pct(n, d) { return d ? Math.round(n / d * 100) + '%' : '—'; }
  function celula(n, d) {
    return '<td class="px-3 py-2 text-right whitespace-nowrap"><b>' + n + '</b> <span class="text-gray-400">' + pct(n, d) + '</span></td>';
  }
  function diaBr(iso) { var p = String(iso).split('-'); return p[2] + '/' + p[1]; }
  async function carregarFunil(diasPedidos) {
    var box = document.getElementById('acomp-funil');
    if (!box) return;
    var dias = Math.min(90, Number(diasPedidos) || Number(filtros().get('dias')) || 30);
    try {
      var r = await C().request('/api/admin/acompanhamento/funil?dias=' + dias);
      var desde = r.versao_nova_desde ? new Date(r.versao_nova_desde) : null;
      var linha = function (c, total) {
        var antiga = !total && !r.versao_nova_todos && (!desde || new Date(c.dia + 'T23:59:59-03:00') < desde);
        return '<tr class="border-t' + (total ? ' font-semibold bg-slate-50' : '') + '">' +
          '<th scope="row" class="px-3 py-2 text-left whitespace-nowrap">' + (total ? 'Total' : esc(diaBr(c.dia))) +
            (antiga ? ' <span class="text-xs font-normal text-gray-400">versão antiga</span>' : '') + '</th>' +
          '<td class="px-3 py-2 text-right">' + c.contas + '</td>' + celula(c.entraram, c.contas) + celula(c.entraram_24h, c.contas) +
          celula(c.comecaram, c.contas) + celula(c.concluiram, c.contas) + celula(c.certificado, c.contas) + '</tr>';
      };
      var th = function (t, esq) { return '<th scope="col" class="px-3 py-2 font-semibold ' + (esq ? 'text-left' : 'text-right') + '">' + t + '</th>'; };
      box.innerHTML = '<section class="bg-white border rounded-xl p-4" aria-labelledby="acomp-funil-h">' +
        '<h3 id="acomp-funil-h" class="font-bold text-gray-800">Funil por dia de matrícula</h3>' +
        '<p class="text-xs text-gray-500 mb-3">Alunos agrupados pelo dia em que a conta foi criada (até 30 min depois de aparecerem no relatório de matriculados). Porcentagens sobre as contas do dia.</p>' +
        (r.coortes.length
          ? '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-xs text-gray-500">' +
            th('Dia', true) + th('Contas') + th('Entraram') + th('Em até 24 h') + th('Começaram a Aula') + th('Concluíram (' + r.total_modulos + ' módulos)') + th('Certificado') +
            '</tr></thead><tbody>' + r.coortes.map(function (c) { return linha(c, false); }).join('') + linha(r.total, true) + '</tbody></table></div>'
          : '<p class="text-sm text-gray-500">Nenhuma conta criada no período.</p>') +
        '</section>';
    } catch (err) {
      box.innerHTML = '<p class="text-sm text-red-700">' + esc(err.message || 'Não foi possível carregar o funil.') + '</p>';
    }
  }

  // Versão das telas (VERSAO_NOVA_PARA / VERSAO_NOVA_DESDE): o que o servidor leu e por que cada aluno vê uma ou outra.
  var MOTIVO = { todos: 'versão nova (liberada para todos)', lista: 'versão nova (está em VERSAO_NOVA_PARA)', data: 'versão nova (conta criada a partir de VERSAO_NOVA_DESDE)' };
  function dataHora(d) { return d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  async function conferirVersao(q) {
    var conf = document.getElementById('versao-conf');
    var res = document.getElementById('versao-res');
    try {
      var r = await C().request('/api/admin/versao?q=' + encodeURIComponent(q || ''));
      var c = r.config;
      conf.innerHTML = '<ul class="space-y-1">' +
        '<li><b>VERSAO_NOVA_PARA:</b> ' + (c.todos ? 'todos (*)' : c.lista.length ? esc(c.lista.join(', ')) : '<span class="text-red-700">vazia (ninguém por lista)</span>') + '</li>' +
        '<li><b>VERSAO_NOVA_DESDE:</b> ' + (c.desde ? esc(dataHora(c.desde)) : c.desde_invalida ? '<span class="text-red-700">data inválida (use AAAA-MM-DD)</span>' : 'não definida') + '</li>' +
        '<li><b>Aula Inaugural (TRILHA_LIBERADA_PARA):</b> ' + esc(c.trilha) + ' · <b>Rastreio:</b> ' + esc(c.rastreio) + '</li>' +
        '<li class="text-xs text-gray-500">Mudou o Environment no EasyPanel? Só vale depois de um novo Deploy. A tela de login é sempre a antiga; a troca acontece depois de entrar.</li></ul>';
      if (!q) { res.innerHTML = ''; return; }
      res.innerHTML = r.alunos.length ? '<ul class="space-y-2">' + r.alunos.map(function (a) {
        var nova = !!a.motivo;
        return '<li class="border rounded-lg p-2"><b>' + esc(a.nome) + '</b> · ' + (a.rgm ? 'RGM ' + esc(a.rgm) : 'sem RGM') + ' · ' + esc(a.email) +
          '<br><span class="' + (nova ? 'text-green-700' : 'text-gray-600') + ' font-semibold">' + (nova ? esc(MOTIVO[a.motivo]) : 'versão antiga') + '</span>' +
          ' · Aula Inaugural: ' + (a.aula ? 'liberada' : 'não') + ' · conta criada em ' + esc(dataHora(a.criada_em)) + ' · último login: ' + esc(dataHora(a.ultimo_login_em)) + '</li>';
      }).join('') + '</ul>' : '<p class="text-gray-500">Nenhum aluno encontrado.</p>';
    } catch (err) {
      conf.textContent = err.message || 'Não foi possível conferir.';
    }
  }

  async function load() {
    var msg = document.getElementById('acomp-msg');
    msg.textContent = 'Carregando...';
    try {
      var r = await C().request('/api/admin/acompanhamento?' + filtros().toString());
      dados = r;
      if (!sinaisCarregados) {
        var gs = document.getElementById('acomp-sit-grupo');
        var gi = document.getElementById('acomp-sinal-grupo');
        (r.situacoes || []).forEach(function (x) {
          var o = document.createElement('option'); o.value = 'sit:' + x.id; o.textContent = x.rotulo; gs.appendChild(o);
        });
        r.sinais.forEach(function (x) {
          var o = document.createElement('option'); o.value = x.id; o.textContent = x.rotulo; gi.appendChild(o);
        });
        sinaisCarregados = true;
        situacoes = (r.situacoes || []).reduce(function (m, x) { m[x.id] = x; return m; }, {});
        if (pendente) { var p = pendente; pendente = null; aplicarFiltro(p); return load(); }
      }
      var t = r.totais;
      var pctVideo = t.videos_iniciados ? Math.round(t.videos_concluidos / t.videos_iniciados * 100) + '%' : '—';
      document.getElementById('acomp-totais').innerHTML =
        card('Alunos que entraram (' + r.dias + ' dias)', t.ativos_periodo + ' de ' + t.alunos, t.acessos_periodo + ' acessos') +
        card('Tempo médio por aluno', t.minutos_medio + ' min', 'no período, só tempo de uso') +
        card('Vídeos terminados', pctVideo, t.videos_concluidos + ' de ' + t.videos_iniciados + ' iniciados') +
        card('Precisam de contato', t.com_sinal, 'travaram, pararam ou sumiram');
      document.getElementById('acomp-lista').innerHTML = r.alunos.length
        ? r.alunos.map(linhaAluno).join('')
        : '<p class="text-gray-500 text-sm">Ninguém nesse filtro.</p>';
      msg.textContent = r.total_filtrado > r.alunos.length ? 'Mostrando ' + r.alunos.length + ' de ' + r.total_filtrado + '. Use a busca ou o CSV para ver todos.' : r.total_filtrado + ' aluno(s).';
    } catch (err) {
      msg.textContent = err.message || 'Não foi possível carregar.';
    }
  }

  function aluno(id) { return dados && dados.alunos.find(function (a) { return String(a.id) === String(id); }); }

  async function registrar(id, motivo, canal) {
    try {
      await C().request('/api/admin/acompanhamento/' + id + '/followup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo: motivo, canal: canal || 'whatsapp' }),
      });
    } catch (err) { /* o envio do WhatsApp já aconteceu; só não ficou registrado */ }
  }

  function descricao(e) {
    var d = e.dados || {};
    var partes = [];
    if (d.alvo) partes.push('"' + d.alvo + '"');
    if (d.tela) partes.push(d.tela);
    if (d.titulo) partes.push(d.titulo);
    else if (d.video) partes.push(d.video);
    if (d.pct != null) partes.push(d.pct + '%');
    if (d.nivel) partes.push('Módulo ' + d.nivel + (d.nivel_titulo ? ' · ' + d.nivel_titulo : ''));
    if (d.parte_titulo) partes.push(d.parte_titulo);
    if (d.termo) partes.push('"' + d.termo + '"');
    if (d.pergunta) partes.push(d.pergunta);
    if (d.acertou != null) partes.push(d.acertou ? 'acertou' : 'errou');
    if (d.destino && d.externo) partes.push('→ ' + d.destino);
    if (d.mensagem) partes.push(d.mensagem);
    return partes.join(' · ');
  }

  async function percurso(id) {
    var a = aluno(id);
    var modal = document.getElementById('acomp-modal');
    var body = document.getElementById('acomp-modal-body');
    document.getElementById('acomp-modal-title').textContent = 'Percurso de ' + (a ? a.nome : 'aluno');
    body.innerHTML = '<p class="text-gray-500">Carregando...</p>';
    modal.classList.remove('hidden');
    document.getElementById('acomp-modal-close').focus();
    try {
      var r = await C().request('/api/admin/acompanhamento/' + id);
      var acessos = r.acessos.length
        ? '<ul class="space-y-1 mb-4">' + r.acessos.map(function (s) {
            return '<li class="flex flex-wrap gap-x-3 border rounded-lg px-3 py-2"><b>' + esc(quando(s.inicio)) + '</b><span>' + esc(minutos(s.segundos_ativos)) + ' de uso</span><span>' + s.telas + ' telas · ' + s.cliques + ' cliques</span><span class="text-gray-500">' + esc(s.dispositivo || '') + '</span></li>';
          }).join('') + '</ul>'
        : '<p class="text-gray-500 mb-4">Nenhum acesso registrado desde que o acompanhamento foi ligado.</p>';
      var eventos = r.eventos.length
        ? '<ol class="space-y-1">' + r.eventos.map(function (e) {
            var imp = IMPORTANTES[e.nome];
            return '<li class="flex gap-3 px-2 py-1 rounded ' + (imp ? 'bg-amber-50' : '') + '"><span class="text-gray-500 whitespace-nowrap">' + esc(quando(e.criado_em)) + '</span><span><b>' + esc(NOMES_EVENTO[e.nome] || e.nome) + '</b> ' + esc(descricao(e)) + (e.tela ? ' <span class="text-gray-400">(' + esc(e.tela) + ')</span>' : '') + '</span></li>';
          }).join('') + '</ol>'
        : '<p class="text-gray-500">Sem eventos.</p>';
      var contatos = r.followups.length
        ? '<ul class="space-y-1 mb-4">' + r.followups.map(function (f) {
            return '<li class="border rounded-lg px-3 py-2">' + esc(quando(f.criado_em)) + ' · ' + esc(f.canal) + (f.motivo ? ' · ' + esc(f.motivo) : '') + (f.nota ? ' · ' + esc(f.nota) : '') + '</li>';
          }).join('') + '</ul>'
        : '<p class="text-gray-500 mb-4">Nenhum contato registrado.</p>';
      body.innerHTML =
        '<h4 class="font-bold mb-2">Acessos (últimos 30)</h4>' + acessos +
        '<h4 class="font-bold mb-2">Contatos feitos</h4>' + contatos +
        '<h4 class="font-bold mb-2">O que fez (mais recente primeiro)</h4>' + eventos;
    } catch (err) {
      body.innerHTML = '<p class="text-red-600">' + esc(err.message || 'Não foi possível carregar.') + '</p>';
    }
  }

  async function exportar() {
    var msg = document.getElementById('acomp-msg');
    msg.textContent = 'Gerando CSV...';
    try {
      var res = await fetch('/api/admin/acompanhamento/export.csv?' + filtros().toString(), { headers: { Authorization: 'Bearer ' + C().token() } });
      if (res.status === 401) { C().showLogin(); throw new Error('Sessão expirada.'); }
      if (!res.ok) throw new Error('Não foi possível exportar o CSV.');
      var url = URL.createObjectURL(await res.blob());
      var link = document.createElement('a'); link.href = url; link.download = 'acompanhamento-alunos.csv';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      msg.textContent = 'CSV baixado.';
    } catch (err) {
      msg.textContent = err.message || 'Não foi possível exportar o CSV.';
    }
  }

  function fecharModal() { document.getElementById('acomp-modal').classList.add('hidden'); }

  // ---------- Regras dos sinais ----------
  var VARIAVEIS = '{nome} {nivel} {nivel_titulo} {termo} {data_primeiro_acesso} {dias_sem_acesso} {email} {senha_inicial} {link}';
  var UNIDADE = { dias: 'dias', horas: 'horas', vezes: 'vez(es)' };
  var MAXIMO = { dias: 365, horas: 720, vezes: 50 };

  function formRegras(r) {
    var cfg = r.regras;
    var linhas = r.catalogo.map(function (c) {
      var x = cfg.sinais[c.id];
      var unidade = UNIDADE[c.tipo] || 'vez(es)';
      return (
        '<fieldset class="border rounded-xl p-3" data-regra="' + esc(c.id) + '">' +
          '<legend class="px-1 font-bold">' + esc(c.rotulo) + '</legend>' +
          '<p class="text-xs text-gray-500 mb-2">' + esc(c.descricao) + '</p>' +
          '<div class="flex flex-wrap gap-4 items-end mb-2">' +
            '<label class="flex items-center gap-2"><input type="checkbox" name="ativo"' + (x.ativo ? ' checked' : '') + '> Ligado</label>' +
            '<label class="flex flex-col gap-1"><span class="text-xs text-gray-600">N (' + unidade + ')</span><input type="number" name="limite" min="1" max="' + (MAXIMO[c.tipo] || 50) + '" value="' + Number(x.limite) + '" class="border rounded-lg px-2 py-1 w-24"></label>' +
            '<label class="flex flex-col gap-1"><span class="text-xs text-gray-600">Prioridade (1 = primeiro)</span><input type="number" name="prioridade" min="1" max="20" value="' + Number(x.prioridade) + '" class="border rounded-lg px-2 py-1 w-24"></label>' +
          '</div>' +
          '<label class="flex flex-col gap-1"><span class="text-xs text-gray-600">Mensagem sugerida</span><textarea name="mensagem" rows="3" maxlength="700" class="border rounded-lg px-2 py-1">' + esc(x.mensagem) + '</textarea></label>' +
        '</fieldset>'
      );
    }).join('');
    return (
      '<form id="acomp-regras-form" class="space-y-3">' +
        '<label class="flex flex-wrap items-center gap-2 border rounded-xl p-3"><span class="font-bold">Quem já foi contatado sai da lista por</span>' +
          '<input type="number" name="ocultar_contatados_dias" min="0" max="90" value="' + Number(cfg.ocultar_contatados_dias) + '" class="border rounded-lg px-2 py-1 w-20"> dias' +
          '<span class="text-xs text-gray-500 w-full">0 = não esconde. Depois do prazo, volta se o sinal continuar.</span></label>' +
        '<p class="text-xs text-gray-500">Nas mensagens, use: ' + esc(VARIAVEIS) + ' ({nivel} = número do módulo da Aula Inaugural; {nivel_titulo} = nome do módulo)</p>' +
        linhas +
        '<p id="acomp-regras-msg" class="text-sm text-gray-600" role="status"></p>' +
        '<div class="flex flex-wrap gap-2 sticky bottom-0 bg-white py-2">' +
          '<button type="submit" class="bg-cruzeiro text-white font-semibold px-4 py-2 rounded-lg">Salvar regras</button>' +
          '<button type="button" data-regras-padrao class="bg-white border font-semibold px-4 py-2 rounded-lg">Voltar ao padrão</button>' +
        '</div>' +
      '</form>'
    );
  }

  // Regras ficam na aba Configurações (#config-regras), não mais num modal.
  async function carregarRegras() {
    var box = document.getElementById('config-regras');
    if (!box) return;
    box.innerHTML = '<p class="text-gray-500">Carregando...</p>';
    try {
      box.innerHTML = formRegras(await C().request('/api/admin/acompanhamento/regras'));
    } catch (err) {
      box.innerHTML = '<p class="text-red-600">' + esc(err.message || 'Não foi possível carregar.') + '</p>';
    }
  }

  function loadConfig() {
    carregarRegras();
    var q = document.getElementById('versao-q');
    conferirVersao(q ? q.value.trim() : '');
  }

  function lerFormRegras(form) {
    var out = { ocultar_contatados_dias: Number(form.querySelector('[name="ocultar_contatados_dias"]').value), sinais: {} };
    form.querySelectorAll('[data-regra]').forEach(function (fs) {
      out.sinais[fs.getAttribute('data-regra')] = {
        ativo: fs.querySelector('[name="ativo"]').checked,
        limite: Number(fs.querySelector('[name="limite"]').value),
        prioridade: Number(fs.querySelector('[name="prioridade"]').value),
        mensagem: fs.querySelector('[name="mensagem"]').value,
      };
    });
    return out;
  }

  async function salvarRegras(corpo) {
    var msg = document.getElementById('acomp-regras-msg');
    if (msg) msg.textContent = 'Salvando...';
    try {
      await C().request('/api/admin/acompanhamento/regras', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      sinaisCarregados = false;
      var sel = document.getElementById('acomp-sinal');
      Array.prototype.slice.call(sel.options).forEach(function (o) { if (['com_sinal', 'em_espera', 'todos'].indexOf(o.value) === -1) o.remove(); });
      if (corpo.reset) await carregarRegras();
      msg = document.getElementById('acomp-regras-msg');
      if (msg) msg.textContent = corpo.reset ? 'Regras voltaram ao padrão.' : 'Regras salvas. A lista já usa as novas regras.';
      load();
    } catch (err) {
      if (msg) msg.textContent = err.message || 'Não foi possível salvar.';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var vbusca = document.getElementById('versao-busca');
    if (vbusca) vbusca.addEventListener('submit', function (e) { e.preventDefault(); conferirVersao(document.getElementById('versao-q').value.trim()); });
    var regras = document.getElementById('config-regras');
    if (regras) {
      regras.addEventListener('submit', function (e) {
        if (e.target.id !== 'acomp-regras-form') return;
        e.preventDefault();
        salvarRegras(lerFormRegras(e.target));
      });
      regras.addEventListener('click', function (e) {
        if (!e.target.closest('[data-regras-padrao]')) return;
        if (window.confirm('Voltar todas as regras e mensagens ao padrão?')) salvarRegras({ reset: true });
      });
    }
    var f = document.getElementById('acomp-filtros');
    if (!f) return;
    f.addEventListener('submit', function (e) { e.preventDefault(); load(); });
    f.querySelectorAll('select').forEach(function (s) { s.addEventListener('change', load); });
    document.getElementById('btn-acomp-export').addEventListener('click', exportar);
    document.getElementById('acomp-modal-close').addEventListener('click', fecharModal);
    document.getElementById('acomp-modal').addEventListener('click', function (e) { if (e.target.id === 'acomp-modal') fecharModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharModal(); });
    document.getElementById('acomp-lista').addEventListener('click', function (e) {
      var wa = e.target.closest('[data-acomp-wa]');
      if (wa) {
        registrar(wa.getAttribute('data-acomp-wa'), wa.getAttribute('data-motivo'), 'whatsapp');
        wa.textContent = 'WhatsApp aberto ✓';
        return;
      }
      var cp = e.target.closest('[data-acomp-copiar]');
      if (cp) {
        var a = aluno(cp.getAttribute('data-acomp-copiar'));
        if (a && a.sinais[0] && navigator.clipboard) navigator.clipboard.writeText(a.sinais[0].mensagem).then(function () { cp.textContent = 'Copiada ✓'; });
        return;
      }
      var pc = e.target.closest('[data-acomp-percurso]');
      if (pc) percurso(pc.getAttribute('data-acomp-percurso'));
    });
    // O admin.js pode ter aberto esta aba antes deste arquivo carregar.
    var painel = document.getElementById('tab-acompanhamento');
    if (painel && !painel.classList.contains('hidden') && C() && C().token() && !dados) load();
  });

  return { load: load, loadConfig: loadConfig, filtrar: filtrar, carregarFunil: carregarFunil };
})();
