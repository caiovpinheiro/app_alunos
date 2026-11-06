/* Admin › Medição: as respostas que decidem o que produzir a seguir. Dados de GET /api/admin/medicao?dias=N
   (server/medicao.js). Cinco sub-abas (#medicao/retencao, /resultado, /saidas, /ajuda, /entrada).
   Só números agregados: os nomes ficam em Quem contatar e no percurso de cada aluno. */
window.AdminMedicao = (function () {
  'use strict';

  var C = function () { return window.AdminCore; };
  var esc = function (t) { return C().escapeHtml(t); };
  var ultimo = null;
  var carregando = false;
  var ligado = false;

  var MOTIVOS = [
    ['senha_incorreta', 'Senha errada'], ['conta_nao_encontrada', 'Sem conta'], ['conta_inativa', 'Desativada'],
    ['campos_vazios', 'Vazio'], ['erro_interno', 'Erro'], ['esqueci_senha', 'Esqueci a senha'],
  ];
  var CARTAO_TIPO = { modulo: 'Módulos da Aula', video: 'Vídeos da Central', faq: 'Dúvidas da Central' };
  var ORIGEM_ROTULO = { sem_origem: 'Sem origem (link sem ?o=)', bv: 'bv (régua de boas-vindas)', reenvio: 'reenvio (campanha de reenvio)', polo: 'polo (enviado pelo polo)' };

  // ---------- formatação ----------
  function diaBr(iso) { if (!iso) return '—'; var p = String(iso).slice(0, 10).split('-'); return p[2] + '/' + p[1]; }
  function semanaTxt(ini) {
    var d = new Date(ini + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 6);
    return diaBr(ini) + ' a ' + diaBr(d.toISOString().slice(0, 10));
  }
  function quandoTxt(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function pctTxt(v) { return v == null ? '—' : v + '%'; }
  function pct(n, de) { return de ? Math.round(n / de * 100) : null; }
  function tempo(min) {
    if (min == null) return '—';
    if (min < 60) return Math.max(1, Math.round(min)) + ' min';
    if (min < 48 * 60) return Math.floor(min / 60) + ' h' + (min % 60 >= 1 ? ' ' + Math.round(min % 60) + ' min' : '');
    return Math.round(min / 1440) + ' dias';
  }
  function num(n, sub) {
    return '<td class="pn-num"><b>' + (n == null ? '—' : n) + '</b>' + (sub == null || sub === '' ? '' : ' <span>' + esc(sub) + '</span>') + '</td>';
  }
  function kpi(rotulo, valor, sub) {
    return '<div class="av-kpi"><span>' + esc(rotulo) + '</span><b>' + esc(valor) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
  }
  function aviso(html, tipo) { return '<p class="av-aviso' + (tipo ? ' av-aviso--' + tipo : '') + '">' + html + '</p>'; }
  function sec(id, titulo, sub, corpo) {
    return '<section class="pn-sec md-sec" aria-labelledby="md-h-' + id + '"><h3 id="md-h-' + id + '" class="pn-h3">' + esc(titulo) + '</h3>' +
      (sub ? '<p class="pn-sub">' + sub + '</p>' : '') + corpo + '</section>';
  }
  function tabela(classe, cab, linhas, vazio) {
    if (!linhas) return '<p class="pn-vazio">' + esc(vazio) + '</p>';
    return '<div class="overflow-x-auto"><table class="pn-sits ' + (classe || '') + '"><thead><tr>' + cab.map(function (c, i) {
      return '<th scope="col"' + (i ? ' class="pn-num"' : '') + '>' + esc(c) + '</th>';
    }).join('') + '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
  }
  function desdeTxt(iso, oque) {
    var q = quandoTxt(iso);
    return q ? 'Medindo ' + oque + ' desde ' + q + '.' : 'Ainda sem dados de ' + oque + ': a medida passa a existir depois da publicação.';
  }
  // Barra empilhada: conseguiu / não conseguiu / não respondeu.
  function pilha(x) {
    var t = x.base || 0;
    if (!t) return '<td class="md-pilha-c"></td>';
    var w = function (n) { return (n / t * 100).toFixed(1) + '%'; };
    return '<td class="md-pilha-c"><div class="md-pilha" role="img" aria-label="' + x.conseguiu + ' conseguiram, ' + x.nao_conseguiu + ' não conseguiram, ' + x.sem_resposta + ' não responderam">' +
      '<i class="md-sim" style="width:' + w(x.conseguiu) + '"></i><i class="md-nao" style="width:' + w(x.nao_conseguiu) + '"></i><i class="md-sem" style="width:' + w(x.sem_resposta) + '"></i></div></td>';
  }

  // ---------- 1. retenção ----------
  function celRet(j) {
    if (!j.elegiveis && !j.no_prazo) return '<td class="pn-num md-vazia">—</td>';
    if (!j.elegiveis) return '<td class="pn-num md-andamento"><span>no prazo</span><small class="md-nota">' + j.no_prazo + ' aluno(s)</small></td>';
    var cls = !j.completa ? ' md-andamento' : j.poucos ? ' md-poucos' : '';
    var nota = !j.completa ? 'em andamento' : j.poucos ? 'poucos dados' : '';
    return '<td class="pn-num' + cls + '"><b>' + pctTxt(j.pct) + '</b> <span>' + j.voltaram + ' de ' + j.elegiveis + '</span>' +
      (nota ? '<small class="md-nota">' + nota + '</small>' : '') +
      '<div class="rs-barra md-barra" aria-hidden="true"><i style="width:' + (j.pct || 0) + '%"></i></div></td>';
  }
  function retencaoHtml(r) {
    var R = r.retencao;
    var kpis = R.janelas.map(function (n) {
      var c = R.comparacao[n];
      return kpi('Voltou até D+' + n, c.coortes ? pctTxt(c.pct) : '—', c.coortes
        ? c.coortes + ' coorte(s) com prazo completo' + (c.melhor && c.pior ? ' · melhor ' + pctTxt(c.melhor.pct) + ' (sem. ' + diaBr(c.melhor.semana) + '), pior ' + pctTxt(c.pior.pct) + ' (sem. ' + diaBr(c.pior.semana) + ')' : '')
        : 'Nenhuma coorte com o prazo completo e 5+ alunos');
    }).join('');
    var linhas = R.coortes.map(function (c) {
      return '<tr><th scope="row">' + esc(semanaTxt(c.semana)) + (c.semana < (r.contar_desde || '') ? '<small>semana começa antes do corte (' + esc(diaBr(r.contar_desde)) + ')</small>' : '') + '</th>' +
        num(c.contas) + num(c.entraram, pctTxt(pct(c.entraram, c.contas))) + num(c.rastreadas, pctTxt(pct(c.rastreadas, c.contas))) +
        R.janelas.map(function (n) { return celRet(c.janelas[n]); }).join('') + '</tr>';
    }).join('');
    return '<div class="av-kpis md-kpis">' + kpis + '</div>' +
      aviso('<b>Só contas rastreadas.</b> A retenção sai de <code>csu_acessos</code>: conta só quem tem acesso registrado pelo rastreio do portal. ' +
        'D0 é o primeiro dia com acesso; "voltou até D+7" = entrou de novo em outro dia, do dia seguinte até 7 dias depois. ' +
        'Cada aluno só entra na conta quando o prazo dele terminou. Compare só as coortes sem "em andamento". ' + esc(desdeTxt(r.desde && r.desde.acessos, 'acessos'))) +
      sec('ret', 'Por semana de criação da conta', 'Cada linha é a semana (segunda a domingo) em que a conta foi criada, nas últimas 12 semanas. "Entraram" vem do login; "Rastreadas" são as que têm acesso registrado e formam a base da retenção.',
        tabela('md-ret', ['Semana', 'Contas', 'Entraram', 'Rastreadas'].concat(R.janelas.map(function (n) { return 'Voltou até D+' + n; })), linhas, 'Nenhuma conta criada nas últimas 12 semanas.'));
  }

  // ---------- 2. resultado prático ----------
  function resultadoHtml(r) {
    var x = r.resultado;
    var t = x.totais;
    var kpis = ['modulo', 'video', 'faq'].map(function (k) {
      var v = t[k];
      var resp = v.conseguiu + v.nao;
      return kpi(CARTAO_TIPO[k] + ': deu certo', resp ? pctTxt(v.pct_conseguiu) : '—', resp ? v.conseguiu + ' de ' + resp + ' respostas · ' + Math.max(0, v.sem_resposta) + ' sem resposta' : 'Ninguém respondeu ainda');
    }).join('');
    var linhaItem = function (i) {
      return '<tr><th scope="row">' + esc(i.titulo) + '<small>' + esc(CARTAO_TIPO[i.tipo] || i.tipo) + '</small></th>' +
        num(i.base) + num(i.conseguiu) + num(i.nao_conseguiu, i.pct_nao == null ? '' : i.pct_nao + '%') + num(i.sem_resposta) +
        num(pctTxt(i.pct_conseguiu), i.poucos && (i.conseguiu + i.nao_conseguiu) ? 'poucos dados' : '') + pilha(i) + '</tr>';
    };
    var cab = ['Conteúdo', 'Viram', 'Deu certo', 'Não funcionou', 'Não respondeu', '% deu certo', ''];
    var piores = x.piores.length ? x.piores.map(linhaItem).join('') : '';
    var mods = x.modulos.map(linhaItem).join('');
    var outros = x.conteudos.slice(0, 30).map(linhaItem).join('');
    return '<div class="av-kpis md-kpis">' + kpis + '</div>' +
      aviso('"Conseguiu fazer?" aparece no fim de cada módulo da Aula, de cada vídeo e de cada dúvida da Central. "Viram" = concluíram o módulo ou abriram o vídeo/dúvida no período, depois que a pergunta passou a existir; ' +
        'quem respondeu sem estar nessa base também conta. ' + esc(desdeTxt(r.desde && r.desde.pratica, 'respostas'))) +
      sec('piores', 'Os 5 piores', 'Maior parte de "Não funcionou" entre quem respondeu. É por aqui que começa a revisão de conteúdo.',
        tabela('md-res', cab, piores, 'Nenhum "Não funcionou" no período.')) +
      sec('mods', 'Por módulo da Aula Inaugural', '<span class="md-leg"><span><i class="md-sim"></i>Deu certo</span><span><i class="md-nao"></i>Não funcionou</span><span><i class="md-sem"></i>Não respondeu</span></span>',
        tabela('md-res', cab, mods, 'Sem módulos.')) +
      sec('cent', 'Vídeos e dúvidas da Central', 'Os 30 com mais "Não funcionou" (depois, os mais vistos).',
        tabela('md-res', cab, outros, 'Nenhum vídeo ou dúvida aberto desde que a pergunta existe.'));
  }

  // ---------- 3. saídas ----------
  function saidasHtml(r) {
    var s = r.saidas;
    var f = s.fazer_agora;
    var ordem = Object.keys(s.destinos);
    var kpis = kpi('Saídas para a faculdade', s.cliques, s.alunos + ' aluno(s)') +
      kpi('Módulo 1: "Fazer agora"', f.agora, f.depois ? f.depois + ' escolheram só "Fazer depois"' : '') +
      kpi('Fizeram agora e saíram', f.agora ? pctTxt(f.pct_sairam) : '—', f.agora ? f.sairam + ' de ' + f.agora + ' em até ' + f.horas + ' h' + (f.poucos ? ' · poucos dados' : '') : 'Ninguém tocou em "Fazer agora"') +
      kpi('Fizeram agora e foram ao AVA', f.agora ? pctTxt(f.pct_ava) : '—', f.agora ? f.sairam_ava + ' de ' + f.agora : '');
    var porDestino = s.por_destino.map(function (d) {
      return '<tr><th scope="row">' + esc(d.rotulo) + '</th>' + num(d.cliques) + num(d.alunos, pctTxt(pct(d.alunos, s.alunos))) + '</tr>';
    }).join('');
    var porOrigem = s.por_origem.map(function (o) {
      return '<tr><th scope="row">' + esc(o.rotulo) + '</th>' + num(o.cliques) + num(o.alunos) +
        ordem.map(function (k) { return num(o.destinos[k] || 0); }).join('') + '</tr>';
    }).join('');
    return '<div class="av-kpis md-kpis">' + kpis + '</div>' +
      aviso('Conta o toque em links para o AVA, a Área do Aluno, o e-mail acadêmico e as lojas do Duda e do Authenticator, de qualquer tela do portal. Mostra a intenção de sair, não se o login lá deu certo. ' +
        esc(desdeTxt(r.desde && r.desde.saidas, 'saídas'))) +
      sec('dest', 'Por destino', '', tabela('', ['Destino', 'Toques', 'Alunos'], porDestino, 'Nenhuma saída no período.')) +
      sec('orig', 'Por onde o aluno estava', 'Módulo da Aula Inaugural quando o link estava num módulo; senão, a tela.',
        tabela('md-orig', ['Onde', 'Toques', 'Alunos'].concat(ordem.map(function (k) { return s.destinos[k]; })), porOrigem, 'Nenhuma saída no período.'));
  }

  // ---------- 4. ajuda ----------
  function ajudaHtml(r) {
    var a = r.ajuda;
    var linha = function (x, total) {
      return '<tr' + (total ? ' class="av-total"' : '') + '><th scope="row">' + esc(x.rotulo) + '</th>' + num(x.oferecida) + num(x.recusada) +
        num(x.aceita, x.pct_aceita == null ? '' : x.pct_aceita + '% das ofertas') + num(x.atendida) +
        num(x.resolvida, x.pct_resolvida == null ? '' : x.pct_resolvida + '% das aceitas') +
        '<td class="pn-num">' + esc(tempo(x.mediana_atender_min)) + '</td><td class="pn-num">' + esc(tempo(x.mediana_resolver_min)) + '</td></tr>';
    };
    var linhas = a.origens.length ? linha(a.total, true) + a.origens.map(function (x) { return linha(x); }).join('') : '';
    var t = a.total;
    var kpis = kpi('Ofertas', t.oferecida, t.recusada + ' "Agora não"') +
      kpi('Aceitas', t.aceita, (t.oferecida ? pctTxt(t.pct_aceita) + ' das ofertas' : 'sem ofertas no período') + ' · o total inclui os pedidos pelo painel, que não têm oferta') +
      kpi('Resolvidas', t.resolvida, pctTxt(t.pct_resolvida) + ' das aceitas') +
      kpi('Tempo até resolver', tempo(t.mediana_resolver_min), 'mediana; até atender: ' + tempo(t.mediana_atender_min));
    return '<div class="av-kpis md-kpis">' + kpis + '</div>' +
      aviso('Oferecida e recusada vêm do rastreio (eventos <code>ajuda_oferecida</code> e <code>ajuda_recusada</code>); aceita, atendida e resolvida vêm dos pedidos (Quem contatar), que só viram "resolvido" quando a equipe marca. Tempos contados a partir do pedido.') +
      sec('ajuda', 'Por origem da oferta', '',
        tabela('md-ajuda', ['Origem', 'Oferecida', 'Recusada', 'Aceita', 'Atendida', 'Resolvida', 'Até atender', 'Até resolver'], linhas, 'Nenhuma oferta nem pedido no período.'));
  }

  // ---------- 5. entrada ----------
  function origemRot(o) { return ORIGEM_ROTULO[o] || o; }
  function entradaHtml(r) {
    var e = r.entrada;
    var origens = e.origens;
    var coortes = e.coortes.map(function (c) {
      var med = c.contas - c.nao_entrou - c.antes;
      return '<tr><th scope="row">' + esc(semanaTxt(c.semana)) + '</th>' + num(c.contas) + num(c.nao_entrou) + num(c.antes) +
        origens.map(function (o) { var n = c.origens[o] || 0; return num(n, med && n ? pctTxt(pct(n, med)) : ''); }).join('') + '</tr>';
    }).join('');
    var entradas = (e.entradas || []).map(function (x) {
      return '<tr><th scope="row">' + esc(origemRot(x.origem)) + '</th>' + num(x.entradas) + num(x.primeiras) + num(x.alunos) + '</tr>';
    }).join('');
    var F = e.falhas;
    var max = F.dias.reduce(function (m, d) { return Math.max(m, d.total); }, 0);
    var falhas = F.dias.map(function (d) {
      return '<tr><th scope="row">' + esc(diaBr(d.dia)) + '</th>' + num(d.total) +
        MOTIVOS.map(function (m) { return num(d.motivos[m[0]] || 0); }).join('') + num(d.contas) +
        '<td class="md-falha-c"><div class="rs-barra" aria-hidden="true"><i style="width:' + (max ? Math.round(d.total / max * 100) : 0) + '%"></i></div></td></tr>';
    }).join('');
    var kpis = kpi('Falhas de login', F.total, F.contas_identificadas + ' conta(s) identificada(s)') +
      kpi('Senha incorreta', F.motivos.senha_incorreta || 0, 'RGM/e-mail certo, senha errada') +
      kpi('Sem conta', F.motivos.conta_nao_encontrada || 0, 'RGM ou e-mail que não existe aqui') +
      kpi('"Esqueci minha senha"', F.motivos.esqueci_senha || 0, 'toques no link da tela de login');
    return '<div class="av-kpis md-kpis">' + kpis + '</div>' +
      aviso('A origem vem do parâmetro <code>?o=</code> do link de entrada (ex.: <code>app.cruzeiroead.com.br/?o=bv</code>) e é gravada no login. Sem RGM, e-mail ou senha: as falhas guardam só o motivo, a hora e, quando o RGM/e-mail bate com uma conta, o id dela. ' +
        esc(desdeTxt(r.desde && r.desde.entradas, 'entradas'))) +
      sec('orig', 'Origem do primeiro acesso, por semana de criação', '"Antes da medição": a conta entrou pela primeira vez antes de a origem ser gravada. A porcentagem é sobre quem entrou com a origem medida.',
        tabela('md-origem', ['Semana', 'Contas', 'Não entrou', 'Antes da medição'].concat(origens.map(origemRot)), coortes, 'Nenhuma conta nas últimas 12 semanas.')) +
      sec('ent', 'Entradas no período, por origem', 'Todo login ou cadastro que deu certo, inclusive de quem volta. "Primeiras" = primeira entrada da conta.',
        tabela('', ['Origem', 'Entradas', 'Primeiras', 'Alunos'], entradas, 'Nenhuma entrada gravada no período.')) +
      sec('falhas', 'Falhas de login por dia', '', tabela('md-falhas', ['Dia', 'Total'].concat(MOTIVOS.map(function (m) { return m[1]; })).concat(['Contas', '']), falhas, 'Nenhuma falha de login no período.'));
  }

  // ---------- montagem ----------
  function render(r) {
    var corpo = {
      retencao: retencaoHtml(r), resultado: resultadoHtml(r), saidas: saidasHtml(r), ajuda: ajudaHtml(r), entrada: entradaHtml(r),
    };
    Object.keys(corpo).forEach(function (k) {
      var el = document.getElementById('medicao-' + k);
      if (el) el.innerHTML = corpo[k];
    });
    var st = document.getElementById('medicao-status');
    if (st) {
      st.textContent = 'Atualizado às ' + new Date(r.gerado_em).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) +
        (r.contar_desde ? ' · contas criadas desde ' + diaBr(r.contar_desde) : ' · todas as contas');
    }
  }

  async function load() {
    if (!ligado) {
      ligado = true;
      var sel = document.getElementById('medicao-dias');
      if (sel) sel.addEventListener('change', load);
      var bt = document.getElementById('medicao-atualizar');
      if (bt) bt.addEventListener('click', load);
    }
    if (carregando) return;
    carregando = true;
    var msg = document.getElementById('medicao-msg');
    var dias = (document.getElementById('medicao-dias') || {}).value || '30';
    if (msg) msg.textContent = ultimo ? '' : 'Carregando...';
    try {
      ultimo = await C().request('/api/admin/medicao?dias=' + encodeURIComponent(dias));
      render(ultimo);
      if (msg) msg.textContent = '';
    } catch (err) {
      if (msg) msg.textContent = err.message || 'Não foi possível carregar a Medição.';
    } finally {
      carregando = false;
    }
  }

  return { load: load };
})();
