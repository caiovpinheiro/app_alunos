'use strict';

// Trilha "EaD Digital para Iniciantes": conteúdo em server/assets/trilha.json,
// progresso por aluno em csu_trilha_progresso / csu_trilha_tarefas.
// O gabarito (campo `certa`) e a explicação nunca vão para o navegador antes da resposta.

const fs = require('node:fs');
const path = require('node:path');

const CONTEUDO = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'trilha.json'), 'utf8'));
const NIVEIS = CONTEUDO.niveis;
const PONTOS_VIDEO = CONTEUDO.pontos_video;
const PONTOS_1A = CONTEUDO.pontos_certa_1a;
const PONTOS_DEPOIS = CONTEUDO.pontos_certa_depois;
const TAREFAS = new Set(CONTEUDO.tarefas.map((t) => t.id));
const MAX_PONTOS = NIVEIS.reduce((n, l) => n + l.qs.length * PONTOS_1A + PONTOS_VIDEO, 0);
const WHATSAPP_PADRAO = '(11) 91518-4535';

function formatPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return null;
}

function fill(text, whatsapp) {
  return typeof text === 'string' ? text.split('{whatsapp}').join(whatsapp) : text;
}

// Conteúdo público: tudo menos `certa` e `exp`.
function publicContent(whatsappRaw) {
  const whatsapp = formatPhone(whatsappRaw) || WHATSAPP_PADRAO;
  return {
    versao: CONTEUDO.versao,
    pontos: { video: PONTOS_VIDEO, certa_1a: PONTOS_1A, certa_depois: PONTOS_DEPOIS, maximo: MAX_PONTOS },
    whatsapp,
    niveis: NIVEIS.map((l, i) => ({
      nivel: i + 1,
      t: l.t,
      short: l.short,
      rank: l.rank,
      learn: l.learn.map((x) => fill(x, whatsapp)),
      tip: fill(l.tip, whatsapp),
      formula: l.formula,
      tallShots: l.tallShots,
      shots: l.shots,
      video: l.video || null,
      parts: l.parts ? l.parts.map((p) => ({ t: p.t, v: p.v, erro: fill(p.erro, whatsapp) })) : null,
      qs: l.qs.map((q) => ({ q: q.q, opts: q.opts })),
    })),
    tarefas: CONTEUDO.tarefas,
    glossario: CONTEUDO.glossario,
    ajuda: CONTEUDO.ajuda.map((x) => fill(x, whatsapp)),
  };
}

function nivelValido(n) {
  const i = Number(n);
  return Number.isInteger(i) && i >= 1 && i <= NIVEIS.length ? i : null;
}

