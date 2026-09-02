'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const meuSemestre = require('./meuSemestre');

const STATUSES = ['pendente', 'processando', 'concluida', 'erro'];
const MONTHS_FULL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const MES_INDEX = {
  JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6,
  JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12,
};
const LOGO_PATH = path.join(__dirname, 'assets', 'cruzeiro-virtual.png');

let cachedLogo = null;
let workerRunning = false;
let enqueueRunning = false;
const inflight = new Map();

function xml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(value, maxChars) {
  const words = String(value ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function textLines(lines, x, y, options = {}) {
  const size = options.size || 28;
  const lineHeight = options.lineHeight || Math.round(size * 1.22);
  const weight = options.weight || 600;
  const fill = options.fill || '#092b63';
  const anchor = options.anchor || 'start';
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">` +
    lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${xml(line)}</tspan>`).join('') +
    '</text>';
}

function roundedRect(x, y, width, height, radius, fill, stroke = 'none', strokeWidth = 0) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

function calendarIcon(x, y, size = 42) {
  const s = size / 42;
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="#4b91cf" stroke-width="3" stroke-linecap="round">
    <rect x="3" y="7" width="36" height="32" rx="5" fill="#edf6fd"/><path d="M3 16h36M12 3v8M30 3v8"/>
    <path d="M11 23h3M20 23h3M29 23h3M11 30h3M20 30h3M29 30h3"/>
  </g>`;
}

function checkIcon(x, y, size = 34) {
  return `<g transform="translate(${x} ${y})"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#f4d83f"/><path d="M9 17l6 6 11-13" fill="none" stroke="#092b63" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

function bookIcon(x, y) {
  return `<g transform="translate(${x} ${y})" fill="none" stroke="#0d3f83" stroke-width="3" stroke-linejoin="round"><path d="M3 6c8-3 15-1 20 4v27c-5-5-12-7-20-4zM43 6c-8-3-15-1-20 4v27c5-5 12-7 20-4z" fill="#edf6fd"/></g>`;
}

function activityKind(titulo) {
  const t = String(titulo || '').toLowerCase();
  if (t.includes('ambient')) return 'digital';
  if (t.includes('carreira')) return 'carreira';
  if (t.includes('projeto')) return 'projeto';
  if (t.includes('extens')) return 'extensao';
  return 'outro';
}

function activityIcon(x, y, kind) {
  const symbols = { digital: '◎', carreira: '◆', projeto: '●', extensao: '♥', outro: '✓' };
  const symbol = symbols[kind] || '✓';
  return `<g><rect x="${x}" y="${y}" width="68" height="68" rx="16" fill="#edf6fd"/><text x="${x + 34}" y="${y + 47}" text-anchor="middle" font-size="36" font-weight="800" fill="#0d3f83">${symbol}</text></g>`;
}

function logoDataUri() {
  if (!cachedLogo) {
    cachedLogo = fs.readFileSync(LOGO_PATH).toString('base64');
  }
  return cachedLogo;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatRange(start, end) {
  const a = meuSemestre.toIsoDate(start);
  const b = meuSemestre.toIsoDate(end) || a;
  if (!a) return '';
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  if (a === b) return `${pad2(ad)}/${pad2(am)}`;
  if (am === bm && ay === by) return `${pad2(ad)} a ${pad2(bd)}/${pad2(bm)}`;
  return `${pad2(ad)}/${pad2(am)} a ${pad2(bd)}/${pad2(bm)}`;
}

function formatDateBr(iso) {
  const raw = meuSemestre.toIsoDate(iso);
  if (!raw) return '';
  const [, m, d] = raw.split('-');
  return `${d}/${m}`;
}

function monthFromDiscipline(item) {
  const iso = meuSemestre.toIsoDate(item.data_inicio);
  if (iso) return Number(iso.slice(5, 7));
  const mes = String(item.mes || '').toUpperCase();
  return MES_INDEX[mes] || 0;
}

function activityDeadline(item) {
  if (item.prazo_preferencial) return `Finalize preferencialmente até ${formatDateBr(item.prazo_preferencial)}`;
  if (item.prazo) return `Disponível até ${formatDateBr(item.prazo)}`;
  return '';
}

function attentionFrom(data) {
  const items = [];
  const events = Array.isArray(data.calendario) ? data.calendario : [];
  const encerramento = events.find((event) => event.tipo === 'encerramento');
  const recuperacao = events.find((event) => event.tipo === 'recuperacao');
  if (encerramento && encerramento.data_inicio) {
    items.push(`Confira todas as pendências até ${formatDateBr(encerramento.data_inicio)}`);
  }
  if (recuperacao && recuperacao.data_inicio) {
    const when = formatRange(recuperacao.data_inicio, recuperacao.data_fim);
    items.push(when ? `RECUPERAÇÃO: ${when}, se necessária` : 'RECUPERAÇÃO, se necessária');
  }
  return items.slice(0, 2);
}

function mapToPlanData(data) {
  const grouped = new Map();
  (data.disciplinas || []).forEach((item) => {
    const month = monthFromDiscipline(item);
    if (!month || !item.titulo) return;
    if (!grouped.has(month)) grouped.set(month, []);
    grouped.get(month).push(item);
  });

  const months = [...grouped.keys()].sort((a, b) => a - b).map((month) => ({
    label: MONTHS_FULL[month - 1],
    disciplines: grouped.get(month).map((item) => ({
      name: item.titulo,
      study: formatRange(item.data_inicio, item.data_fim) || '—',
      exam: formatRange(item.prova_inicio, item.prova_fim) || '—',
    })),
  }));

  const activities = (data.atividades || []).map((item) => ({
    kind: activityKind(item.titulo),
    name: item.titulo,
    deadline: activityDeadline(item) || '—',
  }));
  if (data.avaliacao_integrada && data.avaliacao_integrada.titulo) {
    activities.push({
      kind: 'outro',
      name: data.avaliacao_integrada.titulo,
      deadline: activityDeadline(data.avaliacao_integrada) || '—',
    });
  }

  return {
    studentName: (data.aluno && data.aluno.nome) || 'Aluno',
    semester: (data.plano && data.plano.periodo) || '',
    intro: 'Este é o seu plano de estudos do semestre',
    months,
    activitiesSubtitle: 'Faça um pouco por semana para não acumular',
    mandatoryActivities: activities,
    attention: attentionFrom(data),
    weeklyReminder: 'Toda semana: acesse o AVA, estude, faça as atividades e confira os avisos.',
  };
}

function renderSvg(data) {
  const width = 1080;
  const margin = 54;
  const contentWidth = width - margin * 2;
  const months = Array.isArray(data.months) ? data.months : [];
  const activities = Array.isArray(data.mandatoryActivities) ? data.mandatoryActivities : [];
  const logoData = logoDataUri();

  const preparedMonths = months.map((month) => {
    const disciplines = (month.disciplines || []).map((discipline) => {
      const titleLines = wrapText(discipline.name, 47);
      const rowHeight = Math.max(116, 82 + (titleLines.length - 1) * 27);
      return { ...discipline, titleLines, rowHeight };
    });
    const height = 91 + disciplines.reduce((sum, row) => sum + row.rowHeight + 14, 0) + 16;
    return { ...month, disciplines, height };
  });

  const activityTitleLines = wrapText('ATIVIDADES OBRIGATÓRIAS DO SEMESTRE', 29);
  const activityHeaderHeight = 100 + activityTitleLines.length * 38;
  const activityRows = activities.map((activity) => {
    const titleLines = wrapText(activity.name, 29);
    const deadlineLines = wrapText(activity.deadline, 21);
    const height = Math.max(100, 58 + Math.max(titleLines.length, deadlineLines.length) * 25);
    return { ...activity, titleLines, deadlineLines, height };
  });

  const headerHeight = 415;
  const monthsHeight = preparedMonths.reduce((sum, month) => sum + month.height + 30, 0);
  const activitiesHeight = activityHeaderHeight + activityRows.reduce((sum, row) => sum + row.height + 12, 0) + 30;
  const attentionBlock = (Array.isArray(data.attention) ? data.attention : []).length ? 174 : 24;
  const footerHeight = attentionBlock + 126;
  const height = headerHeight + monthsHeight + activitiesHeight + footerHeight;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="softBlue" x1="0" x2="1"><stop stop-color="#edf6fd"/><stop offset="1" stop-color="#dceeff"/></linearGradient>
    <linearGradient id="navy" x1="0" x2="1"><stop stop-color="#092b63"/><stop offset="1" stop-color="#0d478e"/></linearGradient>
    <linearGradient id="attention" x1="0" x2="1"><stop stop-color="#fff7d7"/><stop offset="1" stop-color="#ffefb4"/></linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="7" stdDeviation="9" flood-color="#092b63" flood-opacity=".08"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  <style>text{font-family:Arial,Helvetica,sans-serif}</style>
  <image href="data:image/png;base64,${logoData}" xlink:href="data:image/png;base64,${logoData}" x="290" y="34" width="500" height="180" preserveAspectRatio="xMidYMid meet"/>
  ${textLines([`PLANO DE ESTUDOS — ${data.semester || ''}`], width / 2, 250, { size: 54, weight: 800, anchor: 'middle' })}
  ${roundedRect(margin, 292, contentWidth, 104, 24, 'url(#softBlue)')}
  <circle cx="112" cy="344" r="36" fill="#0d3f83"/>
  <circle cx="112" cy="331" r="12" fill="#fff"/><path d="M91 366c4-19 38-19 42 0" fill="#fff"/>
  ${textLines([`Olá, ${data.studentName || 'Aluno'}!`], 170, 336, { size: 32, weight: 800 })}
  ${textLines([data.intro || 'Este é o seu plano de estudos do semestre'], 170, 373, { size: 23, weight: 500, fill: '#243a5a' })}`;

  let y = headerHeight;
  let timelineStarted = false;
  for (const month of preparedMonths) {
    const cardX = 95;
    const cardWidth = width - cardX - margin;
    if (!timelineStarted) {
      svg += `<line x1="58" y1="${y + 30}" x2="58" y2="${headerHeight + monthsHeight - 62}" stroke="#092b63" stroke-width="6"/>`;
      timelineStarted = true;
    }
    svg += `<circle cx="58" cy="${y + 30}" r="22" fill="#fff" stroke="#092b63" stroke-width="6"/><circle cx="58" cy="${y + 30}" r="10" fill="#0d3f83"/>`;
    svg += roundedRect(cardX, y, cardWidth, month.height, 24, '#fff', '#092b63', 3);
    svg += roundedRect(cardX, y - 4, 290, 66, 20, 'url(#navy)');
    svg += textLines([String(month.label || '').toUpperCase()], cardX + 145, y + 42, { size: 28, weight: 800, fill: '#fff', anchor: 'middle' });
    let rowY = y + 78;
    for (const discipline of month.disciplines) {
      svg += roundedRect(cardX + 24, rowY, cardWidth - 48, discipline.rowHeight, 18, '#fafdff', '#9dcbef', 2);
      svg += bookIcon(cardX + 49, rowY + 30);
      svg += textLines(discipline.titleLines, cardX + 120, rowY + 38, { size: 25, weight: 800, lineHeight: 28 });
      const dateY = rowY + discipline.rowHeight - 25;
      svg += calendarIcon(cardX + 120, dateY - 28, 30);
      svg += textLines([`Estude: ${discipline.study || '—'}`], cardX + 160, dateY, { size: 20, weight: 650, fill: '#243a5a' });
      svg += checkIcon(cardX + cardWidth - 295, dateY - 27, 30);
      svg += textLines([`Prova: ${discipline.exam || '—'}`], cardX + cardWidth - 250, dateY, { size: 20, weight: 700, fill: '#243a5a' });
      rowY += discipline.rowHeight + 14;
    }
    y += month.height + 30;
  }

  const activitiesY = y + 6;
  svg += roundedRect(margin, activitiesY, contentWidth, activitiesHeight, 28, 'url(#softBlue)');
  svg += `<circle cx="136" cy="${activitiesY + 72}" r="54" fill="#fff" stroke="#0d3f83" stroke-width="5"/><path d="M111 ${activitiesY + 70}l16 16 35-36" fill="none" stroke="#0d3f83" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
  svg += textLines(activityTitleLines, 215, activitiesY + 54, { size: 30, weight: 800, lineHeight: 36 });
  svg += textLines([data.activitiesSubtitle || 'Faça um pouco por semana para não acumular'], 215, activitiesY + 70 + activityTitleLines.length * 36, { size: 20, weight: 500, fill: '#243a5a' });
  let activityY = activitiesY + activityHeaderHeight;
  for (const activity of activityRows) {
    svg += roundedRect(margin + 24, activityY, contentWidth - 48, activity.height, 18, '#fff');
    svg += activityIcon(margin + 45, activityY + (activity.height - 68) / 2, activity.kind);
    const contentBaseY = activityY + 38;
    svg += textLines(activity.titleLines, margin + 135, contentBaseY, { size: 20, weight: 800, lineHeight: 24 });
    svg += `<line x1="635" y1="${activityY + 20}" x2="635" y2="${activityY + activity.height - 20}" stroke="#b9d9f2" stroke-width="2"/>`;
    svg += calendarIcon(662, activityY + (activity.height - 40) / 2, 38);
    svg += textLines(activity.deadlineLines, 715, contentBaseY, { size: 18, weight: 650, lineHeight: 22, fill: '#243a5a' });
    activityY += activity.height + 12;
  }

  let cursorY = activitiesY + activitiesHeight + 24;
  const attention = Array.isArray(data.attention) ? data.attention : [];
  if (attention.length) {
    svg += roundedRect(margin, cursorY, contentWidth, 150, 26, 'url(#attention)');
    svg += `<circle cx="142" cy="${cursorY + 75}" r="55" fill="#f4c400"/><text x="142" y="${cursorY + 106}" text-anchor="middle" font-size="88" font-weight="900" fill="#092b63">!</text>`;
    svg += textLines(['ATENÇÃO'], 225, cursorY + 52, { size: 32, weight: 800 });
    attention.slice(0, 2).forEach((line, index) => {
      svg += checkIcon(225, cursorY + 69 + index * 38, 25);
      svg += textLines([line], 263, cursorY + 90 + index * 38, { size: 20, weight: 600, fill: '#243a5a' });
    });
    cursorY += 174;
  }
  svg += roundedRect(margin, cursorY, contentWidth, 100, 24, 'url(#navy)');
  svg += bookIcon(92, cursorY + 28);
  svg += textLines(wrapText(data.weeklyReminder || 'Toda semana: acesse o AVA, estude, faça as atividades e confira os avisos.', 75), 170, cursorY + 43, { size: 22, weight: 600, lineHeight: 28, fill: '#fff' });
  svg += '</svg>';
  return svg;
}

function fingerprintFromParts({ nome, plano, disciplinas, atividades, avaliacao, atencao }) {
  return {
    nome: nome || '',
    plano: plano
      ? {
        id: plano.id,
        curso: plano.curso,
        periodo: plano.periodo,
        titulo: plano.titulo,
      }
      : null,
    disciplinas: (disciplinas || []).map((item) => ({
      titulo: item.titulo,
      data_inicio: meuSemestre.toIsoDate(item.data_inicio),
      data_fim: meuSemestre.toIsoDate(item.data_fim),
      prova_inicio: meuSemestre.toIsoDate(item.prova_inicio),
      prova_fim: meuSemestre.toIsoDate(item.prova_fim),
    })),
    atividades: (atividades || []).map((item) => ({
      titulo: item.titulo,
      prazo: meuSemestre.toIsoDate(item.prazo),
      prazo_preferencial: meuSemestre.toIsoDate(item.prazo_preferencial),
    })),
    avaliacao: avaliacao
      ? { titulo: avaliacao.titulo, prazo: meuSemestre.toIsoDate(avaliacao.prazo) }
      : null,
    atencao: (atencao || []).map((item) => ({
      tipo: item.tipo,
      data_inicio: meuSemestre.toIsoDate(item.data_inicio),
      data_fim: meuSemestre.toIsoDate(item.data_fim),
    })),
  };
}

function fingerprint(data) {
  return fingerprintFromParts({
    nome: data.aluno && data.aluno.nome,
    plano: data.plano,
    disciplinas: data.disciplinas,
    atividades: data.atividades,
    avaliacao: data.avaliacao_integrada,
    atencao: (data.calendario || []).filter((item) => item.tipo === 'encerramento' || item.tipo === 'recuperacao'),
  });
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
    console.warn('PLAN_IMAGE_OUTPUT_DIR indisponível, usando fallback local:', fallback, err.message);
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

function filePaths(alunoId, planoId, hash) {
  const dir = path.join(resolveOutputDir(), String(alunoId));
  const base = `${planoId}-${hash.slice(0, 20)}`;
  return {
    dir,
    svg: path.join(dir, `${base}.svg`),
    png: path.join(dir, `${base}.png`),
  };
}

function periodoContem(periodo, isoDate) {
  const match = String(periodo || '').match(/^(\d{4})\/([12])$/);
  if (!match || !isoDate) return false;
  const year = match[1];
  const sem = match[2];
  if (sem === '1') return isoDate >= `${year}-01-01` && isoDate <= `${year}-07-31`;
  return isoDate >= `${year}-08-01` && isoDate <= `${year}-12-31`;
}

function comparePeriodo(a, b) {
  const ma = String(a || '').match(/^(\d{4})\/([12])$/);
  const mb = String(b || '').match(/^(\d{4})\/([12])$/);
  const va = ma ? Number(ma[1]) * 10 + Number(ma[2]) : 0;
  const vb = mb ? Number(mb[1]) * 10 + Number(mb[2]) : 0;
  return vb - va;
}

function pickPlano(planos, curso, today) {
  const matches = planos.filter((plano) => meuSemestre.cursosMatch(curso, plano.curso));
  if (!matches.length) return null;
  const vigentes = matches.filter((plano) => periodoContem(plano.periodo, today));
  const pool = vigentes.length ? vigentes : matches;
  pool.sort((a, b) => comparePeriodo(a.periodo, b.periodo) || b.id - a.id);
  return pool[0];
}

function concurrency() {
  const n = Number(process.env.PLAN_IMAGE_CONCURRENCY || 3);
  if (!Number.isFinite(n)) return 3;
  return Math.min(3, Math.max(2, Math.trunc(n)));
}

async function upsertRow(pool, { alunoId, planoId, hash, status, filePath, errorMessage }) {
  const result = await pool.query(
    `INSERT INTO csu_semestre_imagens
      (aluno_id, plano_id, data_hash, file_path, status, error_message, generated_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 = 'concluida' THEN now() ELSE NULL END, now())
     ON CONFLICT (aluno_id, plano_id) DO UPDATE SET
       data_hash = EXCLUDED.data_hash,
       file_path = EXCLUDED.file_path,
       status = EXCLUDED.status,
       error_message = EXCLUDED.error_message,
       generated_at = CASE WHEN EXCLUDED.status = 'concluida' THEN now() ELSE csu_semestre_imagens.generated_at END,
       updated_at = now()
     RETURNING id, aluno_id, plano_id, data_hash, file_path, status`,
    [alunoId, planoId, hash, filePath || null, status, errorMessage || null],
  );
  return result.rows[0];
}

async function generateForAluno(pool, alunoId) {
  const data = await meuSemestre.getMeuSemestre(pool, alunoId);
  if (!data.plano) {
    const err = new Error('Semestre não disponível para este aluno.');
    err.code = 'NO_PLAN';
    throw err;
  }
  const hash = hashFingerprint(fingerprint(data));
  const existing = await pool.query(
    `SELECT id, data_hash, file_path, status
     FROM csu_semestre_imagens
     WHERE aluno_id = $1 AND plano_id = $2
     LIMIT 1`,
    [alunoId, data.plano.id],
  );
  const row = existing.rows[0];
  if (row && row.status === 'concluida' && row.data_hash === hash && row.file_path) {
    try {
      const pngPath = safeFilePath(row.file_path);
      if (fs.existsSync(pngPath)) {
        const svgPath = pngPath.replace(/\.png$/i, '.svg');
        return { hash, pngPath, svgPath: fs.existsSync(svgPath) ? svgPath : null, reused: true };
      }
    } catch (err) {
      /* regenera se o caminho antigo for inválido */
    }
  }

  await upsertRow(pool, {
    alunoId,
    planoId: data.plano.id,
    hash,
    status: 'processando',
    filePath: row && row.file_path,
    errorMessage: null,
  });

  const paths = filePaths(alunoId, data.plano.id, hash);
  fs.mkdirSync(paths.dir, { recursive: true });
  const svg = renderSvg(mapToPlanData(data));
  fs.writeFileSync(paths.svg, svg, 'utf8');
  await sharp(Buffer.from(svg)).png().toFile(paths.png);
  await upsertRow(pool, {
    alunoId,
    planoId: data.plano.id,
    hash,
    status: 'concluida',
    filePath: paths.png,
    errorMessage: null,
  });
  if (row && row.file_path && row.file_path !== paths.png) {
    try {
      const oldPng = safeFilePath(row.file_path);
      const oldSvg = oldPng.replace(/\.png$/i, '.svg');
      if (fs.existsSync(oldPng)) fs.unlinkSync(oldPng);
      if (fs.existsSync(oldSvg)) fs.unlinkSync(oldSvg);
    } catch (err) {
      /* arquivo antigo pode já ter saído do volume */
    }
  }
  return { hash, pngPath: paths.png, svgPath: paths.svg, reused: false };
}

function generateForAlunoLocked(pool, alunoId) {
  if (inflight.has(alunoId)) return inflight.get(alunoId);
  const pending = generateForAluno(pool, alunoId).finally(() => inflight.delete(alunoId));
  inflight.set(alunoId, pending);
  return pending;
}

async function sendAlunoImage(pool, alunoId, format, res) {
  try {
    const result = await generateForAlunoLocked(pool, alunoId);
    const filePath = format === 'svg' ? result.svgPath : result.pngPath;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(500).json({ success: false, message: 'Não foi possível gerar a imagem.' });
    }
    const filename = format === 'svg' ? 'plano-de-estudos.svg' : 'plano-de-estudos.png';
    res.setHeader('Content-Type', format === 'svg' ? 'image/svg+xml; charset=utf-8' : 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(safeFilePath(filePath));
  } catch (err) {
    if (err.code === 'NO_PLAN') {
      return res.status(404).json({ success: false, message: err.message });
    }
    console.error('Falha ao gerar plano de estudos:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível gerar o plano de estudos.' });
  }
}

async function listEligible(pool) {
  const today = meuSemestre.todayIsoSaoPaulo();
  const planos = await pool.query(
    `SELECT id, curso, periodo, titulo FROM csu_semestre_planos WHERE ativo = TRUE`,
  );
  if (!planos.rows.length) return [];
  const alunos = await pool.query(
    `SELECT id, nome, curso
     FROM csu_alunos
     WHERE ativo = TRUE AND curso IS NOT NULL AND btrim(curso) <> ''`,
  );
  const list = [];
  for (const aluno of alunos.rows) {
    const plano = pickPlano(planos.rows, aluno.curso, today);
    if (plano) list.push({ alunoId: aluno.id, nome: aluno.nome, planoId: plano.id, plano });
  }
  return list;
}

async function enqueueOutdated(pool) {
  const eligible = await listEligible(pool);
  if (!eligible.length) return { queued: 0, total: 0 };

  const planoIds = [...new Set(eligible.map((row) => row.planoId))];
  const itens = await pool.query(
    `SELECT plano_id, tipo, titulo, data_inicio, data_fim, prova_inicio, prova_fim, prazo, prazo_preferencial, ordem
     FROM csu_semestre_itens
     WHERE plano_id = ANY($1::int[])
     ORDER BY ordem ASC, id ASC`,
    [planoIds],
  );
  const byPlano = new Map();
  for (const item of itens.rows) {
    const list = byPlano.get(item.plano_id) || [];
    list.push(item);
    byPlano.set(item.plano_id, list);
  }
  const eventos = await pool.query(
    `SELECT plano_id, tipo, data_inicio, data_fim
     FROM csu_semestre_eventos
     WHERE plano_id = ANY($1::int[])
       AND tipo IN ('encerramento', 'recuperacao')
     ORDER BY data_inicio ASC, ordem ASC, id ASC`,
    [planoIds],
  );
  const eventsByPlano = new Map();
  for (const item of eventos.rows) {
    const list = eventsByPlano.get(item.plano_id) || [];
    list.push(item);
    eventsByPlano.set(item.plano_id, list);
  }

  const existing = await pool.query(
    `SELECT aluno_id, plano_id, data_hash, file_path, status
     FROM csu_semestre_imagens
     WHERE aluno_id = ANY($1::int[])`,
    [eligible.map((row) => row.alunoId)],
  );
  const current = new Map(existing.rows.map((row) => [`${row.aluno_id}:${row.plano_id}`, row]));

  let queued = 0;
  for (const row of eligible) {
    const planItems = byPlano.get(row.planoId) || [];
    const avaliacaoItem = planItems.find((rowItem) => rowItem.tipo === 'avaliacao_integrada') || null;
    const hash = hashFingerprint(fingerprintFromParts({
      nome: row.nome,
      plano: row.plano,
      disciplinas: planItems.filter((item) => item.tipo === 'disciplina'),
      atividades: planItems.filter((item) => item.tipo === 'atividade'),
      avaliacao: avaliacaoItem,
      atencao: eventsByPlano.get(row.planoId) || [],
    }));
    const prev = current.get(`${row.alunoId}:${row.planoId}`);
    if (prev && prev.status === 'processando') continue;
    if (prev && prev.status === 'pendente' && prev.data_hash === hash) continue;
    let fileOk = false;
    if (prev && prev.file_path && prev.data_hash === hash && prev.status === 'concluida') {
      try {
        fileOk = fs.existsSync(safeFilePath(prev.file_path));
      } catch (err) {
        fileOk = false;
      }
    }
    if (fileOk) continue;
    await upsertRow(pool, {
      alunoId: row.alunoId,
      planoId: row.planoId,
      hash,
      status: 'pendente',
      filePath: prev && prev.file_path,
      errorMessage: null,
    });
    queued += 1;
  }
  return { queued, total: eligible.length };
}

async function claimJobs(pool, limit) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const jobs = await client.query(
      `SELECT id, aluno_id, plano_id
       FROM csu_semestre_imagens
       WHERE status = 'pendente'
       ORDER BY id ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    const ids = jobs.rows.map((row) => row.id);
    if (ids.length) {
      await client.query(
        `UPDATE csu_semestre_imagens
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
    await generateForAlunoLocked(pool, job.aluno_id);
  } catch (err) {
    const message = String(err.message || 'Falha ao gerar imagem.').slice(0, 400);
    await pool.query(
      `UPDATE csu_semestre_imagens
       SET status = 'erro', error_message = $2, updated_at = now()
       WHERE aluno_id = $1 AND plano_id = $3`,
      [job.aluno_id, message, job.plano_id],
    );
  }
}

async function recoverStuck(pool) {
  const skip = [...inflight.keys()];
  if (skip.length) {
    await pool.query(
      `UPDATE csu_semestre_imagens
       SET status = 'pendente', error_message = NULL, updated_at = now()
       WHERE status = 'processando'
         AND NOT (aluno_id = ANY($1::int[]))`,
      [skip],
    );
    return;
  }
  await pool.query(
    `UPDATE csu_semestre_imagens
     SET status = 'pendente', error_message = NULL, updated_at = now()
     WHERE status = 'processando'`,
  );
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
      .catch((err) => console.error('Worker de planos de estudo falhou:', err.message))
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
      enqueueOutdated(pool)
        .then((queued) => {
          console.log(`Imagens de plano: ${queued.queued} enfileiradas de ${queued.total} alunos elegíveis.`);
          kickWorker(pool);
        })
        .catch((err) => console.error('Falha ao enfileirar imagens de plano:', err.message))
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
     FROM csu_semestre_imagens
     GROUP BY status`,
  );
  const counts = { pendente: 0, processando: 0, concluida: 0, erro: 0 };
  for (const row of result.rows) {
    if (counts[row.status] !== undefined) counts[row.status] = row.n;
  }
  return {
    running: workerRunning || enqueueRunning,
    pendentes: counts.pendente,
    processando: counts.processando,
    concluidas: counts.concluida,
    erros: counts.erro,
    total: counts.pendente + counts.processando + counts.concluida + counts.erro,
  };
}

function startAutoSync(pool) {
  kickWorker(pool);
  const enabled = String(process.env.PLAN_IMAGE_AUTO_SYNC || '').toLowerCase() === 'true';
  if (!enabled) {
    console.log('Geração automática de planos de estudo desligada: PLAN_IMAGE_AUTO_SYNC!=true.');
    return;
  }
  const minutes = Number(process.env.PLAN_IMAGE_SYNC_INTERVAL_MIN || 60);
  const delayMs = Math.max(5, minutes) * 60 * 1000;
  const run = async (reason) => {
    try {
      console.log('Sync de imagens de plano:', reason);
      await startBatch(pool);
    } catch (err) {
      console.error('Sync de imagens de plano falhou:', err.message);
    }
  };
  setTimeout(() => run('boot'), 20000);
  setInterval(() => run('intervalo'), delayMs);
  console.log(`Geração automática de planos de estudo a cada ${Math.max(5, minutes)} min.`);
}

module.exports = {
  STATUSES,
  renderSvg,
  mapToPlanData,
  sendAlunoImage,
  startBatch,
  getStatus,
  kickWorker,
  startAutoSync,
  generateForAlunoLocked,
};
