'use strict';

// Certificado da Aula Inaugural: sai no mesmo dia em que o aluno conclui.
//
// - Basta ter RGM e a Aula concluída (a regra dos módulos é de quem chama, via `exigirAula`).
//   Curso e polo entram se já existirem; senão ficam NULL e são completados depois.
// - Fontes de curso e polo, nesta ordem: relatório de matriculados (consulta na hora), a conta
//   (`csu_alunos`, que o sync preenche) e o que o polo subiu no admin (`csu_dados_acesso`, no mesmo dia).
// - Um certificado por aluno: "baixar de novo" reaproveita o registro mais antigo, com o mesmo
//   `certificate_id`, e só completa o que faltava. Linhas repetidas de antes continuam no banco.
// - A data impressa é a da conclusão da Aula (último módulo concluído), não a do clique.
// - `completarPendentes` roda no fim do sync de matriculados; `pendentesDeAviso` lista quem teve erro
//   ao emitir e ainda não tem certificado, para o atendimento avisar.

const crypto = require('node:crypto');
const db = require('./db');
const matriculados = require('./matriculados');
const dadosAcesso = require('./dadosAcesso');

const MSG_SEM_POLO = 'Seu certificado saiu sem o nome do polo por enquanto. Ele é completado automaticamente em até 1 dia útil: baixe de novo depois.';
const MSG_SEM_RGM = 'Você concluiu a Aula Inaugural! O certificado sai assim que o seu RGM chegar: o polo já está providenciando. Seu progresso fica salvo.';

function partesSP(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date || new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { data: `${get('year')}-${get('month')}-${get('day')}`, hora: `${get('hour')}:${get('minute')}:${get('second')}` };
}

function agoraSP(date) {
  const p = partesSP(date);
  return `${p.data}T${p.hora}-03:00`;
}

function limpo(v) {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t || null;
}

