'use strict';

// Resultado do portal: contas criadas no período e até onde elas chegaram (entrou, começou a Aula,
// concluiu, certificado). Fonte única: a mesma lista e as mesmas regras da lista de alunos,
// para o número do painel bater com a quantidade de nomes ao abrir a etapa.

const painel = require('./painel');

const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
const diaSP = (d) => fmtDia.format(new Date(d));
const UM_DIA = 86400000;
const MAX_SEMANAS = 26;
const MIN_COMPARACAO = 5; // com menos contas no período anterior, o percentual engana

const PERIODOS = {
  hoje: { id: 'hoje', dias: 1, rotulo: 'hoje', sinal: 'novas_hoje' },
  7: { id: '7', dias: 7, rotulo: 'nos últimos 7 dias', sinal: 'novas_7d' },
  30: { id: '30', dias: 30, rotulo: 'nos últimos 30 dias', sinal: 'novas_30d' },
  90: { id: '90', dias: 90, rotulo: 'nos últimos 90 dias', sinal: 'novas_90d' },
  todos: { id: 'todos', dias: null, rotulo: 'desde o início', sinal: 'todos' },
};
const FILTROS_NOVAS = { novas_hoje: 1, novas_7d: 7, novas_30d: 30, novas_90d: 90 };

function dataValida(v) {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

// Intervalo escolhido no calendário. Datas invertidas são trocadas; fim no futuro vira hoje.
function intervaloDe(rawDe, rawAte, agora = Date.now()) {
  let de = dataValida(rawDe);
  let ate = dataValida(rawAte);
  if (!de && !ate) return null;
  if (!de) de = ate;
  if (!ate) ate = diaSP(agora);
  if (de > ate) [de, ate] = [ate, de];
  const hoje = diaSP(agora);
  if (ate > hoje) ate = hoje;
  if (de > hoje) de = hoje;
  return { de, ate };
}

const dataBr = (iso) => iso.split('-').reverse().join('/');

function periodoDe(raw, rawDe, rawAte, agora = Date.now()) {
  if (String(raw) === 'datas') {
    const i = intervaloDe(rawDe, rawAte, agora);
    if (i) {
      const dias = Math.round((Date.parse(i.ate) - Date.parse(i.de)) / UM_DIA) + 1;
      const rotulo = i.de === i.ate ? `em ${dataBr(i.de)}` : `de ${dataBr(i.de)} a ${dataBr(i.ate)}`;
      return { id: 'datas', dias, rotulo, sinal: 'todos', de: i.de, ate: i.ate };
    }
  }
  return PERIODOS[String(raw)] || PERIODOS[30];
}

function pct(n, de) {
  return de ? Math.round((100 * n) / de) : null;
}

// Cada etapa inclui as seguintes: quem tem certificado concluiu, começou e entrou.
function etapasDe(a, certificados) {
  const certificado = Boolean(certificados[a.id]);
  const concluiu = certificado || a.niveis_concluidos >= a.total_niveis;
  const comecou = concluiu || Boolean(a.trilha_ultima);
  const entrou = comecou || Boolean(a.primeiro_acesso);
  return { entrou, comecou, concluiu, certificado };
}

function criadaDesde(a, dias, agora = Date.now()) {
  return Boolean(a.created_at) && diaSP(a.created_at) >= diaSP(agora - (dias - 1) * UM_DIA);
}

function temEtapa(a, etapa, certificados, diasAtivo) {
  const e = etapasDe(a, certificados);
  switch (etapa) {
    case 'entrou': return e.entrou;
    case 'nao_entrou': return !e.entrou;
    case 'nao_comecou': return e.entrou && !e.comecou;
    case 'nao_concluiu': return e.comecou && !e.concluiu;
    case 'sem_certificado': return e.concluiu && !e.certificado;
    case 'certificado': return e.certificado;
    case 'parou_de_acessar': return e.entrou && (a.dias_sem_acesso == null || a.dias_sem_acesso >= diasAtivo);
    default: return true;
  }
}

function contar(alunos, certificados, diasAtivo, agora) {
  const c = { contas: alunos.length, entraram: 0, comecaram: 0, concluiram: 0, certificado: 0, ativos: 0, em24: 0, com24h: 0 };
  alunos.forEach((a) => {
    const e = etapasDe(a, certificados);
    if (e.entrou) c.entraram += 1;
    if (e.comecou) c.comecaram += 1;
    if (e.concluiu) c.concluiram += 1;
    if (e.certificado) c.certificado += 1;
    if (e.entrou && a.dias_sem_acesso != null && a.dias_sem_acesso < diasAtivo) c.ativos += 1;
    // Conta com menos de 24 h ainda não teve o prazo inteiro: fica fora da conta.
    const criada = new Date(a.created_at).getTime();
    if (agora - criada >= UM_DIA) {
      c.com24h += 1;
      if (a.primeiro_acesso && new Date(a.primeiro_acesso).getTime() - criada <= UM_DIA) c.em24 += 1;
    }
  });
  return c;
}

const somaDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * UM_DIA).toISOString().slice(0, 10);
function segundaDe(dia) {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return somaDias(dia, -((semana + 6) % 7));
}

