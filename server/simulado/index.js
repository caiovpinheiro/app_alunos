'use strict';

// Área de simulado e estudo adaptativo (oculta, em validação local). Desenho em docs/simulado.md.
//
// Liga só para SIMULADO_ATIVA_PARA (RGM ou e-mail; "*" = todos; vazio = desligado), no mesmo
// formato de AJUDA_ATIVA_PARA. Com SIMULADO_SO_LOCAL (padrão ligado) só responde em localhost.
// Fora disso, /simulado e /api/simulado/* respondem 404, como se não existissem.
//
// Privacidade: cada consulta filtra por aluno_id da sessão. O arquivo enviado não é guardado,
// só o texto extraído; documento bloqueado como prova não guarda nem o texto.

const crypto = require('node:crypto');
const express = require('express');
const { envValue } = require('../env');
const { extrair } = require('./extrair');
const { detectar } = require('./deteccao');
const adapt = require('./adaptativo');
const llmMod = require('./llm');
const T = require('./texto');

const LIMITE_ARQUIVO = 10 * 1024 * 1024;
const MAX_DOCUMENTOS = 30;
const MAX_UPLOADS_DIA = 30;

// ---------------------------------------------------------------- liberação
function lista() {
  return envValue('SIMULADO_ATIVA_PARA').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

function configurada() {
  return lista().length > 0;
}

function soLocal() {
  return !['0', 'false', 'nao', 'não', 'off'].includes(envValue('SIMULADO_SO_LOCAL', 'true').toLowerCase());
}

function hostLocal(req) {
  const h = String(req.hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
}

function liberadoPara(aluno, req) {
  const l = lista();
  if (!l.length) return false;
  if (req && soLocal() && !hostLocal(req)) return false;
  if (l.includes('*')) return true;
  if (!aluno) return false;
  const rgm = String(aluno.rgm || '').replace(/\D+/g, '');
  const email = String(aluno.email || '').trim().toLowerCase();
  return Boolean((rgm && l.map((x) => x.replace(/\D+/g, '')).includes(rgm)) || (email && l.includes(email)));
}

// ---------------------------------------------------------------- schema
async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS csu_sim_documentos (
      id SERIAL PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL,
      tamanho INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      texto TEXT,
      caracteres INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,              -- ok | pendente (aguarda confirmação) | bloqueado
      revisao BOOLEAN NOT NULL DEFAULT FALSE, -- marcado para a equipe revisar
      revisado_em TIMESTAMPTZ,
      deteccao JSONB NOT NULL DEFAULT '{}'::jsonb,
      resumo JSONB,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (aluno_id, sha256)
    );
    CREATE INDEX IF NOT EXISTS idx_csu_sim_doc_aluno ON csu_sim_documentos (aluno_id, criado_em DESC);

    CREATE TABLE IF NOT EXISTS csu_sim_topicos (
      id SERIAL PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      documento_id INTEGER NOT NULL REFERENCES csu_sim_documentos(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      habilidades JSONB NOT NULL DEFAULT '[]'::jsonb,
      trechos JSONB NOT NULL DEFAULT '[]'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_csu_sim_topicos_aluno ON csu_sim_topicos (aluno_id);

    CREATE TABLE IF NOT EXISTS csu_sim_desempenho (
      topico_id INTEGER PRIMARY KEY REFERENCES csu_sim_topicos(id) ON DELETE CASCADE,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      dominio REAL,
      tentativas INTEGER NOT NULL DEFAULT 0,
      acertos REAL NOT NULL DEFAULT 0,
      ef REAL NOT NULL DEFAULT 2.5,
      repeticoes INTEGER NOT NULL DEFAULT 0,
      intervalo_dias INTEGER NOT NULL DEFAULT 0,
      proxima_revisao TIMESTAMPTZ,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS csu_sim_simulados (
      id SERIAL PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL DEFAULT 'simulado', -- simulado | relampago
      questoes JSONB NOT NULL,
      respostas JSONB NOT NULL DEFAULT '{}'::jsonb,
      resultado JSONB,
      nota REAL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      corrigido_em TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_csu_sim_simulados_aluno ON csu_sim_simulados (aluno_id, criado_em DESC);

    CREATE TABLE IF NOT EXISTS csu_sim_flashcards (
      id SERIAL PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      topico_id INTEGER NOT NULL REFERENCES csu_sim_topicos(id) ON DELETE CASCADE,
      frente TEXT NOT NULL,
      verso TEXT NOT NULL,
      ef REAL NOT NULL DEFAULT 2.5,
      repeticoes INTEGER NOT NULL DEFAULT 0,
      intervalo_dias INTEGER NOT NULL DEFAULT 0,
      proxima_revisao TIMESTAMPTZ NOT NULL DEFAULT now(),
      revisoes INTEGER NOT NULL DEFAULT 0,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_csu_sim_flash_aluno ON csu_sim_flashcards (aluno_id, proxima_revisao);
  `);
}

// ---------------------------------------------------------------- utilidades
function erro(res, status, message, extra) {
  return res.status(status).json({ success: false, message, ...(extra || {}) });
}

function idDe(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nomeArquivo(req) {
  let n = String(req.get('x-nome-arquivo') || 'documento');
  try { n = decodeURIComponent(n); } catch (e) { /* mantém */ }
  return n.replace(/[\u0000-\u001f/\\]/g, '').trim().slice(0, 120) || 'documento';
}

// Questão como o aluno vê (sem gabarito).
function publica(q, i) {
  return {
    indice: i, tipo: q.tipo, topico: q.topico, topico_id: q.topico_id, enunciado: q.enunciado,
    alternativas: q.tipo === 'objetiva' ? q.alternativas : undefined,
  };
}

async function registrarEvento(pool, garantirEventos, alunoId, nome, dados) {
  try {
    await garantirEventos();
    await pool.query(
      `INSERT INTO csu_eventos (aluno_id, sessao, nome, tela, dados) VALUES ($1, 'servidor', $2, '/simulado', $3::jsonb)`,
      [alunoId, nome, JSON.stringify(dados)],
    );
  } catch (err) {
    console.error('Simulado: falha ao registrar evento:', err.message);
  }
}

// Mensagens ao aluno (tom gentil, sem acusar).
const MSG_BLOQUEIO = 'Parece que este arquivo é uma prova ou avaliação já aplicada. Para manter o estudo justo, '
  + 'a área de simulado não aceita provas. Envie a apostila, seus resumos ou as anotações da matéria, que a gente '
  + 'monta um simulado parecido para você treinar. Se achar que nos enganamos, fale com a equipe.';
const MSG_CONFIRMAR = 'Este arquivo tem cara de prova (por exemplo: campos de nome e nota ou questões com valor). '
  + 'Se for material de estudo, como uma lista de exercícios ou um simulado de treino, confirme abaixo. '
  + 'O arquivo fica marcado para a equipe dar uma olhada.';

// ---------------------------------------------------------------- domínio
async function processarDocumento(pool, alunoId, doc) {
  const llm = llmMod.obter();
  const topicos = await llm.extrairTopicos(doc.texto);
  for (const t of topicos.slice(0, 8)) {
    const nome = String(t.nome || '').slice(0, 80) || 'Tópico';
    const trechos = (t.trechos || []).slice(0, 15);
    // Mesmo tópico já visto em outro documento do aluno: junta os trechos (o histórico de desempenho continua um só).
    const existente = (await pool.query(
      `SELECT t.id, t.trechos FROM csu_sim_topicos t JOIN csu_sim_documentos d ON d.id = t.documento_id AND d.status = 'ok'
        WHERE t.aluno_id = $1 AND lower(t.nome) = lower($2) ORDER BY t.id LIMIT 1`, [alunoId, nome],
    )).rows[0];
    if (existente) {
      const juntos = [...new Set([...(existente.trechos || []), ...trechos])].slice(0, 30);
      await pool.query('UPDATE csu_sim_topicos SET trechos = $1::jsonb WHERE id = $2 AND aluno_id = $3', [JSON.stringify(juntos), existente.id, alunoId]);
      continue;
    }
    await pool.query(
      `INSERT INTO csu_sim_topicos (aluno_id, documento_id, nome, habilidades, trechos) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [alunoId, doc.id, nome, JSON.stringify((t.habilidades || []).slice(0, 6)), JSON.stringify(trechos)],
    );
  }
  return topicos.length;
}

async function topicosDoAluno(pool, alunoId) {
  const r = await pool.query(
    `SELECT t.id, t.nome, t.habilidades, t.trechos, t.documento_id, d.nome AS documento,
            p.dominio, p.tentativas, p.proxima_revisao,
            (SELECT count(*)::int FROM csu_sim_flashcards f WHERE f.topico_id = t.id) AS flashcards
       FROM csu_sim_topicos t
       JOIN csu_sim_documentos d ON d.id = t.documento_id AND d.status = 'ok'
       LEFT JOIN csu_sim_desempenho p ON p.topico_id = t.id
      WHERE t.aluno_id = $1
      ORDER BY t.id`,
    [alunoId],
  );
  return r.rows.map((x) => ({ ...x, dominio: x.dominio == null ? null : Number(x.dominio) }));
}

async function vocabularioDoAluno(pool, alunoId) {
  const r = await pool.query(`SELECT texto FROM csu_sim_documentos WHERE aluno_id = $1 AND status = 'ok' ORDER BY id DESC LIMIT 10`, [alunoId]);
  return T.termos(r.rows.map((x) => T.limpo(x.texto || '')).join('\n')).slice(0, 80).map((t) => t.termo);
}

async function montarQuestoes(pool, alunoId, { objetivas, discursivas, soVencidos }) {
  const llm = llmMod.obter();
  let topicos = await topicosDoAluno(pool, alunoId);
  if (!topicos.length) return { questoes: [], topicos: [] };
  if (soVencidos) {
    const agora = Date.now();
    const vencidos = topicos.filter((t) => t.dominio == null || !t.proxima_revisao || new Date(t.proxima_revisao).getTime() <= agora || t.dominio < 0.7);
    if (vencidos.length) topicos = vencidos;
  }
  const vocab = await vocabularioDoAluno(pool, alunoId);
  const dist = adapt.distribuir(topicos, objetivas);
  // Discursivas vão para os tópicos de maior peso.
  const porPeso = topicos.slice().sort((a, b) => adapt.peso(b) - adapt.peso(a) || a.id - b.id);
  const disc = new Map(porPeso.slice(0, discursivas).map((t) => [t.id, 1]));
  const semente = `${alunoId}:${Date.now()}`;
  const questoes = [];
  for (const t of porPeso) {
    const nObj = dist.get(t.id) || 0;
    const nDisc = disc.get(t.id) || 0;
    if (!nObj && !nDisc) continue;
    const trechos = Array.isArray(t.trechos) ? t.trechos : [];
    if (!trechos.length) continue;
    let qs = [];
    try {
      qs = await llm.gerarQuestoes({ topico: t.nome, trechos, vocabulario: vocab, objetivas: nObj, discursivas: nDisc, semente });
    } catch (err) {
      console.error('Simulado: falha ao gerar questões:', err.message);
    }
    qs.filter((q) => q && q.enunciado && (q.tipo === 'discursiva' || (Array.isArray(q.alternativas) && q.alternativas.length >= 2 && q.correta >= 0)))
      .slice(0, nObj + nDisc)
      .forEach((q) => questoes.push({ ...q, topico: t.nome, topico_id: t.id }));
  }
  // Algum tópico rendeu menos que a cota: completa com os outros, do mais fraco ao mais forte.
  let falta = objetivas - questoes.filter((q) => q.tipo === 'objetiva').length;
  for (const t of porPeso) {
    if (falta <= 0) break;
    const trechos = Array.isArray(t.trechos) ? t.trechos : [];
    if (!trechos.length) continue;
    let extra = [];
    try {
      extra = await llm.gerarQuestoes({ topico: t.nome, trechos, vocabulario: vocab, objetivas: falta + 2, discursivas: 0, semente: semente + ':extra' });
    } catch (err) {
      console.error('Simulado: falha ao completar questões:', err.message);
    }
    for (const q of extra) {
      if (falta <= 0) break;
      if (q.tipo !== 'objetiva' || questoes.some((x) => x.enunciado === q.enunciado && x.trecho === q.trecho)) continue;
      questoes.push({ ...q, topico: t.nome, topico_id: t.id });
      falta -= 1;
    }
  }
  // Objetivas primeiro, discursivas no fim.
  questoes.sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'objetiva' ? -1 : 1));
  return { questoes, topicos };
}

async function atualizarDesempenho(pool, alunoId, porTopico) {
  for (const [topicoId, score] of Object.entries(porTopico)) {
    const atual = (await pool.query('SELECT * FROM csu_sim_desempenho WHERE topico_id = $1 AND aluno_id = $2', [topicoId, alunoId])).rows[0];
    const e = adapt.atualizar(atual, score);
    await pool.query(
      `INSERT INTO csu_sim_desempenho (topico_id, aluno_id, dominio, tentativas, acertos, ef, repeticoes, intervalo_dias, proxima_revisao, atualizado_em)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, now()
        WHERE EXISTS (SELECT 1 FROM csu_sim_topicos WHERE id = $1 AND aluno_id = $2)
       ON CONFLICT (topico_id) DO UPDATE SET dominio = EXCLUDED.dominio, tentativas = EXCLUDED.tentativas,
         acertos = EXCLUDED.acertos, ef = EXCLUDED.ef, repeticoes = EXCLUDED.repeticoes,
         intervalo_dias = EXCLUDED.intervalo_dias, proxima_revisao = EXCLUDED.proxima_revisao, atualizado_em = now()`,
      [topicoId, alunoId, e.dominio, e.tentativas, e.acertos, e.ef, e.repeticoes, e.intervalo_dias, e.proxima_revisao],
    );
  }
}

async function corrigirQuestao(q, resposta) {
  if (q.tipo === 'objetiva') {
    const escolha = resposta == null || resposta === '' ? null : Number(resposta);
    const certa = escolha === q.correta;
    return {
      score: certa ? 1 : 0, certa, sua_resposta: escolha, correta: q.correta,
      feedback: certa ? 'Certo!' : `A resposta é “${q.alternativas[q.correta]}”.`,
      explicacao: q.explicacao || null, referencia: q.trecho || null,
    };
  }
  const texto = String(resposta || '').slice(0, 4000);
  if (!texto.trim()) {
    return { score: 0, certa: false, sua_resposta: '', feedback: 'Questão em branco.', referencia: q.esperado || q.trecho, faltou: q.palavras_chave || [] };
  }
  const r = await llmMod.obter().corrigirDiscursiva({ enunciado: q.enunciado, esperado: q.esperado, palavras_chave: q.palavras_chave, resposta: texto });
  return { score: r.nota, certa: r.nota >= 0.7, sua_resposta: texto, feedback: r.feedback, faltou: r.faltou || [], referencia: r.referencia || q.esperado };
}

function resumoPorTopico(questoes, correcoes) {
  const acc = {};
  questoes.forEach((q, i) => {
    const c = correcoes[i];
    if (!c) return;
    const k = q.topico_id;
    acc[k] = acc[k] || { topico_id: k, topico: q.topico, soma: 0, n: 0 };
    acc[k].soma += c.score;
    acc[k].n += 1;
  });
  return Object.values(acc).map((x) => ({ topico_id: x.topico_id, topico: x.topico, questoes: x.n, nota: Math.round((x.soma / x.n) * 100) / 10 }));
}

async function painel(pool, alunoId) {
  const topicos = await topicosDoAluno(pool, alunoId);
  const agora = new Date();
  const itens = topicos.map((t) => ({
    id: t.id, nome: t.nome, documento: t.documento, habilidades: t.habilidades,
    dominio: t.dominio, tentativas: t.tentativas || 0, proxima_revisao: t.proxima_revisao,
    vencido: !!(t.proxima_revisao && new Date(t.proxima_revisao) <= agora),
    peso: adapt.peso(t, agora), flashcards: t.flashcards,
    recomendacao: adapt.recomendacao(t, agora),
  }));
  const melhorar = itens.filter((t) => t.dominio == null || t.dominio < 0.7 || t.vencido)
    .sort((a, b) => b.peso - a.peso || a.id - b.id);
  // O que reler: trechos das últimas questões erradas (até 5).
  const ult = (await pool.query(
    `SELECT questoes, resultado FROM csu_sim_simulados WHERE aluno_id = $1 AND resultado IS NOT NULL ORDER BY corrigido_em DESC LIMIT 3`, [alunoId],
  )).rows;
  const reler = [];
  ult.forEach((s) => (s.resultado.correcoes || []).forEach((c, i) => {
    const q = s.questoes[i];
    if (q && c && !c.certa && c.referencia && reler.length < 5 && !reler.some((r) => r.trecho === c.referencia)) {
      reler.push({ topico: q.topico, trecho: String(c.referencia).slice(0, 400) });
    }
  }));
  return { topicos: itens, melhorar, reler };
}

// ---------------------------------------------------------------- rotas
function criarRotas({ pool, getSessionAluno, requireAdmin, garantirEventos }) {
  const aluno = express.Router();
  const admin = express.Router();
  let pronto = null;
  const schema = () => {
    if (!pronto) pronto = ensureSchema(pool).catch((err) => { pronto = null; throw err; });
    return pronto;
  };
  const naoEncontrado = (res) => res.status(404).json({ success: false, message: 'Recurso não encontrado.' });

  // Portão: flag + localhost + aluno liberado; senão 404. Sessão inválida (com a flag ligada) = 401.
  aluno.use(async (req, res, next) => {
    if (!configurada() || (soLocal() && !hostLocal(req)) || !pool) return naoEncontrado(res);
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    try {
      const a = token ? await getSessionAluno(pool, token) : null;
      // Com a flag ligada, sessão vencida ou apagada diz isso (401) em vez de um 404 confuso no meio do uso.
      if (!a) return erro(res, 401, 'Sua sessão expirou. Entre de novo para continuar.', { sessao_expirada: true });
      if (!liberadoPara(a, req)) return naoEncontrado(res);
      req.aluno = a;
      await schema();
      return next();
    } catch (err) {
      console.error('Simulado: falha no portão:', err.message);
      return erro(res, 500, 'Erro interno.');
    }
  });

  const rota = (fn) => async (req, res) => {
    try {
      return await fn(req, res);
    } catch (err) {
      if (err.status && err.status < 500) return erro(res, err.status, err.message);
      console.error('Simulado:', err.message);
      return erro(res, err.status || 500, err.status === 501 ? err.message : 'Não foi possível concluir agora. Tente de novo em instantes.');
    }
  };

  aluno.get('/estado', rota(async (req, res) => {
    const docs = (await pool.query(
      `SELECT id, nome, tipo, tamanho, caracteres, status, revisao, criado_em, (resumo IS NOT NULL) AS tem_resumo,
              deteccao->>'nivel' AS deteccao_nivel,
              (SELECT count(*)::int FROM csu_sim_topicos t WHERE t.documento_id = d.id) AS topicos
         FROM csu_sim_documentos d WHERE aluno_id = $1 AND status <> 'bloqueado' ORDER BY criado_em DESC`, [req.aluno.id],
    )).rows;
    const sims = (await pool.query(
      `SELECT id, tipo, nota, criado_em, corrigido_em, jsonb_array_length(questoes) AS questoes
         FROM csu_sim_simulados WHERE aluno_id = $1 ORDER BY criado_em DESC LIMIT 10`, [req.aluno.id],
    )).rows;
    const flash = (await pool.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE proxima_revisao <= now())::int AS hoje FROM csu_sim_flashcards WHERE aluno_id = $1`, [req.aluno.id],
    )).rows[0];
    const llm = llmMod.obter();
    return res.json({ success: true, documentos: docs, simulados: sims, flashcards: flash, provedor: { nome: llm.nome, real: llm.real, imagens: llm.visao } });
  }));

  // Upload: corpo bruto (application/octet-stream), nome no cabeçalho X-Nome-Arquivo.
  aluno.post('/documentos', express.raw({ type: () => true, limit: LIMITE_ARQUIVO }), rota(async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return erro(res, 400, 'Arquivo vazio.');
    const nome = nomeArquivo(req);
    const alunoId = req.aluno.id;
    const cont = (await pool.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE criado_em > now() - interval '1 day')::int AS hoje
         FROM csu_sim_documentos WHERE aluno_id = $1`, [alunoId],
    )).rows[0];
    if (cont.hoje >= MAX_UPLOADS_DIA) return erro(res, 429, 'Você atingiu o limite de envios de hoje. Tente amanhã.');
    if (cont.total >= MAX_DOCUMENTOS) return erro(res, 409, `Limite de ${MAX_DOCUMENTOS} documentos. Apague algum para enviar outro.`);

    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const repetido = (await pool.query('SELECT id, status FROM csu_sim_documentos WHERE aluno_id = $1 AND sha256 = $2', [alunoId, sha])).rows[0];
    if (repetido) {
      if (repetido.status === 'bloqueado') return erro(res, 422, MSG_BLOQUEIO, { bloqueado: true });
      return res.json({ success: true, status: repetido.status === 'pendente' ? 'confirmar' : 'ok', documento_id: repetido.id, repetido: true });
    }

    const ext = await extrair(buf, nome, llmMod.obter());
    if (ext.texto.replace(/\s+/g, ' ').length < 200) {
      return erro(res, 422, 'Não encontramos texto suficiente neste arquivo. Se for um PDF escaneado (foto das páginas), envie uma versão com texto selecionável.');
    }
    const det = await detectar(ext.texto, llmMod.obter());
    const status = det.nivel === 'alta' ? 'bloqueado' : det.nivel === 'media' ? 'pendente' : 'ok';
    const ins = await pool.query(
      `INSERT INTO csu_sim_documentos (aluno_id, nome, tipo, tamanho, sha256, texto, caracteres, status, revisao, deteccao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) RETURNING id`,
      [alunoId, nome, ext.tipo, buf.length, sha, status === 'bloqueado' ? null : ext.texto, ext.texto.length, status, status !== 'ok', JSON.stringify(det)],
    );
    const id = ins.rows[0].id;
    if (det.nivel !== 'baixa') {
      await registrarEvento(pool, garantirEventos, alunoId, 'simulado_deteccao_prova', {
        documento_id: id, arquivo: nome.slice(0, 80), nivel: det.nivel, confianca: det.confianca, fonte: det.fonte,
        decisao: status === 'bloqueado' ? 'bloqueado' : 'pediu_confirmacao',
        sinais: det.heuristica.sinais.map((s) => s.id).join(','),
      });
    }
    if (status === 'bloqueado') return erro(res, 422, MSG_BLOQUEIO, { bloqueado: true, deteccao: { nivel: det.nivel, sinais: det.heuristica.sinais.map((s) => s.rotulo) } });
    if (status === 'pendente') {
      return res.json({ success: true, status: 'confirmar', documento_id: id, message: MSG_CONFIRMAR, sinais: det.heuristica.sinais.map((s) => s.rotulo) });
    }
    const topicos = await processarDocumento(pool, alunoId, { id, texto: ext.texto });
    return res.json({ success: true, status: 'ok', documento_id: id, topicos, cortado: ext.cortado });
  }));

  // Confirmação do aluno (confiança média): material de estudo -> segue, marcado para revisão; senão apaga.
  aluno.post('/documentos/:id/confirmar', rota(async (req, res) => {
    const id = idDe(req.params.id);
    const doc = id && (await pool.query(`SELECT id, texto, nome FROM csu_sim_documentos WHERE id = $1 AND aluno_id = $2 AND status = 'pendente'`, [id, req.aluno.id])).rows[0];
    if (!doc) return erro(res, 404, 'Documento não encontrado.');
    const ehEstudo = req.body && req.body.material_estudo === true;
    await registrarEvento(pool, garantirEventos, req.aluno.id, 'simulado_deteccao_confirmacao', {
      documento_id: id, arquivo: doc.nome.slice(0, 80), resposta: ehEstudo ? 'material_estudo' : 'desistiu',
    });
    if (!ehEstudo) {
      await pool.query('DELETE FROM csu_sim_documentos WHERE id = $1 AND aluno_id = $2', [id, req.aluno.id]);
      return res.json({ success: true, status: 'removido' });
    }
    await pool.query(`UPDATE csu_sim_documentos SET status = 'ok', revisao = TRUE WHERE id = $1 AND aluno_id = $2`, [id, req.aluno.id]);
    const topicos = await processarDocumento(pool, req.aluno.id, doc);
    return res.json({ success: true, status: 'ok', documento_id: id, topicos });
  }));

  aluno.delete('/documentos/:id', rota(async (req, res) => {
    const id = idDe(req.params.id);
    const r = id ? await pool.query(`DELETE FROM csu_sim_documentos WHERE id = $1 AND aluno_id = $2 AND status <> 'bloqueado'`, [id, req.aluno.id]) : { rowCount: 0 };
    if (!r.rowCount) return erro(res, 404, 'Documento não encontrado.');
    return res.json({ success: true });
  }));

  aluno.post('/documentos/:id/resumo', rota(async (req, res) => {
    const id = idDe(req.params.id);
    const doc = id && (await pool.query(`SELECT id, nome, texto, resumo FROM csu_sim_documentos WHERE id = $1 AND aluno_id = $2 AND status = 'ok'`, [id, req.aluno.id])).rows[0];
    if (!doc) return erro(res, 404, 'Documento não encontrado.');
    let resumo = doc.resumo;
    if (!resumo || (req.body && req.body.refazer === true)) {
      resumo = await llmMod.obter().resumir(doc.texto, doc.nome);
      await pool.query('UPDATE csu_sim_documentos SET resumo = $1::jsonb WHERE id = $2 AND aluno_id = $3', [JSON.stringify(resumo), id, req.aluno.id]);
    }
    const topicos = (await pool.query('SELECT id, nome, habilidades FROM csu_sim_topicos WHERE documento_id = $1 AND aluno_id = $2 ORDER BY id', [id, req.aluno.id])).rows;
    return res.json({ success: true, documento: { id, nome: doc.nome }, resumo, topicos });
  }));

  // Novo simulado (ou quiz relâmpago: 5 objetivas dos tópicos vencidos/fracos, correção questão a questão).
  aluno.post('/simulados', rota(async (req, res) => {
    const relampago = req.body && req.body.tipo === 'relampago';
    // As provas do aluno são só de alternativas (a–e): o simulado segue o mesmo formato, sem discursivas.
    const objetivas = relampago ? 5 : Math.max(3, Math.min(20, Number(req.body && req.body.objetivas) || 10));
    const discursivas = relampago ? 0 : Math.max(0, Math.min(5, Number(req.body && req.body.discursivas) || 0));
    const { questoes } = await montarQuestoes(pool, req.aluno.id, { objetivas, discursivas, soVencidos: relampago });
    if (!questoes.length) return erro(res, 409, 'Envie pelo menos um documento de estudo antes de pedir um simulado.');
    const r = await pool.query(
      `INSERT INTO csu_sim_simulados (aluno_id, tipo, questoes) VALUES ($1, $2, $3::jsonb) RETURNING id, criado_em`,
      [req.aluno.id, relampago ? 'relampago' : 'simulado', JSON.stringify(questoes)],
    );
    return res.json({ success: true, simulado: { id: r.rows[0].id, tipo: relampago ? 'relampago' : 'simulado', questoes: questoes.map(publica) } });
  }));

  aluno.get('/simulados/:id', rota(async (req, res) => {
    const id = idDe(req.params.id);
    const s = id && (await pool.query('SELECT * FROM csu_sim_simulados WHERE id = $1 AND aluno_id = $2', [id, req.aluno.id])).rows[0];
    if (!s) return erro(res, 404, 'Simulado não encontrado.');
    return res.json({ success: true, simulado: { id: s.id, tipo: s.tipo, questoes: s.questoes.map(publica), resultado: s.resultado, nota: s.nota } });
  }));

  // Quiz relâmpago: confere uma questão e devolve o feedback na hora.
  aluno.post('/simulados/:id/conferir', rota(async (req, res) => {
    const id = idDe(req.params.id);
    const s = id && (await pool.query(`SELECT * FROM csu_sim_simulados WHERE id = $1 AND aluno_id = $2 AND corrigido_em IS NULL`, [id, req.aluno.id])).rows[0];
    if (!s) return erro(res, 404, 'Quiz não encontrado ou já encerrado.');
    const i = Number(req.body && req.body.indice);
    const q = s.questoes[i];
    if (!q || q.tipo !== 'objetiva') return erro(res, 400, 'Questão inválida.');
    if (s.respostas[String(i)] !== undefined) return erro(res, 409, 'Questão já respondida.');
    const c = await corrigirQuestao(q, req.body.resposta);
    await pool.query(`UPDATE csu_sim_simulados SET respostas = respostas || $1::jsonb WHERE id = $2 AND aluno_id = $3`,
      [JSON.stringify({ [String(i)]: req.body.resposta ?? null }), id, req.aluno.id]);
    return res.json({ success: true, correcao: c });
  }));

  // Correção final: simulado manda todas as respostas; relâmpago usa as já conferidas.
  aluno.post('/simulados/:id/corrigir', rota(async (req, res) => {
    const id = idDe(req.params.id);
    const s = id && (await pool.query('SELECT * FROM csu_sim_simulados WHERE id = $1 AND aluno_id = $2', [id, req.aluno.id])).rows[0];
    if (!s) return erro(res, 404, 'Simulado não encontrado.');
    if (s.corrigido_em) return res.json({ success: true, resultado: s.resultado, nota: s.nota });
    const respostas = s.tipo === 'relampago' ? s.respostas : ((req.body && req.body.respostas) || {});
    const correcoes = [];
    for (let i = 0; i < s.questoes.length; i += 1) {
      correcoes.push(await corrigirQuestao(s.questoes[i], respostas[String(i)]));
    }
    const porTopico = resumoPorTopico(s.questoes, correcoes);
    const nota = Math.round((correcoes.reduce((a, c) => a + c.score, 0) / correcoes.length) * 100) / 10;
    const resultado = { nota, correcoes, por_topico: porTopico };
    await pool.query(
      `UPDATE csu_sim_simulados SET respostas = $1::jsonb, resultado = $2::jsonb, nota = $3, corrigido_em = now() WHERE id = $4 AND aluno_id = $5`,
      [JSON.stringify(respostas), JSON.stringify(resultado), nota, id, req.aluno.id],
    );
    await atualizarDesempenho(pool, req.aluno.id, Object.fromEntries(porTopico.map((t) => [t.topico_id, t.nota / 10])));
    return res.json({ success: true, resultado, nota });
  }));

  aluno.get('/painel', rota(async (req, res) => res.json({ success: true, ...(await painel(pool, req.aluno.id)) })));

  // Flashcards: gera para os tópicos que ainda não têm; revisão com repetição espaçada.
  aluno.post('/flashcards/gerar', rota(async (req, res) => {
    const llm = llmMod.obter();
    const topicos = (await topicosDoAluno(pool, req.aluno.id)).filter((t) => !t.flashcards);
    const vocab = await vocabularioDoAluno(pool, req.aluno.id);
    let criados = 0;
    for (const t of topicos) {
      const cards = await llm.gerarFlashcards({ topico: t.nome, trechos: t.trechos || [], vocabulario: vocab });
      for (const c of cards.slice(0, 8)) {
        await pool.query('INSERT INTO csu_sim_flashcards (aluno_id, topico_id, frente, verso) VALUES ($1, $2, $3, $4)',
          [req.aluno.id, t.id, String(c.frente).slice(0, 500), String(c.verso).slice(0, 300)]);
        criados += 1;
      }
    }
    return res.json({ success: true, criados });
  }));

  aluno.get('/flashcards/hoje', rota(async (req, res) => {
    const r = await pool.query(
      `SELECT f.id, f.frente, f.verso, f.revisoes, t.nome AS topico, t.id AS topico_id
         FROM csu_sim_flashcards f JOIN csu_sim_topicos t ON t.id = f.topico_id
        WHERE f.aluno_id = $1 AND f.proxima_revisao <= now()
        ORDER BY f.proxima_revisao, f.id LIMIT 20`, [req.aluno.id],
    );
    const total = (await pool.query('SELECT count(*)::int AS n FROM csu_sim_flashcards WHERE aluno_id = $1', [req.aluno.id])).rows[0].n;
    return res.json({ success: true, cards: r.rows, total });
  }));

  // nota: 0 errei, 1 difícil, 2 bom, 3 fácil.
  aluno.post('/flashcards/:id/revisar', rota(async (req, res) => {
    const id = idDe(req.params.id);
    const nota = Math.max(0, Math.min(3, Math.round(Number(req.body && req.body.nota))));
    if (!id || !Number.isFinite(nota)) return erro(res, 400, 'Revisão inválida.');
    const c = (await pool.query('SELECT * FROM csu_sim_flashcards WHERE id = $1 AND aluno_id = $2', [id, req.aluno.id])).rows[0];
    if (!c) return erro(res, 404, 'Cartão não encontrado.');
    const e = adapt.atualizar({ ef: c.ef, repeticoes: c.repeticoes, intervalo_dias: c.intervalo_dias, dominio: 0 }, [0.2, 0.6, 0.8, 1][nota]);
    // Errei: volta ainda hoje (10 min), não amanhã.
    const proxima = nota === 0 ? new Date(Date.now() + 10 * 60000) : e.proxima_revisao;
    await pool.query(
      `UPDATE csu_sim_flashcards SET ef = $1, repeticoes = $2, intervalo_dias = $3, proxima_revisao = $4, revisoes = revisoes + 1 WHERE id = $5 AND aluno_id = $6`,
      [e.ef, e.repeticoes, e.intervalo_dias, proxima, id, req.aluno.id],
    );
    return res.json({ success: true, proxima_revisao: proxima, intervalo_dias: nota === 0 ? 0 : e.intervalo_dias });
  }));

  aluno.use((req, res) => naoEncontrado(res));

  // ---------- admin: detecções de prova (mesma flag; sem ela, 404) ----------
  admin.use((req, res, next) => (configurada() && pool ? next() : naoEncontrado(res)));
  admin.get('/deteccoes', requireAdmin, rota(async (req, res) => {
    await schema();
    const r = await pool.query(
      `SELECT d.id, d.aluno_id, a.nome AS aluno, a.rgm, d.nome AS arquivo, d.tipo, d.status, d.revisao, d.revisado_em, d.criado_em,
              d.deteccao->>'nivel' AS nivel, (d.deteccao->>'confianca')::real AS confianca, d.deteccao->>'fonte' AS fonte,
              d.deteccao->'heuristica'->'sinais' AS sinais, d.deteccao->'llm' AS llm
         FROM csu_sim_documentos d JOIN csu_alunos a ON a.id = d.aluno_id
        WHERE d.status IN ('bloqueado', 'pendente') OR d.revisao
        ORDER BY (d.revisado_em IS NULL) DESC, d.criado_em DESC LIMIT 200`,
    );
    return res.json({ success: true, deteccoes: r.rows });
  }));
  admin.post('/deteccoes/:id/revisado', requireAdmin, rota(async (req, res) => {
    await schema();
    const id = idDe(req.params.id);
    const r = id ? await pool.query('UPDATE csu_sim_documentos SET revisado_em = now() WHERE id = $1', [id]) : { rowCount: 0 };
    if (!r.rowCount) return erro(res, 404, 'Detecção não encontrada.');
    return res.json({ success: true });
  }));

  return { aluno, admin };
}

module.exports = { criarRotas, liberadoPara, configurada, soLocal, hostLocal, ensureSchema, processarDocumento };