function novoId(agora) {
  return `CSU-${agora.slice(0, 4)}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// Curso e polo para o certificado. `buscarMatricula(aluno)` consulta o relatório (pode faltar no local).
async function cursoEPolo(pool, aluno, { buscarMatricula } = {}) {
  let curso = limpo(matriculados.formatCurso(aluno.curso));
  let unidade = limpo(matriculados.formatPolo(aluno.unidade));

  if (buscarMatricula) {
    try {
      const m = await buscarMatricula(aluno);
      if (m && (m.curso || m.unidade)) {
        curso = limpo(m.curso) || curso;
        unidade = limpo(m.unidade) || unidade;
        await db.upsertAcessoDerived(pool, { email: aluno.email, rgm: aluno.rgm, nome: aluno.nome, curso: limpo(m.curso), unidade: limpo(m.unidade) });
      }
    } catch (err) {
      console.error('Falha ao buscar matrícula para certificado:', err.message);
    }
  }

  if (!curso || !unidade) {
    try {
      const d = await dadosAcesso.doRgm(pool, aluno.rgm);
      if (d && ((!curso && d.curso) || (!unidade && d.unidade))) {
        curso = curso || limpo(d.curso);
        unidade = unidade || limpo(d.unidade);
        // A conta passa a ter o que o polo informou; o relatório, quando chegar, prevalece (upsertAcessoDerived).
        await pool.query(
          `UPDATE csu_alunos SET curso = COALESCE(NULLIF(btrim(curso), ''), $2), unidade = COALESCE(NULLIF(btrim(unidade), ''), $3)
           WHERE id = $1`,
          [aluno.id, curso, unidade],
        );
      }
    } catch (err) {
      console.error('Falha ao ler dados de acesso para certificado:', err.message);
    }
  }
  return { curso, unidade };
}

// Dia (em Brasília) em que o aluno concluiu o último dos `total` módulos; null se ainda não concluiu todos.
async function dataConclusao(pool, alunoId, total) {
  if (!total) return null;
  try {
    const r = await pool.query(
      `SELECT to_char(max(concluido_em) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia,
              count(concluido_em)::int AS n
       FROM csu_trilha_progresso WHERE aluno_id = $1`,
      [alunoId],
    );
    const row = r.rows[0];
    return row && row.n >= total ? row.dia : null;
  } catch (err) {
    return null; // sem a tabela da Aula: vale a data da emissão
  }
}

const COLUNAS = `id, certificate_id, aluno_id, email, nome, rgm, curso, unidade,
  to_char(data_aula_inaugural, 'YYYY-MM-DD') AS data_aula_inaugural, created_at, completado_em, baixado_em`;

async function certificadoDoAluno(q, alunoId) {
  const r = await q.query(
    `SELECT ${COLUNAS} FROM csu_certificados WHERE aluno_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1`,
    [alunoId],
  );
  return r.rows[0] || null;
}

// Grava (ou reaproveita) o certificado do aluno. Bloqueia a linha do aluno: dois cliques seguidos
// não criam dois certificados. `baixado: false` é a emissão automática: o aluno ainda não baixou.
async function gravar(pool, aluno, { curso, unidade, dataAula, agora, baixado = true }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM csu_alunos WHERE id = $1 FOR UPDATE', [aluno.id]);
    const atual = await certificadoDoAluno(client, aluno.id);
    let row;
    if (atual) {
      const r = await client.query(
        `UPDATE csu_certificados SET
           curso = COALESCE(curso, $2),
           unidade = COALESCE(unidade, $3),
           completado_em = CASE WHEN unidade IS NULL AND $3::text IS NOT NULL THEN now() ELSE completado_em END,
           baixado_em = CASE WHEN $4::boolean THEN now() ELSE baixado_em END
         WHERE id = $1
         RETURNING ${COLUNAS}`,
        [atual.id, curso, unidade, baixado],
      );
      row = { ...r.rows[0], reaproveitado: true };
    } else {
      const r = await client.query(
        `INSERT INTO csu_certificados
           (certificate_id, aluno_id, email, nome, rgm, data_aula_inaugural, curso, unidade, created_at, baixado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $10::boolean THEN now() END)
         RETURNING ${COLUNAS}`,
        [novoId(agora), aluno.id, aluno.email, aluno.nome, aluno.rgm, dataAula, curso, unidade, agora, baixado],
      );
      row = { ...r.rows[0], reaproveitado: false };
    }
    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Emite (ou baixa de novo) o certificado do aluno. Devolve { status, body } para a rota.
 * deps: {
 *   buscarMatricula?: async (aluno) => ({curso, unidade}) | null,
 *   exigirAula?: async (alunoId) => null | {status, body}   // regra dos módulos; só vale para a 1ª emissão
 *   totalModulos?: number                                    // para a data de conclusão
 *   agora?: Date
 *   semDownload?: boolean                                    // emissão automática: não marca baixado_em
 * }
 */
async function emitir(pool, alunoId, deps = {}) {
  const aluno = await db.getAlunoForCertificate(pool, alunoId);
  if (!aluno || !aluno.ativo) {
    return { status: 401, body: { success: false, message: 'Sessão inválida ou expirada.' } };
  }
  const existente = await certificadoDoAluno(pool, aluno.id);

  if (!existente && deps.exigirAula) {
    const bloqueio = await deps.exigirAula(aluno.id);
    if (bloqueio) return bloqueio;
  }

  // O certificado leva o RGM: sem ele (acesso em preparação), espera. O progresso fica salvo.
  if (!aluno.rgm) {
    return { status: 422, body: { success: false, codigo: 'sem_rgm', message: MSG_SEM_RGM } };
  }

  const precisa = !existente || !existente.curso || !existente.unidade;
  const { curso, unidade } = precisa ? await cursoEPolo(pool, aluno, deps) : { curso: existente.curso, unidade: existente.unidade };
  const agora = agoraSP(deps.agora);
  const dataAula = existente ? existente.data_aula_inaugural
    : (await dataConclusao(pool, aluno.id, deps.totalModulos)) || agora.slice(0, 10);

  const cert = await gravar(pool, aluno, { curso, unidade, dataAula, agora, baixado: !deps.semDownload });
  const semPolo = !cert.unidade;
  return {
    status: 200,
    body: {
      success: true,
      certificate_id: cert.certificate_id,
      created_at: agoraSP(new Date(cert.created_at)),
      nome: cert.nome,
      email: cert.email,
      rgm: cert.rgm,
      curso: cert.curso,
      unidade: cert.unidade,
      data_aula_inaugural: cert.data_aula_inaugural,
      reaproveitado: cert.reaproveitado,
      polo_pendente: semPolo,
      aviso: semPolo ? MSG_SEM_POLO : null,
    },
  };
}

// Estado do certificado para o Início e a Aula (GET /api/trilha/resumo).
// sem_polo: saiu sem o polo; polo_completado: o polo chegou depois do último download.
async function estado(pool, alunoId) {
  try {
    const c = await certificadoDoAluno(pool, alunoId);
    if (!c) return { emitido: false, emitido_em: null, sem_polo: false, polo_completado: false };
    const completado = Boolean(c.completado_em && (!c.baixado_em || new Date(c.baixado_em) < new Date(c.completado_em)));
    return { emitido: true, emitido_em: c.created_at, sem_polo: !c.unidade, polo_completado: completado };
  } catch (err) {
    return { emitido: false, emitido_em: null, sem_polo: false, polo_completado: false };
  }
}

// Completa curso e polo dos certificados que saíram sem eles, a partir da conta (que o sync acabou
// de atualizar) e do que o polo subiu no admin. Devolve quantos certificados mudaram.
async function completarPendentes(pool) {
  await dadosAcesso.ensureSchema(pool);
  const r = await pool.query(`
    WITH alvo AS (
      SELECT c.id,
             COALESCE(NULLIF(btrim(a.curso), ''), NULLIF(btrim(d.curso), '')) AS curso,
             COALESCE(NULLIF(btrim(a.unidade), ''), NULLIF(btrim(d.unidade), '')) AS unidade
      FROM csu_certificados c
      JOIN csu_alunos a ON a.id = c.aluno_id
      LEFT JOIN csu_dados_acesso d ON d.rgm = regexp_replace(c.rgm, '\\D', '', 'g')
      WHERE c.curso IS NULL OR c.unidade IS NULL
    )
    UPDATE csu_certificados c SET
      curso = COALESCE(c.curso, alvo.curso),
      unidade = COALESCE(c.unidade, alvo.unidade),
      completado_em = CASE WHEN c.unidade IS NULL AND alvo.unidade IS NOT NULL THEN now() ELSE c.completado_em END
    FROM alvo
    WHERE alvo.id = c.id
      AND ((c.curso IS NULL AND alvo.curso IS NOT NULL) OR (c.unidade IS NULL AND alvo.unidade IS NOT NULL))
    RETURNING c.id
  `);
  return r.rowCount;
}

// Emite sozinho o certificado de quem concluiu a Aula (os `totalModulos` módulos), tem RGM e ainda não tem
// certificado: quem nunca clicou e quem tentou e deu erro antes da correção de 07/11. Roda no fim de cada
// volta do sync (`completarCertificados`). Sem curso e polo o certificado sai com NULL, e `completarPendentes`
// preenche logo em seguida; `baixado_em` fica NULL até o aluno baixar. Registra `certificado_gerado`
// (origem `automatico`) em `csu_eventos`, para o sinal "Erro no certificado" do acompanhamento se apagar.
// Sem a tabela da Aula não há como saber quem concluiu: devolve zeros.
async function emitirPendentes(pool, { totalModulos = 7, buscarMatricula = null, agora } = {}) {
  let alvo;
  try {
    alvo = await pool.query(
      `SELECT a.id
       FROM csu_alunos a
       JOIN (SELECT aluno_id, count(concluido_em)::int AS n FROM csu_trilha_progresso GROUP BY aluno_id) m ON m.aluno_id = a.id
       WHERE a.ativo AND NULLIF(btrim(a.rgm), '') IS NOT NULL AND m.n >= $1
         AND NOT EXISTS (SELECT 1 FROM csu_certificados c WHERE c.aluno_id = a.id)
       ORDER BY a.id`,
      [totalModulos],
    );
  } catch (err) {
    if (err.code === '42P01') return { candidatos: 0, emitidos: 0, falhas: 0 };
    throw err;
  }
  let emitidos = 0;
  let falhas = 0;
  for (const { id } of alvo.rows) {
    try {
      const out = await emitir(pool, id, { totalModulos, buscarMatricula, agora, semDownload: true });
      if (out.status !== 200) { falhas += 1; continue; }
      emitidos += 1;
      await pool.query(
        `INSERT INTO csu_eventos (aluno_id, nome, dados) VALUES ($1, 'certificado_gerado', $2::jsonb)`,
        [id, JSON.stringify({ protocolo: out.body.certificate_id, origem: 'automatico', polo_pendente: out.body.polo_pendente })],
      ).catch(() => {}); // sem rastreio (tabela ausente): o certificado vale do mesmo jeito
    } catch (err) {
      falhas += 1;
      console.error('Certificado automático falhou:', id, err.code || err.message);
    }
  }
  return { candidatos: alvo.rowCount, emitidos, falhas };
}

// Quem tentou emitir, teve erro e ainda não tem certificado, mas já tem curso e polo: o atendimento avisa
// "seu certificado está liberado". Com `concluiram: true`, entra também quem concluiu a Aula e nunca tentou.
async function pendentesDeAviso(pool, { concluiram = false, totalModulos = 7 } = {}) {
  const temEventos = await pool.query(`SELECT to_regclass('csu_eventos') IS NOT NULL AS ok, to_regclass('csu_trilha_progresso') IS NOT NULL AS trilha`);
  const { ok, trilha } = temEventos.rows[0];
  const erros = ok
    ? `(SELECT aluno_id, max(criado_em) AS ultimo_erro, count(*)::int AS erros FROM csu_eventos WHERE nome = 'certificado_erro' GROUP BY aluno_id)`
    : `(SELECT NULL::int AS aluno_id, NULL::timestamptz AS ultimo_erro, 0 AS erros WHERE false)`;
  const modulos = trilha
    ? `(SELECT aluno_id, count(concluido_em)::int AS n, max(concluido_em) AS concluiu_em FROM csu_trilha_progresso GROUP BY aluno_id)`
    : `(SELECT NULL::int AS aluno_id, 0 AS n, NULL::timestamptz AS concluiu_em WHERE false)`;
  const r = await pool.query(
    `SELECT a.id, a.nome, a.rgm, a.email, a.curso, a.unidade AS polo,
            e.ultimo_erro, COALESCE(e.erros, 0) AS erros, COALESCE(m.n, 0) AS modulos, m.concluiu_em,
            CASE WHEN e.aluno_id IS NOT NULL THEN 'erro_ao_emitir' ELSE 'concluiu_sem_emitir' END AS motivo
     FROM csu_alunos a
     LEFT JOIN ${erros} e ON e.aluno_id = a.id
     LEFT JOIN ${modulos} m ON m.aluno_id = a.id
     WHERE a.ativo AND a.rgm IS NOT NULL
       AND NULLIF(btrim(a.curso), '') IS NOT NULL AND NULLIF(btrim(a.unidade), '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM csu_certificados c WHERE c.aluno_id = a.id)
       AND (e.aluno_id IS NOT NULL OR ($1 AND COALESCE(m.n, 0) >= $2))
     ORDER BY (e.aluno_id IS NULL), COALESCE(e.ultimo_erro, m.concluiu_em)`,
    [Boolean(concluiram), totalModulos],
  );
  return r.rows;
}

function paraCsv(linhas) {
  const cols = ['nome', 'rgm', 'email', 'curso', 'polo', 'motivo', 'erros', 'ultimo_erro', 'modulos', 'concluiu_em'];
  const cel = (v) => {
    const t = v instanceof Date ? agoraSP(v) : String(v ?? '');
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [cols.join(';')].concat(linhas.map((l) => cols.map((c) => cel(l[c])).join(';'))).join('\n');
}

module.exports = {
  MSG_SEM_POLO,
  MSG_SEM_RGM,
  agoraSP,
  cursoEPolo,
  dataConclusao,
  emitir,
  estado,
  emitirPendentes,
  completarPendentes,
  pendentesDeAviso,
  paraCsv,
};
