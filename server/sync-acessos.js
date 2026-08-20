'use strict';

const db = require('./db');
const matriculados = require('./matriculados');

const CONCURRENCY = 8;

function mapAluno(data) {
  return {
    nome: String(data?.Nome ?? '').replace(/\s+/g, ' ').trim(),
    rgm: String(data?.RGM ?? '').replace(/\D+/g, ''),
    email: String(data?.Email ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
      || String(data?.['Email acadêmico'] ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
    situacao: String(data?.['Situação Matrícula'] ?? '').replace(/\s+/g, ' ').trim().toUpperCase(),
  };
}

async function loadLatestEmCurso(sourcePool) {
  const latest = await sourcePool.query(`
    SELECT id, file_name, row_count, created_at
    FROM public.matriculados_snapshots
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const snap = latest.rows[0];
  if (!snap) throw new Error('Nenhum snapshot de matriculados encontrado.');

  const rows = await sourcePool.query(
    `
    SELECT data
    FROM public.matriculados_rows
    WHERE snapshot_id = $1
    `,
    [snap.id],
  );

  const byRgm = new Map();
  const emails = new Set();
  const emCurso = new Set();
  const allRgms = new Set();

  for (const row of rows.rows) {
    const aluno = mapAluno(row.data);
    if (!aluno.rgm) continue;
    allRgms.add(aluno.rgm);
    if (aluno.situacao !== 'EM CURSO') continue;
    emCurso.add(aluno.rgm);
    if (!aluno.nome || !aluno.email) continue;
    if (!matriculados.derivedPassword(aluno.nome)) continue;
    if (byRgm.has(aluno.rgm) || emails.has(aluno.email)) continue;
    byRgm.set(aluno.rgm, {
      nome: aluno.nome,
      rgm: aluno.rgm,
      email: aluno.email,
      curso: String(row.data?.Curso ?? '').replace(/\s+/g, ' ').trim(),
      unidade: String(row.data?.Polo ?? row.data?.Instituição ?? '').replace(/\s+/g, ' ').trim(),
    });
    emails.add(aluno.email);
  }

  const revokeRgms = [...allRgms].filter((rgm) => !emCurso.has(rgm));

  return {
    snapshot_id: snap.id,
    snapshot_at: snap.created_at,
    file_name: snap.file_name,
    row_count: snap.row_count,
    alunos: [...byRgm.values()],
    revokeRgms,
  };
}

async function applyAcessos(destPool, alunos) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < alunos.length) {
      const aluno = alunos[cursor];
      cursor += 1;
      try {
        const row = await db.upsertAcessoDerived(destPool, aluno);
        if (row.created) created += 1;
        else updated += 1;
      } catch (err) {
        skipped += 1;
        console.error('Falha ao upsert acesso:', aluno.rgm, err.code || err.message);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return { created, updated, skipped, total: alunos.length };
}

async function syncFromMatriculados(destPool, { force = false } = {}) {
  if (!matriculados.isConfigured()) {
    throw new Error('MATRICULADOS_HOST/MATRICULADOS_DATABASE não configurado');
  }

  await db.ensureSchema(destPool);
  const sourcePool = matriculados.createPool();
  try {
    const payload = await loadLatestEmCurso(sourcePool);
    const previous = await db.getSyncState(destPool);
    if (
      !force
      && previous
      && previous.snapshot_id === payload.snapshot_id
      && Number(previous.row_count) === Number(payload.row_count)
      && previous.revoked_count != null
    ) {
      return {
        skippedRun: true,
        snapshot_id: payload.snapshot_id,
        total: payload.alunos.length,
        created: 0,
        updated: 0,
        skipped: 0,
        revoked: 0,
      };
    }

    const result = await applyAcessos(destPool, payload.alunos);
    const revoked = await db.deactivateAlunosByRgm(destPool, payload.revokeRgms);
    await db.saveSyncState(destPool, {
      snapshot_id: payload.snapshot_id,
      snapshot_at: payload.snapshot_at,
      file_name: payload.file_name,
      row_count: payload.row_count,
      created_count: result.created,
      updated_count: result.updated,
      skipped_count: result.skipped,
      revoked_count: revoked,
    });
    console.log(
      'Sync de acessos:',
      `novos=${result.created}`,
      `atualizados=${result.updated}`,
      `revogados=${revoked}`,
      `snapshot=${payload.file_name}`,
    );
    return {
      skippedRun: false,
      snapshot_id: payload.snapshot_id,
      file_name: payload.file_name,
      revoked,
      ...result,
    };
  } finally {
    await sourcePool.end();
  }
}

module.exports = {
  loadLatestEmCurso,
  applyAcessos,
  syncFromMatriculados,
};
