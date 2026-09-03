'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { renderSvg } = require('./planoImagem');

const RENDER_VERSION = 2;
const STATUSES = ['pendente', 'processando', 'concluida', 'erro'];
const MONTHS_FULL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

let workerRunning = false;
let enqueueRunning = false;
const inflight = new Map();

function materiaTitle(item) {
  if (item == null) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'object') {
    return String(item.disciplina || item.nome || item.titulo || item.materia || '').trim();
  }
  return String(item).trim();
}

function materiaPeriodo(item) {
  if (item && typeof item === 'object') return String(item.data || item.periodo || '').trim();
  return '';
}

function parseBrRange(raw) {
  const match = String(raw || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s*a\s*(\d{2})\/(\d{2})\/(\d{4}))?/);
  if (!match) return null;
  return {
    startDay: match[1],
    startMonth: Number(match[2]),
    startYear: Number(match[3]),
    endDay: match[4] || match[1],
    endMonth: Number(match[5] || match[2]),
    endYear: Number(match[6] || match[3]),
  };
}

function formatMateriaRange(raw) {
  const parsed = parseBrRange(raw);
  if (!parsed) return raw || 'Matéria do semestre';
  const a = `${parsed.startDay}/${String(parsed.startMonth).padStart(2, '0')}`;
  const b = `${parsed.endDay}/${String(parsed.endMonth).padStart(2, '0')}`;
  if (a === b) return a;
  if (parsed.startMonth === parsed.endMonth && parsed.startYear === parsed.endYear) {
    return `${parsed.startDay} a ${parsed.endDay}/${String(parsed.startMonth).padStart(2, '0')}`;
  }
  return `${a} a ${b}`;
}

function normalizeMaterias(materias) {
  return (Array.isArray(materias) ? materias : [])
    .map((item) => ({
      name: materiaTitle(item),
      period: materiaPeriodo(item),
      month: (parseBrRange(materiaPeriodo(item)) || {}).startMonth || 0,
    }))
    .filter((item) => item.name);
}

function isMandatoryActivity(title) {
  const t = String(title || '').toLowerCase();
  return t.includes('ambient')
    || t.includes('carreira')
    || t.includes('extens')
    || t.includes('projeto')
    || t.includes('avalia')
    || t.includes('multidisciplinar');
}

function activityKind(titulo) {
  const t = String(titulo || '').toLowerCase();
  if (t.includes('ambient')) return 'digital';
  if (t.includes('carreira')) return 'carreira';
  if (t.includes('projeto')) return 'projeto';
  if (t.includes('extens')) return 'extensao';
  return 'outro';
}

function mapMateriasToPlanData({ nome, materias, periodo }) {
  const list = normalizeMaterias(materias);
  const disciplinas = list.filter((item) => !isMandatoryActivity(item.name));
  const atividades = list.filter((item) => isMandatoryActivity(item.name));

  const grouped = new Map();
  for (const item of disciplinas) {
    const month = item.month || 99;
    if (!grouped.has(month)) grouped.set(month, []);
    grouped.get(month).push(item);
  }
  const months = [...grouped.keys()].sort((a, b) => a - b).map((month) => ({
    label: MONTHS_FULL[month - 1] || 'DISCIPLINAS DO SEMESTRE',
    disciplines: grouped.get(month).map((item) => ({
      name: item.name,
      study: formatMateriaRange(item.period),
      exam: '—',
    })),
  }));

  return {
    studentName: nome || 'Aluno',
    semester: periodo || '2026/2',
    intro: 'Estas são as matérias do seu semestre',
    months,
    activitiesSubtitle: 'Faça um pouco por semana para não acumular',
    mandatoryActivities: atividades.map((item) => ({
      kind: activityKind(item.name),
      name: item.name,
      deadline: item.period ? `Disponível: ${formatMateriaRange(item.period)}` : 'Durante o semestre',
    })),
    attention: [],
    weeklyReminder: 'Toda semana: acesse o AVA, estude, faça as atividades e confira os avisos.',
  };
}

