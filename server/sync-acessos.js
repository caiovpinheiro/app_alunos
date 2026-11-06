'use strict';

const db = require('./db');
const matriculados = require('./matriculados');

const CONCURRENCY = 8;
const RELATORIO_ANTIGO_H = 24;
const MAX_FORA_GUARDADOS = 1000;

// Por que um aluno em curso no relatório ficou sem conta no portal.
const MOTIVOS_FORA = {
  sem_rgm: 'Sem RGM no relatório',
  sem_nome: 'Sem nome no relatório',
  sem_email: 'Sem e-mail no relatório',
  email_repetido: 'E-mail igual ao de outra pessoa',
  erro: 'Erro ao criar a conta',
};

// Fim do sync: certificados que saíram sem curso ou polo ganham o que a conta já tem. Nunca derruba o sync.
async function completarCertificados(destPool) {
  try {
    // eslint-disable-next-line global-require
    const certificado = require('./certificado');
    const completados = await certificado.completarPendentes(destPool);
    const pendentes = (await certificado.pendentesDeAviso(destPool)).length;
    if (completados || pendentes) {
      console.log('Certificados:', `completados=${completados}`, `erro_sem_certificado_com_polo=${pendentes}`);
    }
    return { completados, pendentes };
  } catch (err) {
    console.error('Falha ao completar certificados:', err.message);
    return { completados: 0, pendentes: null };
  }
}

function intervaloSyncMin() {
  return Math.max(5, Number(process.env.ACESSOS_SYNC_INTERVAL_MIN || 30));
}

function foraDe(aluno, motivo, extra) {
  return { nome: aluno.nome || null, rgm: aluno.rgm || null, email: aluno.email || null, motivo, ...extra };
}

// Mesmo e-mail e mesmo nome (sem contar acento, maiúsculas e espaços) = a mesma pessoa, com outra matrícula.
function nomeComparavel(nome) {
  return String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function mapAluno(data) {
  return matriculados.mapRow(data);
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

  const expected = Number(snap.row_count) || 0;
  const loadedRows = rows.rows.length;
  if (expected > 0 && loadedRows < expected) {
    return {
      incomplete: true,
      snapshot_id: snap.id,
      snapshot_at: snap.created_at,
      file_name: snap.file_name,
      row_count: expected,
      loaded_rows: loadedRows,
      alunos: [],
      revokeRgms: [],
    };
  }

  const byRgm = new Map();
  const donoDoEmail = new Map(); // e-mail → aluno que ficou com a conta
  const emCurso = new Set();
  const allRgms = new Set();
  const semRgm = [];
  const semConta = new Map(); // RGM em curso sem dados para virar conta (outra linha do mesmo RGM pode resolver)
  const outroCurso = new Set(); // RGM da mesma pessoa de outro RGM: ela entra pelo e-mail, na conta única

  for (const row of rows.rows) {
    const aluno = mapAluno(row.data);
    if (!aluno.rgm) {
      if (aluno.situacao === 'EM CURSO' && (aluno.nome || aluno.email)) semRgm.push(foraDe(aluno, 'sem_rgm'));
      continue;
    }
    allRgms.add(aluno.rgm);
    if (aluno.situacao !== 'EM CURSO') continue;
    emCurso.add(aluno.rgm);
    if (!aluno.nome || !matriculados.derivedPassword(aluno.nome)) {
      semConta.set(aluno.rgm, foraDe(aluno, 'sem_nome'));
      continue;
    }
    if (!aluno.email) {
      semConta.set(aluno.rgm, foraDe(aluno, 'sem_email'));
      continue;
    }
    if (byRgm.has(aluno.rgm)) continue;
    const dono = donoDoEmail.get(aluno.email);
    if (dono) {
      if (nomeComparavel(dono.nome) === nomeComparavel(aluno.nome)) {
        outroCurso.add(aluno.rgm);
        semConta.delete(aluno.rgm);
      } else if (!outroCurso.has(aluno.rgm)) {
        semConta.set(aluno.rgm, foraDe(aluno, 'email_repetido', { conflito: { nome: dono.nome, rgm: dono.rgm } }));
      }
      continue;
    }
    byRgm.set(aluno.rgm, {
      nome: aluno.nome,
      rgm: aluno.rgm,
      email: aluno.email,
      curso: aluno.curso,
      unidade: aluno.unidade,
    });
    donoDoEmail.set(aluno.email, aluno);
  }

  const revokeRgms = [...allRgms].filter((rgm) => !emCurso.has(rgm));
  const fora = semRgm.concat([...semConta].filter(([rgm]) => !byRgm.has(rgm)).map(([, x]) => x));

  return {
    snapshot_id: snap.id,
    snapshot_at: snap.created_at,
    file_name: snap.file_name,
    row_count: snap.row_count,
    alunos: [...byRgm.values()],
    revokeRgms,
    em_curso: emCurso.size + semRgm.length,
    fora,
    mais_de_um_curso: [...outroCurso].filter((rgm) => !byRgm.has(rgm)).length,
  };
}

async function applyAcessos(destPool, alunos) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let cursor = 0;
  const falhas = [];

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
        falhas.push(foraDe(aluno, 'erro'));
        console.error('Falha ao upsert acesso:', aluno.rgm, err.code || err.message);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return { created, updated, skipped, total: alunos.length, falhas };
}

