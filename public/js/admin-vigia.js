/* Admin › Vigia: o retrato de 2 em 2 horas da jornada do calouro (server/vigia.js).
   GET /api/admin/vigia traz o último retrato, a tendência das últimas 24 h e a configuração;
   POST /api/admin/vigia/ler faz uma leitura agora (guarda o retrato, não envia nada).
   Só números agregados: nenhum nome ou contato aparece aqui. */
window.AdminVigia = (function () {
  'use strict';

  var C = function () { return window.AdminCore; };
  var esc = function (t) { return C().escapeHtml(t); };
  var carregando = false;
  var ligado = false;

  var FONTES = [
    ['app', 'Banco do app'], ['app_publico', 'App e gerador de link (endereço público)'], ['n8n', 'n8n (execuções)'],
    ['crm_templates', 'CRM: templates aprovados'], ['crm_bv', 'CRM: logs do BV'], ['crm_email', 'CRM: logs do email_acad'],
    ['crm_atendimento', 'CRM: atendimento (só tendência)'],
  ];
  var ESTADO = {
    ok: ['bom', 'Lido'], parcial: ['regular', 'Lido em parte'], erro: ['ruim', 'Não respondeu'], recusado: ['ruim', 'Chave recusada'],
    sem_acesso: ['sem_dados', 'Sem acesso com o token'], desligado: ['sem_dados', 'Desligado (sem chave)'], sem_lista: ['sem_dados', 'Sem templates-chave'],
  };
  var TENDENCIA = [
    ['vendas', 'Vendas (n8n)'], ['n8n_erros', 'Erros no n8n'], ['entradas', 'Entradas no app'], ['primeiras', 'Primeiras entradas'],
    ['falhas_pct', 'Falhas de login (%)'], ['links_pedidos', 'Pedidos de link'], ['link_vazio_pct', 'Link vazio (%)'],
    ['links_usados', 'Links usados'], ['nunca_entraram', 'Nunca entraram'], ['travados', 'Travados na Aula'],
    ['cert_erros', 'Erros de certificado'], ['bv_failed', 'Passos FAILED no BV'], ['alertas', 'Alertas'],
  ];
  var MAIOR_PIOR = { n8n_erros: 1, falhas_pct: 1, link_vazio_pct: 1, nunca_entraram: 1, travados: 1, cert_erros: 1, bv_failed: 1, alertas: 1 };

  function hora(iso) { return iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function dataHora(iso) {
    return iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  }
  function ha(min) {
    if (min == null) return '';
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.floor(min / 60); var m = min % 60;
    return 'há ' + h + ' h' + (m ? ' ' + m + ' min' : '');
  }
  function v(n, suf) { return n == null ? '—' : String(n).replace('.', ',') + (suf || ''); }
  function kpi(rotulo, valor, sub) {
    return '<div class="av-kpi"><span>' + esc(rotulo) + '</span><b>' + esc(valor) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
  }
  function aviso(txt, tipo) { return '<p class="av-aviso' + (tipo ? ' av-aviso--' + tipo : '') + '">' + txt + '</p>'; }
  function sec(id, titulo, sub, corpo) {
    return '<section class="pn-sec md-sec" aria-labelledby="vg-h-' + id + '"><h3 id="vg-h-' + id + '" class="pn-h3">' + esc(titulo) + '</h3>' +
      (sub ? '<p class="pn-sub">' + sub + '</p>' : '') + corpo + '</section>';
  }
  function selo(estado) {
    var e = ESTADO[estado] || ['sem_dados', estado || '—'];
    return '<span class="pn-selo pn-selo--' + e[0] + '">' + esc(e[1]) + '</span>';
  }

  function avisosTopo(r) {
    var out = [];
    var c = r.config;
    if (!c.ligado) out.push(aviso('<b>Vigia desligado.</b> A leitura de 2 em 2 horas só roda com <code>VIGIA_LIGADO=true</code> no EasyPanel. Dá para ler agora pelo botão.', ''));
    else if (r.atrasado) {
      out.push(aviso('<b>Passou de 2 h 30 min sem leitura' + (r.minutos_sem_leitura != null ? ' (' + esc(ha(r.minutos_sem_leitura)) + ')' : '') + '.</b> O vigia pode estar parado: confira se o app está no ar no EasyPanel. Enquanto ele não roda, nenhum alerta sai.', 'ruim'));
    }
    if (c.ligado && !c.alerta_para) out.push(aviso(c.alerta_para_invalido ? '<b>VIGIA_ALERTA_PARA inválido.</b> Use o id da conversa da equipe no CRM.' : 'Sem <code>VIGIA_ALERTA_PARA</code>: os alertas ficam só nesta aba, nada vai para o WhatsApp.', ''));
    return out.join('');
  }

  function alertasHtml(u) {
    var al = (u && u.alertas) || [];
    if (!u) return '<p class="pn-vazio">Ainda não há leitura. Toque em "Ler agora".</p>';
    if (!al.length) return '<p class="pn-vazio">Nada fora do normal na última leitura.</p>';
    var NIVEL = { critico: ['ruim', 'ruim', 'Crítico'], atencao: ['regular', 'regular', 'Atenção'], info: ['conteudo', 'bom', 'Resultado'] };
    return '<div class="pn-acoes">' + al.map(function (a) {
      var n = NIVEL[a.nivel] || NIVEL.atencao;
      return '<div class="pn-acao pn-acao--' + n[0] + '"><div class="pn-acao-t">' +
        '<p class="pn-acao-h"><span class="pn-selo pn-selo--' + n[1] + '">' + n[2] + '</span>' + esc(a.titulo) + '</p>' +
        '<p class="pn-acao-p">' + esc(a.detalhe) + '</p><p class="pn-acao-p"><b>O que fazer:</b> ' + esc(a.acao) + '</p></div></div>';
    }).join('') + '</div>';
  }

  function envioHtml(r) {
    var u = r.ultimo;
    var e = (u && u.envio) || {};
    var partes = [];
    var ag = r.ultima_agendada;
    if (ag) {
      var MOT = { nada_novo: 'nada novo, não enviou', sem_destino: 'sem destino configurado', envio_desligado: 'envio desligado', sem_token: 'sem CRM_API_TOKEN' };
      partes.push('<p class="pn-sub">Última rodada agendada: ' + esc(dataHora(ag.lido_em)) + ' · ' +
        (ag.enviado ? 'mensagem enviada para a equipe' : esc(MOT[ag.motivo] || ('não enviou: ' + (ag.motivo || '—')))) + '.</p>');
    }
    if (!e.mensagem) return partes.join('') + '<p class="pn-vazio">Sem mensagem nesta leitura.</p>';
    return partes.join('') + '<p class="pn-sub">' + (u.manual ? 'Prévia (leitura manual não envia):' : (e.enviado ? 'Mensagem enviada:' : 'Mensagem montada:')) + '</p>' +
      '<pre class="vg-msg">' + esc(e.mensagem) + '</pre>';
  }

  function fontesHtml(u) {
    var f = (u && u.fontes) || {};
    return '<div class="overflow-x-auto"><table class="pn-sits"><thead><tr><th scope="col">Fonte</th><th scope="col">Situação</th></tr></thead><tbody>' +
      FONTES.map(function (x) {
        var s = f[x[0]] || {};
        var det = s.codigo || s.detalhe || (s.status ? 'HTTP ' + s.status : '');
        return '<tr><td>' + esc(x[1]) + '</td><td>' + selo(s.estado) + (det ? ' <span class="pn-sub">' + esc(det) + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="pn-sub">Os logs das automações e o atendimento do CRM só aceitam login de navegador hoje; com o token eles ficam "sem acesso" e não geram alerta.</p>';
  }

  function indicadoresHtml(u) {
    if (!u) return '';
    var i = u.indicadores || {};
    var a = i.app || {};
    var h = Math.round((i.janela_min || 120) / 6) / 10;
    var lk = a.links || {};
    var fl = a.falhas || {};
    var ev = a.eventos || {};
    var ent = a.entradas || {};
    var orig = Object.keys(ent.por_origem || {}).sort(function (x, y) { return ent.por_origem[y] - ent.por_origem[x]; })
      .map(function (k) { return k + ' ' + ent.por_origem[k]; }).join(' · ');
    var kp = [
      kpi('Vendas (n8n)', v(i.n8n ? i.n8n.vendas : null), 'em ' + h + ' h'),
      kpi('Entradas no app', v(ent.total), orig || 'sem entradas'),
      kpi('Primeiras entradas', v(ent.primeiras), 'contas que entraram pela 1ª vez'),
      kpi('Falhas de login', v(fl.pct, '%'), (fl.total || 0) + ' de ' + (fl.tentativas || 0) + ' tentativas'),
      kpi('Link de acesso vazio', v(lk.vazio_pct, '%'), (lk.falhas || 0) + ' de ' + (lk.pedidos || 0) + ' pedidos · ' + (lk.usados || 0) + ' usados'),
      kpi('Nunca entraram', v(a.contas && a.contas.nunca_entraram), 'de ' + v(a.contas && a.contas.contas) + ' contas no recorte'),
      kpi('Travados na Aula', v(a.travados), 'tocaram em "Travei" e não concluíram'),
      kpi('Certificado', v(ev.certificado_gerado), (ev.certificado_erro || 0) + ' erro(s) em ' + h + ' h'),
      kpi('Vídeos', v(ev.video_inicio), (ev.video_fim || 0) + ' concluídos em ' + h + ' h'),
    ];
    var n8n = '';
    if (i.n8n) {
      n8n = '<div class="overflow-x-auto"><table class="pn-sits"><thead><tr><th scope="col">Fluxo do n8n</th><th scope="col" class="pn-num">Execuções</th><th scope="col" class="pn-num">Com erro</th><th scope="col" class="pn-num">Último erro</th></tr></thead><tbody>' +
        i.n8n.fluxos.map(function (f) {
          if (!f.lido) return '<tr><td>' + esc(f.nome) + '</td><td class="pn-num" colspan="3">não lido</td></tr>';
          return '<tr><td>' + esc(f.nome) + '</td><td class="pn-num"><b>' + f.total + '</b></td><td class="pn-num"><b>' + f.erro + '</b></td><td class="pn-num">' + esc(f.ultimo_erro_em ? hora(f.ultimo_erro_em) : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    var crm = '';
    if (i.crm && i.crm.templates && i.crm.templates.length) {
      crm = '<div class="overflow-x-auto"><table class="pn-sits"><thead><tr><th scope="col">Template-chave</th><th scope="col">Status</th><th scope="col">Categoria</th></tr></thead><tbody>' +
        i.crm.templates.map(function (t) {
          return '<tr><td>' + esc(t.nome) + '</td><td>' + (t.aprovado ? '<span class="pn-selo pn-selo--bom">APPROVED</span>' : '<span class="pn-selo pn-selo--ruim">Fora de APPROVED</span>') + '</td><td>' + esc(t.categoria || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return '<div class="av-kpis">' + kp.join('') + '</div>' + n8n + crm;
  }

  // Régua: por código de mensagem (?o=), quem entrou em 24 h; e os testes A/B (códigos terminados em _a, _b...).
  var ESTADO_TESTE = { vencedor: ['bom', 'Vencedor'], coletando: ['sem_dados', 'Coletando'], empate: ['regular', 'Sem diferença ainda'] };
  function reguaHtml(u) {
    var g = u && u.indicadores && u.indicadores.regua;
    if (!g) return '<p class="pn-vazio">Sem dados da régua nesta leitura.</p>';
    if (!g.mensagens.length) return '<p class="pn-vazio">Nenhum link da régua com 24 h completas nos últimos ' + g.dias + ' dias. Cada mensagem precisa de um código próprio no link (bv_acesso, fup1_a, fup1_b...).</p>';
    var linhas = g.mensagens.map(function (m) {
      return '<tr><td>' + esc(m.origem) + '</td><td class="pn-num"><b>' + m.base + '</b></td><td class="pn-num"><b>' + m.entraram + '</b></td><td class="pn-num"><b>' + esc(v(m.pct, '%')) + '</b>' +
        '<div class="rs-barra md-barra" aria-hidden="true"><i style="width:' + (m.pct || 0) + '%"></i></div></td></tr>';
    }).join('');
    var tab = '<div class="overflow-x-auto"><table class="pn-sits"><thead><tr><th scope="col">Mensagem (código)</th><th scope="col" class="pn-num">Receberam</th><th scope="col" class="pn-num">Entraram em 24 h</th><th scope="col" class="pn-num">Taxa</th></tr></thead><tbody>' + linhas + '</tbody></table></div>';
    var testes = (g.testes || []).map(function (t) {
      var e = ESTADO_TESTE[t.estado] || ESTADO_TESTE.coletando;
      var vs = t.variantes.map(function (x) { return (x.variante === t.vencedor ? '<b>' : '') + esc(x.variante + ' ' + v(x.pct, '%') + ' (' + x.entraram + ' de ' + x.base + ')') + (x.variante === t.vencedor ? '</b>' : ''); }).join(' · ');
      var nota = t.estado === 'coletando' ? ' Faltam ' + t.faltam + ' contas para decidir.' : t.estado === 'empate' ? ' Amostra completa, mas a diferença ainda pode ser acaso.' : '';
      return '<p class="pn-sub"><span class="pn-selo pn-selo--' + e[0] + '">' + e[1] + '</span> Teste <b>' + esc(t.teste) + '</b>: ' + vs + '.' + esc(nota) + '</p>';
    }).join('');
    return tab + (testes || '<p class="pn-sub">Nenhum teste A/B ativo (códigos terminados em _a, _b...).</p>');
  }

  function tendenciaHtml(r) {
    var t = r.tendencia || [];
    if (!t.length) return '<p class="pn-vazio">Sem leituras nas últimas 24 h.</p>';
    var cab = '<th scope="col">Indicador</th>' + t.map(function (x) {
      return '<th scope="col" class="pn-num">' + esc(hora(x.lido_em)) + (x.manual ? '<small class="md-nota">manual</small>' : '') + '</th>';
    }).join('');
    var linhas = TENDENCIA.map(function (k) {
      var ant = null;
      return '<tr><th scope="row">' + esc(k[1]) + '</th>' + t.map(function (x) {
        var n = x.resumo ? x.resumo[k[0]] : null;
        var cls = '';
        if (n != null && ant != null && n !== ant) cls = ((n > ant) === Boolean(MAIOR_PIOR[k[0]])) ? ' vg-pior' : ' vg-melhor';
        if (n != null) ant = n;
        return '<td class="pn-num' + cls + '">' + esc(v(n)) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="overflow-x-auto"><table class="pn-sits vg-tend"><thead><tr>' + cab + '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
  }

  function pintar(r) {
    var el = document.getElementById('vigia-corpo');
    var st = document.getElementById('vigia-status');
    var u = r.ultimo;
    st.textContent = u ? 'Última leitura: ' + dataHora(u.lido_em) + ' (' + ha(Math.round((Date.now() - new Date(u.lido_em).getTime()) / 60000)) + ')' +
      (r.config.ligado ? ' · próxima faixa: ' + hora(r.proxima_faixa) : '') : 'Sem leitura ainda';
    var h = Math.round((r.config.limites.janela_min || 120) / 6) / 10;
    el.innerHTML = avisosTopo(r) +
      sec('alertas', 'Alertas abertos', 'Da última leitura, com a ação sugerida. Janela: últimas ' + h + ' h.', alertasHtml(u)) +
      sec('retrato', 'Retrato', u ? 'Leitura de ' + esc(dataHora(u.lido_em)) + (u.manual ? ' (manual)' : '') + ', janela de ' + esc(hora(u.janela_inicio)) + ' a ' + esc(hora(u.lido_em)) + '.' : '', indicadoresHtml(u)) +
      sec('regua', 'Régua: o que funciona', 'Por mensagem: contas que receberam o link e ainda não tinham entrado, e quantas entraram em até 24 h por qualquer caminho. Últimos ' +
        esc(String((u && u.indicadores && u.indicadores.regua && u.indicadores.regua.dias) || 14)) + ' dias.', reguaHtml(u)) +
      sec('tendencia', 'Tendência das últimas 24 h', 'Uma coluna por leitura. Vermelho: piorou em relação à anterior; verde: melhorou.', tendenciaHtml(r)) +
      sec('envio', 'Mensagem para a equipe', 'Uma mensagem por rodada, só com alertas novos ou que voltaram ao normal.', envioHtml(r)) +
      sec('fontes', 'Fontes', '', fontesHtml(u));
  }

  async function load(ler) {
    if (carregando) return;
    carregando = true;
    var msg = document.getElementById('vigia-msg');
    var btn = document.getElementById('vigia-ler');
    msg.textContent = ler ? 'Lendo o app, o n8n e o CRM...' : 'Carregando...';
    if (btn) btn.disabled = true;
    try {
      var r = await C().request(ler ? '/api/admin/vigia/ler' : '/api/admin/vigia', ler ? { method: 'POST' } : undefined);
      msg.textContent = '';
      pintar(r);
    } catch (err) {
      msg.textContent = err.message || 'Não foi possível carregar o Vigia.';
    } finally {
      carregando = false;
      if (btn) btn.disabled = false;
    }
  }

  function iniciar() {
    if (!ligado) {
      ligado = true;
      document.getElementById('vigia-ler').addEventListener('click', function () { load(true); });
      document.getElementById('vigia-atualizar').addEventListener('click', function () { load(false); });
    }
    load(false);
  }

  return { load: iniciar };
})();