function evolucao(alunos, certificados, periodo, agora, versao, contarDesde) {
  const hoje = diaSP(agora);
  const criadas = alunos.filter((a) => a.created_at).map((a) => diaSP(a.created_at));
  const ate = periodo.ate || hoje;
  let inicio;
  if (periodo.id === 'datas') inicio = periodo.de;
  else if (periodo.dias) inicio = somaDias(hoje, -(Math.max(periodo.dias, 7) - 1));
  else inicio = criadas.length ? criadas.reduce((m, d) => (d < m ? d : m)) : somaDias(hoje, -6);
  if (contarDesde && inicio < contarDesde) inicio = contarDesde <= ate ? contarDesde : ate; // antes do corte não há o que mostrar
  const totalDias = Math.round((Date.parse(ate) - Date.parse(inicio)) / UM_DIA) + 1;
  const agrupado = totalDias > 31 ? 'semana' : 'dia';
  const primeiroDia = inicio; // a semana pode começar antes: só contam as contas de dentro do intervalo
  if (agrupado === 'semana') {
    inicio = segundaDe(inicio);
    const limite = somaDias(segundaDe(ate), -7 * (MAX_SEMANAS - 1));
    if (inicio < limite) inicio = limite;
  }
  const passo = agrupado === 'semana' ? 7 : 1;
  const linhas = [];
  const porInicio = new Map();
  for (let d = inicio; d <= ate; d = somaDias(d, passo)) {
    const fim = agrupado === 'semana' ? somaDias(d, 6) : d;
    const antiga = Boolean(versao) && !versao.todos && (!versao.desde || new Date(`${fim}T23:59:59-03:00`) < new Date(versao.desde));
    const linha = { inicio: d, fim, contas: 0, entraram: 0, comecaram: 0, concluiram: 0, certificado: 0, antiga };
    linhas.push(linha);
    porInicio.set(d, linha);
  }
  alunos.forEach((a) => {
    if (!a.created_at) return;
    const dia = diaSP(a.created_at);
    if (dia < primeiroDia || dia > ate) return;
    const linha = porInicio.get(agrupado === 'semana' ? segundaDe(dia) : dia);
    if (!linha) return;
    const e = etapasDe(a, certificados);
    linha.contas += 1;
    if (e.entrou) linha.entraram += 1;
    if (e.comecou) linha.comecaram += 1;
    if (e.concluiu) linha.concluiram += 1;
    if (e.certificado) linha.certificado += 1;
  });
  return { agrupado, linhas };
}

