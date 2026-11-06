'use strict';

// Lembretes de acesso da régua (follow-ups) e o laço app → CRM.
//
// O CRM não consegue perguntar ao app se a pessoa já entrou (o passo webhook não lê a resposta), mas o
// app consegue escrever no negócio pela API do CRM (Bearer CRM_API_TOKEN, rotas que aceitam token):
//   - POST /api/deals/:id/tags            marca a tag app_entrou (REGUA_TAG_ENTROU);
//   - PUT  /api/deals/:id/custom-fields   grava o link novo do lembrete (CRM_CAMPO_LINK_ACESSO e
//                                         CRM_CAMPO_LINK_CODIGO, ids dos campos do negócio).
//
// Na automação do CRM, cada lembrete é:
//   1. webhook POST /api/integracoes/regua-fup {segredo, negocio, rgm}            → se já entrou, marca a tag
//   2. condição: negócio NÃO tem a tag app_entrou (se tem, encerra)
//   3. rodízio (round_robin) A/B
//   4. em cada caminho: webhook {segredo, negocio, rgm, origem: "fup1_a"}         → gera o link do lembrete e
//      grava nos campos do negócio antes de o passo seguinte ler
//   5. template do lembrete com {{campo link_acesso_codigo}} no botão "Entrar no app"
// O código da origem (fup1_a, fup1_b...) vai no ?o= do link: o vigia mede quem entrou em 24 h por código e
// diz qual variante funciona melhor (server/vigia.js, lerRegua).
//
// O passo webhook que falha interrompe o fluxo daquele aluno no CRM. Por isso esta rota só responde erro
// com segredo errado: conta não encontrada, CRM fora ou banco fora respondem 200 com o motivo.
// Nada de dado pessoal: o app guarda só o id do negócio junto do link (csu_links_acesso.negocio).
// O segredo é o mesmo do gerador de link (LINK_ACESSO_SEGREDO).

const { envValue } = require('./env');
const linkAcesso = require('./link-acesso');
const vigia = require('./vigia');

const ORIGEM_FUP = /^[a-z0-9]{2,12}(_[a-z0-9]{1,8})?$/;

function crmBase() { return String(envValue('CRM_API_URL', 'https://integrations.bwipo.com')).trim().replace(/\/+$/, ''); }
function tagEntrou() { return envValue('REGUA_TAG_ENTROU', 'app_entrou'); }
const CAMPO_RE = /^[A-Za-z0-9_-]{6,64}$/;
function campo(nome) { const v = envValue(nome); return CAMPO_RE.test(v) ? v : null; }

async function crm(fetchImpl, metodo, caminho, corpo) {
  const token = envValue('CRM_API_TOKEN');
  if (!token) return { ok: false, motivo: 'sem_token' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchImpl(crmBase() + caminho, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controller.signal,
    });
    return res.ok ? { ok: true } : { ok: false, motivo: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, motivo: err.name === 'AbortError' ? 'tempo esgotado' : 'sem resposta' };
  } finally {
    clearTimeout(timer);
  }
}

function marcarEntrou(fetchImpl, negocio) {
  return crm(fetchImpl, 'POST', `/api/deals/${encodeURIComponent(negocio)}/tags`, { tagName: tagEntrou() });
}

function gravarLink(fetchImpl, negocio, link) {
  const values = [];
  const cUrl = campo('CRM_CAMPO_LINK_ACESSO');
  const cCod = campo('CRM_CAMPO_LINK_CODIGO');
  if (cUrl) values.push({ fieldId: cUrl, value: link.url });
  if (cCod) values.push({ fieldId: cCod, value: link.codigo });
  if (!values.length) return Promise.resolve({ ok: false, motivo: 'sem_campos' });
  return crm(fetchImpl, 'PUT', `/api/deals/${encodeURIComponent(negocio)}/custom-fields`, { values });
}

async function jaEntrou(pool, alunoId) {
  const r = await pool.query('SELECT primeiro_login_em IS NOT NULL AS entrou FROM csu_alunos WHERE id = $1', [alunoId]);
  return Boolean(r.rows[0] && r.rows[0].entrou);
}

// Um lembrete: devolve o que fazer, sempre sem lançar (a rota responde 200 com isto).
async function lembrete(pool, { negocio, rgm, origem }, { findAluno, fetchImpl = globalThis.fetch }) {
  const neg = linkAcesso.limparNegocio(negocio);
  const cod = String(origem == null ? '' : origem).trim().toLowerCase();
  const org = cod ? (ORIGEM_FUP.test(cod) ? cod : null) : null;
  if (!neg) return { ok: false, motivo: 'sem_negocio' };
  if (cod && !org) return { ok: false, motivo: 'origem_invalida' };
  const r = String(rgm == null ? '' : rgm).replace(/\D+/g, '');
  if (!r) return { ok: false, motivo: 'sem_rgm' };
  const aluno = await findAluno(pool, r);
  if (!aluno || !aluno.ativo) {
    if (org) vigia.registrarPedidoLink(pool, 'conta_nao_encontrada', org);
    return { ok: false, motivo: 'conta_nao_encontrada' };
  }
  if (await jaEntrou(pool, aluno.id)) {
    const t = await marcarEntrou(fetchImpl, neg);
    return { ok: true, entrou: true, tag: t.ok ? 'marcada' : t.motivo };
  }
  if (!org) return { ok: true, entrou: false };
  const link = await linkAcesso.gerar(pool, aluno.id, org, { negocio: neg, manterAnteriores: true });
  vigia.registrarPedidoLink(pool, 'ok', org);
  const g = await gravarLink(fetchImpl, neg, link);
  return { ok: true, entrou: false, link: g.ok ? 'gravado' : g.motivo };
}

// Entrou no app: marca a tag no último negócio conhecido da conta. Uma vez por conta e processo.
const marcados = new Set();
function aoEntrar(fetchImpl = globalThis.fetch) {
  return async (pool, { alunoId, primeira }) => {
    if (primeira === false || marcados.has(alunoId) || !envValue('CRM_API_TOKEN')) return;
    const neg = await linkAcesso.negocioDe(pool, alunoId);
    if (!neg) return;
    const t = await marcarEntrou(fetchImpl, neg);
    if (t.ok) marcados.add(alunoId);
    else console.error('Não foi possível marcar app_entrou no CRM:', t.motivo);
  };
}

function registrarRotas(app, { getPool, findAluno, ensureSchemaAlunos, instrumentacao }) {
  instrumentacao.quandoEntrar(aoEntrar());
  app.post('/api/integracoes/regua-fup', async (req, res) => {
    const b = req.body || {};
    if (!envValue('LINK_ACESSO_SEGREDO')) return res.json({ ok: false, motivo: 'desligado' });
    if (!linkAcesso.segredoOk(req.get('x-segredo') || b.segredo)) return res.status(401).json({ ok: false, motivo: 'segredo' });
    const pool = getPool();
    if (!pool) return res.json({ ok: false, motivo: 'sem_banco' });
    try {
      if (ensureSchemaAlunos) await ensureSchemaAlunos();
      return res.json(await lembrete(pool, b, { findAluno }));
    } catch (err) {
      console.error('Falha no lembrete da régua:', err.code || '', err.message);
      return res.json({ ok: false, motivo: 'erro' });
    }
  });
}

module.exports = { lembrete, aoEntrar, registrarRotas, ORIGEM_FUP };
