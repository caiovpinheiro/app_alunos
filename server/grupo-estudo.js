'use strict';

// Grupo de estudo do curso, moderado por IA (desenho em docs/grupo-estudo.md).
//
// Um grupo por curso (csu_alunos.curso normalizado) e conversas privadas 1:1 entre colegas do mesmo grupo.
// Cada mensagem (texto, foto ou áudio) passa pela moderação (server/grupo-moderacao.js) ANTES de aparecer:
// publicada, bloqueada (o autor vê a explicação) ou retida (vai para a fila do admin). Os colegas só veem
// "Maria S."; a API nunca devolve RGM, e-mail ou id de outro aluno (colega = referência aleatória `ref`).
// Fotos e áudios ficam em disco por GRUPO_MIDIA_DIAS (padrão 7) e depois são apagados; a foto é
// regravada sem metadados (EXIF/GPS). Denúncias e decisões da equipe vão para csu_eventos (sem o texto).
//
// Liga só para GRUPO_ESTUDO_ATIVA_PARA (RGM ou e-mail; "*" = todos; vazio = ninguém). Desligado,
// /api/grupos/* e /api/admin/grupos/* respondem 404 e a tela não aparece. Sem integração com o CRM.
//
// Tudo entra no app por montar(app, deps), chamado uma vez em server/index.js.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { envValue } = require('./env');
const moderacao = require('./grupo-moderacao');