function partesDoNivel(nivel) {
  const l = NIVEIS[nivel - 1];
  return l.parts ? l.parts.length : 1;
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS csu_trilha_progresso (
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      nivel INTEGER NOT NULL,
      partes_vistas JSONB NOT NULL DEFAULT '[]'::jsonb,
      video_ok BOOLEAN NOT NULL DEFAULT FALSE,
      pulou_video BOOLEAN NOT NULL DEFAULT FALSE,
      respostas JSONB NOT NULL DEFAULT '{}'::jsonb,
      travei JSONB NOT NULL DEFAULT '{}'::jsonb,
      pontos INTEGER NOT NULL DEFAULT 0,
      concluido_em TIMESTAMPTZ,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (aluno_id, nivel)
    );

    CREATE TABLE IF NOT EXISTS csu_trilha_tarefas (
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      tarefa TEXT NOT NULL,
      feita_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (aluno_id, tarefa)
    );
  `);
}

function emptyRow(nivel) {
  return { nivel, partes_vistas: [], video_ok: false, pulou_video: false, respostas: {}, travei: {}, pontos: 0, concluido_em: null };
}

function calcPontos(nivel, row) {
  let pontos = row.video_ok ? PONTOS_VIDEO : 0;
  NIVEIS[nivel - 1].qs.forEach((_, k) => {
    const r = row.respostas[k];
    if (r && r.ok) pontos += r.tries.length <= 1 ? PONTOS_1A : PONTOS_DEPOIS;
  });
  return pontos;
}

function nivelConcluido(nivel, row) {
  return NIVEIS[nivel - 1].qs.every((_, k) => row.respostas[k] && row.respostas[k].ok);
}

// Progresso enviado ao aluno: tentativas e acertos, sem revelar a resposta certa
// de pergunta ainda não acertada.
function publicRow(nivel, row) {
  const respostas = {};
  Object.keys(row.respostas || {}).forEach((k) => {
    const r = row.respostas[k];
    const q = NIVEIS[nivel - 1].qs[Number(k)];
    respostas[k] = { tries: r.tries, ok: !!r.ok };
    if (r.ok && q) { respostas[k].certa = q.certa; respostas[k].exp = q.exp; }
  });
  return {
    nivel,
    partes_vistas: row.partes_vistas || [],
    video_ok: !!row.video_ok,
    pulou_video: !!row.pulou_video,
    respostas,
    pontos: row.pontos || 0,
    concluido: !!row.concluido_em,
  };
}

async function loadRows(client, alunoId) {
  const r = await client.query(
    `SELECT nivel, partes_vistas, video_ok, pulou_video, respostas, travei, pontos, concluido_em
     FROM csu_trilha_progresso WHERE aluno_id = $1`,
    [alunoId],
  );
  const map = {};
  r.rows.forEach((row) => { map[row.nivel] = row; });
  return map;
}

async function getProgresso(pool, alunoId) {
  const rows = await loadRows(pool, alunoId);
  const tarefas = await pool.query('SELECT tarefa FROM csu_trilha_tarefas WHERE aluno_id = $1', [alunoId]);
  const niveis = NIVEIS.map((_, i) => publicRow(i + 1, rows[i + 1] || emptyRow(i + 1)));
  return {
    niveis,
    pontos: niveis.reduce((n, l) => n + l.pontos, 0),
    concluidos: niveis.filter((l) => l.concluido).length,
    tarefas: tarefas.rows.map((r) => r.tarefa).filter((t) => TAREFAS.has(t)),
  };
}

// Lê, altera e grava a linha do nível numa transação (evita corrida entre cliques).
async function mutate(pool, alunoId, nivel, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO csu_trilha_progresso (aluno_id, nivel) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [alunoId, nivel],
    );
    const r = await client.query(
      `SELECT nivel, partes_vistas, video_ok, pulou_video, respostas, travei, pontos, concluido_em
       FROM csu_trilha_progresso WHERE aluno_id = $1 AND nivel = $2 FOR UPDATE`,
      [alunoId, nivel],
    );
    const row = r.rows[0];
    const extra = fn(row) || {};
    row.pontos = calcPontos(nivel, row);
    if (!row.concluido_em && nivelConcluido(nivel, row)) row.concluido_em = new Date();
    await client.query(
      `UPDATE csu_trilha_progresso SET
         partes_vistas = $3, video_ok = $4, pulou_video = $5, respostas = $6, travei = $7,
         pontos = $8, concluido_em = $9, atualizado_em = now()
       WHERE aluno_id = $1 AND nivel = $2`,
      [alunoId, nivel, JSON.stringify(row.partes_vistas), row.video_ok, row.pulou_video,
        JSON.stringify(row.respostas), JSON.stringify(row.travei), row.pontos, row.concluido_em],
    );
    await client.query('COMMIT');
    return { nivel: publicRow(nivel, row), ...extra };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Parte (ou vídeo único) assistida até 90%.
async function marcarVideo(pool, alunoId, nivel, parte) {
  const total = partesDoNivel(nivel);
  const p = Number(parte || 0);
  if (!Number.isInteger(p) || p < 0 || p >= total) return null;
  return mutate(pool, alunoId, nivel, (row) => {
    const vistas = new Set(row.partes_vistas || []);
    vistas.add(p);
    row.partes_vistas = [...vistas].sort((a, b) => a - b);
    if (row.partes_vistas.length >= total) row.video_ok = true;
  });
}

async function pularVideo(pool, alunoId, nivel) {
  return mutate(pool, alunoId, nivel, (row) => { row.pulou_video = true; });
}

async function marcarTravei(pool, alunoId, nivel, parte) {
  const total = partesDoNivel(nivel);
  const p = Number(parte || 0);
  if (!Number.isInteger(p) || p < 0 || p >= total) return null;
  return mutate(pool, alunoId, nivel, (row) => {
    row.travei = row.travei || {};
    row.travei[p] = (Number(row.travei[p]) || 0) + 1;
  });
}

async function responder(pool, alunoId, nivel, pergunta, opcao) {
  const q = NIVEIS[nivel - 1].qs[Number(pergunta)];
  const k = Number(pergunta);
  const j = Number(opcao);
  if (!q || !Number.isInteger(k) || !Number.isInteger(j) || j < 0 || j >= q.opts.length) return null;
  return mutate(pool, alunoId, nivel, (row) => {
    row.respostas = row.respostas || {};
    const rec = row.respostas[k] || { tries: [], ok: false };
    const jaEstavaCerta = rec.ok;
    if (!rec.ok && !rec.tries.includes(j)) {
      rec.tries.push(j);
      if (j === q.certa) rec.ok = true;
    }
    row.respostas[k] = rec;
    const certo = !jaEstavaCerta && rec.ok;
    return {
      resultado: {
        certo,
        ok: rec.ok,
        ganhou: certo ? (rec.tries.length <= 1 ? PONTOS_1A : PONTOS_DEPOIS) : 0,
        certa: rec.ok ? q.certa : undefined,
        exp: rec.ok ? q.exp : undefined,
      },
    };
  });
}

async function marcarTarefa(pool, alunoId, tarefa, feita) {
  if (!TAREFAS.has(tarefa)) return false;
  if (feita) {
    await pool.query(
      `INSERT INTO csu_trilha_tarefas (aluno_id, tarefa) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [alunoId, tarefa],
    );
  } else {
    await pool.query('DELETE FROM csu_trilha_tarefas WHERE aluno_id = $1 AND tarefa = $2', [alunoId, tarefa]);
  }
  return true;
}

