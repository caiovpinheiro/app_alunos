'use strict';

// Trilha "EaD Digital para Iniciantes": conteúdo em server/assets/trilha.json,
// progresso por aluno em csu_trilha_progresso / csu_trilha_tarefas.
// O gabarito (campo `certa`) e a explicação nunca vão para o navegador antes da resposta.

const fs = require('node:fs');
const path = require('node:path');
const versao = require('./versao');

const CONTEUDO = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'trilha.json'), 'utf8'));
const NIVEIS = CONTEUDO.niveis;
// Pontuação simples (aprovada em 20/10/2026): cada módulo concluído vale PONTOS_MODULO (10).
// Vídeo e acerto de primeira não mudam os pontos; errar nunca tira ponto. Os pontos saem de
// `concluido_em` na leitura, então o progresso salvo na escala antiga (vídeo 50, pergunta 100/40,
// meta 1.800) vale sem migração. A coluna `pontos` da tabela fica só como cache.
const PONTOS_MODULO = Number(CONTEUDO.pontos_modulo) || 10;
const TAREFAS = new Set(CONTEUDO.tarefas.map((t) => t.id));
const MAX_PONTOS = NIVEIS.length * PONTOS_MODULO;
// Aula Inaugural = programa único: cada nível (módulo) tem como vídeo o(s) capítulo(s) da aula
// ligados a ele (nivel_trilha em central/aula-inaugural.json). Os vídeos antigos da trilha
// (partes do passo a passo e vídeos por nível) ficam como "passo a passo" opcional, sem pontos.
// Certificado de 4 horas: os 7 módulos concluídos + META_CERTIFICADO pontos (regra no servidor).
// Com 10 por módulo, a meta (70) é o mesmo que concluir os 7; nunca passa do máximo.
const META_CERTIFICADO = Math.min(Number(CONTEUDO.meta_certificado) || MAX_PONTOS, MAX_PONTOS);
const HORAS_CERTIFICADO = Number(CONTEUDO.horas_certificado) || 4;
const AULA = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'central', 'aula-inaugural.json'), 'utf8'));
  } catch (err) {
    console.error('Trilha: aula-inaugural.json indisponível:', err.message);
    return null;
  }
})();
const ERRO_CAPITULO = 'Sem problema! Leia o resumo, veja os vídeos curtos de como fazer ou toque em Ajuda, no topo da página, para falar com a equipe do seu polo.';
const CAPITULOS = (AULA && Array.isArray(AULA.capitulos) ? AULA.capitulos : [])
  .map((c, i) => ({ i, t: c.titulo, v: c.v, duracao: c.duracao || '', nivel: c.nivel_trilha || null }))
  .filter((c) => c.v);
