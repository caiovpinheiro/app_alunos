'use strict';

// Pedido de ajuda: quando o aluno toca em "Travei" ou mostra dificuldade e aceita falar com a equipe,
// o portal grava um pedido com protocolo (AJ-XXXX) e o contexto do problema, montado aqui no servidor
// a partir do banco (o navegador manda só a origem, o lugar e alguns contadores).
//
// Entrega: hoje, WhatsApp do polo com a mensagem pronta e o protocolo; o pedido aparece no admin
// (Quem contatar e Visão geral). Se PEDIDO_AJUDA_WEBHOOK_URL existir, o pedido vai ao CRM servidor a
// servidor, assinado (contrato em docs/integracao/bwipo-eventos.md). Quando o chat do CRM aceitar
// abrir com contexto, o portal abre o chat com a mesma mensagem (public/js/dificuldade.js).
//
// Liga só para AJUDA_ATIVA_PARA (RGM ou e-mail; "*" = todos; vazio = ninguém).
// Não guarda nada digitado em formulários, senha, CPF ou IP. Termos de busca com 6+ dígitos são mascarados.

const crypto = require('node:crypto');
const { envValue } = require('./env');
const trilha = require('./trilha');

const ORIGENS = {
  travei: 'Tocou em "Travei"',
  quiz_erros: 'Errou 2 vezes a mesma pergunta',
  video_pausas: 'Pausou o vídeo várias vezes',
  busca_vazia: 'Buscou na Central e não achou',
  certificado_erro: 'Erro ao gerar o certificado',
  parado: 'Ficou parado no módulo',
  ajuda_painel: 'Pediu ajuda pelo painel',
};
const SITUACOES = ['aberto', 'em_atendimento', 'resolvido', 'cancelado'];
const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I/L
// Fora da linha do tempo: ruído e os próprios passos do pedido (já estão no cabeçalho da nota).
const EVENTOS_FORA = new Set(['clique', 'video_progresso', 'tela_aberta', 'pedido_ajuda', 'ajuda_aceita', 'whatsapp_clicado']);
const DISPOSITIVOS = new Set(['celular', 'tablet', 'computador']);

