'use strict';

// Admin › Ao vivo: funil do portal e régua do CRM, para o time acompanhar a meta de 100%.
// Só números agregados de alunos: nome, telefone, e-mail e RGM são usados aqui dentro e nunca saem na resposta.
// As etapas vêm de resultado.etapasDe, a mesma regra da Visão geral e de Quem contatar.

const { etapasDe, diaSP } = require('./resultado');
const { soDigitos } = require('./ao-vivo-regua');

const UM_DIA = 86400000;
// Foco do painel: as contas novas, já sob a régua atual. A base inteira continua a um clique.
const NOVOS_DESDE = '2026-11-04';
const baseValida = (raw) => (raw === 'todas' ? 'todas' : 'novos');
const desdeDaBase = (base, corte) => (base === 'todas' || corte > NOVOS_DESDE ? corte : NOVOS_DESDE);
const diaBr = (iso) => iso.split('-').reverse().slice(0, 2).join('/');
function basesDe(corte) {
  return [
    { id: 'novos', rotulo: `Novos, desde ${diaBr(desdeDaBase('novos', corte))}` },
    { id: 'todas', rotulo: `Todas, desde ${diaBr(corte)}` },
  ];
}
const pct = (n, de) => (de ? Math.round((100 * n) / de) : null);
const somaDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * UM_DIA).toISOString().slice(0, 10);

function diasDesde(desde, hoje) {
  const dias = [];
  for (let d = desde; d <= hoje; d = somaDias(d, 1)) dias.push(d);
  return dias;
}

const linhaVazia = (dia) => ({ dia, contas: 0, entraram: 0, em24: 0, com24h: 0, comecaram: 0, concluiram: 0, certificado: 0, primeiros_acessos: 0 });

function somar(alvo, a, e, agora) {
  alvo.contas += 1;
  if (e.entrou) alvo.entraram += 1;
  if (e.comecou) alvo.comecaram += 1;
  if (e.concluiu) alvo.concluiram += 1;
  if (e.certificado) alvo.certificado += 1;
  const criada = new Date(a.created_at).getTime();
  // Conta com menos de 24 h ainda não teve o prazo inteiro: fica fora da conta.
  if (agora - criada >= UM_DIA) {
    alvo.com24h += 1;
    if (a.primeiro_acesso && new Date(a.primeiro_acesso).getTime() - criada <= UM_DIA) alvo.em24 += 1;
  }
}

// Em qual módulo o aluno está parado: o primeiro aberto sem concluir ou, sem nenhum, o seguinte ao último concluído.
function moduloParado(a) {
  const total = a.total_niveis || 7;
  const n = a.nivel_aberto || (a.niveis_concluidos || 0) + 1;
  return Math.max(1, Math.min(total, n));
}

// Por que a pessoa nunca entrou. Uma razão só: primeiro o que a régua sabe dela.
function motivoNaoEntrou(a, ctx) {
  const criada = new Date(a.created_at).getTime();
  if (ctx.agora - criada < UM_DIA) return 'no_prazo';
  const rgm = soDigitos(a.rgm);
  // Conta anterior ao primeiro aviso do CRM: não dá para saber o que ela recebeu.
  const conhecida = Boolean(ctx.alcance) && criada >= ctx.alcance.inicio;
  if (conhecida && ctx.alcance.login.has(rgm)) return 'login_nao_entrou';
  if (conhecida && ctx.alcance.oferta.has(rgm)) return 'oferta_sem_login';
  if (conhecida && ctx.alcance.sem_senha.has(rgm)) return 'sem_senha';
  if (ctx.telefones && soDigitos(ctx.telefones.get(a.rgm)).length < 10) return 'sem_telefone';
  return conhecida ? 'sem_registro' : 'nao_entrou';
}

