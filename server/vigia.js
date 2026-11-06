'use strict';

// Vigia da jornada do calouro: de 2 em 2 horas lê o app, o n8n e o CRM, guarda um retrato só com
// números (csu_vigia_retratos) e avisa a equipe no WhatsApp quando algo sai do normal, com a ação sugerida.
//
// O que lê (sem navegador):
//   app  entradas por origem, falhas de login por motivo, contas que nunca entraram, travados na Aula,
//        erros de certificado, vídeos iniciados/concluídos, pedidos do link de acesso e se o app e o
//        gerador de link respondem no endereço público.
//   n8n  execuções e erros da janela nos fluxos de FLUXOS_N8N (GET /api/v1/executions, N8N_API_KEY).
//   CRM  templates aprovados (Bearer CRM_API_TOKEN), logs das automações BV e email_acad e métricas de
//        atendimento. As rotas de logs e de atendimento do CRM hoje só aceitam login de navegador: com o
//        token elas respondem 401 e a fonte fica "sem acesso" no retrato (não vira alerta).
//
// Alertas: REGRAS_PADRAO, ajustáveis por VIGIA_LIMITES (JSON). Uma mensagem por rodada com os alertas
// novos e os que voltaram ao normal; alerta que continua igual não é repetido (só depois de lembrete_h,
// se ligado). A mensagem vai para a conversa do CRM em VIGIA_ALERTA_PARA (grupo/número interno da equipe).
//
// Agendamento: VIGIA_LIGADO=true liga. A cada 5 min o app confere se já existe retrato da faixa de 2 h
// atual (08h, 10h, 12h... de Brasília); se não existir, pega uma trava no Postgres (pg_try_advisory_lock)
// e roda. Com mais de uma instância só uma roda; a coluna slot é única, então nunca há dois retratos da
// mesma faixa. Sem N8N_API_KEY / CRM_API_TOKEN a fonte fica "desligada"; sem VIGIA_ALERTA_PARA nada é enviado.
//
// Nada de dado pessoal: só contagens, ids de fluxo/passo e nomes de template. Os logs do CRM trazem nome e
// telefone do contato; aqui só se lê status, passo e horário de cada linha, e o resto é descartado.

const { envValue } = require('./env');
const recorte = require('./recorte');

const TZ = 'America/Sao_Paulo';
const TRAVA = 7724001; // chave do pg_try_advisory_lock
const VERIFICA_MS = 5 * 60 * 1000;
const RETENCAO_DIAS = 90;

const N8N_PADRAO = 'https://n8n-new-n8n.ca31ey.easypanel.host';
// O Bearer de org do CRM só vale no processo da API pública (backend_crm1 src/lib/api-public-access.ts).
const CRM_PADRAO = 'https://integrations.bwipo.com';

const FLUXOS_N8N = [
  { id: '36vKiDidEwyN0t8y', nome: 'comercial_p_academico (criação de lead)', vendas: true },
  { id: 'mxJmpVN4snTUiH0c', nome: 'Alunos Provisorios' },
  { id: 'bxPxERzvVyriO8qr', nome: 'acad_senha_reserva' },
  { id: 'mUm1OgIFmqJPcWSz', nome: 'acolhimento_fup' },
];
const CRM = {
  bv: 'cmrw7umn317zypd017ofaroom',
  passoMatricula: 'b9e9f48a-1656-43a9-b5b1-9196168cbec3',
  emailAcad: 'cmw0osy7h0gwepj01yc8y4s2d',
  canal: 'cmtai20yx0090mw019h6uyrqk',
};

// Ao trocar a BV pela cópia com checagem de acesso, o id da automação e o do passo mudam: estas env apontam.
function idCrm(nome, padrao) {
  const v = envValue(nome);
  return /^[A-Za-z0-9_-]{6,80}$/.test(v) ? v : padrao;
}

const REGRAS_PADRAO = {
  janela_min: 120,
  n8n_erros_min: 1,         // qualquer erro nos fluxos
  vendas_de: 8,             // zero vendas na janela entre 8h e 22h
  vendas_ate: 22,
  link_vazio_pct: 10,       // pedidos de link sem link acima de 10%
  link_min_amostra: 3,
  falhas_login_pct: 30,     // falhas / tentativas acima de 30%
  login_min_amostra: 10,
  bv_failed_min: 1,         // passo FAILED no BV
  bv_ignorar_passos: [],    // passos do BV cujo FAILED já é tratado
  matricula_min: 1,         // negócio no passo do template de matrícula
  email_failed_min: 1,
  regua_dias: 14,           // janela da medida "entrou em 24 h" por mensagem da régua
  ab_min_amostra: 60,       // contas por variante antes de declarar vencedor
  atraso_min: 150,          // a aba avisa quando passa disso sem leitura
  lembrete_h: 0,            // 0 = não repete alerta que continua igual
};

const EVENTOS = ['certificado_erro', 'certificado_gerado', 'video_inicio', 'video_fim'];
const MOTIVOS_SEM_TENTATIVA = ['esqueci_senha']; // tocar em "Esqueci" não é tentativa de login

// ---------- configuração ----------

function ligado() {
  return ['1', 'true', 'sim', 'on'].includes(envValue('VIGIA_LIGADO').toLowerCase());
}

function limites(raw) {
  const out = { ...REGRAS_PADRAO };
  let extra = raw;
  if (extra === undefined) {
    const txt = envValue('VIGIA_LIMITES');
    try { extra = txt ? JSON.parse(txt) : {}; } catch (err) { extra = {}; console.error('VIGIA_LIMITES não é um JSON válido; usando os padrões.'); }
  }
  if (!extra || typeof extra !== 'object') return out;
  Object.keys(REGRAS_PADRAO).forEach((k) => {
    if (!(k in extra)) return;
    if (Array.isArray(REGRAS_PADRAO[k])) {
      if (Array.isArray(extra[k])) out[k] = extra[k].map(String).slice(0, 50);
      return;
    }
    const n = Number(extra[k]);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  });
  out.janela_min = Math.max(30, Math.min(720, Math.round(out.janela_min)));
  return out;
}

function templatesChave() {
  return envValue('VIGIA_TEMPLATES_CHAVE').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
}

function semBarra(u) { return String(u || '').trim().replace(/\/+$/, ''); }
function n8nBase() { return semBarra(envValue('N8N_URL', N8N_PADRAO)); }
function crmBase() { return semBarra(envValue('CRM_API_URL', CRM_PADRAO)); }
function appBase() {
  return semBarra(envValue('VIGIA_APP_URL') || envValue('APP_PUBLIC_URL') || 'https://app.cruzeiroead.com.br');
}
function descobrirUrl() {
  return String(envValue('VIGIA_EMAIL_ACADEMICO_URL', 'https://emailacademico.cruzeiroead.com.br/descobrir')).trim();
}
const DESTINO_RE = /^[A-Za-z0-9_-]{10,60}$/;
function destino() {
  const d = envValue('VIGIA_ALERTA_PARA');
  return DESTINO_RE.test(d) ? d : null;
}