function fingerprintFromMaterias({ rgm, nome, materias, periodo }) {
  return {
    source: 'materias_alunos',
    v: RENDER_VERSION,
    rgm: String(rgm || ''),
    nome: String(nome || ''),
    periodo: String(periodo || ''),
    materias: normalizeMaterias(materias).map((item) => ({
      name: item.name,
      period: item.period,
    })),
  };
}

function hashFingerprint(fp) {
  return crypto.createHash('sha256').update(JSON.stringify(fp)).digest('hex');
}

function resolveOutputDir() {
  const configured = process.env.PLAN_IMAGE_OUTPUT_DIR || '/data/planos-estudos';
  try {
    fs.mkdirSync(configured, { recursive: true });
    fs.accessSync(configured, fs.constants.W_OK);
    return configured;
  } catch (err) {
    const fallback = path.join(__dirname, '..', 'data', 'planos-estudos');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

function safeFilePath(filePath) {
  const root = path.resolve(resolveOutputDir());
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Caminho de imagem inválido.');
  }
  return resolved;
}

function filePaths(alunoId, rgm, hash) {
  const dir = path.join(resolveOutputDir(), 'materias', String(alunoId));
  const base = `${String(rgm).replace(/\D/g, '')}-${hash.slice(0, 20)}`;
  return {
    dir,
    svg: path.join(dir, `${base}.svg`),
    png: path.join(dir, `${base}.png`),
  };
}

function newShareToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function ensureShareToken(pool, rgm) {
  const existing = await pool.query(
    `SELECT share_token FROM csu_materias_imagens WHERE rgm = $1 LIMIT 1`,
    [rgm],
  );
  if (existing.rows[0] && existing.rows[0].share_token) return existing.rows[0].share_token;
  const token = newShareToken();
  const updated = await pool.query(
    `UPDATE csu_materias_imagens
     SET share_token = COALESCE(share_token, $2), updated_at = now()
     WHERE rgm = $1
     RETURNING share_token`,
    [rgm, token],
  );
  return updated.rows[0] && updated.rows[0].share_token;
}

async function upsertRow(pool, { rgm, alunoId, hash, status, filePath, errorMessage, imagePng }) {
  const result = await pool.query(
    `INSERT INTO csu_materias_imagens
      (rgm, aluno_id, data_hash, file_path, imagem_png, status, error_message, share_token, generated_at, updated_at)
     VALUES ($1, $2, $3, $4, $8, $5, $6, $7, CASE WHEN $5 = 'concluida' THEN now() ELSE NULL END, now())
     ON CONFLICT (rgm) DO UPDATE SET
       aluno_id = EXCLUDED.aluno_id,
       data_hash = EXCLUDED.data_hash,
       file_path = EXCLUDED.file_path,
       imagem_png = CASE WHEN EXCLUDED.status = 'concluida' THEN EXCLUDED.imagem_png ELSE csu_materias_imagens.imagem_png END,
       status = EXCLUDED.status,
       error_message = EXCLUDED.error_message,
       share_token = COALESCE(csu_materias_imagens.share_token, EXCLUDED.share_token),
       generated_at = CASE WHEN EXCLUDED.status = 'concluida' THEN now() ELSE csu_materias_imagens.generated_at END,
       updated_at = now()
     RETURNING rgm, aluno_id, data_hash, file_path, status, share_token`,
    [rgm, alunoId, hash, filePath || null, status, errorMessage || null, newShareToken(), imagePng || null],
  );
  return result.rows[0];
}

function publicBaseUrl(req) {
  const configured = String(process.env.APP_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  if (!req) return '';
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

function publicImageUrl(req, token) {
  const base = publicBaseUrl(req);
  if (!base || !token) return null;
  return `${base}/p/plano/${token}.png`;
}

async function generateForRgm(pool, rgm) {
  const row = await pool.query(
    `SELECT m.rgm, m.aluno_nome, m.materias, m.aluno_id, a.nome AS aluno_nome_app
     FROM csu_materias_alunos m
     LEFT JOIN csu_alunos a ON a.id = m.aluno_id
     WHERE m.rgm = $1
     LIMIT 1`,
    [rgm],
  );
  const materia = row.rows[0];
  if (!materia || !materia.aluno_id) {
    const err = new Error('Matérias não encontradas ou aluno não vinculado.');
    err.code = 'NO_MATERIAS';
    throw err;
  }

  const nome = materia.aluno_nome_app || materia.aluno_nome || `Aluno ${rgm}`;
  const materias = Array.isArray(materia.materias) ? materia.materias : [];
  const periodo = process.env.MATERIAS_PERIODO || '2026/2';
  const hash = hashFingerprint(fingerprintFromMaterias({ rgm, nome, materias, periodo }));

  const existing = await pool.query(
    `SELECT data_hash, file_path, status, share_token,
            (imagem_png IS NOT NULL) AS has_imagem
     FROM csu_materias_imagens
     WHERE rgm = $1
     LIMIT 1`,
    [rgm],
  );
  const prev = existing.rows[0];
  if (prev && prev.status === 'concluida' && prev.data_hash === hash && prev.has_imagem) {
    let pngPath = null;
    try {
      if (prev.file_path) {
        const candidate = safeFilePath(prev.file_path);
        if (fs.existsSync(candidate)) pngPath = candidate;
      }
    } catch (err) {
      pngPath = null;
    }
    return {
      hash,
      pngPath,
      reused: true,
      shareToken: await ensureShareToken(pool, rgm),
    };
  }

  await upsertRow(pool, {
    rgm,
    alunoId: materia.aluno_id,
    hash,
    status: 'processando',
    filePath: prev && prev.file_path,
    errorMessage: null,
  });

  const paths = filePaths(materia.aluno_id, rgm, hash);
  fs.mkdirSync(paths.dir, { recursive: true });
  const planData = mapMateriasToPlanData({ nome, materias, periodo });
  fs.writeFileSync(paths.svg, renderSvg(planData), 'utf8');
  const pngBuffer = await sharp(Buffer.from(renderSvg(planData, { embedFonts: true }))).png().toBuffer();
  fs.writeFileSync(paths.png, pngBuffer);
  await upsertRow(pool, {
    rgm,
    alunoId: materia.aluno_id,
    hash,
    status: 'concluida',
    filePath: paths.png,
    errorMessage: null,
    imagePng: pngBuffer,
  });

  if (prev && prev.file_path && prev.file_path !== paths.png) {
    try {
      const oldPng = safeFilePath(prev.file_path);
      const oldSvg = oldPng.replace(/\.png$/i, '.svg');
      if (fs.existsSync(oldPng)) fs.unlinkSync(oldPng);
      if (fs.existsSync(oldSvg)) fs.unlinkSync(oldSvg);
    } catch (err) {
      /* ignore */
    }
  }

  return {
    hash,
    pngPath: paths.png,
    reused: false,
    shareToken: await ensureShareToken(pool, rgm),
  };
}

function generateForRgmLocked(pool, rgm) {
  if (inflight.has(rgm)) return inflight.get(rgm);
  const pending = generateForRgm(pool, rgm).finally(() => inflight.delete(rgm));
  inflight.set(rgm, pending);
  return pending;
}

async function findSharedImage(pool, token) {
  const result = await pool.query(
    `SELECT imagem_png, file_path, status
     FROM csu_materias_imagens
     WHERE share_token = $1
     LIMIT 1`,
    [token],
  );
  return result.rows[0] || null;
}

async function enqueueAll(pool) {
  const rows = await pool.query(
    `SELECT m.rgm, m.aluno_id, m.aluno_nome, m.materias,
            i.data_hash, i.status, (i.imagem_png IS NOT NULL) AS has_imagem
     FROM csu_materias_alunos m
     LEFT JOIN csu_materias_imagens i ON i.rgm = m.rgm
     WHERE m.aluno_id IS NOT NULL`,
  );
  const periodo = process.env.MATERIAS_PERIODO || '2026/2';
  let queued = 0;
  for (const row of rows.rows) {
    const materias = Array.isArray(row.materias) ? row.materias : [];
    const hash = hashFingerprint(fingerprintFromMaterias({
      rgm: row.rgm,
      nome: row.aluno_nome,
      materias,
      periodo,
    }));
    if (row.status === 'processando') continue;
    if (row.status === 'pendente' && row.data_hash === hash) continue;
    if (row.status === 'concluida' && row.data_hash === hash && row.has_imagem) continue;
    await upsertRow(pool, {
      rgm: row.rgm,
      alunoId: row.aluno_id,
      hash,
      status: 'pendente',
      filePath: null,
      errorMessage: null,
    });
    queued += 1;
  }
  return { queued, total: rows.rows.length };
}

async function claimJobs(pool, limit) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const jobs = await client.query(
      `SELECT id, rgm, aluno_id
       FROM csu_materias_imagens
       WHERE status = 'pendente'
       ORDER BY id ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    const ids = jobs.rows.map((row) => row.id);
    if (ids.length) {
      await client.query(
        `UPDATE csu_materias_imagens
         SET status = 'processando', error_message = NULL, updated_at = now()
         WHERE id = ANY($1::int[])`,
        [ids],
      );
    }
    await client.query('COMMIT');
    return jobs.rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function processJob(pool, job) {
  try {
    await generateForRgmLocked(pool, job.rgm);
  } catch (err) {
    const message = String(err.message || 'Falha ao gerar imagem.').slice(0, 400);
    await pool.query(
      `UPDATE csu_materias_imagens
       SET status = 'erro', error_message = $2, updated_at = now()
       WHERE rgm = $1`,
      [job.rgm, message],
    );
  }
}

async function recoverStuck(pool) {
  const skip = [...inflight.keys()];
  if (skip.length) {
    await pool.query(
      `UPDATE csu_materias_imagens
       SET status = 'pendente', error_message = NULL, updated_at = now()
       WHERE status = 'processando'
         AND NOT (rgm = ANY($1::text[]))`,
      [skip],
    );
    return;
  }
  await pool.query(
    `UPDATE csu_materias_imagens
     SET status = 'pendente', error_message = NULL, updated_at = now()
     WHERE status = 'processando'`,
  );
}

function concurrency() {
  const n = Number(process.env.PLAN_IMAGE_CONCURRENCY || 3);
  if (!Number.isFinite(n)) return 3;
  return Math.min(3, Math.max(2, Math.trunc(n)));
}

async function runWorker(pool) {
  await recoverStuck(pool);
  const max = concurrency();
  while (true) {
    const jobs = await claimJobs(pool, max);
    if (!jobs.length) return;
    await Promise.all(jobs.map((job) => processJob(pool, job)));
  }
}

function kickWorker(pool) {
  if (workerRunning || !pool) return false;
  workerRunning = true;
  setImmediate(() => {
    runWorker(pool)
      .catch((err) => console.error('Worker de matérias falhou:', err.message))
      .finally(() => {
        workerRunning = false;
      });
  });
  return true;
}

async function startBatch(pool) {
  if (!enqueueRunning) {
    enqueueRunning = true;
    setImmediate(() => {
      enqueueAll(pool)
        .then((queued) => {
          console.log(`Imagens de matérias: ${queued.queued} enfileiradas de ${queued.total} alunos.`);
          kickWorker(pool);
        })
        .catch((err) => console.error('Falha ao enfileirar imagens de matérias:', err.message))
        .finally(() => {
          enqueueRunning = false;
        });
    });
  }
  const started = kickWorker(pool);
  const status = await getStatus(pool);
  return {
    queued: status.pendentes,
    total: status.total,
    running: workerRunning || enqueueRunning || started,
    started: true,
  };
}

async function getStatus(pool) {
  const result = await pool.query(
    `SELECT status, COUNT(*)::int AS n
     FROM csu_materias_imagens
     GROUP BY status`,
  );
  const counts = { pendente: 0, processando: 0, concluida: 0, erro: 0 };
  for (const row of result.rows) counts[row.status] = row.n;
  const materias = await pool.query(`SELECT COUNT(*)::int AS n FROM csu_materias_alunos`);
  return {
    running: workerRunning || enqueueRunning,
    pendentes: counts.pendente,
    processando: counts.processando,
    concluidas: counts.concluida,
    erros: counts.erro,
    total: counts.pendente + counts.processando + counts.concluida + counts.erro,
    materias_synced: materias.rows[0].n,
  };
}

async function listCrmRows(pool, req, { limit = 100, offset = 0 } = {}) {
  const base = publicBaseUrl(req);
  const result = await pool.query(
    `SELECT
       m.rgm,
       COALESCE(a.nome, m.aluno_nome) AS nome,
       a.email,
       m.telefone,
       i.share_token,
       i.status,
       i.generated_at
     FROM csu_materias_imagens i
     JOIN csu_materias_alunos m ON m.rgm = i.rgm
     LEFT JOIN csu_alunos a ON a.id = i.aluno_id
     WHERE i.status = 'concluida' AND i.share_token IS NOT NULL
     ORDER BY COALESCE(a.nome, m.aluno_nome) ASC, m.rgm ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows.map((row) => ({
    rgm: row.rgm,
    nome: row.nome,
    email: row.email,
    telefone: row.telefone || '',
    share_token: row.share_token,
    url: base ? `${base}/p/plano/${row.share_token}.png` : `/p/plano/${row.share_token}.png`,
    status: row.status,
    generated_at: row.generated_at,
  }));
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function rowsToCsv(rows) {
  const header = ['rgm', 'nome', 'telefone', 'email', 'url'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((key) => csvEscape(row[key])).join(','));
  }
  return `\uFEFF${lines.join('\n')}`;
}

async function buildExportRows(pool, req, phonesByRgm) {
  const base = publicBaseUrl(req);
  const result = await pool.query(
    `SELECT
       m.rgm,
       COALESCE(a.nome, m.aluno_nome) AS nome,
       a.email,
       m.telefone,
       i.share_token
     FROM csu_materias_imagens i
     JOIN csu_materias_alunos m ON m.rgm = i.rgm
     LEFT JOIN csu_alunos a ON a.id = i.aluno_id
     WHERE i.status = 'concluida' AND i.share_token IS NOT NULL
     ORDER BY COALESCE(a.nome, m.aluno_nome) ASC, m.rgm ASC`,
  );
  const phones = phonesByRgm || new Map();
  const updates = [];
  const rows = result.rows.map((row) => {
    const rgmDigits = String(row.rgm || '').replace(/\D+/g, '');
    const telefone = phones.get(rgmDigits) || phones.get(row.rgm) || row.telefone || '';
    if (telefone && telefone !== row.telefone) updates.push({ rgm: row.rgm, telefone });
    return {
      rgm: row.rgm,
      nome: row.nome || '',
      telefone,
      email: row.email || '',
      url: base ? `${base}/p/plano/${row.share_token}.png` : `/p/plano/${row.share_token}.png`,
    };
  });
  if (updates.length) {
    await pool.query(
      `UPDATE csu_materias_alunos AS m
       SET telefone = v.telefone, updated_at = now()
       FROM unnest($1::text[], $2::text[]) AS v(rgm, telefone)
       WHERE m.rgm = v.rgm`,
      [updates.map((item) => item.rgm), updates.map((item) => item.telefone)],
    );
  }
  return rows;
}

async function sendExportCsv(pool, req, res, phonesByRgm) {
  const rows = await buildExportRows(pool, req, phonesByRgm);
  const csv = rowsToCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="planos-materias.csv"');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.send(csv);
}

module.exports = {
  STATUSES,
  mapMateriasToPlanData,
  generateForRgmLocked,
  findSharedImage,
  publicImageUrl,
  startBatch,
  getStatus,
  listCrmRows,
  sendExportCsv,
};