async function syncFromMatriculados(destPool, { force = false } = {}) {
  if (!matriculados.isConfigured()) {
    throw new Error('MATRICULADOS_HOST/MATRICULADOS_DATABASE não configurado');
  }

  await db.ensureSchema(destPool);
  const sourcePool = matriculados.createPool();
  try {
    const payload = await loadLatestEmCurso(sourcePool);
    if (payload.incomplete) {
      console.warn(
        'Sync de acessos adiado: snapshot incompleto',
        `${payload.loaded_rows}/${payload.row_count}`,
        payload.snapshot_id,
      );
      await db.registrarVerificacaoSync(
        destPool,
        `O último relatório chegou incompleto (${payload.loaded_rows} de ${payload.row_count} linhas) e ainda não foi aplicado.`,
      );
      return {
        skippedRun: true,
        incomplete: true,
        snapshot_id: payload.snapshot_id,
        loaded_rows: payload.loaded_rows,
        row_count: payload.row_count,
        total: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        revoked: 0,
      };
    }

    const previous = await db.getSyncState(destPool);
    const appliedWork = Number(previous?.created_count || 0) + Number(previous?.updated_count || 0);
    if (
      !force
      && previous
      && previous.snapshot_id === payload.snapshot_id
      && Number(previous.row_count) === Number(payload.row_count)
      && previous.revoked_count != null
      && previous.fora_count != null
      && previous.mais_de_um_curso_count != null
      && appliedWork > 0
    ) {
      await db.registrarVerificacaoSync(destPool, null);
      // O polo pode ter subido curso e polo no admin desde a última volta: completa mesmo sem relatório novo.
      const cert = await completarCertificados(destPool);
      return {
        skippedRun: true,
        certificados_completados: cert.completados,
        snapshot_id: payload.snapshot_id,
        total: payload.alunos.length,
        created: 0,
        updated: 0,
        skipped: 0,
        revoked: 0,
      };
    }

    if (payload.alunos.length === 0 && Number(payload.row_count) > 0) {
      console.warn('Sync de acessos adiado: dump sem alunos elegíveis', payload.snapshot_id);
      await db.registrarVerificacaoSync(destPool, 'O último relatório não trouxe nenhum aluno em curso e não foi aplicado.');
      return {
        skippedRun: true,
        incomplete: true,
        snapshot_id: payload.snapshot_id,
        total: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        revoked: 0,
      };
    }

    const result = await applyAcessos(destPool, payload.alunos);
    const revoked = await db.deactivateAlunosByRgm(destPool, payload.revokeRgms);
    // Quem já tem conta (de um relatório anterior) continua entrando: não conta como fora.
    const candidatos = payload.fora.concat(result.falhas);
    const comConta = await db.rgmsComConta(destPool, candidatos.map((x) => x.rgm));
    const fora = candidatos.filter((x) => !x.rgm || !comConta.has(x.rgm));
    await db.saveSyncState(destPool, {
      snapshot_id: payload.snapshot_id,
      snapshot_at: payload.snapshot_at,
      file_name: payload.file_name,
      row_count: payload.row_count,
      created_count: result.created,
      updated_count: result.updated,
      skipped_count: result.skipped,
      revoked_count: revoked,
      em_curso_count: payload.em_curso,
      fora_count: fora.length,
      fora: fora.slice(0, MAX_FORA_GUARDADOS),
      mais_de_um_curso_count: payload.mais_de_um_curso,
    });
    console.log(
      'Sync de acessos:',
      `novos=${result.created}`,
      `atualizados=${result.updated}`,
      `revogados=${revoked}`,
      `fora=${fora.length}`,
      `mais_de_um_curso=${payload.mais_de_um_curso}`,
      `snapshot=${payload.file_name}`,
    );
    const cert = await completarCertificados(destPool);
    return {
      skippedRun: false,
      snapshot_id: payload.snapshot_id,
      file_name: payload.file_name,
      revoked,
      certificados_completados: cert.completados,
      certificados_pendentes_aviso: cert.pendentes,
      ...result,
    };
  } finally {
    await sourcePool.end();
  }
}