function configuracao() {
  return {
    ligado: ligado(),
    n8n: Boolean(envValue('N8N_API_KEY')),
    crm: Boolean(envValue('CRM_API_TOKEN')),
    alerta_para: Boolean(destino()),
    alerta_para_invalido: Boolean(envValue('VIGIA_ALERTA_PARA')) && !destino(),
    templates_chave: templatesChave(),
    limites: limites(),
  };
}

// ---------- horário ----------

const fmtHora = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function minutosSP(d) {
  const [h, m] = fmtHora.format(new Date(d)).split(':').map(Number);
  return h * 60 + m;
}
function horaTxt(d) { return fmtHora.format(new Date(d)).replace(':', 'h'); }
function dataHoraTxt(d) {
  return new Date(d).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Faixa de 2 h alinhada ao horário de Brasília (UTC-3, sem horário de verão): 08h, 10h, 12h...
function slotDe(agora, intervaloMin = REGRAS_PADRAO.janela_min) {
  const passo = intervaloMin * 60000;
  const off = 3 * 3600000;
  const t = new Date(agora).getTime();
  return new Date(Math.floor((t - off) / passo) * passo + off).toISOString();
}

// ---------- HTTP ----------

async function buscar(fetchImpl, url, { method = 'GET', headers = {}, body, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method, headers, body, signal: controller.signal, redirect: 'manual' });
    let json = null;
    try { json = await res.json(); } catch (e) { /* sem corpo JSON */ }
    const location = res.headers && typeof res.headers.get === 'function' ? res.headers.get('location') : null;
    return { status: res.status, ok: res.ok, json, location };
  } catch (err) {
    return { status: 0, ok: false, json: null, erro: err.name === 'AbortError' ? 'tempo esgotado' : 'sem resposta' };
  } finally {
    clearTimeout(timer);
  }
}

function estadoHttp(r, { aceitaToken = true } = {}) {
  if (r.ok) return { estado: 'ok' };
  if (r.status === 401 || r.status === 403) {
    const codigo = r.json && r.json.code ? String(r.json.code).slice(0, 40) : null;
    return { estado: aceitaToken ? 'recusado' : 'sem_acesso', status: r.status, codigo };
  }
  return { estado: 'erro', status: r.status, detalhe: r.erro || `HTTP ${r.status}` };
}

// ---------- n8n ----------

function agregarN8n(execucoes, desde) {
  const ini = new Date(desde).getTime();
  const out = { total: 0, sucesso: 0, erro: 0, rodando: 0, ultimo_erro_em: null };
  execucoes.forEach((e) => {
    const t = Date.parse(e && (e.startedAt || e.createdAt));
    if (!Number.isFinite(t) || t < ini) return;
    out.total += 1;
    const s = String(e.status || (e.finished ? 'success' : '')).toLowerCase();
    if (s === 'success') out.sucesso += 1;
    else if (s === 'error' || s === 'crashed') {
      out.erro += 1;
      if (!out.ultimo_erro_em || t > Date.parse(out.ultimo_erro_em)) out.ultimo_erro_em = new Date(t).toISOString();
    } else if (s === 'running' || s === 'waiting' || s === 'new') out.rodando += 1;
  });
  return out;
}

async function lerN8n(fetchImpl, desde) {
  const chave = envValue('N8N_API_KEY');
  if (!chave) return { fonte: { estado: 'desligado' }, dados: null };
  const fluxos = [];
  let falha = null;
  for (const f of FLUXOS_N8N) {
    const execs = [];
    let cursor = null;
    let pagina = 0;
    let erroFluxo = null;
    do {
      const q = new URLSearchParams({ workflowId: f.id, limit: '100' });
      if (cursor) q.set('cursor', cursor);
      const r = await buscar(fetchImpl, `${n8nBase()}/api/v1/executions?${q}`, { headers: { 'X-N8N-API-KEY': chave, Accept: 'application/json' } });
      if (!r.ok) { erroFluxo = estadoHttp(r); break; }
      const lista = Array.isArray(r.json && r.json.data) ? r.json.data : [];
      execs.push(...lista);
      cursor = r.json && r.json.nextCursor;
      const ultima = lista[lista.length - 1];
      if (!ultima || Date.parse(ultima.startedAt || ultima.createdAt) < new Date(desde).getTime()) cursor = null;
      pagina += 1;
    } while (cursor && pagina < 5);
    if (erroFluxo) { falha = falha || erroFluxo; fluxos.push({ id: f.id, nome: f.nome, vendas: Boolean(f.vendas), lido: false }); continue; }
    fluxos.push({ id: f.id, nome: f.nome, vendas: Boolean(f.vendas), lido: true, ...agregarN8n(execs, desde) });
  }
  const venda = fluxos.find((f) => f.vendas && f.lido);
  const algumLido = fluxos.some((f) => f.lido);
  return {
    fonte: falha ? { ...falha, estado: algumLido ? 'parcial' : falha.estado } : { estado: 'ok' },
    dados: { fluxos, vendas: venda ? venda.sucesso : null },
  };
}

// ---------- CRM ----------

function itensDe(j) {
  if (Array.isArray(j)) return j;
  if (!j || typeof j !== 'object') return [];
  return j.items || j.data || j.logs || [];
}

// Só status, passo e horário: o resto da linha (contato, telefone, negócio) não sai daqui.
function agregarLogs(itens, desde, { ignorar = [] } = {}) {
  const ini = new Date(desde).getTime();
  const out = { total: 0, falhas: 0, por_status: {}, falhas_por_passo: {} };
  itens.forEach((l) => {
    const t = Date.parse(l && l.executedAt);
    if (!Number.isFinite(t) || t < ini) return;
    const st = String(l.status || 'SEM_STATUS').toUpperCase().slice(0, 20);
    out.total += 1;
    out.por_status[st] = (out.por_status[st] || 0) + 1;
    if (st === 'FAILED') {
      const passo = l.stepId ? String(l.stepId).slice(0, 60) : 'gatilho';
      if (ignorar.includes(passo)) return;
      out.falhas += 1;
      out.falhas_por_passo[passo] = (out.falhas_por_passo[passo] || 0) + 1;
    }
  });
  return out;
}