const MOTIVOS = [
  { id: 'no_prazo', etapa: 'acesso', texto: 'Conta com menos de 24 h: ainda no prazo', dono: 'Aguardar' },
  { id: 'sem_telefone', etapa: 'acesso', texto: 'Nunca entraram e não têm telefone válido: a régua não alcança', dono: 'Corrigir o cadastro' },
  { id: 'sem_senha', etapa: 'acesso', texto: 'Nunca entraram e o negócio nasceu sem senha: podem ter ido para a mensagem sem link', dono: 'CRM' },
  { id: 'sem_registro', etapa: 'acesso', texto: 'Nunca entraram e não há aviso delas na régua (sem negócio no CRM ou sem RGM)', dono: 'CRM' },
  { id: 'oferta_sem_login', etapa: 'acesso', texto: 'Receberam a oferta e não pediram o login', dono: 'CRM' },
  { id: 'login_nao_entrou', etapa: 'acesso', texto: 'Receberam o login e não entraram', dono: 'Atendimento' },
  { id: 'nao_entrou', etapa: 'acesso', texto: 'Nunca entraram (conta anterior aos avisos do CRM)', dono: 'CRM' },
  { id: 'nao_comecou', etapa: 'aula', texto: 'Entraram e não começaram a Aula', dono: 'Produto e CRM' },
  { id: 'nao_concluiu', etapa: 'aula', texto: 'Começaram e não concluíram a Aula', dono: 'Produto e atendimento' },
  { id: 'cert_erro', etapa: 'certificado', texto: 'Concluíram e deu erro ao gerar o certificado', dono: 'Produto' },
  { id: 'cert_sem_tentar', etapa: 'certificado', texto: 'Concluíram e ainda não geraram o certificado', dono: 'CRM' },
];

function funil(lista, certificados, opts) {
  const { desde, agora = Date.now(), niveis = [] } = opts;
  const hoje = diaSP(agora);
  const dias = new Map(diasDesde(desde, hoje).map((d) => [d, linhaVazia(d)]));
  const total = linhaVazia(null);
  const faltam = {};
  MOTIVOS.forEach((m) => { faltam[m.id] = 0; });
  const parados = {};
  niveis.forEach((_, i) => { parados[i + 1] = { aqui: 0, ha_24h: 0 }; });
  const ctx = { agora, telefones: opts.telefones || null, alcance: opts.alcance || null };

  lista.forEach((a) => {
    if (!a.created_at) return;
    const dia = diaSP(a.created_at);
    if (dia < desde || dia > hoje) return;
    const e = etapasDe(a, certificados);
    somar(total, a, e, agora);
    somar(dias.get(dia), a, e, agora);
    if (a.primeiro_acesso) {
      const diaAcesso = diaSP(a.primeiro_acesso);
      if (dias.has(diaAcesso)) dias.get(diaAcesso).primeiros_acessos += 1;
      if (diaAcesso >= desde && diaAcesso <= hoje) total.primeiros_acessos += 1;
    }
    if (!e.entrou) faltam[motivoNaoEntrou(a, ctx)] += 1;
    else if (!e.comecou) faltam.nao_comecou += 1;
    else if (!e.concluiu) {
      faltam.nao_concluiu += 1;
      const m = parados[moduloParado(a)];
      if (m) {
        m.aqui += 1;
        if (a.trilha_ultima && agora - new Date(a.trilha_ultima).getTime() >= UM_DIA) m.ha_24h += 1;
      }
    } else if (!e.certificado) faltam[a.cert_erros > 0 ? 'cert_erro' : 'cert_sem_tentar'] += 1;
  });

  const falta = total.contas - total.certificado;
  const etapa = (id, rotulo, n, de = total.contas) => ({ id, rotulo, n, de, pct: pct(n, de), faltam: de - n });
  const porModulo = opts.progresso || {};
  return {
    desde,
    total,
    etapas: [
      etapa('entraram', 'Entraram', total.entraram),
      etapa('em24', 'Primeiro acesso em até 24 h', total.em24, total.com24h),
      etapa('comecaram', 'Começaram a Aula', total.comecaram),
      etapa('concluiram', 'Concluíram a Aula', total.concluiram),
      etapa('certificado', 'Emitiram o certificado', total.certificado),
    ],
    por_dia: [...dias.values()].reverse(),
    falta_100: {
      total: falta,
      motivos: MOTIVOS.filter((m) => faltam[m.id] > 0).map((m) => ({ ...m, n: faltam[m.id], pct_falta: pct(faltam[m.id], falta) })),
    },
    modulos: {
      nao_entraram: total.contas - total.entraram,
      nao_comecaram: total.entraram - total.comecaram,
      lista: niveis.map((n, i) => {
        const id = i + 1;
        const p = porModulo[id] || { abriram: 0, concluiram: 0 };
        return { modulo: id, titulo: n.t, abriram: p.abriram, concluiram: p.concluiram, parados: parados[id].aqui, parados_24h: parados[id].ha_24h };
      }),
    },
  };
}

