'use strict';

// Acompanhamento do aluno: acessos (sessões), tempo ativo, cliques, vídeos e eventos do portal,
// gravados no nosso Postgres. O admin usa para achar quem travou ou sumiu e chamar no WhatsApp.
//
// Liga só para as contas de RASTREIO_LIBERADO_PARA (RGM ou e-mail; "*" = todos; vazio = ninguém).
// Guardamos o mínimo: nada do que o aluno digita em formulários, nada de senha, sem IP.
// Eventos e acessos com mais de RASTREIO_RETENCAO_DIAS (padrão 180) são apagados.

const { envValue } = require('./env');

const NOME_EVENTO = /^[a-z0-9_]{2,40}$/;
const MAX_EVENTOS = 60; // o corpo passa pelo express.json global (20 kb)
const MAX_CHAVES = 12;

function lista(nome) {
  return envValue(nome).split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

function liberadoPara(aluno) {
  const l = lista('RASTREIO_LIBERADO_PARA');
  if (!l.length) return false;
  if (l.includes('*')) return true;
  if (!aluno) return false;
  const rgm = String(aluno.rgm || '').replace(/\D+/g, '');
  const email = String(aluno.email || '').trim().toLowerCase();
  return Boolean((rgm && l.includes(rgm)) || (email && l.includes(email)));
}

function retencaoDias() {
  const n = Number(envValue('RASTREIO_RETENCAO_DIAS', '180'));
  return Number.isFinite(n) && n >= 30 ? Math.floor(n) : 180;
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS csu_acessos (
      sessao TEXT PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
      fim TIMESTAMPTZ NOT NULL DEFAULT now(),
      segundos_ativos INTEGER NOT NULL DEFAULT 0,
      telas INTEGER NOT NULL DEFAULT 0,
      cliques INTEGER NOT NULL DEFAULT 0,
      dispositivo TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_csu_acessos_aluno ON csu_acessos (aluno_id, inicio DESC);

    CREATE TABLE IF NOT EXISTS csu_eventos (
      id BIGSERIAL PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      sessao TEXT,
      nome TEXT NOT NULL,
      tela TEXT,
      dados JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_csu_eventos_aluno ON csu_eventos (aluno_id, criado_em DESC);
    CREATE INDEX IF NOT EXISTS idx_csu_eventos_nome ON csu_eventos (nome, criado_em DESC);

    CREATE TABLE IF NOT EXISTS csu_followups (
      id SERIAL PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      motivo TEXT,
      canal TEXT NOT NULL DEFAULT 'whatsapp',
      nota TEXT,
      admin_id INTEGER,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_csu_followups_aluno ON csu_followups (aluno_id, criado_em DESC);

    CREATE TABLE IF NOT EXISTS csu_acomp_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      config JSONB NOT NULL,
      admin_id INTEGER,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await limparAntigos(pool);
}

async function limparAntigos(pool) {
  const dias = retencaoDias();
  await pool.query(`DELETE FROM csu_eventos WHERE criado_em < now() - ($1::int * interval '1 day')`, [dias]);
  await pool.query(`DELETE FROM csu_acessos WHERE fim < now() - ($1::int * interval '1 day')`, [dias]);
}

// Só valores simples, texto curto, no máximo 12 chaves.
function limpaDados(dados) {
  const out = {};
  if (!dados || typeof dados !== 'object') return out;
  Object.keys(dados).slice(0, MAX_CHAVES).forEach((k) => {
    const chave = String(k).slice(0, 40);
    const v = dados[k];
    if (v == null) return;
    if (typeof v === 'string') out[chave] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[chave] = v;
    else if (typeof v === 'boolean') out[chave] = v;
  });
  return out;
}

function dataDoCliente(raw) {
  const t = Date.parse(raw);
  const agora = Date.now();
  if (!Number.isFinite(t) || t > agora + 60000 || t < agora - 6 * 3600000) return new Date(agora);
  return new Date(Math.min(t, agora));
}

// Um lote vindo do navegador: soma tempo/cliques/telas na sessão e grava os eventos.
async function registrarLote(pool, aluno, body) {
  const sessao = String(body?.sessao || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
  if (sessao.length < 8) return { ok: false, motivo: 'sessao' };
  const eventos = (Array.isArray(body?.eventos) ? body.eventos : []).slice(0, MAX_EVENTOS)
    .filter((e) => e && NOME_EVENTO.test(String(e.nome || '')));
  const ativo = Math.max(0, Math.min(900, Math.round(Number(body?.ativo_s) || 0)));
  const cliques = eventos.filter((e) => e.nome === 'clique').length;
  const telas = eventos.filter((e) => e.nome === 'tela_aberta').length;
  const dispositivo = String(body?.dispositivo || '').slice(0, 20) || null;

  // Sessão de outra conta não é reaproveitada (só soma se for do mesmo aluno).
  await pool.query(
    `INSERT INTO csu_acessos (sessao, aluno_id, segundos_ativos, telas, cliques, dispositivo)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (sessao) DO UPDATE SET
       fim = now(),
       segundos_ativos = csu_acessos.segundos_ativos + EXCLUDED.segundos_ativos,
       telas = csu_acessos.telas + EXCLUDED.telas,
       cliques = csu_acessos.cliques + EXCLUDED.cliques
     WHERE csu_acessos.aluno_id = EXCLUDED.aluno_id`,
    [sessao, aluno.id, ativo, telas, cliques, dispositivo],
  );

  if (eventos.length) {
    const valores = [];
    const params = [];
    eventos.forEach((e, i) => {
      const b = i * 6;
      valores.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::jsonb, $${b + 6})`);
      params.push(aluno.id, sessao, String(e.nome), e.tela ? String(e.tela).slice(0, 60) : null,
        JSON.stringify(limpaDados(e.dados)), dataDoCliente(e.em));
    });
    await pool.query(
      `INSERT INTO csu_eventos (aluno_id, sessao, nome, tela, dados, criado_em) VALUES ${valores.join(', ')}`,
      params,
    );
  }
  return { ok: true, eventos: eventos.length };
}

// ---------- Painel do admin ----------

// Regras dos sinais: padrão aqui, ajustes salvos pelo admin em csu_acomp_config (uma linha).
// limite = o número que dispara o sinal (dias ou vezes, conforme "tipo").
// mensagem aceita: {nome} {nivel} {nivel_titulo} {termo} {data_primeiro_acesso} {dias_sem_acesso}
//                  {email} {senha_inicial} {link}
const OI = 'Oi, {nome}! Aqui é da equipe do seu polo na Cruzeiro do Sul Virtual.';
const SINAIS = {
  nunca_entrou: { rotulo: 'Ainda não entrou no portal', tipo: 'horas', descricao: 'Conta criada há pelo menos N horas (dentro do período escolhido) e nenhum login até agora',
    padrao: { ativo: true, prioridade: 1, limite: 24, mensagem: `${OI} Seu acesso ao portal do polo já está pronto: {link} Entre com o e-mail {email} e a senha {senha_inicial}. Lá você faz a Aula Inaugural, que vale certificado de 4 horas, e vê o passo a passo para entrar no AVA. Se travar em alguma parte, é só me responder aqui.` } },
  travou_trilha: { rotulo: 'Travou na Aula Inaugural', tipo: 'vezes', descricao: 'Tocou em "Travei" pelo menos N vezes e não concluiu a Aula Inaugural',
    padrao: { ativo: true, prioridade: 1, limite: 1, mensagem: `${OI} Vi que você marcou que travou no módulo {nivel} da Aula Inaugural ({nivel_titulo}). Quer ajuda com essa parte?` } },
  certificado_erro: { rotulo: 'Erro no certificado', tipo: 'vezes', descricao: 'Teve N erros ao gerar o certificado (no período) e não gerou depois',
    padrao: { ativo: true, prioridade: 2, limite: 1, mensagem: `${OI} Vi que deu erro ao gerar o seu certificado da Aula Inaugural. Vamos resolver juntos?` } },
  busca_sem_resultado: { rotulo: 'Não achou na Central', tipo: 'vezes', descricao: 'Fez N buscas sem resultado na Central (no período)',
    padrao: { ativo: true, prioridade: 3, limite: 1, mensagem: `${OI} Vi que você procurou por "{termo}" na Central de ajuda e não encontrou. Posso te ajudar com isso?` } },
  parou_trilha: { rotulo: 'Parou a Aula Inaugural', tipo: 'dias', descricao: 'Começou a Aula Inaugural, não concluiu e está há N dias sem mexer nela',
    padrao: { ativo: true, prioridade: 4, limite: 3, mensagem: `${OI} Você começou a Aula Inaugural e parou no módulo {nivel}. Falta pouco para o certificado de 4 horas! Precisa de ajuda para continuar?` } },
  nunca_voltou: { rotulo: 'Entrou uma vez e não voltou', tipo: 'dias', descricao: 'Só 1 acesso e N dias sem voltar',
    padrao: { ativo: true, prioridade: 5, limite: 2, mensagem: `${OI} Você entrou no portal no dia {data_primeiro_acesso} e não voltou mais. Ficou alguma dúvida no primeiro acesso?` } },
  sumiu: { rotulo: 'Sem acessar há dias', tipo: 'dias', descricao: 'N dias ou mais sem entrar no portal',
    padrao: { ativo: true, prioridade: 6, limite: 7, mensagem: `${OI} Faz {dias_sem_acesso} dias que você não entra no portal do polo. Está tudo certo com os estudos? Se precisar de algo, é só responder aqui.` } },
  video_incompleto: { rotulo: 'Vídeos pela metade', tipo: 'vezes', descricao: 'Começou N vídeos ou mais sem terminar (no período)',
    padrao: { ativo: true, prioridade: 7, limite: 2, mensagem: `${OI} Vi que você começou alguns vídeos de ajuda e não terminou. Ficou alguma dúvida que eu possa responder?` } },
};
// Padrões antigos (antes da Aula Inaugural, 20/10/2026). Se o admin salvou a config sem mexer
// nessas mensagens, elas trocam sozinhas pelo padrão novo; mensagens personalizadas ficam como estão.
const MENSAGENS_ANTIGAS = new Set([
  `${OI} Faz {dias_sem_acesso} dias que você não entra na Área do Aluno. Está tudo certo com os estudos? Se precisar de algo, é só responder aqui.`,
  `${OI} Vi que você marcou que travou no Nível {nivel} da Trilha EaD ({nivel_titulo}). Quer ajuda com essa parte?`,
  `${OI} Você começou a Trilha EaD para Iniciantes e parou no Nível {nivel}. Falta pouco! Precisa de ajuda para continuar?`,
]);
// Esconder da lista quem já foi contatado há menos de N dias (0 = não esconde).
const PADRAO_GERAL = { ocultar_contatados_dias: 0 };

function configPadrao() {
  const sinais = {};
  Object.keys(SINAIS).forEach((id) => { sinais[id] = { ...SINAIS[id].padrao }; });
  return { ...PADRAO_GERAL, sinais };
}

function inteiro(v, min, max, padrao) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : padrao;
}

// Junta o que veio (do banco ou do formulário) com o padrão, validando cada campo.
function normalizaConfig(raw) {
  const base = configPadrao();
  const c = raw && typeof raw === 'object' ? raw : {};
  const out = { ocultar_contatados_dias: inteiro(c.ocultar_contatados_dias, 0, 90, base.ocultar_contatados_dias), sinais: {} };
  Object.keys(SINAIS).forEach((id) => {
    const p = base.sinais[id];
    const x = (c.sinais && c.sinais[id]) || {};
    let msg = typeof x.mensagem === 'string' && x.mensagem.trim() ? x.mensagem.trim().slice(0, 700) : p.mensagem;
    // Texto padrão antigo ("Trilha EaD", "Nível") salvo sem personalização vira o padrão novo.
    if (MENSAGENS_ANTIGAS.has(msg)) msg = p.mensagem;
    out.sinais[id] = {
      ativo: typeof x.ativo === 'boolean' ? x.ativo : p.ativo,
      prioridade: inteiro(x.prioridade, 1, 20, p.prioridade),
      limite: inteiro(x.limite, 1, { dias: 365, horas: 720 }[SINAIS[id].tipo] || 50, p.limite),
      mensagem: msg,
    };
  });
  return out;
}

let cacheConfig = null;
async function lerConfig(pool) {
  if (cacheConfig && Date.now() - cacheConfig.em < 30000) return cacheConfig.valor;
  const r = await pool.query('SELECT config FROM csu_acomp_config WHERE id = 1');
  const valor = normalizaConfig(r.rows[0] && r.rows[0].config);
  cacheConfig = { valor, em: Date.now() };
  return valor;
}

async function salvarConfig(pool, raw, adminId) {
  const valor = raw === null ? configPadrao() : normalizaConfig(raw);
  await pool.query(
    `INSERT INTO csu_acomp_config (id, config, admin_id, atualizado_em) VALUES (1, $1::jsonb, $2, now())
     ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, admin_id = EXCLUDED.admin_id, atualizado_em = now()`,
    [JSON.stringify(valor), adminId || null],
  );
  cacheConfig = null;
  return valor;
}

// Descrição das regras para a tela do admin.
function catalogo() {
  return Object.keys(SINAIS).map((id) => ({ id, rotulo: SINAIS[id].rotulo, tipo: SINAIS[id].tipo, descricao: SINAIS[id].descricao }));
}

function diasDesde(d) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

function primeiroNome(nome) {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

function dataBr(d) {
  if (!d) return '';
  const x = new Date(d);
  return x.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
}

// Senha inicial do portal (mesma regra do login: primeiro nome + "123@", ver matriculados.derivedPassword).
function senhaInicial(nome) {
  const p = primeiroNome(nome);
  return p ? `${p}123@` : '';
}

function linkPortal() {
  return String(envValue('APP_PUBLIC_URL') || 'https://app.cruzeiroead.com.br').trim().replace(/\/$/, '');
}

// Mensagem sugerida para o WhatsApp (o atendente revisa antes de enviar).
function mensagem(modelo, r) {
  const valores = {
    nome: primeiroNome(r.nome) || 'tudo bem',
    nivel: r.nivel_aberto || '',
    nivel_titulo: r.nivel_titulo || 'primeiros passos',
    termo: r.ultima_busca_vazia || 'uma dúvida',
    data_primeiro_acesso: dataBr(r.primeiro_acesso),
    dias_sem_acesso: r.dias_sem_acesso == null ? '' : r.dias_sem_acesso,
    email: r.email || 'o seu e-mail',
    senha_inicial: senhaInicial(r.nome) || 'a senha que o polo te passou',
    link: linkPortal(),
  };
  return String(modelo || '').replace(/\{(\w+)\}/g, (m, k) => (k in valores ? String(valores[k]) : m));
}

function sinaisDo(r, cfg) {
  const s = [];
  const on = (id) => cfg.sinais[id].ativo;
  const lim = (id) => cfg.sinais[id].limite;
  const semTrilha = diasDesde(r.trilha_ultima);
  const trilhaAberta = r.niveis_concluidos < r.total_niveis;
  if (on('travou_trilha') && r.travei_total >= lim('travou_trilha') && trilhaAberta) s.push('travou_trilha');
  if (on('certificado_erro') && r.cert_erros >= lim('certificado_erro') && !r.cert_ok) s.push('certificado_erro');
  if (on('busca_sem_resultado') && r.buscas_vazias >= lim('busca_sem_resultado')) s.push('busca_sem_resultado');
  if (on('parou_trilha') && r.trilha_ultima && trilhaAberta && semTrilha != null && semTrilha >= lim('parou_trilha')) s.push('parou_trilha');
  // Nunca entrou: conta com pelo menos N horas, criada dentro do período (sem pegar contas antigas esquecidas).
  const horasConta = r.created_at ? (Date.now() - new Date(r.created_at).getTime()) / 3600000 : null;
  if (on('nunca_entrou') && !r.primeiro_acesso && horasConta != null && horasConta >= lim('nunca_entrou')
    && horasConta <= (r.periodo_dias || 30) * 24) s.push('nunca_entrou');
  const umaVez = r.acessos_total <= 1;
  if (on('nunca_voltou') && umaVez && r.dias_sem_acesso != null && r.dias_sem_acesso >= lim('nunca_voltou')) s.push('nunca_voltou');
  else if (on('sumiu') && r.dias_sem_acesso != null && r.dias_sem_acesso >= lim('sumiu')) s.push('sumiu');
  if (on('video_incompleto') && r.videos_inicio - r.videos_fim >= lim('video_incompleto')) s.push('video_incompleto');
  return s.sort((a, b) => cfg.sinais[a].prioridade - cfg.sinais[b].prioridade);
}

async function listar(pool, opts) {
  const dias = Math.max(1, Math.min(180, Number(opts.dias) || 30));
  const busca = String(opts.q || '').trim().toLowerCase();
  const { rows } = await pool.query(
    `WITH ac AS (
       SELECT aluno_id, COUNT(*)::int AS acessos, COALESCE(SUM(segundos_ativos),0)::int AS segundos,
              COALESCE(SUM(cliques),0)::int AS cliques, COALESCE(SUM(telas),0)::int AS telas
       FROM csu_acessos WHERE inicio >= now() - ($1::int * interval '1 day') GROUP BY aluno_id),
     tot AS (
       SELECT aluno_id, COUNT(*)::int AS acessos_total, MIN(inicio) AS primeiro, MAX(fim) AS ultimo
       FROM csu_acessos GROUP BY aluno_id),
     lg AS (
       SELECT aluno_id, COUNT(*)::int AS logins, MIN(created_at) AS primeiro, MAX(created_at) AS ultimo
       FROM csu_sessoes GROUP BY aluno_id),
     ev AS (
       SELECT aluno_id,
         COUNT(*) FILTER (WHERE nome = 'video_inicio')::int AS videos_inicio,
         COUNT(*) FILTER (WHERE nome = 'video_fim')::int AS videos_fim,
         COUNT(*) FILTER (WHERE nome = 'central_busca_sem_resultado')::int AS buscas_vazias,
         COUNT(*) FILTER (WHERE nome = 'certificado_erro')::int AS cert_erros,
         COUNT(*) FILTER (WHERE nome = 'certificado_gerado')::int AS cert_ok,
         COUNT(*) FILTER (WHERE nome = 'whatsapp_clicado')::int AS whatsapp,
         (ARRAY_AGG(dados->>'termo' ORDER BY criado_em DESC) FILTER (WHERE nome = 'central_busca_sem_resultado'))[1] AS ultima_busca_vazia
       FROM csu_eventos WHERE criado_em >= now() - ($1::int * interval '1 day') GROUP BY aluno_id),
     tr AS (
       SELECT aluno_id,
         COUNT(*) FILTER (WHERE concluido_em IS NOT NULL)::int AS niveis_concluidos,
         MIN(nivel) FILTER (WHERE concluido_em IS NULL) AS nivel_aberto,
         MAX(atualizado_em) AS trilha_ultima,
         COALESCE(SUM((SELECT COALESCE(SUM(value::int),0) FROM jsonb_each_text(travei))),0)::int AS travei_total
       FROM csu_trilha_progresso GROUP BY aluno_id),
     fu AS (
       SELECT DISTINCT ON (aluno_id) aluno_id, criado_em AS followup_em, motivo AS followup_motivo
       FROM csu_followups ORDER BY aluno_id, criado_em DESC)
     SELECT a.id, a.nome, a.rgm, a.email, a.curso, a.unidade, a.created_at,
       COALESCE(ac.acessos,0) AS acessos, COALESCE(ac.segundos,0) AS segundos, COALESCE(ac.cliques,0) AS cliques, COALESCE(ac.telas,0) AS telas,
       GREATEST(COALESCE(tot.acessos_total,0), COALESCE(lg.logins,0), COALESCE(a.logins,0)) AS acessos_total,
       LEAST(tot.primeiro, lg.primeiro, a.primeiro_login_em) AS primeiro_acesso,
       GREATEST(tot.ultimo, lg.ultimo, a.ultimo_login_em) AS ultimo_acesso,
       $1::int AS periodo_dias,
       COALESCE(ev.videos_inicio,0) AS videos_inicio, COALESCE(ev.videos_fim,0) AS videos_fim,
       COALESCE(ev.buscas_vazias,0) AS buscas_vazias, COALESCE(ev.cert_erros,0) AS cert_erros, COALESCE(ev.cert_ok,0) AS cert_ok,
       COALESCE(ev.whatsapp,0) AS whatsapp, ev.ultima_busca_vazia,
       COALESCE(tr.niveis_concluidos,0) AS niveis_concluidos, tr.nivel_aberto, tr.trilha_ultima, COALESCE(tr.travei_total,0) AS travei_total,
       fu.followup_em, fu.followup_motivo
     FROM csu_alunos a
     LEFT JOIN ac ON ac.aluno_id = a.id
     LEFT JOIN tot ON tot.aluno_id = a.id
     LEFT JOIN lg ON lg.aluno_id = a.id
     LEFT JOIN ev ON ev.aluno_id = a.id
     LEFT JOIN tr ON tr.aluno_id = a.id
     LEFT JOIN fu ON fu.aluno_id = a.id
     WHERE a.ativo
       AND ($2::text = '' OR lower(a.nome) LIKE '%' || $2 || '%' OR a.rgm LIKE '%' || $2 || '%' OR lower(a.email) LIKE '%' || $2 || '%')`,
    [dias, busca],
  );
  return { dias, rows };
}

function montar(rows, niveis, cfg) {
  const conf = cfg || configPadrao();
  return rows.map((r) => {
    const x = {
      ...r,
      total_niveis: niveis.length,
      nivel_titulo: r.nivel_aberto && niveis[r.nivel_aberto - 1] ? niveis[r.nivel_aberto - 1].t : null,
      dias_sem_acesso: diasDesde(r.ultimo_acesso),
    };
    x.sinais = sinaisDo(x, conf).map((id) => ({ id, rotulo: SINAIS[id].rotulo, mensagem: mensagem(conf.sinais[id].mensagem, x) }));
    // Contatado há pouco: fica "em espera" (sem sinal) até passar o prazo configurado.
    const espera = conf.ocultar_contatados_dias;
    const desdeContato = diasDesde(r.followup_em);
    x.em_espera = Boolean(espera && x.sinais.length && desdeContato != null && desdeContato < espera);
    if (x.em_espera) { x.sinais_em_espera = x.sinais; x.sinais = []; x.volta_em_dias = espera - desdeContato; }
    x.prioridade = x.sinais.length ? conf.sinais[x.sinais[0].id].prioridade : 99;
    return x;
  });
}

async function percurso(pool, alunoId) {
  const [acessos, eventos, followups] = await Promise.all([
    pool.query(`SELECT sessao, inicio, fim, segundos_ativos, telas, cliques, dispositivo
                FROM csu_acessos WHERE aluno_id = $1 ORDER BY inicio DESC LIMIT 30`, [alunoId]),
    pool.query(`SELECT nome, tela, dados, criado_em, sessao
                FROM csu_eventos WHERE aluno_id = $1 ORDER BY criado_em DESC LIMIT 400`, [alunoId]),
    pool.query(`SELECT motivo, canal, nota, criado_em FROM csu_followups WHERE aluno_id = $1 ORDER BY criado_em DESC LIMIT 20`, [alunoId]),
  ]);
  return { acessos: acessos.rows, eventos: eventos.rows, followups: followups.rows };
}

async function registrarFollowup(pool, alunoId, adminId, body) {
  const motivo = Object.prototype.hasOwnProperty.call(SINAIS, body?.motivo) ? body.motivo : null;
  const canal = ['whatsapp', 'chat', 'telefone', 'email'].includes(body?.canal) ? body.canal : 'whatsapp';
  const nota = body?.nota ? String(body.nota).slice(0, 500) : null;
  await pool.query(
    'INSERT INTO csu_followups (aluno_id, motivo, canal, nota, admin_id) VALUES ($1, $2, $3, $4, $5)',
    [alunoId, motivo, canal, nota, adminId || null],
  );
}

module.exports = {
  liberadoPara,
  ensureSchema,
  registrarLote,
  listar,
  montar,
  percurso,
  registrarFollowup,
  lerConfig,
  salvarConfig,
  configPadrao,
  catalogo,
  SINAIS,
};