async function logsAutomacao(fetchImpl, base, headers, id, desde, extra = {}) {
  const itens = [];
  for (let page = 1; page <= 5; page += 1) {
    const q = new URLSearchParams({ page: String(page), perPage: '100', ...extra });
    const r = await buscar(fetchImpl, `${base}/api/automations/${id}/logs?${q}`, { headers });
    if (!r.ok) return { erro: estadoHttp(r, { aceitaToken: false }) };
    const lista = itensDe(r.json);
    itens.push(...lista.map((l) => ({ status: l.status, stepId: l.stepId, executedAt: l.executedAt })));
    const ultima = lista[lista.length - 1];
    if (lista.length < 100 || !ultima || Date.parse(ultima.executedAt) < new Date(desde).getTime()) break;
  }
  return { itens };
}

// Números de um objeto (1 nível de profundidade), sem textos: a resposta do atendimento vira tendência.
function numeros(obj, max = 24) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  const add = (k, v) => { if (Object.keys(out).length < max && typeof v === 'number' && Number.isFinite(v)) out[k.slice(0, 60)] = v; };
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if (typeof v === 'number') add(k, v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach((k2) => add(`${k}.${k2}`, v[k2]));
  });
  return out;
}

async function lerCrm(fetchImpl, desde, agora, L) {
  const token = envValue('CRM_API_TOKEN');
  const desligado = { estado: 'desligado' };
  if (!token) return { fontes: { crm_templates: desligado, crm_bv: desligado, crm_email: desligado, crm_atendimento: desligado }, dados: null };
  const base = crmBase();
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const fontes = {};
  const dados = { templates: [], bv: null, email_acad: null, atendimento: {} };

  // Templates aprovados (rota aceita Bearer): o template-chave sumir da lista = saiu de APPROVED.
  const chave = templatesChave();
  if (!chave.length) fontes.crm_templates = { estado: 'sem_lista' };
  else {
    const r = await buscar(fetchImpl, `${base}/api/whatsapp-template-configs/approved?channelId=${CRM.canal}`, { headers });
    fontes.crm_templates = estadoHttp(r);
    if (r.ok) {
      const lista = itensDe(r.json);
      dados.templates = chave.map((nome) => {
        const t = lista.find((x) => x && (x.metaTemplateName === nome || x.name === nome));
        return { nome, aprovado: Boolean(t), categoria: t && t.category ? String(t.category).toUpperCase().slice(0, 20) : null };
      });
    }
  }

  // Logs do BV: falhas na janela e quantos passaram pelo passo do template de matrícula.
  const bvId = idCrm('VIGIA_CRM_BV', CRM.bv);
  const bv = await logsAutomacao(fetchImpl, base, headers, bvId, desde);
  if (bv.erro) fontes.crm_bv = bv.erro;
  else {
    const mat = await logsAutomacao(fetchImpl, base, headers, bvId, desde, { stepId: idCrm('VIGIA_CRM_PASSO_MATRICULA', CRM.passoMatricula) });
    dados.bv = agregarLogs(bv.itens, desde, { ignorar: L.bv_ignorar_passos });
    dados.bv.matricula = mat.erro ? null : agregarLogs(mat.itens, desde).total;
    fontes.crm_bv = { estado: 'ok' };
  }
  const em = await logsAutomacao(fetchImpl, base, headers, CRM.emailAcad, desde);
  if (em.erro) fontes.crm_email = em.erro;
  else { dados.email_acad = agregarLogs(em.itens, desde); fontes.crm_email = { estado: 'ok' }; }

  // Atendimento: só tendência (resolução e tempo de resolução estão errados no CRM).
  const periodo = new URLSearchParams({ from: new Date(desde).toISOString(), to: new Date(agora).toISOString() });
  const rotas = { inbox: `/api/analytics/inbox?${periodo}`, servico: `/api/analytics/service-overview?${periodo}`, dia: '/api/inbox/daily-stats' };
  let estadoAt = null;
  for (const k of Object.keys(rotas)) {
    const r = await buscar(fetchImpl, base + rotas[k], { headers });
    if (r.ok) dados.atendimento[k] = numeros(r.json);
    else estadoAt = estadoAt || estadoHttp(r, { aceitaToken: false });
  }
  fontes.crm_atendimento = estadoAt || { estado: 'ok' };
  return { fontes, dados };
}

// ---------- app ----------