function calcular(lista, certificados, periodoRaw, opts = {}) {
  const agora = opts.agora || Date.now();
  const periodo = typeof periodoRaw === 'object' && periodoRaw ? periodoRaw : periodoDe(periodoRaw, null, null, agora);
  const F = painel.normalizaFaixas(opts.faixas);
  const diasAtivo = F.dias_sumiu;
  const hoje = diaSP(agora);
  const ate = periodo.ate || hoje;
  const de = periodo.de || (periodo.dias ? diaSP(agora - (periodo.dias - 1) * UM_DIA) : null);
  const noPeriodo = lista.filter((a) => {
    if (!a.created_at) return false;
    const d = diaSP(a.created_at);
    return (!de || d >= de) && d <= ate;
  });
  const c = contar(noPeriodo, certificados, diasAtivo, agora);

  let antes = null;
  if (periodo.dias) {
    const deAntes = somaDias(de, -periodo.dias);
    const antesDoCorte = opts.contar_desde && deAntes < opts.contar_desde; // período anterior incompleto: não compara
    if (!antesDoCorte) {
      antes = contar(lista.filter((a) => {
        if (!a.created_at) return false;
        const d = diaSP(a.created_at);
        return d >= deAntes && d < de;
      }), certificados, diasAtivo, agora);
    }
  }

  const etapa = (id, rotulo, n, anteriorN, anteriorRotulo, faixaId, falta) => {
    const conversao = pct(n, anteriorN);
    const pctContas = pct(n, c.contas);
    const pctAntes = antes && antes.contas >= MIN_COMPARACAO ? pct(antes[id], antes.contas) : null;
    return {
      id,
      rotulo,
      n,
      pct_contas: pctContas,
      conversao,
      conversao_de: anteriorRotulo,
      faixa: painel.faixaDe(faixaId, conversao, anteriorN, F),
      meta: painel.metaTexto(faixaId, F),
      anterior_pct: pctAntes,
      variacao: pctAntes == null || pctContas == null ? null : pctContas - pctAntes,
      falta,
    };
  };
  const falta = (n, texto, id) => (n > 0 ? { n, texto, etapa: id } : null);
  const etapas = [
    etapa('entraram', 'Entraram no portal', c.entraram, c.contas, 'das contas', 'entraram',
      falta(c.contas - c.entraram, `${c.contas - c.entraram} ${c.contas - c.entraram === 1 ? 'não entrou' : 'não entraram'}`, 'nao_entrou')),
    etapa('comecaram', 'Começaram a Aula', c.comecaram, c.entraram, 'de quem entrou', 'comecaram_aula',
      falta(c.entraram - c.comecaram, `${c.entraram - c.comecaram} ${c.entraram - c.comecaram === 1 ? 'entrou e não começou' : 'entraram e não começaram'}`, 'nao_comecou')),
    etapa('concluiram', 'Concluíram a Aula', c.concluiram, c.comecaram, 'de quem começou', 'concluiram_aula',
      falta(c.comecaram - c.concluiram, `${c.comecaram - c.concluiram} ${c.comecaram - c.concluiram === 1 ? 'começou e não concluiu' : 'começaram e não concluíram'}`, 'nao_concluiu')),
    etapa('certificado', 'Emitiram o certificado', c.certificado, c.concluiram, 'de quem concluiu', 'certificado',
      falta(c.concluiram - c.certificado, `${c.concluiram - c.certificado} ${c.concluiram - c.certificado === 1 ? 'concluiu sem certificado' : 'concluíram sem certificado'}`, 'sem_certificado')),
  ];

  const pct24 = pct(c.em24, c.com24h);
  const pctAtivos = pct(c.ativos, c.entraram);
  const ev = evolucao(lista, certificados, periodo, agora, opts.versao, opts.contar_desde);
  return {
    periodo: {
      id: periodo.id,
      rotulo: periodo.id === 'todos' && opts.contar_desde ? `desde ${dataBr(opts.contar_desde)}` : periodo.rotulo,
      sinal: periodo.sinal,
      de,
      ate,
    },
    contar_desde: opts.contar_desde || null,
    contas: c.contas,
    contas_anterior: antes ? antes.contas : null,
    etapas,
    primeiro_acesso_24h: { valor: pct24, n: c.em24, de: c.com24h, faixa: painel.faixaDe('entraram_24h', pct24, c.com24h, F), meta: painel.metaTexto('entraram_24h', F) },
    acessando: {
      valor: pctAtivos,
      n: c.ativos,
      de: c.entraram,
      dias: diasAtivo,
      faixa: painel.faixaDe('ativos', pctAtivos, c.entraram, F),
      meta: painel.metaTexto('ativos', F),
      falta: falta(c.entraram - c.ativos, `${c.entraram - c.ativos} ${c.entraram - c.ativos === 1 ? 'parou de acessar' : 'pararam de acessar'}`, 'parou_de_acessar'),
    },
    evolucao: ev,
    tem_versao_antiga: ev.linhas.some((l) => l.antiga && l.contas > 0),
  };
}

module.exports = { calcular, periodoDe, intervaloDe, etapasDe, temEtapa, criadaDesde, diaSP, PERIODOS, FILTROS_NOVAS };