// Vídeos antigos fora do ar por informação errada (curadoria de 20/10): o nivel7 diz que o ENADE é
// obrigatório para todos e fala de TCC. O módulo 7 fica só com o capítulo da aula.
const APOSENTADOS = new Set(['/trilha-midia/videos/nivel7']);
NIVEIS.forEach((l, i) => {
  const caps = CAPITULOS.filter((c) => c.nivel === i + 1);
  if (!caps.length) return;
  // O que era o vídeo do nível vira passo a passo opcional.
  l.passo_a_passo = (l.parts ? l.parts.map((p) => ({ t: p.t, v: p.v })) : (l.video ? [{ t: 'Vídeo detalhado do módulo', v: l.video }] : []))
    .filter((p) => !APOSENTADOS.has(p.v));
  l.capitulos = caps.map((c) => ({ t: c.t, duracao: c.duracao }));
  if (caps.length === 1) { l.video = caps[0].v; l.parts = null; }
  else { l.video = null; l.parts = caps.map((c) => ({ t: c.t, v: c.v, erro: ERRO_CAPITULO })); }
});
// Abertura (antes do 1º nível) e encerramento (depois do último): vídeo sem pontos.
const PRIMEIRO_COM_NIVEL = CAPITULOS.findIndex((c) => c.nivel);
const ABERTURA_CAPS = CAPITULOS.filter((c, k) => !c.nivel && (PRIMEIRO_COM_NIVEL === -1 || k < PRIMEIRO_COM_NIVEL)).map((c) => ({ t: c.t, v: c.v, duracao: c.duracao }));
// Boas-vindas novo (40 s, tutora Roberta, 20/10/2026): substitui os capítulos 0 e 1 na abertura e na aula
// completa. O capítulo 1 ("Como funciona o EaD") continua na Central, em "Entenda como funciona".
const BOAS_VINDAS = { t: 'Boas-vindas', v: '/trilha-midia/aula/boasvindas', duracao: '0:40' };
const TEM_BOAS_VINDAS = fs.existsSync(path.join(__dirname, '..', 'public', 'trilha-midia', 'aula', 'boasvindas.mp4'));
const ABERTURA = TEM_BOAS_VINDAS ? [BOAS_VINDAS] : ABERTURA_CAPS;
const ENCERRAMENTO = CAPITULOS.filter((c, k) => !c.nivel && PRIMEIRO_COM_NIVEL !== -1 && k > PRIMEIRO_COM_NIVEL).map((c) => ({ t: c.t, v: c.v, duracao: c.duracao }));

// Pontos de quem concluiu `concluidos` módulos (a única regra de pontos).
function pontosDe(concluidos) {
  return (Number(concluidos) || 0) * PONTOS_MODULO;
}

// Certificado liberado? Usa o progresso de getProgresso() (ou qualquer objeto com `concluidos`).
function statusCertificado(progresso) {
  const concluidos = progresso.concluidos || 0;
  const pontos = pontosDe(concluidos);
  return {
    meta: META_CERTIFICADO,
    horas: HORAS_CERTIFICADO,
    pontos,
    concluidos,
    total: NIVEIS.length,
    faltam_pontos: Math.max(0, META_CERTIFICADO - pontos),
    faltam_modulos: Math.max(0, NIVEIS.length - concluidos),
    liberado: concluidos >= NIVEIS.length && pontos >= META_CERTIFICADO,
  };
}
const WHATSAPP_PADRAO = '(11) 91518-4535';

// A trilha é o guia principal; tutoriais e Meu Semestre apontam para o nível que ensina o assunto.
// Categoria de tutorial → nível (1-based). Sem categoria, usa o tipo do item do Meu Semestre.
const NIVEL_POR_CATEGORIA = {
  'Primeiros passos': 1,
  'Área do Aluno': 2,
  Documentos: 2,
  Blackboard: 3,
  Atividades: 3,
  Provas: 4,
  Financeiro: 5,
};
const NIVEL_POR_TIPO = { atividade: 3, disciplina: 4, avaliacao_integrada: 4 };

function guiaTrilha(categoria, tipo) {
  const nivel = NIVEL_POR_CATEGORIA[categoria] || NIVEL_POR_TIPO[tipo] || null;
  if (!nivel || !NIVEIS[nivel - 1]) return null;
  return { nivel, titulo: NIVEIS[nivel - 1].t };
}