async function seguro(promessa, vazio) {
  try { return await promessa; } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return vazio;
    throw err;
  }
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS csu_vigia_retratos (
      id BIGSERIAL PRIMARY KEY,
      slot TEXT UNIQUE,
      lido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      janela_inicio TIMESTAMPTZ NOT NULL,
      manual BOOLEAN NOT NULL DEFAULT FALSE,
      duracao_ms INTEGER,
      fontes JSONB NOT NULL DEFAULT '{}'::jsonb,
      indicadores JSONB NOT NULL DEFAULT '{}'::jsonb,
      alertas JSONB NOT NULL DEFAULT '[]'::jsonb,
      envio JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_csu_vigia_retratos_em ON csu_vigia_retratos (lido_em DESC);
  `);
  await garantirPedidos(pool);
  await pool.query(`DELETE FROM csu_vigia_retratos WHERE lido_em < now() - ($1::int * interval '1 day')`, [RETENCAO_DIAS]);
}
let pronto = null;
function garantir(pool) {
  if (!pronto) pronto = ensureSchema(pool).catch((err) => { pronto = null; throw err; });
  return pronto;
}

// Pedidos ao gerador do link de acesso (server/link-acesso.js), só o resultado: mede o "link saindo vazio".
let pedidosProntos = null;
function garantirPedidos(pool) {
  if (!pedidosProntos) {
    pedidosProntos = pool.query(`
      CREATE TABLE IF NOT EXISTS csu_link_acesso_pedidos (
        id BIGSERIAL PRIMARY KEY,
        resultado TEXT NOT NULL,
        origem TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_csu_link_acesso_pedidos_em ON csu_link_acesso_pedidos (criado_em DESC);
      DELETE FROM csu_link_acesso_pedidos WHERE criado_em < now() - interval '30 days';
    `).catch((err) => { pedidosProntos = null; throw err; });
  }
  return pedidosProntos;
}
const RESULTADOS_LINK = ['ok', 'sem_rgm', 'conta_nao_encontrada', 'erro'];
function registrarPedidoLink(pool, resultado, origem) {
  if (!pool || !RESULTADOS_LINK.includes(resultado)) return Promise.resolve();
  return garantirPedidos(pool)
    .then(() => pool.query('INSERT INTO csu_link_acesso_pedidos (resultado, origem) VALUES ($1, $2)', [resultado, origem || null]))
    .catch((err) => { console.error('Falha ao registrar pedido de link:', err.code || '', err.message); });
}

function pct(n, de) { return de ? Math.round((n / de) * 1000) / 10 : null; }

async function lerApp(pool, desde, totalNiveis) {
  const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
  const corte = await recorte.contarDesde(pool);
  const noCorte = `($2::date IS NULL OR a.created_at >= (($2::date)::timestamp AT TIME ZONE '${TZ}'))`;
  const [entradas, falhas, contas, travados, eventos, pedidos, links] = await Promise.all([
    seguro(q(`SELECT COALESCE(origem, 'sem_origem') AS origem, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE primeira)::int AS primeiras
              FROM csu_entradas WHERE criado_em >= $1 GROUP BY 1`, [desde]), []),
    seguro(q('SELECT motivo, COUNT(*)::int AS n FROM csu_login_falhas WHERE criado_em >= $1 GROUP BY 1', [desde]), []),
    seguro(q(`SELECT COUNT(*)::int AS contas, COUNT(*) FILTER (WHERE a.primeiro_login_em IS NULL)::int AS nunca_entraram,
                     COUNT(*) FILTER (WHERE a.created_at >= $1)::int AS novas
              FROM csu_alunos a WHERE a.ativo AND ${noCorte}`, [desde, corte]), [{}]),
    seguro(q(`SELECT COUNT(*)::int AS n FROM (
                SELECT p.aluno_id FROM csu_trilha_progresso p JOIN csu_alunos a ON a.id = p.aluno_id
                WHERE a.ativo AND ${noCorte} AND $1::timestamptz IS NOT NULL
                GROUP BY p.aluno_id
                HAVING SUM((SELECT COALESCE(SUM(value::int), 0) FROM jsonb_each_text(p.travei))) > 0
                   AND COUNT(p.concluido_em) < $3) t`, [desde, corte, totalNiveis]), [{ n: 0 }]),
    seguro(q(`SELECT nome, COUNT(*)::int AS n FROM csu_eventos WHERE criado_em >= $1 AND nome = ANY($2) GROUP BY 1
              UNION ALL
              SELECT 'saida_email_academico', COUNT(*)::int FROM csu_eventos
              WHERE criado_em >= $1 AND nome = 'saida_externa' AND dados->>'destino' = 'email_academico'`, [desde, EVENTOS]), []),
    seguro(q('SELECT resultado, COUNT(*)::int AS n FROM csu_link_acesso_pedidos WHERE criado_em >= $1 GROUP BY 1', [desde]), []),
    seguro(q(`SELECT COUNT(*) FILTER (WHERE criado_em >= $1)::int AS gerados, COUNT(*) FILTER (WHERE usado_em >= $1)::int AS usados
              FROM csu_links_acesso`, [desde]), [{}]),
  ]);

  const porOrigem = {};
  let totalEntradas = 0;
  let primeiras = 0;
  entradas.forEach((r) => { porOrigem[r.origem] = r.n; totalEntradas += r.n; primeiras += r.primeiras; });
  const porMotivo = {};
  let totalFalhas = 0;
  falhas.forEach((r) => { porMotivo[r.motivo] = r.n; if (!MOTIVOS_SEM_TENTATIVA.includes(r.motivo)) totalFalhas += r.n; });
  const ev = {};
  EVENTOS.forEach((n) => { ev[n] = 0; });
  ev.saida_email_academico = 0;
  eventos.forEach((r) => { ev[r.nome] = r.n; });
  const porResultado = {};
  let pedidosTotal = 0;
  pedidos.forEach((r) => { porResultado[r.resultado] = r.n; pedidosTotal += r.n; });
  const ok = porResultado.ok || 0;
  const c = contas[0] || {};
  return {
    contar_desde: corte,
    entradas: { total: totalEntradas, primeiras, por_origem: porOrigem },
    falhas: { total: totalFalhas, por_motivo: porMotivo, tentativas: totalFalhas + totalEntradas, pct: pct(totalFalhas, totalFalhas + totalEntradas) },
    contas: { contas: c.contas || 0, nunca_entraram: c.nunca_entraram || 0, novas: c.novas || 0 },
    travados: (travados[0] && travados[0].n) || 0,
    eventos: ev,
    links: {
      pedidos: pedidosTotal, ok, falhas: pedidosTotal - ok, por_resultado: porResultado,
      vazio_pct: pct(pedidosTotal - ok, pedidosTotal),
      gerados: (links[0] && links[0].gerados) || 0, usados: (links[0] && links[0].usados) || 0,
    },
  };
}

// O app e o gerador de link respondem no endereço público? (o gerador sem segredo deve dar 401; 503 = desligado)
async function lerSaude(fetchImpl) {
  const base = appBase();
  const h = await buscar(fetchImpl, `${base}/health`, { timeoutMs: 8000 });
  const app = h.ok && h.json && h.json.ok !== false ? { estado: 'ok' } : { estado: 'fora', status: h.status, detalhe: h.erro || `HTTP ${h.status}` };
  const g = await buscar(fetchImpl, `${base}/api/integracoes/link-acesso`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', timeoutMs: 8000,
  });
  let gerador;
  if (g.status === 401 || g.status === 400) gerador = { estado: 'ok' };
  else if (g.status === 503) gerador = { estado: 'desligado', status: 503 };
  else gerador = { estado: 'fora', status: g.status, detalhe: g.erro || `HTTP ${g.status}` };
  // Site onde o aluno descobre o e-mail acadêmico (passo 1 do módulo 1 e dúvidas da Central). Hoje é um atalho
  // que redireciona para o SSO da faculdade (sso.cruzeirodosul.edu.br/recover-email). Só o atalho é checado: o
  // SSO recusa acesso automático (403), então a queda do SSO em si não aparece aqui.
  const d = await buscar(fetchImpl, descobrirUrl(), { timeoutMs: 8000 });
  let destinoOk = true;
  if (d.status >= 300 && d.status < 400) {
    try { destinoOk = /(^|\.)cruzeirodosul\.edu\.br$/.test(new URL(d.location, descobrirUrl()).hostname); } catch (e) { destinoOk = false; }
  }
  const descobrir = d.status >= 200 && d.status < 400 && destinoOk
    ? { estado: 'ok' }
    : { estado: 'fora', status: d.status, detalhe: d.erro || (destinoOk ? `HTTP ${d.status}` : 'redireciona para fora da Cruzeiro do Sul') };
  return { url: base, app, gerador, descobrir: { url: descobrirUrl(), ...descobrir } };
}

// ---------- regras ----------

const NOME_FONTE = {
  n8n: 'o n8n', crm_templates: 'os templates no CRM', crm_bv: 'os logs do BV no CRM',
  crm_email: 'os logs do email_acad no CRM', crm_atendimento: 'o atendimento no CRM',
};

function regras(ind, fontes, L, { inicio, agora }) {
  const a = [];
  const add = (id, nivel, titulo, detalhe, acao) => a.push({ id, nivel, titulo, detalhe, acao });
  const h = Math.round(L.janela_min / 6) / 10; // 120 → 2
  const s = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const pc = (n) => `${String(n).replace('.', ',')}%`;

  // Saúde do app e do gerador
  const saude = ind.saude;
  if (saude && saude.app.estado === 'fora') {
    add('app_fora', 'critico', 'App fora do ar', `${saude.url}/health não respondeu (${saude.app.detalhe}).`,
      'Abra o serviço no EasyPanel, veja os logs e reinicie se preciso.');
  }
  if (saude && saude.gerador.estado === 'desligado') {
    add('gerador_desligado', 'critico', 'Gerador de link desligado', 'O gerador respondeu 503: o link de acesso está saindo vazio.',
      'Confira LINK_ACESSO_SEGREDO no Environment do EasyPanel (o mesmo valor do n8n) e reinicie o app.');
  } else if (saude && saude.gerador.estado === 'fora' && saude.app.estado !== 'fora') {
    add('gerador_fora', 'critico', 'Gerador de link fora do ar', `POST /api/integracoes/link-acesso não respondeu (${saude.gerador.detalhe}).`,
      'Veja os logs do app no EasyPanel; enquanto isso, o BV sai sem o link pessoal.');
  }
  if (saude && saude.descobrir && saude.descobrir.estado === 'fora') {
    add('descobrir_email_fora', 'critico', 'Site do e-mail acadêmico fora do ar', `${saude.descobrir.url} não respondeu (${saude.descobrir.detalhe}).`,
      'Avise quem cuida do site. Enquanto estiver fora, o calouro não descobre o e-mail acadêmico (passo 1 do módulo 1): oriente pelo WhatsApp a pedir o e-mail ao polo.');
  }

  // n8n
  const n8n = ind.n8n;
  if (n8n) {
    n8n.fluxos.filter((f) => f.lido && f.erro >= L.n8n_erros_min).forEach((f) => {
      add(`n8n_erro:${f.id}`, 'critico', `Erro no n8n: ${f.nome}`,
        `${s(f.erro, 'execução', 'execuções')} com erro em ${h} h (de ${f.total}).`,
        `Abra o n8n › Executions do fluxo ${f.nome}, veja o nó que falhou e reprocesse as execuções com erro.`);
    });
    const ini = minutosSP(inicio);
    const fim = minutosSP(agora);
    const noHorario = ini >= L.vendas_de * 60 && fim <= L.vendas_ate * 60 + 15 && fim > ini;
    if (noHorario && n8n.vendas === 0) {
      add('vendas_zero', 'atencao', `Nenhuma venda em ${h} h`,
        `O fluxo comercial_p_academico não criou nenhum negócio entre ${horaTxt(inicio)} e ${horaTxt(agora)}.`,
        'Confirme com o comercial se houve venda. Se houve, veja se o fluxo está ativo no n8n e se o gatilho do CRM disparou.');
    }
  }

  // Link de acesso saindo vazio
  const lk = ind.app && ind.app.links;
  if (lk && lk.pedidos >= L.link_min_amostra && lk.vazio_pct > L.link_vazio_pct) {
    const motivos = Object.keys(lk.por_resultado).filter((k) => k !== 'ok').sort((x, y) => lk.por_resultado[y] - lk.por_resultado[x]);
    const top = motivos[0];
    const acao = top === 'conta_nao_encontrada'
      ? 'A conta ainda não existia quando o n8n pediu o link: confira se o fluxo Alunos Provisorios rodou antes e se o RGM do negócio está certo.'
      : top === 'sem_rgm'
        ? 'O n8n pediu o link sem RGM: confira o campo usado no nó que chama o gerador.'
        : 'Veja os logs do app no EasyPanel ("Falha ao gerar link de acesso").';
    add('link_vazio', 'critico', 'Link de acesso saindo vazio',
      `${lk.falhas} de ${lk.pedidos} pedidos sem link (${pc(lk.vazio_pct)}). Motivo mais comum: ${top || '—'}.`, acao);
  }

  // CRM
  const crm = ind.crm;
  if (crm && crm.bv) {
    if (crm.bv.falhas >= L.bv_failed_min) {
      const passos = Object.keys(crm.bv.falhas_por_passo).sort((x, y) => crm.bv.falhas_por_passo[y] - crm.bv.falhas_por_passo[x]);
      add('bv_failed', 'atencao', 'Passo com falha no BV',
        `${s(crm.bv.falhas, 'passo', 'passos')} FAILED em ${h} h (passo mais afetado: ${passos[0]}).`,
        'Abra o CRM › Automações › BV › Logs com o filtro FAILED e trate cada negócio (reenvie ou chame a pessoa).');
    }
    if (crm.bv.matricula != null && crm.bv.matricula >= L.matricula_min) {
      add('bv_matricula', 'critico', 'Graduação caindo no template de matrícula',
        `${s(crm.bv.matricula, 'negócio passou', 'negócios passaram')} pelo passo de matrícula do BV em ${h} h.`,
        'A proteção de senha (acad_senha_reserva) falhou: confira o fluxo no n8n e o campo de senha desses negócios antes do próximo envio.');
    }
  }
  if (crm && crm.email_acad && crm.email_acad.falhas >= L.email_failed_min) {
    add('email_failed', 'atencao', 'Falha na automação email_acad',
      `${s(crm.email_acad.falhas, 'passo', 'passos')} FAILED em ${h} h.`,
      'Abra o CRM › Automações › email_acad › Logs com o filtro FAILED.');
  }
  if (crm) {
    crm.templates.forEach((t) => {
      if (!t.aprovado) {
        add(`template:${t.nome}`, 'critico', `Template fora de APPROVED: ${t.nome}`, 'O template não aparece mais entre os aprovados da Meta.',
          'Abra o CRM › Templates, veja o status na Meta e troque a automação para um template aprovado enquanto isso.');
      } else if (t.categoria === 'MARKETING') {
        add(`template:${t.nome}`, 'critico', `Template virou MARKETING: ${t.nome}`, 'A Meta recategorizou o template como MARKETING (custo maior e entrega limitada).',
          'Peça a revisão da categoria na Meta ou crie um template UTILITY com o mesmo texto.');
      }
    });
  }

  // Régua: teste A/B com vencedor
  const rg = ind.regua;
  if (rg) {
    rg.testes.filter((t) => t.estado === 'vencedor').forEach((t) => {
      const v = t.variantes.find((x) => x.variante === t.vencedor);
      const outras = t.variantes.filter((x) => x !== v).map((x) => `${x.variante} ${pc(x.pct)} (${x.entraram} de ${x.base})`).join(', ');
      add(`teste:${t.teste}:${t.vencedor}`, 'info', `Teste ${t.teste}: a variante ${t.vencedor} venceu`,
        `${pc(v.pct)} entraram em 24 h (${v.entraram} de ${v.base}) contra ${outras}.`,
        `Deixe só a variante ${t.vencedor} (${v.origem}) no rodízio do CRM e comece o próximo teste com outro código.`);
    });
  }

  // Falhas de login
  const f = ind.app && ind.app.falhas;
  if (f && f.tentativas >= L.login_min_amostra && f.pct > L.falhas_login_pct) {
    const motivos = Object.keys(f.por_motivo).filter((k) => !MOTIVOS_SEM_TENTATIVA.includes(k)).sort((x, y) => f.por_motivo[y] - f.por_motivo[x]);
    add('falhas_login', 'atencao', 'Muitas falhas de login',
      `${f.total} de ${f.tentativas} tentativas falharam (${pc(f.pct)}). Motivo mais comum: ${motivos[0] || '—'}.`,
      motivos[0] === 'senha_incorreta'
        ? 'Confira se a senha inicial que sai na mensagem do BV bate com a do portal; mande o link de acesso para quem errou.'
        : 'Veja Admin › Medição › Entrada para o detalhe por motivo e origem.');
  }

  // Fonte que não respondeu (sem_acesso e desligado não viram alerta: aparecem só na aba)
  Object.keys(NOME_FONTE).forEach((k) => {
    const x = fontes[k];
    if (!x) return;
    if (x.estado === 'erro' || x.estado === 'parcial') {
      add(`fonte:${k}`, 'atencao', `Não consegui ler ${NOME_FONTE[k]}`, x.detalhe || `HTTP ${x.status}`,
        'Veja se o serviço está no ar; o vigia tenta de novo na próxima rodada.');
    } else if (x.estado === 'recusado') {
      add(`fonte:${k}`, 'atencao', `Chave recusada ao ler ${NOME_FONTE[k]}`, `HTTP ${x.status}${x.codigo ? ` (${x.codigo})` : ''}.`,
        k === 'n8n' ? 'Gere uma nova chave em n8n › Settings › API e cole em N8N_API_KEY no EasyPanel.'
          : 'Confira CRM_API_TOKEN e CRM_API_URL no EasyPanel (o token só vale na API pública do CRM).');
    }
  });
  return a;
}

// ---------- o que mandar ----------

function assinatura(al) { return `${al.id}|${al.nivel}`; }

// conhecidos: { assinatura: avisado_em } do último retrato agendado. Devolve o que é novo, o que voltou ao
// normal e o mapa a guardar se a mensagem for entregue.
function novidades(alertas, conhecidos, agora, lembreteH = 0) {
  const antes = conhecidos || {};
  const t = new Date(agora).getTime();
  const proximo = {};
  const novos = [];
  alertas.forEach((al) => {
    const k = assinatura(al);
    const quando = antes[k] ? Date.parse(antes[k]) : null;
    if (quando && !(lembreteH > 0 && t - quando >= lembreteH * 3600000)) proximo[k] = antes[k];
    else { novos.push(al); proximo[k] = new Date(t).toISOString(); }
  });
  const idsAgora = new Set(alertas.map((al) => al.id));
  const resolvidos = [];
  Object.keys(antes).forEach((k) => {
    const id = k.split('|')[0];
    if (!idsAgora.has(id) && !resolvidos.includes(id)) resolvidos.push(id);
  });
  return { novos, resolvidos, proximo };
}

const ICONE = { critico: '🔴', atencao: '🟡', info: '🟢' };

function montarMensagem({ novos, resolvidos = [], titulos = {}, abertos = 0, agora, painel }) {
  const linhas = [`*Vigia do calouro* · ${dataHoraTxt(agora)}`];
  if (novos.length) {
    linhas.push('');
    novos.slice(0, 12).forEach((al) => {
      linhas.push(`${ICONE[al.nivel] || '•'} *${al.titulo}*`);
      linhas.push(al.detalhe);
      linhas.push(`→ ${al.acao}`);
      linhas.push('');
    });
    if (novos.length > 12) linhas.push(`+ ${novos.length - 12} alerta(s) no painel.`, '');
  }
  if (resolvidos.length) {
    if (!novos.length) linhas.push('');
    linhas.push(`✅ Voltou ao normal: ${resolvidos.map((id) => titulos[id] || id).join('; ')}.`);
  }
  const outros = abertos - novos.length;
  if (outros > 0) linhas.push(`Seguem abertos (já avisados): ${outros}.`);
  if (painel) linhas.push(`Painel: ${painel}`);
  return linhas.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 3500);
}

// Linha da tendência (e o que a aba mostra no topo).
function resumo(ind, alertas) {
  const app = ind.app || {};
  const n8n = ind.n8n;
  const crm = ind.crm;
  return {
    vendas: n8n ? n8n.vendas : null,
    n8n_erros: n8n ? n8n.fluxos.reduce((t, f) => t + (f.erro || 0), 0) : null,
    entradas: app.entradas ? app.entradas.total : null,
    primeiras: app.entradas ? app.entradas.primeiras : null,
    falhas_pct: app.falhas ? app.falhas.pct : null,
    links_pedidos: app.links ? app.links.pedidos : null,
    link_vazio_pct: app.links ? app.links.vazio_pct : null,
    links_usados: app.links ? app.links.usados : null,
    nunca_entraram: app.contas ? app.contas.nunca_entraram : null,
    travados: app.travados != null ? app.travados : null,
    cert_erros: app.eventos ? app.eventos.certificado_erro : null,
    saidas_email: app.eventos ? app.eventos.saida_email_academico : null,
    bv_failed: crm && crm.bv ? crm.bv.falhas : null,
    alertas: alertas.length,
    criticos: alertas.filter((x) => x.nivel === 'critico').length,
  };
}

// ---------- régua: o que funciona ----------

// Cada mensagem da régua gera um link com o seu código no ?o= (bv_acesso, fup1_a, fup1_b...). Por código:
// quantas contas receberam (base: ainda não tinham entrado), quantas entraram em até 24 h por qualquer
// caminho. Só entra quem já teve as 24 h inteiras. Códigos que terminam em _a, _b, _c são variantes de um
// teste A/B (prefixo antes do _): o vencedor sai quando bate todas as outras com folga estatística.
async function lerRegua(pool, agora, L) {
  const ate = new Date(new Date(agora).getTime() - 24 * 3600000);
  const desde = new Date(new Date(agora).getTime() - L.regua_dias * 86400000);
  const linhas = await seguro(pool.query(`
    WITH envios AS (
      SELECT DISTINCT ON (l.aluno_id, l.origem) l.aluno_id, l.origem, l.criado_em
      FROM csu_links_acesso l
      WHERE l.origem IS NOT NULL AND l.criado_em >= $1 AND l.criado_em <= $2
      ORDER BY l.aluno_id, l.origem, l.criado_em
    )
    SELECT e.origem,
           COUNT(*) FILTER (WHERE a.primeiro_login_em IS NULL OR a.primeiro_login_em >= e.criado_em)::int AS base,
           COUNT(*) FILTER (WHERE a.primeiro_login_em >= e.criado_em AND a.primeiro_login_em < e.criado_em + interval '24 hours')::int AS entraram
    FROM envios e JOIN csu_alunos a ON a.id = e.aluno_id
    GROUP BY 1 ORDER BY 1`, [desde, ate]).then((r) => r.rows), []);
  const mensagens = linhas.map((x) => ({ ...x, pct: pct(x.entraram, x.base) }));
  return { dias: L.regua_dias, mensagens, testes: testesAB(mensagens, L.ab_min_amostra) };
}

// z de duas proporções (pooled).
function zDuas(a, b) {
  const p = (a.entraram + b.entraram) / (a.base + b.base);
  const se = Math.sqrt(p * (1 - p) * (1 / a.base + 1 / b.base));
  return se ? (a.entraram / a.base - b.entraram / b.base) / se : 0;
}

function testesAB(mensagens, minAmostra = REGRAS_PADRAO.ab_min_amostra) {
  const grupos = {};
  mensagens.forEach((m) => {
    const x = /^(.+)_([a-z])$/.exec(m.origem);
    if (!x) return;
    (grupos[x[1]] = grupos[x[1]] || []).push({ variante: x[2].toUpperCase(), ...m });
  });
  return Object.keys(grupos).filter((k) => grupos[k].length >= 2).map((k) => {
    const vs = grupos[k].sort((a, b) => a.variante.localeCompare(b.variante));
    const faltam = vs.reduce((t, v) => t + Math.max(0, minAmostra - v.base), 0);
    const melhor = vs.filter((v) => v.base).sort((a, b) => b.entraram / b.base - a.entraram / a.base)[0];
    const corte = vs.length > 2 ? 2.24 : 1.96; // com 3+ variantes, margem mais rígida (Bonferroni)
    const zs = melhor ? vs.filter((v) => v !== melhor).map((v) => (v.base ? zDuas(melhor, v) : 0)) : [];
    const venceu = Boolean(melhor) && !faltam && zs.length && zs.every((z) => z >= corte);
    return {
      teste: k,
      variantes: vs.map((v) => ({ variante: v.variante, origem: v.origem, base: v.base, entraram: v.entraram, pct: v.pct })),
      estado: venceu ? 'vencedor' : faltam ? 'coletando' : 'empate',
      vencedor: venceu ? melhor.variante : null,
      faltam,
      z_min: zs.length ? Math.round(Math.min(...zs) * 100) / 100 : null,
    };
  });
}

// ---------- rodada ----------

async function coletar(pool, { agora, fetchImpl, L }) {
  const inicio = new Date(new Date(agora).getTime() - L.janela_min * 60000);
  const totalNiveis = (() => { try { return require('./trilha').NIVEIS.length; } catch (e) { return 7; } })();
  const [app, saude, n8n, crm, regua] = await Promise.all([
    lerApp(pool, inicio, totalNiveis).then((d) => ({ d, f: { estado: 'ok' } }), (err) => ({ d: null, f: { estado: 'erro', detalhe: err.code || err.message } })),
    lerSaude(fetchImpl),
    lerN8n(fetchImpl, inicio),
    lerCrm(fetchImpl, inicio, agora, L),
    lerRegua(pool, agora, L).catch((err) => { console.error('Vigia: régua', err.code || '', err.message); return null; }),
  ]);
  const fontes = {
    app: app.f,
    app_publico: { estado: saude.app.estado === 'ok' && saude.gerador.estado === 'ok' ? 'ok' : 'erro' },
    email_academico: saude.descobrir.estado === 'ok' ? { estado: 'ok' } : { estado: 'erro', detalhe: saude.descobrir.detalhe },
    n8n: n8n.fonte,
    ...crm.fontes,
  };
  const indicadores = { janela_min: L.janela_min, app: app.d, saude, n8n: n8n.dados, crm: crm.dados, regua };
  return { inicio, fontes, indicadores };
}

async function ultimoAgendado(pool) {
  const r = await pool.query(`SELECT envio FROM csu_vigia_retratos WHERE slot IS NOT NULL ORDER BY lido_em DESC LIMIT 1`);
  return r.rows[0] ? r.rows[0].envio || {} : {};
}

async function enviarMensagem(fetchImpl, conversa, texto) {
  const token = envValue('CRM_API_TOKEN');
  if (!token) return { ok: false, motivo: 'sem_token' };
  const r = await buscar(fetchImpl, `${crmBase()}/api/conversations/${encodeURIComponent(conversa)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ content: texto }),
    timeoutMs: 15000,
  });
  if (!r.ok) return { ok: false, motivo: r.erro || `HTTP ${r.status}` };
  const nova = r.json && typeof r.json.reopenedConversationId === 'string' ? r.json.reopenedConversationId : null;
  return { ok: true, conversa: nova && DESTINO_RE.test(nova) ? nova : conversa };
}