async function reiniciar(pool, alunoId) {
  await pool.query('DELETE FROM csu_trilha_progresso WHERE aluno_id = $1', [alunoId]);
}

// ---------- Admin ----------

async function resumoAdmin(pool) {
  const alunos = await pool.query(`
    SELECT COUNT(DISTINCT aluno_id)::int AS iniciaram,
           COUNT(DISTINCT aluno_id) FILTER (WHERE nivel = ${NIVEIS.length} AND concluido_em IS NOT NULL)::int AS concluiram
    FROM csu_trilha_progresso`);
  const porNivel = await pool.query(`
    SELECT nivel,
           COUNT(*)::int AS abriram,
           COUNT(*) FILTER (WHERE video_ok)::int AS viram_video,
           COUNT(*) FILTER (WHERE concluido_em IS NOT NULL)::int AS concluiram
    FROM csu_trilha_progresso GROUP BY nivel ORDER BY nivel`);
  const rows = await pool.query('SELECT nivel, respostas, travei FROM csu_trilha_progresso');
  const erros = {};
  const travei = {};
  rows.rows.forEach((r) => {
    Object.keys(r.respostas || {}).forEach((k) => {
      const e = (r.respostas[k].tries || []).length - (r.respostas[k].ok ? 1 : 0);
      if (e > 0) { const key = `${r.nivel}-${k}`; erros[key] = (erros[key] || 0) + e; }
    });
    Object.keys(r.travei || {}).forEach((p) => {
      const key = `${r.nivel}-${p}`; travei[key] = (travei[key] || 0) + Number(r.travei[p] || 0);
    });
  });
  const nivelInfo = porNivel.rows.reduce((m, r) => { m[r.nivel] = r; return m; }, {});
  return {
    iniciaram: alunos.rows[0].iniciaram,
    concluiram: alunos.rows[0].concluiram,
    niveis: NIVEIS.map((l, i) => ({
      nivel: i + 1,
      titulo: l.t,
      abriram: nivelInfo[i + 1] ? nivelInfo[i + 1].abriram : 0,
      viram_video: nivelInfo[i + 1] ? nivelInfo[i + 1].viram_video : 0,
      concluiram: nivelInfo[i + 1] ? nivelInfo[i + 1].concluiram : 0,
    })),
    perguntas_dificeis: Object.keys(erros)
      .map((key) => { const [n, k] = key.split('-').map(Number); return { nivel: n, pergunta: NIVEIS[n - 1].qs[k].q, erros: erros[key] }; })
      .sort((a, b) => b.erros - a.erros).slice(0, 10),
    travei: Object.keys(travei)
      .map((key) => {
        const [n, p] = key.split('-').map(Number);
        const l = NIVEIS[n - 1];
        return { nivel: n, parte: l.parts ? l.parts[p].t : 'Vídeo', vezes: travei[key] };
      })
      .sort((a, b) => b.vezes - a.vezes),
  };
}

// Uma linha por aluno que começou a trilha (para o CRM chamar quem parou).
async function exportAlunos(pool) {
  const r = await pool.query(`
    SELECT a.nome, a.rgm, a.email,
           COUNT(*) FILTER (WHERE p.concluido_em IS NOT NULL)::int AS niveis_concluidos,
           COALESCE(SUM(p.pontos), 0)::int AS pontos,
           MAX(p.atualizado_em) AS ultimo_acesso
    FROM csu_trilha_progresso p
    JOIN csu_alunos a ON a.id = p.aluno_id
    GROUP BY a.id
    ORDER BY ultimo_acesso DESC`);
  return r.rows;
}

module.exports = {
  NIVEIS,
  MAX_PONTOS,
  publicContent,
  nivelValido,
  ensureSchema,
  getProgresso,
  marcarVideo,
  pularVideo,
  marcarTravei,
  responder,
  marcarTarefa,
  reiniciar,
  resumoAdmin,
  exportAlunos,
  formatPhone,
};