// O que o admin mostra sobre a base: de quando é o relatório, se a conferência está rodando e quem ficou de fora.
function resumoBase(estado, { configurada = true, agora = Date.now(), intervaloMin = intervaloSyncMin() } = {}) {
  const e = estado || {};
  const alertas = [];
  const horas = (d) => (agora - new Date(d).getTime()) / 3600000;
  if (!configurada) alertas.push({ tipo: 'aviso', texto: 'O relatório de matriculados não está configurado: nenhuma conta nova é criada automaticamente.' });
  if (e.ultimo_erro) alertas.push({ tipo: 'erro', texto: e.ultimo_erro, em: e.ultimo_erro_em });
  if (configurada && e.snapshot_at && horas(e.snapshot_at) > RELATORIO_ANTIGO_H) {
    alertas.push({ tipo: 'aviso', texto: `O último relatório tem mais de ${RELATORIO_ANTIGO_H} horas. Matrículas novas só viram conta quando chegar um relatório novo.` });
  }
  if (configurada && e.verificado_em && horas(e.verificado_em) * 60 > intervaloMin * 3) {
    alertas.push({ tipo: 'aviso', texto: `A conferência automática deveria rodar a cada ${intervaloMin} min, mas está parada desde o horário acima.` });
  }
  const lista = Array.isArray(e.fora) ? e.fora : [];
  return {
    configurada,
    relatorio: e.snapshot_at ? { arquivo: e.file_name || null, em: e.snapshot_at, linhas: e.row_count } : null,
    aplicado_em: e.snapshot_at ? e.synced_at : null,
    verificado_em: e.verificado_em || null,
    ultima_carga: e.snapshot_at ? { novos: e.created_count || 0, atualizados: e.updated_count || 0, revogados: e.revoked_count || 0 } : null,
    em_curso: e.em_curso_count == null ? null : e.em_curso_count,
    fora_total: e.fora_count == null ? null : e.fora_count,
    mais_de_um_curso: e.mais_de_um_curso_count == null ? null : e.mais_de_um_curso_count,
    fora: lista.map((x) => ({ ...x, motivo_rotulo: MOTIVOS_FORA[x.motivo] || x.motivo })),
    alertas,
  };
}

module.exports = {
  completarCertificados,
  intervaloSyncMin,
  resumoBase,
  loadLatestEmCurso,
  applyAcessos,
  syncFromMatriculados,
};