// Uma leitura. slot = faixa de 2 h (rodada agendada) ou null (leitura manual pelo admin, que nunca envia).
async function rodar(pool, { agora = new Date(), slot = null, enviar = false, fetchImpl = globalThis.fetch } = {}) {
  await garantir(pool);
  const L = limites();
  const t0 = Date.now();
  const { inicio, fontes, indicadores } = await coletar(pool, { agora, fetchImpl, L });
  const alertas = regras(indicadores, fontes, L, { inicio, agora });
  indicadores.resumo = resumo(indicadores, alertas);

  const anterior = slot ? await ultimoAgendado(pool) : {};
  const nov = novidades(alertas, anterior.conhecidos, agora, L.lembrete_h);
  const titulos = {};
  (anterior.titulos ? Object.entries(anterior.titulos) : []).forEach(([k, v]) => { titulos[k] = v; });
  alertas.forEach((al) => { titulos[al.id] = al.titulo; });
  const painel = `${appBase()}/admin#vigia`;
  const mensagem = slot
    ? (nov.novos.length || nov.resolvidos.length ? montarMensagem({ ...nov, titulos, abertos: alertas.length, agora, painel }) : null)
    : (alertas.length ? montarMensagem({ novos: alertas, agora, painel }) : null);

  const envio = { mensagem, novos: nov.novos.map((x) => x.id), resolvidos: nov.resolvidos, enviado: false };
  if (slot) {
    envio.conhecidos = anterior.conhecidos || {};
    const para = destino();
    if (!mensagem) { envio.motivo = 'nada_novo'; envio.conhecidos = nov.proximo; }
    else if (!enviar) envio.motivo = 'envio_desligado';
    else if (!para) envio.motivo = 'sem_destino';
    else {
      const conversa = anterior.para === para && anterior.conversa ? anterior.conversa : para;
      const r = await enviarMensagem(fetchImpl, conversa, mensagem);
      envio.para = para;
      envio.conversa = r.ok ? r.conversa : conversa;
      if (r.ok) { envio.enviado = true; envio.enviado_em = new Date().toISOString(); envio.conhecidos = nov.proximo; } else envio.motivo = r.motivo;
    }
    // Títulos de quem ainda pode "voltar ao normal" (os conhecidos e os abertos), para a próxima mensagem.
    envio.titulos = {};
    Object.keys(envio.conhecidos).map((k) => k.split('|')[0]).concat(alertas.map((al) => al.id))
      .forEach((id) => { if (titulos[id]) envio.titulos[id] = titulos[id]; });
  }

  const ins = await pool.query(
    `INSERT INTO csu_vigia_retratos (slot, lido_em, janela_inicio, manual, duracao_ms, fontes, indicadores, alertas, envio)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (slot) DO NOTHING
     RETURNING id, slot, lido_em, janela_inicio, manual, duracao_ms, fontes, indicadores, alertas, envio`,
    [slot, new Date(agora), inicio, !slot, Date.now() - t0, fontes, indicadores, JSON.stringify(alertas), envio],
  );
  return ins.rows[0] || null;
}