// Liberação gradual: só as contas em TRILHA_LIBERADA_PARA (RGM ou e-mail, separados por
// vírgula ou espaço) veem a trilha e os links para ela. "*" libera para todos. Vazio = ninguém.
function listaLiberada() {
  return String(process.env.TRILHA_LIBERADA_PARA || '')
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

// Além desta lista, a conta precisa estar na versão nova das telas (VERSAO_NOVA_PARA, server/versao.js):
// as telas congeladas da produção anterior não conversam com a trilha deste servidor.
function liberadaParaTodos() {
  return listaLiberada().includes('*') && versao.paraTodos();
}

function liberadaPara(aluno) {
  if (!versao.novaPara(aluno)) return false;
  const lista = listaLiberada();
  if (lista.includes('*')) return true;
  if (!aluno) return false;
  // Acesso em preparação (sem RGM): a Aula Inaugural é justamente o que essa conta tem para fazer.
  if (aluno.rgm == null || String(aluno.rgm).trim() === '') return true;
  const rgm = String(aluno.rgm || '').replace(/\D+/g, '');
  const email = String(aluno.email || '').trim().toLowerCase();
  return (rgm && lista.includes(rgm)) || (email && lista.includes(email));
}

// Remove os links "aprenda na trilha" de uma resposta (Meu Semestre, tutoriais)
// para quem ainda não tem a trilha liberada: a tela fica como antes.
function semTrilha(value) {
  if (Array.isArray(value)) return value.map(semTrilha);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    Object.keys(value).forEach((k) => { if (k !== 'trilha') out[k] = semTrilha(value[k]); });
    return out;
  }
  return value;
}

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
    pontos: { modulo: PONTOS_MODULO, maximo: MAX_PONTOS, meta: META_CERTIFICADO },
    certificado: { meta: META_CERTIFICADO, horas: HORAS_CERTIFICADO },
    abertura: ABERTURA,
    encerramento: ENCERRAMENTO,
    aula_completa: (TEM_BOAS_VINDAS ? [BOAS_VINDAS] : []).concat(
      CAPITULOS.filter((c, k) => !(TEM_BOAS_VINDAS && !c.nivel && (PRIMEIRO_COM_NIVEL === -1 || k < PRIMEIRO_COM_NIVEL)))
        .map((c) => ({ t: c.t, v: c.v, duracao: c.duracao }))),
    whatsapp,
    niveis: NIVEIS.map((l, i) => ({
      nivel: i + 1,
      t: l.t,
      short: l.short,
      rank: l.rank,
      // topicos: 3 a 5 linhas curtas mostradas por padrão; learn é o resumo completo (fica fechado).
      topicos: (l.topicos || []).map((x) => fill(x, whatsapp)),
      learn: l.learn.map((x) => fill(x, whatsapp)),
      tip: fill(l.tip, whatsapp),
      formula: l.formula,
      tallShots: l.tallShots,
      shots: l.shots,
      video: l.video || null,
      parts: l.parts ? l.parts.map((p) => ({ t: p.t, v: p.v, erro: fill(p.erro, whatsapp) })) : null,
      capitulos: l.capitulos || null,
      passo_a_passo: l.passo_a_passo || [],
      // passo_aberto: os vídeos curtos do módulo já aparecem abertos na coluna do resumo.
      passo_aberto: !!l.passo_aberto,
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
    pontos: row.concluido_em ? PONTOS_MODULO : 0,
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
    if (!row.concluido_em && nivelConcluido(nivel, row)) row.concluido_em = new Date();
    row.pontos = row.concluido_em ? PONTOS_MODULO : 0;
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
    const jaConcluido = !!row.concluido_em || nivelConcluido(nivel, row);
    if (!rec.ok && !rec.tries.includes(j)) {
      rec.tries.push(j);
      if (j === q.certa) rec.ok = true;
    }
    row.respostas[k] = rec;
    const certo = !jaEstavaCerta && rec.ok;
    // Os pontos vêm ao concluir o módulo (última pergunta certa), não a cada acerto.
    const concluiuAgora = certo && !jaConcluido && nivelConcluido(nivel, row);
    return {
      resultado: {
        certo,
        ok: rec.ok,
        concluiu: concluiuAgora,
        ganhou: concluiuAgora ? PONTOS_MODULO : 0,
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

module.exports = {
  NIVEIS,
  MAX_PONTOS,
  ABERTURA,
  PONTOS_MODULO,
  pontosDe,
  guiaTrilha,
  liberadaPara,
  liberadaParaTodos,
  semTrilha,
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
  statusCertificado,
  META_CERTIFICADO,
  HORAS_CERTIFICADO,
  formatPhone,
};