function lista(nome) {
  return envValue(nome).split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

function liberadoPara(aluno) {
  const l = lista('AJUDA_ATIVA_PARA');
  if (!l.length) return false;
  if (l.includes('*')) return true;
  if (!aluno) return false;
  const rgm = String(aluno.rgm || '').replace(/\D+/g, '');
  const email = String(aluno.email || '').trim().toLowerCase();
  return Boolean((rgm && l.map((x) => x.replace(/\D+/g, '')).includes(rgm)) || (email && l.includes(email)));
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS csu_pedidos_ajuda (
      id SERIAL PRIMARY KEY,
      protocolo TEXT NOT NULL UNIQUE,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      origem TEXT NOT NULL,
      tela TEXT,
      nivel INTEGER,
      parte INTEGER,
      pergunta INTEGER,
      contexto JSONB NOT NULL DEFAULT '{}'::jsonb,
      canal TEXT NOT NULL DEFAULT 'whatsapp',
      situacao TEXT NOT NULL DEFAULT 'aberto',
      crm_enviado BOOLEAN NOT NULL DEFAULT FALSE,
      crm_tentativas INTEGER NOT NULL DEFAULT 0,
      crm_ref TEXT,
      admin_id INTEGER,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atendido_em TIMESTAMPTZ,
      resolvido_em TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_csu_pedidos_ajuda_aluno ON csu_pedidos_ajuda (aluno_id, criado_em DESC);
    CREATE INDEX IF NOT EXISTS idx_csu_pedidos_ajuda_situacao ON csu_pedidos_ajuda (situacao, criado_em DESC);
  `);
  const dias = Math.max(30, Number(envValue('RASTREIO_RETENCAO_DIAS', '180')) || 180);
  await pool.query(`DELETE FROM csu_pedidos_ajuda WHERE criado_em < now() - ($1::int * interval '1 day')`, [dias]);
}

function inteiro(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function texto(v, max) { return v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, max) || null; }
function mascara(t) { return t == null ? null : String(t).replace(/\d{6,}/g, (m) => '•'.repeat(Math.min(m.length, 11))); }

function novoProtocolo() {
  const b = crypto.randomBytes(4);
  return 'AJ-' + Array.from(b).map((x) => LETRAS[x % LETRAS.length]).join('');
}

function linkPercurso(alunoId) {
  const base = String(envValue('APP_PUBLIC_URL') || 'https://app.cruzeiroead.com.br').trim().replace(/\/$/, '');
  return `${base}/admin#acompanhamento/aluno/${alunoId}`;
}

// O que o navegador pode mandar (tudo opcional, validado): nada de texto livre além do termo de busca.
function lerEntrada(body) {
  const b = body && typeof body === 'object' ? body : {};
  const sinais = b.sinais && typeof b.sinais === 'object' ? b.sinais : {};
  return {
    origem: Object.prototype.hasOwnProperty.call(ORIGENS, b.origem) ? b.origem : null,
    tela: texto(b.tela, 60),
    nivel: inteiro(b.nivel, 1, trilha.NIVEIS.length),
    parte: inteiro(b.parte, 0, 20),       // a partir de 0, igual a csu_trilha_progresso.travei
    pergunta: inteiro(b.pergunta, 0, 20), // índice da pergunta no módulo
    dispositivo: DISPOSITIVOS.has(b.dispositivo) ? b.dispositivo : null,
    navegador: texto(b.navegador, 40),
    sinais: {
      pausas: inteiro(sinais.pausas, 0, 999),
      video_pct: inteiro(sinais.video_pct, 0, 100),
      viu_dica: sinais.viu_dica === true,
      tempo_s: inteiro(sinais.tempo_s, 0, 86400),
      termos: Array.isArray(sinais.termos) ? sinais.termos.slice(0, 3).map((x) => mascara(texto(x, 60))).filter(Boolean) : [],
      video: texto(sinais.video, 80),
    },
  };
}

async function ultimosEventos(pool, alunoId) {
  try {
    const r = await pool.query(
      `SELECT nome, tela, dados, criado_em FROM csu_eventos
       WHERE aluno_id = $1 AND criado_em >= now() - interval '3 hours'
       ORDER BY criado_em DESC LIMIT 60`, [alunoId]);
    return r.rows.filter((e) => !EVENTOS_FORA.has(e.nome)).slice(0, 10).reverse().map((e) => ({
      nome: e.nome, em: e.criado_em,
      // Só o que ajuda a entender o passo (nada de texto livre além do termo de busca, mascarado).
      dados: {
        nivel: e.dados && e.dados.nivel, parte: e.dados && e.dados.parte, pct: e.dados && e.dados.pct,
        titulo: e.dados && (e.dados.titulo || e.dados.video || e.dados.parte_titulo || e.dados.nivel_titulo),
        termo: e.dados && mascara(e.dados.termo), acertou: e.dados && e.dados.acertou,
      },
    }));
  } catch (err) {
    if (err.code === '42P01') return [];
    throw err;
  }
}

// O pacote que a equipe recebe. Congelado no pedido (o aluno pode avançar depois).
async function montarContexto(pool, aluno, e) {
  const [a, prog, cert, eventos] = await Promise.all([
    pool.query('SELECT id, nome, rgm, email, curso, unidade FROM csu_alunos WHERE id = $1', [aluno.id]),
    pool.query('SELECT nivel, partes_vistas, video_ok, pulou_video, respostas, travei, concluido_em FROM csu_trilha_progresso WHERE aluno_id = $1', [aluno.id]),
    pool.query('SELECT 1 FROM csu_certificados WHERE aluno_id = $1 LIMIT 1', [aluno.id]).catch(() => ({ rows: [] })),
    ultimosEventos(pool, aluno.id),
  ]);
  const p = a.rows[0] || {};
  const rows = prog.rows;
  const concluidos = rows.filter((r) => r.concluido_em).length;
  const onde = { tela: e.tela };
  if (e.nivel) {
    const l = trilha.NIVEIS[e.nivel - 1];
    const r = rows.find((x) => x.nivel === e.nivel) || null;
    onde.nivel = e.nivel;
    onde.nivel_titulo = l.t;
    if (e.parte != null && l.parts && l.parts[e.parte]) { onde.parte = e.parte + 1; onde.parte_titulo = l.parts[e.parte].t; onde.partes = l.parts.length; }
    if (e.pergunta != null && l.qs[e.pergunta]) {
      const q = l.qs[e.pergunta];
      const resp = r && r.respostas ? r.respostas[e.pergunta] : null;
      onde.pergunta = q.q;
      onde.tentativas = resp && resp.tries ? resp.tries.length : 0;
      // As opções são textos nossos (trilha.json), não o que o aluno digitou.
      onde.opcoes_erradas = resp && resp.tries ? resp.tries.filter((j) => !(resp.ok && j === q.certa)).map((j) => q.opts[j]).filter(Boolean) : [];
    }
    if (r) {
      const partes = l.parts ? l.parts.length : 1;
      onde.video = r.video_ok ? 'assistiu' : r.pulou_video ? 'pulou' : `${(r.partes_vistas || []).length} de ${partes} parte(s)`;
      onde.travei = Object.values(r.travei || {}).reduce((s, x) => s + (Number(x) || 0), 0);
      onde.erros_modulo = Object.values(r.respostas || {}).reduce((s, q) => s + Math.max(0, (q.tries || []).length - (q.ok ? 1 : 0)), 0);
      onde.concluido = Boolean(r.concluido_em);
    }
  }
  return {
    aluno: { nome: p.nome || aluno.nome, rgm: p.rgm || null, email: p.rgm ? null : (p.email || aluno.email), curso: p.curso || null, polo: p.unidade || null },
    motivo: ORIGENS[e.origem],
    onde,
    tentou: e.sinais,
    progresso: { concluidos, total: trilha.NIVEIS.length, certificado: cert.rows.length > 0 },
    dispositivo: [e.dispositivo, e.navegador].filter(Boolean).join(' · ') || null,
    ultimos_eventos: eventos,
    rastreio: eventos.length > 0,
    link_percurso: linkPercurso(aluno.id),
  };
}

const TELAS = { '/inicio': 'Início', '/meu-semestre': 'Meu semestre', '/tutoriais': 'Central de ajuda', '/trilha': 'Aula Inaugural', '/avisos': 'Avisos', '/atendimento': 'Atendimento' };

function ondeTexto(ctx) {
  const o = ctx.onde || {};
  if (!o.nivel) return o.tela && TELAS[o.tela] ? `na tela ${TELAS[o.tela]}` : o.tela ? `na tela ${o.tela}` : 'no portal';
  return `no Módulo ${o.nivel} (${o.nivel_titulo})` + (o.parte ? `, parte ${o.parte} "${o.parte_titulo}"` : '') + ' da Aula Inaugural';
}

// Mensagem curta que o aluno manda (pode editar). Vai pré-preenchida no WhatsApp ou no chat.
function mensagemAluno(row) {
  const ctx = row.contexto || {};
  const o = ctx.onde || {};
  let frase;
  if (row.origem === 'certificado_erro') frase = 'Deu erro ao gerar o meu certificado da Aula Inaugural.';
  else if (row.origem === 'busca_vazia') frase = 'Procurei na Central de ajuda e não achei o que precisava.';
  else if (o.nivel) frase = `Travei ${ondeTexto(ctx)}.`;
  else frase = `Preciso de ajuda. Estou ${ondeTexto(ctx).replace('na tela ', 'na tela ')} do portal.`;
  return `Oi! ${frase} Protocolo ${row.protocolo}.`;
}

function hora(d) {
  return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const NOME_EVENTO = {
  trilha_nivel_aberto: 'abriu o módulo', trilha_video_assistido: 'viu o vídeo', trilha_video_pulado: 'pulou o vídeo', trilha_travei: 'Travei',
  trilha_resposta: 'respondeu', video_inicio: 'começou o vídeo', video_pausa: 'pausou o vídeo', video_fim: 'terminou o vídeo',
  central_busca: 'buscou', central_busca_sem_resultado: 'buscou sem resultado', faq_aberta: 'abriu a dúvida', central_video: 'abriu vídeo da Central',
  certificado_erro: 'erro no certificado', ajuda_oferecida: 'recebeu a oferta de ajuda', ajuda_aceita: 'aceitou falar com a equipe',
  ajuda_recusada: 'recusou a oferta de ajuda', ajuda_aberta: 'abriu o painel de ajuda', video_retomado: 'voltou ao vídeo', aviso_lido: 'leu um aviso',
  aula_capitulo: 'abriu capítulo da Aula', certificado_gerado: 'gerou o certificado', trilha_tarefa: 'marcou tarefa', trilha_nivel_concluido: 'concluiu o módulo',
};

// Nota interna para a equipe (CRM ou admin): tudo o que se sabe, em texto corrido.
function notaEquipe(row) {
  const c = row.contexto || {};
  const a = c.aluno || {};
  const o = c.onde || {};
  const t = c.tentou || {};
  const linhas = [];
  linhas.push(`Pedido de ajuda ${row.protocolo} · ${hora(row.criado_em)} · ${a.nome || ''}` + (a.rgm ? ` · RGM ${a.rgm}` : a.email ? ` · ${a.email}` : '') +
    (a.curso ? ` · ${a.curso}` : '') + (a.polo ? ` · Polo ${a.polo}` : ''));
  linhas.push(`Motivo: ${c.motivo || row.origem}, ${ondeTexto(c)}`);
  if (o.pergunta) linhas.push(`Pergunta: "${o.pergunta}" · ${o.tentativas || 0} tentativa(s)` + (o.opcoes_erradas && o.opcoes_erradas.length ? ` · marcou: ${o.opcoes_erradas.map((x) => `"${x}"`).join(', ')}` : ''));
  const tentou = [];
  if (o.video) tentou.push(`vídeo do módulo: ${o.video}`);
  if (t.video_pct != null) tentou.push(`assistiu ${t.video_pct}% do vídeo` + (t.pausas ? `, ${t.pausas} pausa(s)` : ''));
  if (t.viu_dica) tentou.push('viu a dica do "Travei"');
  if (t.termos && t.termos.length) tentou.push(`buscou ${t.termos.map((x) => `"${x}"`).join(', ')}`);
  if (o.erros_modulo) tentou.push(`${o.erros_modulo} erro(s) nas perguntas do módulo`);
  if (tentou.length) linhas.push(`Já tentou: ${tentou.join('; ')}`);
  const prog = c.progresso || {};
  linhas.push([t.tempo_s ? `Tempo aqui: ${Math.max(1, Math.round(t.tempo_s / 60))} min` : null,
    `Progresso: ${prog.concluidos || 0} de ${prog.total || 7} módulos, ${prog.certificado ? 'com' : 'sem'} certificado`, c.dispositivo].filter(Boolean).join(' · '));
  const passos = (c.ultimos_eventos || []).filter((e) => !EVENTOS_FORA.has(e.nome));
  if (passos.length) {
    linhas.push('Últimos passos: ' + passos.map((e) => {
      const d = e.dados || {};
      const extra = d.termo ? ` "${d.termo}"` : d.titulo ? ` (${d.titulo})` : d.nivel ? ` (módulo ${d.nivel})` : '';
      return `${hora(e.em).slice(-5)} ${NOME_EVENTO[e.nome] || e.nome}${extra}`;
    }).join(' · '));
  } else {
    linhas.push('Últimos passos: rastreio desligado para esta conta.');
  }
  linhas.push(`Ver percurso: ${c.link_percurso || linkPercurso(row.aluno_id)}`);
  return linhas.join('\n');
}

// Cria o pedido. Se já houver um aberto do mesmo aluno no mesmo módulo (ou mesma origem) nas últimas 24 h,
// devolve esse (não duplica).
async function criar(pool, aluno, body) {
  const e = lerEntrada(body);
  if (!e.origem) { const err = new Error('origem'); err.status = 400; throw err; }
  const aberto = await pool.query(
    `SELECT * FROM csu_pedidos_ajuda
     WHERE aluno_id = $1 AND situacao IN ('aberto', 'em_atendimento') AND criado_em >= now() - interval '24 hours'
       AND (($2::int IS NOT NULL AND nivel = $2) OR ($2::int IS NULL AND origem = $3))
     ORDER BY criado_em DESC LIMIT 1`, [aluno.id, e.nivel, e.origem]);
  if (aberto.rows[0]) return { pedido: aberto.rows[0], existente: true };
  const contexto = await montarContexto(pool, aluno, e);
  for (let i = 0; i < 5; i += 1) {
    try {
      const r = await pool.query(
        `INSERT INTO csu_pedidos_ajuda (protocolo, aluno_id, origem, tela, nivel, parte, pergunta, contexto)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING *`,
        [novoProtocolo(), aluno.id, e.origem, e.tela, e.nivel, e.parte, e.pergunta, JSON.stringify(contexto)]);
      return { pedido: r.rows[0], existente: false };
    } catch (err) {
      if (err.code !== '23505') throw err; // protocolo repetido: sorteia outro
    }
  }
  throw new Error('Não foi possível gerar o protocolo.');
}

async function aberto(pool, alunoId) {
  const r = await pool.query(
    `SELECT protocolo, origem, nivel, criado_em, situacao FROM csu_pedidos_ajuda
     WHERE aluno_id = $1 AND situacao IN ('aberto', 'em_atendimento') AND criado_em >= now() - interval '24 hours'
     ORDER BY criado_em DESC LIMIT 1`, [alunoId]);
  return r.rows[0] || null;
}

// ---------- CRM (servidor a servidor, assinado) ----------
function webhookUrl() { return String(envValue('PEDIDO_AJUDA_WEBHOOK_URL') || '').trim(); }

async function enviarCRM(pool, row) {
  const url = webhookUrl();
  if (!url) return { enviado: false, motivo: 'sem_url' };
  const c = row.contexto || {};
  const corpo = JSON.stringify({
    tipo: 'pedido_ajuda',
    external_id: (c.aluno && (c.aluno.rgm || c.aluno.email)) || String(row.aluno_id),
    protocolo: row.protocolo,
    origem: row.origem,
    prioridade: ['travei', 'certificado_erro', 'quiz_erros'].includes(row.origem) ? 'alta' : 'normal',
    texto: notaEquipe(row),
    campos: c,
    link_percurso: c.link_percurso,
    criado_em: row.criado_em,
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const segredo = String(envValue('PEDIDO_AJUDA_WEBHOOK_SECRET') || '');
  const headers = { 'Content-Type': 'application/json', 'X-Timestamp': ts, 'Idempotency-Key': row.protocolo };
  if (segredo) headers['X-Signature'] = 'sha256=' + crypto.createHmac('sha256', segredo).update(ts + '.' + corpo).digest('hex');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let ok = false;
  let ref = null;
  try {
    const res = await fetch(url, { method: 'POST', headers, body: corpo, signal: controller.signal });
    ok = res.ok;
    if (ok) { try { const j = await res.json(); ref = j && (j.conversation_id || j.id) ? String(j.conversation_id || j.id).slice(0, 80) : null; } catch (e) { /* sem corpo */ } }
    else console.error('Webhook do pedido de ajuda: HTTP', res.status);
  } catch (err) {
    console.error('Webhook do pedido de ajuda falhou:', err.message);
  } finally {
    clearTimeout(timer);
  }
  await pool.query(
    'UPDATE csu_pedidos_ajuda SET crm_enviado = crm_enviado OR $2, crm_tentativas = crm_tentativas + 1, crm_ref = COALESCE($3, crm_ref) WHERE id = $1',
    [row.id, ok, ref]);
  return { enviado: ok };
}

// Os que não foram ao CRM (fora do ar): tenta de novo, até 5 vezes em 48 h.
async function reenviarPendentes(pool) {
  if (!webhookUrl()) return 0;
  const r = await pool.query(`SELECT * FROM csu_pedidos_ajuda WHERE NOT crm_enviado AND crm_tentativas < 5 AND criado_em >= now() - interval '48 hours' ORDER BY criado_em LIMIT 20`);
  for (const row of r.rows) await enviarCRM(pool, row);
  return r.rows.length;
}

// ---------- admin ----------
async function listarAdmin(pool, { situacao } = {}) {
  const abertos = situacao !== 'todos';
  const r = await pool.query(
    `SELECT p.*, a.nome, a.rgm, a.email FROM csu_pedidos_ajuda p JOIN csu_alunos a ON a.id = p.aluno_id
     WHERE ($1::boolean = FALSE OR p.situacao IN ('aberto', 'em_atendimento'))
     ORDER BY (p.situacao = 'aberto') DESC, p.criado_em DESC LIMIT 200`, [abertos]);
  return r.rows.map((row) => ({
    id: row.id, protocolo: row.protocolo, aluno_id: row.aluno_id, nome: row.nome, rgm: row.rgm, email: row.email,
    origem: row.origem, motivo: ORIGENS[row.origem] || row.origem, onde: ondeTexto(row.contexto || {}), situacao: row.situacao,
    criado_em: row.criado_em, atendido_em: row.atendido_em, resolvido_em: row.resolvido_em,
    crm_enviado: row.crm_enviado, nota: notaEquipe(row), mensagem: mensagemAluno(row),
  }));
}

async function contarAbertos(pool) {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM csu_pedidos_ajuda WHERE situacao = 'aberto'`);
    return r.rows[0].n;
  } catch (err) {
    if (err.code === '42P01') return 0;
    throw err;
  }
}

async function mudarSituacao(pool, id, situacao, adminId) {
  if (!SITUACOES.includes(situacao)) { const err = new Error('situacao'); err.status = 400; throw err; }
  const r = await pool.query(
    `UPDATE csu_pedidos_ajuda SET situacao = $2, admin_id = $3,
       atendido_em = CASE WHEN $2 IN ('em_atendimento', 'resolvido') THEN COALESCE(atendido_em, now()) ELSE atendido_em END,
       resolvido_em = CASE WHEN $2 = 'resolvido' THEN now() ELSE NULL END
     WHERE id = $1 RETURNING *`, [id, situacao, adminId || null]);
  const row = r.rows[0];
  // Atendido conta como contato no acompanhamento (some da fila pelo prazo de espera).
  if (row && situacao !== 'cancelado') {
    await pool.query(`INSERT INTO csu_followups (aluno_id, motivo, canal, nota, admin_id) VALUES ($1, $2, 'whatsapp', $3, $4)`,
      [row.aluno_id, row.origem === 'travei' ? 'travou_trilha' : null, `Pedido ${row.protocolo}: ${situacao}`, adminId || null]).catch(() => {});
  }
  return row;
}

module.exports = {
  ORIGENS, liberadoPara, ensureSchema, criar, aberto, mensagemAluno, notaEquipe, enviarCRM, reenviarPendentes,
  listarAdmin, contarAbertos, mudarSituacao, lerEntrada, mascara,
};