// Rodada agendada: só uma instância roda por faixa de 2 h.
let emCurso = false;
async function rodadaAgendada(pool, { agora = new Date(), fetchImpl = globalThis.fetch } = {}) {
  if (emCurso || !pool) return { rodou: false, motivo: 'em_curso' };
  emCurso = true;
  let client = null;
  let travou = false;
  try {
    await garantir(pool);
    const L = limites();
    const slot = slotDe(agora, L.janela_min);
    const ja = await pool.query('SELECT 1 FROM csu_vigia_retratos WHERE slot = $1', [slot]);
    if (ja.rowCount) return { rodou: false, motivo: 'faixa_lida', slot };
    client = await pool.connect();
    travou = (await client.query('SELECT pg_try_advisory_lock($1) AS ok', [TRAVA])).rows[0].ok;
    if (!travou) return { rodou: false, motivo: 'outra_instancia', slot };
    const de2 = await pool.query('SELECT 1 FROM csu_vigia_retratos WHERE slot = $1', [slot]);
    if (de2.rowCount) return { rodou: false, motivo: 'faixa_lida', slot };
    const retrato = await rodar(pool, { agora, slot, enviar: true, fetchImpl });
    return { rodou: Boolean(retrato), slot, retrato };
  } finally {
    if (client) {
      if (travou) await client.query('SELECT pg_advisory_unlock($1)', [TRAVA]).catch(() => {});
      client.release();
    }
    emCurso = false;
  }
}