const MAX_TEXTO = 500;
const MAX_POR_MINUTO = 6;
const DENUNCIAS_PARA_OCULTAR = 3;
const MAX_AUDIO_SEG = 120;
const MAX_UPLOAD = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MOTIVOS_DENUNCIA = {
  fraude: 'Prova, gabarito ou trabalho pronto',
  ofensa: 'Palavrão, ofensa ou assédio',
  odio: 'Preconceito ou ódio',
  dados: 'Dados pessoais ou contato',
  spam: 'Propaganda ou link',
  outro: 'Outro motivo',
};
const REGRAS = [
  'Aqui é para estudar junto: dúvidas, dicas, materiais e apoio.',
  'Prova, gabarito, cola e trabalho pronto não entram. Isso pode anular a sua prova.',
  'Nada de telefone, e-mail, @, CPF, endereço ou senha, nem em foto ou áudio.',
  'Palavrões, xingamentos e ofensas não são publicados.',
  'Toda mensagem passa por um moderador antes de aparecer; fotos e áudios passam pela equipe.',
];
const MIME = {
  imagem: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  audio: { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3' },
};

function midiaDias() {
  const n = Number(envValue('GRUPO_MIDIA_DIAS', '7'));
  return Number.isFinite(n) && n >= 1 && n <= 30 ? Math.floor(n) : 7;
}
function midiaDir() {
  return envValue('GRUPO_MIDIA_DIR') || path.join(__dirname, '..', 'data', 'grupo-midia');
}
function aviso() {
  const d = midiaDias();
  return `Fotos e áudios ficam disponíveis por ${d} dias e depois são apagados. Não envie foto de documento, prova ou gabarito. ` +
    'A equipe do polo pode ler mensagens denunciadas ou retidas pelo moderador.';
}

// ---------- Flag ----------
function lista() {
  return envValue('GRUPO_ESTUDO_ATIVA_PARA').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

function ligado() {
  return lista().length > 0;
}

function liberadoPara(aluno) {
  const l = lista();
  if (!l.length) return false;
  if (l.includes('*')) return true;
  if (!aluno) return false;
  const rgm = String(aluno.rgm || '').replace(/\D+/g, '');
  const email = String(aluno.email || '').trim().toLowerCase();
  return Boolean((rgm && l.map((x) => x.replace(/\D+/g, '')).includes(rgm)) || (email && l.includes(email)));
}

// ---------- Schema ----------
async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS csu_grupos (
      id SERIAL PRIMARY KEY,
      chave TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS csu_grupo_membros (
      grupo_id INTEGER NOT NULL REFERENCES csu_grupos(id) ON DELETE CASCADE,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      silenciado_ate TIMESTAMPTZ,
      entrou_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      visto_em TIMESTAMPTZ,
      PRIMARY KEY (grupo_id, aluno_id)
    );
    ALTER TABLE csu_grupo_membros ADD COLUMN IF NOT EXISTS ref TEXT;
    ALTER TABLE csu_grupo_membros ADD COLUMN IF NOT EXISTS lido_ate BIGINT NOT NULL DEFAULT 0;
    UPDATE csu_grupo_membros SET ref = md5(random()::text || clock_timestamp()::text || aluno_id::text) WHERE ref IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_csu_grupo_membros_ref ON csu_grupo_membros (ref);

    CREATE TABLE IF NOT EXISTS csu_dm_conversas (
      id BIGSERIAL PRIMARY KEY,
      grupo_id INTEGER NOT NULL REFERENCES csu_grupos(id) ON DELETE CASCADE,
      aluno_a INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      aluno_b INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      lido_a BIGINT NOT NULL DEFAULT 0,
      lido_b BIGINT NOT NULL DEFAULT 0,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      ultima_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (aluno_a < aluno_b),
      UNIQUE (aluno_a, aluno_b)
    );
    CREATE TABLE IF NOT EXISTS csu_dm_bloqueios (
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      bloqueado_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (aluno_id, bloqueado_id)
    );

    CREATE TABLE IF NOT EXISTS csu_grupo_mensagens (
      id BIGSERIAL PRIMARY KEY,
      grupo_id INTEGER NOT NULL REFERENCES csu_grupos(id) ON DELETE CASCADE,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      texto TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('publicada', 'bloqueada', 'retida', 'removida')),
      categoria TEXT NOT NULL DEFAULT 'ok',
      confianca TEXT,
      motivo TEXT,
      moderador TEXT NOT NULL,
      sinais TEXT[] NOT NULL DEFAULT '{}',
      revisar BOOLEAN NOT NULL DEFAULT FALSE,
      denuncias INTEGER NOT NULL DEFAULT 0,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      publicada_em TIMESTAMPTZ,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      revisado_em TIMESTAMPTZ,
      revisado_por INTEGER
    );
    ALTER TABLE csu_grupo_mensagens ADD COLUMN IF NOT EXISTS conversa_id BIGINT REFERENCES csu_dm_conversas(id) ON DELETE CASCADE;
    ALTER TABLE csu_grupo_mensagens ADD COLUMN IF NOT EXISTS midia_tipo TEXT;
    ALTER TABLE csu_grupo_mensagens ADD COLUMN IF NOT EXISTS midia_arquivo TEXT;
    ALTER TABLE csu_grupo_mensagens ADD COLUMN IF NOT EXISTS midia_mime TEXT;
    ALTER TABLE csu_grupo_mensagens ADD COLUMN IF NOT EXISTS midia_bytes INTEGER;
    ALTER TABLE csu_grupo_mensagens ADD COLUMN IF NOT EXISTS midia_duracao INTEGER;
    ALTER TABLE csu_grupo_mensagens ADD COLUMN IF NOT EXISTS midia_largura INTEGER;
    ALTER TABLE csu_grupo_mensagens ADD COLUMN IF NOT EXISTS midia_altura INTEGER;
    ALTER TABLE csu_grupo_mensagens ADD COLUMN IF NOT EXISTS midia_expira_em TIMESTAMPTZ;
    ALTER TABLE csu_grupo_mensagens ADD COLUMN IF NOT EXISTS midia_apagada BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_csu_grupo_msg_grupo ON csu_grupo_mensagens (grupo_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_csu_grupo_msg_atualizado ON csu_grupo_mensagens (grupo_id, atualizado_em);
    CREATE INDEX IF NOT EXISTS idx_csu_grupo_msg_autor ON csu_grupo_mensagens (aluno_id, criado_em DESC);
    CREATE INDEX IF NOT EXISTS idx_csu_grupo_msg_fila ON csu_grupo_mensagens (status, revisar, criado_em);
    CREATE INDEX IF NOT EXISTS idx_csu_grupo_msg_conversa ON csu_grupo_mensagens (conversa_id, id DESC) WHERE conversa_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_csu_grupo_msg_midia ON csu_grupo_mensagens (midia_expira_em) WHERE midia_arquivo IS NOT NULL;

    CREATE TABLE IF NOT EXISTS csu_grupo_denuncias (
      id SERIAL PRIMARY KEY,
      mensagem_id BIGINT NOT NULL REFERENCES csu_grupo_mensagens(id) ON DELETE CASCADE,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      motivo TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolvida_em TIMESTAMPTZ,
      UNIQUE (mensagem_id, aluno_id)
    );
  `);
  const dias = Math.max(30, Number(envValue('RASTREIO_RETENCAO_DIAS', '180')) || 180);
  await pool.query(`DELETE FROM csu_grupo_mensagens WHERE criado_em < now() - ($1::int * interval '1 day')`, [dias]);
}

// ---------- Mídia em disco (apaga depois de GRUPO_MIDIA_DIAS) ----------
async function apagarArquivo(nome) {
  if (!nome || !/^[a-f0-9-]+\.[a-z0-9]+$/.test(nome)) return;
  try { await fs.unlink(path.join(midiaDir(), nome)); } catch (err) { if (err.code !== 'ENOENT') console.error('Grupo de estudo: falha ao apagar mídia:', err.message); }
}

async function limparMidia(pool) {
  const r = await pool.query(
    `SELECT id, midia_arquivo FROM csu_grupo_mensagens
     WHERE midia_arquivo IS NOT NULL AND (midia_expira_em < now() OR status = 'removida') LIMIT 500`,
  );
  for (const row of r.rows) {
    await apagarArquivo(row.midia_arquivo);
    await pool.query('UPDATE csu_grupo_mensagens SET midia_arquivo = NULL, midia_apagada = TRUE WHERE id = $1', [row.id]);
  }
  return r.rowCount;
}

function confereAssinatura(tipo, buf) {
  const h = buf.subarray(0, 12);
  if (tipo === 'imagem') {
    return (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) // JPEG
      || h.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) // PNG
      || (h.subarray(0, 4).toString() === 'RIFF' && h.subarray(8, 12).toString() === 'WEBP');
  }
  return h.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) // WebM
    || h.subarray(0, 4).toString() === 'OggS'
    || h.subarray(4, 8).toString() === 'ftyp' // MP4/M4A
    || h.subarray(0, 3).toString() === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0); // MP3/AAC
}

// ---------- Utilidades ----------
function chaveCurso(curso) {
  return String(curso || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
// "MARIA DA SILVA SANTOS" → "Maria S.". Nunca mostra o nome completo para os colegas.
function nomeExibido(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter((p) => p && !PARTICULAS.has(p.toLowerCase()));
  if (!partes.length) return 'Colega';
  const cap = (p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  return partes.length > 1 ? `${cap(partes[0])} ${partes[partes.length - 1].charAt(0).toUpperCase()}.` : cap(partes[0]);
}

async function evento(pool, alunoId, nome, dados) {
  try {
    await pool.query(
      `INSERT INTO csu_eventos (aluno_id, sessao, nome, tela, dados) VALUES ($1, NULL, $2, 'grupo', $3::jsonb)`,
      [alunoId, nome, JSON.stringify(dados || {})],
    );
  } catch (err) {
    console.error('Grupo de estudo: falha ao registrar evento:', err.message);
  }
}

// Grupo do aluno (cria o grupo e a filiação na primeira vez). null se o aluno ainda não tem curso.
async function grupoDoAluno(pool, alunoId) {
  const r = await pool.query('SELECT nome, curso FROM csu_alunos WHERE id = $1', [alunoId]);
  const aluno = r.rows[0];
  const chave = chaveCurso(aluno && aluno.curso);
  if (!chave) return null;
  const g = await pool.query(
    `INSERT INTO csu_grupos (chave, nome) VALUES ($1, $2)
     ON CONFLICT (chave) DO UPDATE SET chave = EXCLUDED.chave
     RETURNING id, nome`,
    [chave, String(aluno.curso).replace(/\s+/g, ' ').trim()],
  );
  const grupo = g.rows[0];
  const m = await pool.query(
    `INSERT INTO csu_grupo_membros (grupo_id, aluno_id, ref) VALUES ($1, $2, $3)
     ON CONFLICT (grupo_id, aluno_id) DO UPDATE SET visto_em = now(), ref = COALESCE(csu_grupo_membros.ref, EXCLUDED.ref)
     RETURNING silenciado_ate, lido_ate`,
    [grupo.id, alunoId, crypto.randomBytes(16).toString('hex')],
  );
  return { id: grupo.id, nome: grupo.nome, silenciado_ate: m.rows[0].silenciado_ate, lido_ate: Number(m.rows[0].lido_ate), eu: nomeExibido(aluno.nome) };
}

function silenciadoAte(g) {
  return g.silenciado_ate && new Date(g.silenciado_ate) > new Date() ? g.silenciado_ate : null;
}

// Mensagem como o aluno vê: dos outros, só publicada; as próprias, com status e explicação.
function paraAluno(row, alunoId) {
  const minha = row.aluno_id === alunoId;
  if (row.status !== 'publicada' && !minha) return { id: Number(row.id), oculta: true };
  const out = {
    id: Number(row.id),
    autor: nomeExibido(row.nome),
    minha,
    texto: row.texto,
    criado_em: row.criado_em,
    status: row.status,
  };
  if (row.midia_tipo) {
    const apagada = row.midia_apagada || !row.midia_arquivo;
    out.midia = {
      tipo: row.midia_tipo,
      apagada,
      url: apagada ? null : `/api/grupos/midia/${row.id}`,
      duracao: row.midia_duracao || null,
      largura: row.midia_largura || null,
      altura: row.midia_altura || null,
      expira_em: row.midia_expira_em,
    };
  }
  if (minha && row.status !== 'publicada') {
    out.explicacao = row.status === 'removida'
      ? 'A equipe removeu esta mensagem por não seguir as regras do grupo.'
      : row.categoria === 'revisao_midia' ? moderacao.EXPLICACAO.midia
        : row.status === 'retida' ? moderacao.EXPLICACAO.retida : (moderacao.EXPLICACAO[row.categoria] || moderacao.EXPLICACAO.retida);
  }
  if (row.denunciada_por_mim) out.denunciada = true;
  return out;
}

const SELECT_MSG = `SELECT m.id, m.aluno_id, m.texto, m.status, m.categoria, m.criado_em, a.nome,
    m.midia_tipo, m.midia_arquivo, m.midia_duracao, m.midia_largura, m.midia_altura, m.midia_expira_em, m.midia_apagada,
    EXISTS (SELECT 1 FROM csu_grupo_denuncias d WHERE d.mensagem_id = m.id AND d.aluno_id = $2) AS denunciada_por_mim
  FROM csu_grupo_mensagens m JOIN csu_alunos a ON a.id = m.aluno_id`;

// canal = { grupoId, conversaId|null }. Primeira carga: últimas 80 visíveis; depois (?desde=cursor): o que mudou.
async function listar(pool, canal, alunoId, desde) {
  const agora = (await pool.query('SELECT now() AS t')).rows[0].t;
  const filtro = canal.conversaId ? 'm.conversa_id = $1' : 'm.grupo_id = $1 AND m.conversa_id IS NULL';
  const chave = canal.conversaId || canal.grupoId;
  let rows;
  if (desde) {
    const d = new Date(desde);
    if (Number.isNaN(d.getTime())) return null;
    rows = (await pool.query(
      `${SELECT_MSG} WHERE ${filtro} AND m.atualizado_em >= $3::timestamptz - interval '2 seconds' ORDER BY m.id LIMIT 200`,
      [chave, alunoId, d.toISOString()],
    )).rows;
  } else {
    rows = (await pool.query(
      `${SELECT_MSG} WHERE ${filtro} AND (m.status = 'publicada' OR (m.aluno_id = $2 AND m.criado_em > now() - interval '7 days'))
       ORDER BY m.id DESC LIMIT 80`,
      [chave, alunoId],
    )).rows.reverse();
  }
  const mensagens = rows.map((x) => paraAluno(x, alunoId));
  // Marca como lido até a última publicada de outra pessoa que o aluno recebeu agora.
  const maxLido = rows.filter((x) => x.status === 'publicada' && x.aluno_id !== alunoId).reduce((mx, x) => Math.max(mx, Number(x.id)), 0);
  if (maxLido) {
    if (canal.conversaId) {
      await pool.query(
        `UPDATE csu_dm_conversas SET lido_a = CASE WHEN aluno_a = $2 THEN GREATEST(lido_a, $3) ELSE lido_a END,
                                     lido_b = CASE WHEN aluno_b = $2 THEN GREATEST(lido_b, $3) ELSE lido_b END WHERE id = $1`,
        [canal.conversaId, alunoId, maxLido],
      );
    } else {
      await pool.query('UPDATE csu_grupo_membros SET lido_ate = GREATEST(lido_ate, $3) WHERE grupo_id = $1 AND aluno_id = $2', [canal.grupoId, alunoId, maxLido]);
    }
  }
  return { mensagens: desde ? mensagens : mensagens.filter((x) => !x.oculta), cursor: agora };
}

function previa(row, alunoId) {
  if (!row) return null;
  return {
    texto: row.texto ? row.texto.slice(0, 90) : '',
    midia: row.midia_tipo || null,
    minha: row.aluno_id === alunoId,
    autor: nomeExibido(row.nome),
    status: row.status,
    em: row.criado_em,
  };
}

// Lista à esquerda: o grupo do curso e os colegas (com a conversa privada, se houver).
async function conversas(pool, g, alunoId) {
  const [ultGrupo, naoLidasGrupo, colegas, minhas, bloqueios] = await Promise.all([
    pool.query(
      `SELECT m.id, m.texto, m.midia_tipo, m.status, m.criado_em, m.aluno_id, a.nome FROM csu_grupo_mensagens m JOIN csu_alunos a ON a.id = m.aluno_id
       WHERE m.grupo_id = $1 AND m.conversa_id IS NULL AND (m.status = 'publicada' OR m.aluno_id = $2) ORDER BY m.id DESC LIMIT 1`,
      [g.id, alunoId],
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM csu_grupo_mensagens WHERE grupo_id = $1 AND conversa_id IS NULL AND status = 'publicada' AND aluno_id <> $2 AND id > $3`,
      [g.id, alunoId, g.lido_ate],
    ),
    pool.query(
      `SELECT mem.ref, mem.aluno_id, a.nome FROM csu_grupo_membros mem JOIN csu_alunos a ON a.id = mem.aluno_id
       WHERE mem.grupo_id = $1 AND mem.aluno_id <> $2 AND a.ativo`,
      [g.id, alunoId],
    ),
    pool.query(
      `SELECT c.id, CASE WHEN c.aluno_a = $2 THEN c.aluno_b ELSE c.aluno_a END AS outro, c.ultima_em,
          (SELECT count(*)::int FROM csu_grupo_mensagens m WHERE m.conversa_id = c.id AND m.status = 'publicada' AND m.aluno_id <> $2
             AND m.id > CASE WHEN c.aluno_a = $2 THEN c.lido_a ELSE c.lido_b END) AS nao_lidas
       FROM csu_dm_conversas c WHERE c.grupo_id = $1 AND (c.aluno_a = $2 OR c.aluno_b = $2)`,
      [g.id, alunoId],
    ),
    pool.query('SELECT bloqueado_id FROM csu_dm_bloqueios WHERE aluno_id = $1', [alunoId]),
  ]);
  const ids = minhas.rows.map((c) => c.id);
  const ultimas = ids.length ? (await pool.query(
    `SELECT DISTINCT ON (m.conversa_id) m.conversa_id, m.id, m.texto, m.midia_tipo, m.status, m.criado_em, m.aluno_id, a.nome
     FROM csu_grupo_mensagens m JOIN csu_alunos a ON a.id = m.aluno_id
     WHERE m.conversa_id = ANY($1) AND (m.status = 'publicada' OR m.aluno_id = $2) ORDER BY m.conversa_id, m.id DESC`,
    [ids, alunoId],
  )).rows : [];
  const porOutro = new Map(minhas.rows.map((c) => [c.outro, c]));
  const ultimaPor = new Map(ultimas.map((u) => [String(u.conversa_id), u]));
  const bloqueados = new Set(bloqueios.rows.map((b) => b.bloqueado_id));
  const lista = colegas.rows.map((c) => {
    const conv = porOutro.get(c.aluno_id);
    const ult = conv ? ultimaPor.get(String(conv.id)) : null;
    return {
      ref: c.ref,
      nome: nomeExibido(c.nome),
      bloqueado: bloqueados.has(c.aluno_id),
      ultima: previa(ult, alunoId),
      nao_lidas: conv ? conv.nao_lidas : 0,
    };
  });
  lista.sort((a, b) => {
    if (a.ultima && b.ultima) return new Date(b.ultima.em) - new Date(a.ultima.em);
    if (a.ultima || b.ultima) return a.ultima ? -1 : 1;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
  return {
    grupo: { nome: g.nome, membros: colegas.rows.length + 1, ultima: previa(ultGrupo.rows[0], alunoId), nao_lidas: naoLidasGrupo.rows[0].n },
    colegas: lista,
  };
}

// ---------- Rotas ----------
function montar(app, deps) {
  const { pool, authMiddleware, requireAdmin, ensureAcompanhamento, enviarIndex } = deps;
  let schemaPronto = null;
  function ensure() {
    if (!schemaPronto) {
      schemaPronto = ensureAcompanhamento().then(() => ensureSchema(pool)).then(() => limparMidia(pool)).catch((err) => {
        schemaPronto = null;
        throw err;
      });
    }
    return schemaPronto;
  }
  // Apaga fotos e áudios vencidos a cada hora (só com a área ligada e o banco disponível).
  if (pool) {
    setInterval(() => {
      if (!ligado()) return;
      ensure().then(() => limparMidia(pool)).then((n) => { if (n) console.log(`Grupo de estudo: ${n} mídia(s) apagada(s) (prazo de ${midiaDias()} dias).`); })
        .catch((err) => console.error('Grupo de estudo: limpeza de mídia falhou:', err.message));
    }, 60 * 60 * 1000).unref();
  }
  const naoEncontrado = (res) => res.status(404).json({ success: false, message: 'Recurso não encontrado.' });

  // Endereço da tela (a SPA decide o que mostrar; a API é que libera ou não).
  app.get('/grupo', enviarIndex);

  // Aluno: flag desligada ou conta fora da lista → 404 (como se a área não existisse).
  app.use('/api/grupos', (req, res, next) => (ligado() ? next() : naoEncontrado(res)), authMiddleware, (req, res, next) => {
    if (!pool) return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
    return liberadoPara(req.aluno) ? next() : naoEncontrado(res);
  });

  // Resolve o canal: 'meu' = grupo do curso; senão, a ref de um colega do mesmo grupo (conversa privada).
  async function canalDe(req, criar) {
    const g = await grupoDoAluno(pool, req.aluno.id);
    if (!g) return { erro: 409, message: 'Seu curso ainda não chegou ao portal, então ainda não há grupo para você.' };
    if (!req.params.ref) return { g, canal: { grupoId: g.id, conversaId: null } };
    const col = (await pool.query(
      'SELECT aluno_id FROM csu_grupo_membros WHERE grupo_id = $1 AND ref = $2 AND aluno_id <> $3',
      [g.id, String(req.params.ref), req.aluno.id],
    )).rows[0];
    if (!col) return { erro: 404, message: 'Colega não encontrado.' };
    const a = Math.min(req.aluno.id, col.aluno_id);
    const b = Math.max(req.aluno.id, col.aluno_id);
    let conv = (await pool.query('SELECT id FROM csu_dm_conversas WHERE aluno_a = $1 AND aluno_b = $2', [a, b])).rows[0];
    if (!conv && criar) {
      conv = (await pool.query(
        `INSERT INTO csu_dm_conversas (grupo_id, aluno_a, aluno_b) VALUES ($1, $2, $3)
         ON CONFLICT (aluno_a, aluno_b) DO UPDATE SET grupo_id = EXCLUDED.grupo_id RETURNING id`,
        [g.id, a, b],
      )).rows[0];
    }
    const bl = (await pool.query(
      `SELECT bool_or(aluno_id = $1) AS eu_bloqueei, bool_or(aluno_id = $2) AS me_bloqueou
       FROM csu_dm_bloqueios WHERE (aluno_id = $1 AND bloqueado_id = $2) OR (aluno_id = $2 AND bloqueado_id = $1)`,
      [req.aluno.id, col.aluno_id],
    )).rows[0];
    return {
      g,
      outroId: col.aluno_id,
      eu_bloqueei: Boolean(bl.eu_bloqueei),
      me_bloqueou: Boolean(bl.me_bloqueou),
      canal: { grupoId: g.id, conversaId: conv ? conv.id : null },
    };
  }

  app.get('/api/grupos/meu', async (req, res) => {
    try {
      await ensure();
      const g = await grupoDoAluno(pool, req.aluno.id);
      if (!g) return res.json({ success: true, grupo: null, motivo: 'sem_curso', regras: REGRAS, aviso: aviso() });
      const n = await pool.query('SELECT count(*)::int AS n FROM csu_grupo_membros WHERE grupo_id = $1', [g.id]);
      return res.json({
        success: true,
        grupo: { nome: g.nome, membros: n.rows[0].n },
        eu: { nome: g.eu, silenciado_ate: silenciadoAte(g) },
        regras: REGRAS,
        aviso: aviso(),
        midia_dias: midiaDias(),
        motivos_denuncia: MOTIVOS_DENUNCIA,
        max_texto: MAX_TEXTO,
        max_audio_seg: MAX_AUDIO_SEG,
      });
    } catch (err) {
      console.error('Grupo de estudo: falha ao abrir o grupo:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível abrir o grupo agora.' });
    }
  });

  app.get('/api/grupos/meu/conversas', async (req, res) => {
    try {
      await ensure();
      const g = await grupoDoAluno(pool, req.aluno.id);
      if (!g) return res.json({ success: true, grupo: null, colegas: [] });
      return res.json({ success: true, ...(await conversas(pool, g, req.aluno.id)) });
    } catch (err) {
      console.error('Grupo de estudo: falha ao listar conversas:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível carregar as conversas.' });
    }
  });

  async function rotaListar(req, res) {
    try {
      await ensure();
      const c = await canalDe(req, false);
      if (c.erro) return res.status(c.erro === 409 ? 200 : c.erro).json(c.erro === 409 ? { success: true, mensagens: [], cursor: null } : { success: false, message: c.message });
      const extra = req.params.ref ? { colega: { bloqueado: c.eu_bloqueei } } : {};
      if (!c.canal.conversaId && req.params.ref) {
        const agora = (await pool.query('SELECT now() AS t')).rows[0].t;
        return res.json({ success: true, mensagens: [], cursor: agora, ...extra });
      }
      const r = await listar(pool, c.canal, req.aluno.id, req.query.desde);
      if (!r) return res.status(400).json({ success: false, message: 'Cursor inválido.' });
      return res.json({ success: true, ...r, ...extra });
    } catch (err) {
      console.error('Grupo de estudo: falha ao listar mensagens:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível carregar as mensagens.' });
    }
  }
  app.get('/api/grupos/meu/mensagens', rotaListar);
  app.get('/api/grupos/conversas/:ref/mensagens', rotaListar);

  // Checagens comuns de envio. Devolve { c } ou responde o erro.
  async function preparaEnvio(req, res, textoParaRepeticao) {
    await ensure();
    const c = await canalDe(req, true);
    if (c.erro) { res.status(c.erro).json({ success: false, message: c.message }); return null; }
    const ate = silenciadoAte(c.g);
    if (ate) {
      const quando = new Date(ate).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      res.status(403).json({ success: false, message: `A equipe pausou seus envios até ${quando}. Você continua podendo ler.` });
      return null;
    }
    if (c.eu_bloqueei) { res.status(403).json({ success: false, message: 'Você bloqueou este colega. Desbloqueie para mandar mensagem.' }); return null; }
    if (c.me_bloqueou) { res.status(403).json({ success: false, message: 'Não é possível enviar mensagem para este colega.' }); return null; }
    const lim = await pool.query(
      `SELECT count(*) FILTER (WHERE criado_em > now() - interval '1 minute')::int AS minuto,
              count(*) FILTER (WHERE $2 <> '' AND texto = $2 AND midia_tipo IS NULL AND criado_em > now() - interval '10 minutes')::int AS repetida
       FROM csu_grupo_mensagens WHERE aluno_id = $1 AND criado_em > now() - interval '10 minutes'`,
      [req.aluno.id, textoParaRepeticao],
    );
    if (lim.rows[0].minuto >= MAX_POR_MINUTO) { res.status(429).json({ success: false, message: 'Calma! Espere um minutinho antes de mandar mais mensagens.' }); return null; }
    if (lim.rows[0].repetida > 0) { res.status(409).json({ success: false, message: 'Você já enviou essa mensagem há pouco.' }); return null; }
    return c;
  }

  async function gravar(req, c, texto, d, midia) {
    const ins = await pool.query(
      `INSERT INTO csu_grupo_mensagens (grupo_id, conversa_id, aluno_id, texto, status, categoria, confianca, motivo, moderador, sinais, revisar, publicada_em,
          midia_tipo, midia_arquivo, midia_mime, midia_bytes, midia_duracao, midia_largura, midia_altura, midia_expira_em, midia_apagada)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $5 = 'publicada' THEN now() END,
          $12, $13, $14, $15, $16, $17, $18, CASE WHEN $12::text IS NOT NULL THEN now() + ($19::int * interval '1 day') END, $20)
       RETURNING id`,
      [c.canal.grupoId, c.canal.conversaId, req.aluno.id, texto, d.status, d.categoria || 'ok', d.confianca, d.motivo, d.moderador, d.sinais || [], d.revisar,
        midia ? midia.tipo : null, midia ? midia.arquivo : null, midia ? midia.mime : null, midia ? midia.bytes : null,
        midia ? midia.duracao : null, midia ? midia.largura : null, midia ? midia.altura : null, midiaDias(), Boolean(midia && !midia.arquivo)],
    );
    if (c.canal.conversaId) await pool.query('UPDATE csu_dm_conversas SET ultima_em = now() WHERE id = $1', [c.canal.conversaId]);
    const id = ins.rows[0].id;
    if (d.status !== 'publicada' || d.moderador === 'fallback') {
      await evento(pool, req.aluno.id, 'grupo_mensagem_moderada', {
        mensagem_id: Number(id), status: d.status, categoria: d.categoria, origem: d.moderador, revisar: d.revisar,
        privada: Boolean(c.canal.conversaId), midia: midia ? midia.tipo : null,
      });
    }
    const row = (await pool.query(`${SELECT_MSG} WHERE m.id = $1`, [id, req.aluno.id])).rows[0];
    return paraAluno(row, req.aluno.id);
  }

  async function rotaEnviar(req, res) {
    const texto = String((req.body && req.body.texto) || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!texto) return res.status(400).json({ success: false, message: 'Escreva a mensagem.' });
    if (texto.length > MAX_TEXTO) return res.status(400).json({ success: false, message: `A mensagem pode ter até ${MAX_TEXTO} caracteres.` });
    try {
      const c = await preparaEnvio(req, res, texto);
      if (!c) return undefined;
      const d = await moderacao.moderar(texto, { log: (m) => console.warn('Grupo de estudo:', m) });
      return res.json({ success: true, mensagem: await gravar(req, c, texto, d, null) });
    } catch (err) {
      console.error('Grupo de estudo: falha ao enviar mensagem:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível enviar agora. Tente de novo.' });
    }
  }
  app.post('/api/grupos/meu/mensagens', rotaEnviar);
  app.post('/api/grupos/conversas/:ref/mensagens', rotaEnviar);

  // Foto ou áudio: corpo binário (Content-Type do arquivo), ?tipo=imagem|audio&legenda=&duracao=
  const corpoBinario = express.raw({ type: () => true, limit: MAX_UPLOAD });
  async function rotaMidia(req, res) {
    const tipo = String(req.query.tipo || '');
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const legenda = String(req.query.legenda || '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEXTO);
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!MIME[tipo] || !MIME[tipo][mime] || !buf || !buf.length || !confereAssinatura(tipo, buf)) {
      return res.status(400).json({ success: false, message: tipo === 'audio' ? 'Não foi possível ler esse áudio.' : 'Envie uma foto em JPG, PNG ou WebP.' });
    }
    let duracao = null;
    if (tipo === 'audio') {
      duracao = Math.round(Number(req.query.duracao));
      if (!Number.isFinite(duracao) || duracao < 1) duracao = null;
      if ((duracao && duracao > MAX_AUDIO_SEG + 2) || buf.length > MAX_AUDIO_BYTES) {
        return res.status(400).json({ success: false, message: `O áudio pode ter até ${MAX_AUDIO_SEG / 60} minutos.` });
      }
    }
    try {
      const c = await preparaEnvio(req, res, '');
      if (!c) return undefined;
      let arquivo = buf;
      let arquivoMime = mime;
      let largura = null;
      let altura = null;
      if (tipo === 'imagem') {
        // Regrava a foto: gira pelo EXIF, limita a 1600 px e sai sem metadados (GPS, câmera, data).
        // eslint-disable-next-line global-require
        const sharp = require('sharp');
        const out = await sharp(buf, { failOn: 'error', limitInputPixels: 40e6 }).rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
        arquivo = out.data;
        arquivoMime = 'image/webp';
        largura = out.info.width;
        altura = out.info.height;
      }
      const d = await moderacao.moderarMidia(tipo, legenda, tipo === 'imagem' ? { buffer: arquivo, mime: arquivoMime } : null, { log: (m) => console.warn('Grupo de estudo:', m) });
      // Bloqueada: o arquivo nem é guardado (o autor vê "não publicada").
      let nome = null;
      if (d.status !== 'bloqueada') {
        nome = `${crypto.randomUUID()}.${tipo === 'imagem' ? 'webp' : MIME.audio[mime]}`;
        await fs.mkdir(midiaDir(), { recursive: true });
        await fs.writeFile(path.join(midiaDir(), nome), arquivo, { mode: 0o600 });
      }
      const msg = await gravar(req, c, legenda, d, { tipo, arquivo: nome, mime: arquivoMime, bytes: arquivo.length, duracao, largura, altura });
      return res.json({ success: true, mensagem: msg });
    } catch (err) {
      console.error('Grupo de estudo: falha ao enviar mídia:', err.message);
      return res.status(err.message && /Input buffer|unsupported image/i.test(err.message) ? 400 : 500)
        .json({ success: false, message: 'Não foi possível enviar agora. Tente de novo.' });
    }
  }
  app.post('/api/grupos/meu/midia', corpoBinario, rotaMidia);
  app.post('/api/grupos/conversas/:ref/midia', corpoBinario, rotaMidia);

  async function enviarArquivo(res, row) {
    if (!row || !row.midia_arquivo || row.midia_apagada || (row.midia_expira_em && new Date(row.midia_expira_em) < new Date())) {
      return res.status(410).json({ success: false, message: `Este arquivo foi apagado (fica disponível por ${midiaDias()} dias).` });
    }
    try {
      const dados = await fs.readFile(path.join(midiaDir(), row.midia_arquivo));
      res.set({ 'Content-Type': row.midia_mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
      return res.send(dados);
    } catch (err) {
      return res.status(410).json({ success: false, message: 'Este arquivo não está mais disponível.' });
    }
  }

  // O aluno só baixa mídia de um canal onde está e que pode ver (publicada, ou a própria).
  app.get('/api/grupos/midia/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return naoEncontrado(res);
    try {
      await ensure();
      const g = await grupoDoAluno(pool, req.aluno.id);
      const row = g && (await pool.query(
        `SELECT m.*, c.aluno_a, c.aluno_b FROM csu_grupo_mensagens m LEFT JOIN csu_dm_conversas c ON c.id = m.conversa_id WHERE m.id = $1`, [id],
      )).rows[0];
      if (!row) return naoEncontrado(res);
      const noCanal = row.conversa_id ? (row.aluno_a === req.aluno.id || row.aluno_b === req.aluno.id) : row.grupo_id === g.id;
      if (!noCanal || (row.status !== 'publicada' && row.aluno_id !== req.aluno.id)) return naoEncontrado(res);
      return enviarArquivo(res, row);
    } catch (err) {
      console.error('Grupo de estudo: falha ao abrir mídia:', err.message);
      return res.status(500).json({ success: false });
    }
  });

  app.post('/api/grupos/conversas/:ref/bloqueio', async (req, res) => {
    try {
      await ensure();
      const c = await canalDe(req, false);
      if (c.erro) return res.status(c.erro).json({ success: false, message: c.message });
      if (req.body && req.body.bloquear) {
        await pool.query('INSERT INTO csu_dm_bloqueios (aluno_id, bloqueado_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.aluno.id, c.outroId]);
      } else {
        await pool.query('DELETE FROM csu_dm_bloqueios WHERE aluno_id = $1 AND bloqueado_id = $2', [req.aluno.id, c.outroId]);
      }
      await evento(pool, c.outroId, 'grupo_moderacao', { acao: req.body && req.body.bloquear ? 'bloqueio_aluno' : 'desbloqueio_aluno', origem: 'aluno' });
      return res.json({ success: true, bloqueado: Boolean(req.body && req.body.bloquear) });
    } catch (err) {
      console.error('Grupo de estudo: falha ao bloquear:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível salvar agora.' });
    }
  });

  app.post('/api/grupos/mensagens/:id/denuncia', async (req, res) => {
    const id = Number(req.params.id);
    const motivo = String((req.body && req.body.motivo) || '');
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'Mensagem inválida.' });
    if (!MOTIVOS_DENUNCIA[motivo]) return res.status(400).json({ success: false, message: 'Escolha o motivo.' });
    try {
      await ensure();
      const g = await grupoDoAluno(pool, req.aluno.id);
      const m = g && (await pool.query(
        `SELECT m.id, m.aluno_id, m.status, m.grupo_id, m.conversa_id, c.aluno_a, c.aluno_b
         FROM csu_grupo_mensagens m LEFT JOIN csu_dm_conversas c ON c.id = m.conversa_id WHERE m.id = $1`, [id],
      )).rows[0];
      const noCanal = m && (m.conversa_id ? (m.aluno_a === req.aluno.id || m.aluno_b === req.aluno.id) : m.grupo_id === g.id);
      if (!m || !noCanal || m.status !== 'publicada') return res.status(404).json({ success: false, message: 'Mensagem não encontrada.' });
      if (m.aluno_id === req.aluno.id) return res.status(400).json({ success: false, message: 'Não dá para denunciar a própria mensagem.' });
      const ins = await pool.query(
        `INSERT INTO csu_grupo_denuncias (mensagem_id, aluno_id, motivo) VALUES ($1, $2, $3)
         ON CONFLICT (mensagem_id, aluno_id) DO NOTHING RETURNING id`,
        [id, req.aluno.id, motivo],
      );
      let ocultada = false;
      if (ins.rowCount) {
        const up = await pool.query(
          `UPDATE csu_grupo_mensagens SET denuncias = denuncias + 1,
             status = CASE WHEN denuncias + 1 >= $2 THEN 'retida' ELSE status END,
             revisar = CASE WHEN denuncias + 1 >= $2 THEN TRUE ELSE revisar END,
             atualizado_em = CASE WHEN denuncias + 1 >= $2 THEN now() ELSE atualizado_em END
           WHERE id = $1 RETURNING status`,
          [id, m.conversa_id ? 1 : DENUNCIAS_PARA_OCULTAR],
        );
        ocultada = up.rows[0].status === 'retida';
        await evento(pool, m.aluno_id, 'grupo_moderacao', { acao: 'denuncia', mensagem_id: id, motivo, origem: 'denuncia', ocultada, privada: Boolean(m.conversa_id) });
      }
      return res.json({ success: true, message: 'Obrigado! A equipe vai olhar essa mensagem.' });
    } catch (err) {
      console.error('Grupo de estudo: falha ao denunciar:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível registrar a denúncia agora.' });
    }
  });

  // ---------- Admin: fila de moderação ----------
  app.use('/api/admin/grupos', (req, res, next) => (ligado() ? next() : naoEncontrado(res)), requireAdmin, (req, res, next) => {
    if (!pool) return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
    return next();
  });

  const SELECT_ADMIN = `SELECT m.id, m.texto, m.status, m.categoria, m.confianca, m.motivo, m.moderador, m.sinais, m.revisar,
      m.denuncias, m.criado_em, m.revisado_em, m.aluno_id, a.nome, a.rgm, g.nome AS grupo, m.conversa_id,
      m.midia_tipo, m.midia_duracao, (m.midia_arquivo IS NOT NULL AND NOT m.midia_apagada) AS midia_disponivel, m.midia_expira_em,
      CASE WHEN m.conversa_id IS NULL THEN NULL WHEN c.aluno_a = m.aluno_id THEN ab.nome ELSE aa.nome END AS destinatario,
      mem.silenciado_ate,
      (SELECT json_agg(json_build_object('motivo', d.motivo, 'em', d.criado_em) ORDER BY d.criado_em)
         FROM csu_grupo_denuncias d WHERE d.mensagem_id = m.id AND d.resolvida_em IS NULL) AS denuncias_abertas
    FROM csu_grupo_mensagens m
    JOIN csu_alunos a ON a.id = m.aluno_id
    JOIN csu_grupos g ON g.id = m.grupo_id
    LEFT JOIN csu_dm_conversas c ON c.id = m.conversa_id
    LEFT JOIN csu_alunos aa ON aa.id = c.aluno_a
    LEFT JOIN csu_alunos ab ON ab.id = c.aluno_b
    LEFT JOIN csu_grupo_membros mem ON mem.grupo_id = m.grupo_id AND mem.aluno_id = m.aluno_id`;

  app.get('/api/admin/grupos/fila', async (req, res) => {
    try {
      await ensure();
      const [pendentes, denunciadas, bloqueadas, semIa, resumo] = await Promise.all([
        pool.query(`${SELECT_ADMIN} WHERE m.status = 'retida' OR (m.status = 'bloqueada' AND m.revisar) ORDER BY m.criado_em LIMIT 100`),
        pool.query(`${SELECT_ADMIN} WHERE m.status = 'publicada' AND EXISTS (SELECT 1 FROM csu_grupo_denuncias d WHERE d.mensagem_id = m.id AND d.resolvida_em IS NULL) ORDER BY m.denuncias DESC, m.criado_em LIMIT 100`),
        pool.query(`${SELECT_ADMIN} WHERE m.status = 'bloqueada' AND NOT m.revisar AND m.criado_em > now() - interval '7 days' ORDER BY m.criado_em DESC LIMIT 30`),
        pool.query(`${SELECT_ADMIN} WHERE m.status = 'publicada' AND m.moderador = 'fallback' AND m.revisado_em IS NULL AND m.criado_em > now() - interval '7 days' ORDER BY m.criado_em DESC LIMIT 30`),
        pool.query(`SELECT count(DISTINCT g.id)::int AS grupos,
            count(m.id) FILTER (WHERE m.criado_em > now() - interval '7 days')::int AS mensagens_7d,
            count(m.id) FILTER (WHERE m.criado_em > now() - interval '7 days' AND m.status = 'bloqueada')::int AS bloqueadas_7d,
            count(m.id) FILTER (WHERE m.midia_arquivo IS NOT NULL)::int AS midias_guardadas
          FROM csu_grupos g LEFT JOIN csu_grupo_mensagens m ON m.grupo_id = g.id`),
      ]);
      const prov = moderacao.provedor();
      const ids = (rows) => rows.map((x) => ({ ...x, id: Number(x.id), conversa_id: x.conversa_id ? Number(x.conversa_id) : null })); // BIGSERIAL vem como texto do pg
      return res.json({
        success: true,
        pendentes: ids(pendentes.rows),
        denunciadas: ids(denunciadas.rows),
        bloqueadas: ids(bloqueadas.rows),
        sem_ia: ids(semIa.rows),
        resumo: resumo.rows[0],
        provedor: prov.nome,
        provedor_aviso: prov.aviso || null,
        midia_dias: midiaDias(),
        motivos_denuncia: MOTIVOS_DENUNCIA,
      });
    } catch (err) {
      console.error('Grupo de estudo: falha ao carregar a fila:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível carregar a fila de moderação.' });
    }
  });

  app.get('/api/admin/grupos/midia/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return naoEncontrado(res);
    try {
      await ensure();
      const row = (await pool.query('SELECT * FROM csu_grupo_mensagens WHERE id = $1', [id])).rows[0];
      if (!row) return naoEncontrado(res);
      return enviarArquivo(res, row);
    } catch (err) {
      return res.status(500).json({ success: false });
    }
  });

  const ACOES = ['publicar', 'remover', 'manter_bloqueada', 'descartar_denuncias', 'silenciar', 'conferida'];
  app.post('/api/admin/grupos/mensagens/:id/acao', async (req, res) => {
    const id = Number(req.params.id);
    const acao = String((req.body && req.body.acao) || '');
    const horas = Number(req.body && req.body.horas) === 168 ? 168 : 24;
    if (!Number.isSafeInteger(id) || id <= 0 || !ACOES.includes(acao)) return res.status(400).json({ success: false, message: 'Ação inválida.' });
    const adminId = req.admin && req.admin.id;
    try {
      await ensure();
      const m = (await pool.query('SELECT id, grupo_id, aluno_id, status, categoria, conversa_id, midia_arquivo FROM csu_grupo_mensagens WHERE id = $1', [id])).rows[0];
      if (!m) return res.status(404).json({ success: false, message: 'Mensagem não encontrada.' });
      const resolverDenuncias = () => pool.query('UPDATE csu_grupo_denuncias SET resolvida_em = now() WHERE mensagem_id = $1 AND resolvida_em IS NULL', [id]);
      const revisada = `revisar = FALSE, revisado_em = now(), revisado_por = $2, atualizado_em = now()`;
      const remover = async () => {
        await pool.query(`UPDATE csu_grupo_mensagens SET status = 'removida', midia_arquivo = NULL, midia_apagada = (midia_tipo IS NOT NULL), ${revisada} WHERE id = $1`, [id, adminId]);
        await apagarArquivo(m.midia_arquivo);
        await resolverDenuncias();
      };
      if (acao === 'publicar') {
        await pool.query(`UPDATE csu_grupo_mensagens SET status = 'publicada', publicada_em = COALESCE(publicada_em, now()), denuncias = 0, ${revisada} WHERE id = $1`, [id, adminId]);
        await resolverDenuncias();
      } else if (acao === 'remover') {
        await remover();
      } else if (acao === 'manter_bloqueada') {
        await pool.query(`UPDATE csu_grupo_mensagens SET status = 'bloqueada', ${revisada} WHERE id = $1`, [id, adminId]);
      } else if (acao === 'descartar_denuncias') {
        await pool.query(`UPDATE csu_grupo_mensagens SET denuncias = 0,
            status = CASE WHEN status = 'retida' AND publicada_em IS NOT NULL THEN 'publicada' ELSE status END, ${revisada} WHERE id = $1`, [id, adminId]);
        await resolverDenuncias();
      } else if (acao === 'conferida') {
        await pool.query(`UPDATE csu_grupo_mensagens SET revisado_em = now(), revisado_por = $2 WHERE id = $1`, [id, adminId]);
      } else if (acao === 'silenciar') {
        await pool.query(
          `UPDATE csu_grupo_membros SET silenciado_ate = now() + ($3::int * interval '1 hour') WHERE grupo_id = $1 AND aluno_id = $2`,
          [m.grupo_id, m.aluno_id, horas],
        );
        if (req.body && req.body.remover && m.status !== 'removida') await remover();
      }
      await evento(pool, m.aluno_id, 'grupo_moderacao', {
        acao, mensagem_id: id, categoria: m.categoria, status_antes: m.status, admin_id: adminId || null, origem: 'humano', privada: Boolean(m.conversa_id),
        ...(acao === 'silenciar' ? { horas, removida: Boolean(req.body && req.body.remover) } : {}),
      });
      return res.json({ success: true });
    } catch (err) {
      console.error('Grupo de estudo: falha na ação de moderação:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível salvar a decisão.' });
    }
  });
}

module.exports = { montar, liberadoPara, ligado, nomeExibido, chaveCurso, ensureSchema, limparMidia };