// Abriram e concluíram cada módulo, entre as contas ativas do recorte. Sem dados de aluno na saída.
async function progressoModulos(pool, desde) {
  const r = await pool.query(
    `SELECT p.nivel, COUNT(*)::int AS abriram, COUNT(p.concluido_em)::int AS concluiram
     FROM csu_trilha_progresso p JOIN csu_alunos a ON a.id = p.aluno_id
     WHERE a.ativo AND a.created_at >= (($1::date)::timestamp AT TIME ZONE 'America/Sao_Paulo')
     GROUP BY p.nivel`, [desde]);
  return r.rows.reduce((m, x) => { m[x.nivel] = { abriram: x.abriram, concluiram: x.concluiram }; return m; }, {});
}

// O que este painel não mostra de propósito, para ninguém achar que o número existe.
const LIMITES = [
  { fonte: 'Fila e atendentes', texto: 'A leitura do CRM só funciona com sessão de navegador. Por enquanto, esses números ficam no próprio CRM.' },
  { fonte: 'Oferta enviada', texto: 'O aviso sai quando o negócio nasce com senha. Mostra quem entrou no caminho da oferta, não a entrega no WhatsApp.' },
  { fonte: 'Senha que chegou depois', texto: 'Quem nasceu sem senha aparece assim mesmo que a senha chegue durante as esperas.' },
  { fonte: 'Histórico', texto: 'A régua só conta o que passou pelo webhook depois de ligado.' },
  { fonte: 'Login que falhou', texto: 'O portal ainda não registra tentativa de login sem sucesso.' },
];

function fontePortal(em) {
  return { id: 'portal', rotulo: 'Portal: contas e progresso', status: 'em_dia', atualizado_em: em, detalhe: 'Banco do portal.' };
}

function fonteBase(base) {
  const alertas = (base && base.alertas) || [];
  const em = base ? base.verificado_em || (base.relatorio && base.relatorio.em) : null;
  if (!base || !base.configurada) return { id: 'base', rotulo: 'Relatório de matriculados', status: 'indisponivel', atualizado_em: em, detalhe: 'O relatório não está configurado neste ambiente.' };
  return {
    id: 'base',
    rotulo: 'Relatório de matriculados',
    status: alertas.length ? 'atrasado' : 'em_dia',
    atualizado_em: em,
    detalhe: alertas.length ? alertas.map((a) => a.texto).join(' ') : (base.relatorio ? `Último relatório em ${new Date(base.relatorio.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}.` : 'Nenhum relatório recebido.'),
  };
}

function fonteTelefones(ok, em) {
  return ok
    ? { id: 'telefones', rotulo: 'Telefones dos alunos', status: 'em_dia', atualizado_em: em, detalhe: 'Só para cruzar com o CRM. Não aparecem aqui.' }
    : { id: 'telefones', rotulo: 'Telefones dos alunos', status: 'indisponivel', atualizado_em: em, detalhe: 'Sem acesso à base de telefones: os motivos de quem nunca entrou ficam agrupados.' };
}

module.exports = { baseValida, desdeDaBase, basesDe, funil, progressoModulos, moduloParado, motivoNaoEntrou, fontePortal, fonteBase, fonteTelefones, LIMITES, MOTIVOS };