let timer = null;
function iniciar(getPool) {
  if (timer || !ligado()) return false;
  const tick = () => {
    const pool = getPool();
    if (!pool || !ligado()) return;
    rodadaAgendada(pool)
      .then((r) => { if (r.rodou) console.log(`Vigia: retrato da faixa ${r.slot} (${r.retrato.alertas.length} alerta(s)).`); })
      .catch((err) => console.error('Vigia falhou:', err.code || '', err.message));
  };
  setTimeout(tick, 60 * 1000);
  timer = setInterval(tick, VERIFICA_MS);
  if (timer.unref) timer.unref();
  return true;
}

// ---------- aba do admin ----------

async function painelAdmin(pool) {
  await garantir(pool);
  const cfg = configuracao();
  const [ult, hist] = await Promise.all([
    pool.query(`SELECT id, slot, lido_em, janela_inicio, manual, duracao_ms, fontes, indicadores, alertas, envio
                FROM csu_vigia_retratos ORDER BY lido_em DESC LIMIT 1`),
    pool.query(`SELECT slot, lido_em, manual, indicadores->'resumo' AS resumo
                FROM csu_vigia_retratos WHERE lido_em >= now() - interval '24 hours' ORDER BY lido_em`),
  ]);
  const ultimo = ult.rows[0] || null;
  const agendado = (await pool.query(`SELECT lido_em, envio FROM csu_vigia_retratos WHERE slot IS NOT NULL ORDER BY lido_em DESC LIMIT 1`)).rows[0] || null;
  const minutos = agendado ? Math.round((Date.now() - new Date(agendado.lido_em).getTime()) / 60000) : null;
  if (ultimo && ultimo.envio) { delete ultimo.envio.conhecidos; delete ultimo.envio.para; delete ultimo.envio.conversa; }
  return {
    agora: new Date().toISOString(),
    config: cfg,
    ultimo,
    ultima_agendada: agendado ? { lido_em: agendado.lido_em, enviado: Boolean(agendado.envio && agendado.envio.enviado), motivo: agendado.envio && agendado.envio.motivo } : null,
    minutos_sem_leitura: minutos,
    atrasado: cfg.ligado && (minutos == null || minutos > cfg.limites.atraso_min),
    proxima_faixa: new Date(Date.parse(slotDe(new Date(), cfg.limites.janela_min)) + cfg.limites.janela_min * 60000).toISOString(),
    tendencia: hist.rows,
  };
}

function registrarRotas(app, { getPool, requireAdmin }) {
  app.get('/api/admin/vigia', requireAdmin, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
    try {
      return res.json(await painelAdmin(pool));
    } catch (err) {
      console.error('Falha no Vigia:', err.code || '', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível carregar o Vigia.' });
    }
  });
  // Leitura manual: guarda o retrato e mostra a mensagem que iria, mas não envia nada.
  app.post('/api/admin/vigia/ler', requireAdmin, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
    try {
      await rodar(pool, { slot: null });
      return res.json(await painelAdmin(pool));
    } catch (err) {
      console.error('Falha na leitura do Vigia:', err.code || '', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível fazer a leitura.' });
    }
  });
}

module.exports = {
  FLUXOS_N8N, CRM, REGRAS_PADRAO,
  ligado, limites, configuracao, slotDe, minutosSP,
  agregarN8n, agregarLogs, numeros, regras, novidades, montarMensagem, resumo, testesAB, lerRegua,
  ensureSchema, garantir, registrarPedidoLink, lerApp, lerN8n, lerCrm, lerSaude,
  rodar, rodadaAgendada, iniciar, painelAdmin, registrarRotas,
};
