'use strict';

// Eventos da régua do CRM para a aba Ao vivo. O passo `webhook` das automações avisa o portal.
// Guarda só RGM, id do negócio e o passo: nada de nome, telefone ou senha. Sem a variável
// REGUA_WEBHOOK_SEGREDO o endpoint recusa tudo e o bloco da régua aparece como "Falta ligar".
//
// No CRM, um webhook que falha interrompe o resto daquele fluxo. Por isso a resposta só é erro
// quando o segredo está errado: evento estranho ou banco fora não podem parar a régua do aluno.
// O segredo vem no corpo: o editor do CRM grava cabeçalhos como lista, e o envio só lê objeto.

const crypto = require('node:crypto');
const { envValue } = require('./env');

const PASSOS = new Set(['oferta', 'sem_senha', 'login', 'sem_resposta', 'variante']);
const RETENCAO_DIAS = 180;
const ATRASO_MS = 48 * 3600000; // nenhuma conta nova em 2 dias costuma indicar webhook parado
const UM_DIA = 86400000;
const SEM_DADOS = { automacoes: [], ultimo_evento_em: null, primeiro_evento_em: null };

const hash = (t) => crypto.createHash('sha256').update(String(t)).digest();
const soDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');

function configurado() {
  return Boolean(envValue('REGUA_WEBHOOK_SEGREDO'));
}

function autorizado(recebido) {
  const segredo = envValue('REGUA_WEBHOOK_SEGREDO');
  if (!segredo || !recebido) return false;
  return crypto.timingSafeEqual(hash(recebido), hash(segredo));
}

const texto = (v, re) => {
  const s = String(v == null ? '' : v).trim();
  return re.test(s) ? s : null;
};

// O CRM preenche {{campo}} vazio com texto vazio: RGM pode faltar sem invalidar o evento.
function normalizar(corpo) {
  const b = corpo && typeof corpo === 'object' ? corpo : {};
  const passo = String(b.passo || '').trim();
  const automacao = texto(b.automacao, /^[a-z0-9_-]{1,40}$/);
  const negocio = texto(b.negocio, /^[A-Za-z0-9_-]{1,64}$/);
  if (!PASSOS.has(passo) || !automacao || !negocio) return null;
  const rgm = soDigitos(b.rgm).slice(0, 20) || null;
  return {
    automacao,
    passo,
    negocio,
    rgm,
    teste: texto(b.teste, /^[A-Za-z0-9_-]{1,40}$/),
    variante: texto(b.variante, /^[A-Za-z0-9_-]{1,40}$/),
  };
}

let esquema = null;
function ensureSchema(pool) {
  if (!esquema) {
    esquema = pool.query(`
      CREATE TABLE IF NOT EXISTS csu_regua_eventos (
        id BIGSERIAL PRIMARY KEY,
        automacao TEXT NOT NULL,
        passo TEXT NOT NULL,
        negocio TEXT NOT NULL,
        rgm TEXT,
        teste TEXT NOT NULL DEFAULT '',
        variante TEXT NOT NULL DEFAULT '',
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS csu_regua_eventos_unico ON csu_regua_eventos (automacao, passo, negocio, teste);
      CREATE INDEX IF NOT EXISTS csu_regua_eventos_data ON csu_regua_eventos (criado_em);
    `).catch((err) => { esquema = null; throw err; });
  }
  return esquema;
}

// Repetição do mesmo passo no mesmo negócio não conta de novo: o painel mede pessoas, não disparos.
async function registrar(pool, ev) {
  await ensureSchema(pool);
  await pool.query(
    `INSERT INTO csu_regua_eventos (automacao, passo, negocio, rgm, teste, variante)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
    [ev.automacao, ev.passo, ev.negocio, ev.rgm, ev.teste || '', ev.variante || ''],
  );
}

let ultimaLimpeza = 0;
async function ler(pool, desde, agora = Date.now()) {
  await ensureSchema(pool);
  if (agora - ultimaLimpeza > UM_DIA) {
    ultimaLimpeza = agora;
    await pool.query(`DELETE FROM csu_regua_eventos WHERE criado_em < now() - ($1::int * interval '1 day')`, [RETENCAO_DIAS]);
  }
  const r = await pool.query(
    `SELECT automacao, passo, rgm, teste, variante, criado_em FROM csu_regua_eventos
     WHERE criado_em >= (($1::date)::timestamp AT TIME ZONE 'America/Sao_Paulo') ORDER BY criado_em`, [desde]);
  return r.rows;
}

const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
const linhaVazia = (dia) => ({ dia, oferta: 0, sem_senha: 0, login: 0, sem_resposta: 0 });

function resumir(eventos) {
  if (!eventos.length) return SEM_DADOS;
  const grupos = new Map();
  eventos.forEach((e) => {
    if (e.passo === 'variante') return;
    if (!grupos.has(e.automacao)) grupos.set(e.automacao, { id: e.automacao, total: linhaVazia(null), dias: new Map() });
    const g = grupos.get(e.automacao);
    const dia = fmtDia.format(new Date(e.criado_em));
    if (!g.dias.has(dia)) g.dias.set(dia, linhaVazia(dia));
    g.dias.get(dia)[e.passo] += 1;
    g.total[e.passo] += 1;
  });
  return {
    automacoes: [...grupos.values()].map((g) => ({ id: g.id, total: g.total, dias: [...g.dias.values()].sort((a, b) => (a.dia < b.dia ? 1 : -1)) })),
    ultimo_evento_em: new Date(eventos[eventos.length - 1].criado_em).toISOString(),
    primeiro_evento_em: new Date(eventos[0].criado_em).toISOString(),
  };
}

// Conjuntos de RGM por passo, para explicar por que uma conta nunca entrou.
function alcanceDe(eventos) {
  if (!eventos.length) return null;
  const de = (passo) => new Set(eventos.filter((e) => e.passo === passo && e.rgm).map((e) => e.rgm));
  return {
    inicio: new Date(eventos[0].criado_em).getTime(),
    oferta: de('oferta'),
    sem_senha: de('sem_senha'),
    login: de('login'),
  };
}

function fonte(resumo, agora = Date.now()) {
  const base = { id: 'regua', rotulo: 'CRM: régua, pelo webhook' };
  if (!configurado()) return { ...base, status: 'nao_ligado', atualizado_em: null, detalhe: 'Falta o segredo do webhook neste ambiente.' };
  if (!resumo.ultimo_evento_em) return { ...base, status: 'nao_ligado', atualizado_em: null, detalhe: 'Nenhum aviso recebido do CRM ainda.' };
  const velho = agora - new Date(resumo.ultimo_evento_em).getTime() > ATRASO_MS;
  return {
    ...base,
    status: velho ? 'atrasado' : 'em_dia',
    atualizado_em: resumo.ultimo_evento_em,
    detalhe: velho ? 'Nenhum aviso do CRM há mais de 2 dias: confira a automação e o segredo.' : 'Último aviso recebido do CRM.',
  };
}

module.exports = { PASSOS, soDigitos, configurado, autorizado, normalizar, ensureSchema, registrar, ler, resumir, alcanceDe, fonte };
