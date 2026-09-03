'use strict';

const DERIVED_PW_MARKER = 'DERIVED';

function materiasSupabaseConfig() {
  const url = process.env.MATERIAS_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.MATERIAS_SUPABASE_KEY || process.env.SUPABASE_KEY;
  const table = process.env.MATERIAS_SUPABASE_TABLE || 'materias_alunos';
  if (!url || !key) throw new Error('MATERIAS_SUPABASE_URL/KEY não configurado.');
  return { url: url.replace(/\/$/, ''), key, table };
}

function parseNome(aluno, rgm) {
  const raw = String(aluno || '').trim();
  const digits = String(rgm || '').replace(/\D/g, '');
  if (!raw) return '';
  const match = raw.match(/^\d+\s*-\s*(.+)$/);
  if (match) return match[1].trim();
  if (digits && raw.replace(/\D/g, '') === digits) return '';
  return raw;
}

function placeholderEmail(rgm) {
  return `rgm.${String(rgm).replace(/\D/g, '')}@materias.portal`;
}

function needsNomeUpdate(nome, rgm) {
  const value = String(nome || '').trim();
  if (!value) return true;
  const digits = String(rgm || '').replace(/\D/g, '');
  if (digits && value.replace(/\D/g, '') === digits) return true;
  return false;
}

async function fetchAllFromSupabase() {
  const { url, key, table } = materiasSupabaseConfig();
  const since = String(process.env.MATERIAS_SINCE || '').trim();
  const rows = [];
  let offset = 0;
  while (true) {
    let endpoint = `${url}/rest/v1/${encodeURIComponent(table)}?select=rgm,aluno,materias,qtd_materias,consultado_em&order=rgm.asc&offset=${offset}&limit=1000`;
    if (since) endpoint += `&consultado_em=gte.${encodeURIComponent(since)}`;
    const res = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase materias_alunos: ${res.status} ${text.slice(0, 200)}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    rows.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return rows;
}

async function ensureAlunoForMaterias(pool, { rgm, nome }) {
  const cleanRgm = String(rgm || '').trim();
  const cleanNome = String(nome || '').trim() || `Aluno ${cleanRgm}`;
  const existing = await pool.query(
    `SELECT id, email, rgm, nome, ativo
     FROM csu_alunos
     WHERE rgm = $1
        OR regexp_replace(rgm, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
     LIMIT 1`,
    [cleanRgm],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (needsNomeUpdate(row.nome, cleanRgm) && cleanNome) {
      await pool.query(`UPDATE csu_alunos SET nome = $2 WHERE id = $1`, [row.id, cleanNome]);
      return { id: row.id, created: false, nomeUpdated: true };
    }
    return { id: row.id, created: false, nomeUpdated: false };
  }

  const email = placeholderEmail(cleanRgm);
  const inserted = await pool.query(
    `INSERT INTO csu_alunos (email, rgm, nome, pw_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [email, cleanRgm, cleanNome, DERIVED_PW_MARKER],
  );
  return { id: inserted.rows[0].id, created: true, nomeUpdated: false };
}

async function syncFromSupabase(pool) {
  const rows = await fetchAllFromSupabase();
  let synced = 0;
  let linked = 0;
  let created = 0;
  let namesUpdated = 0;

  for (const row of rows) {
    const rgm = String(row.rgm || '').trim();
    if (!rgm) continue;
    const materias = Array.isArray(row.materias) ? row.materias : [];
    const alunoNome = parseNome(row.aluno, rgm);
    const alunoInfo = await ensureAlunoForMaterias(pool, { rgm, nome: alunoNome });
    if (alunoInfo.created) created += 1;
    if (alunoInfo.nomeUpdated) namesUpdated += 1;
    if (alunoInfo.id) linked += 1;

    await pool.query(
      `INSERT INTO csu_materias_alunos
        (rgm, aluno_label, aluno_nome, materias, qtd_materias, consultado_em, aluno_id, synced_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, now(), now())
       ON CONFLICT (rgm) DO UPDATE SET
         aluno_label = EXCLUDED.aluno_label,
         aluno_nome = COALESCE(NULLIF(EXCLUDED.aluno_nome, ''), csu_materias_alunos.aluno_nome),
         materias = EXCLUDED.materias,
         qtd_materias = EXCLUDED.qtd_materias,
         consultado_em = EXCLUDED.consultado_em,
         aluno_id = COALESCE(EXCLUDED.aluno_id, csu_materias_alunos.aluno_id),
         synced_at = now(),
         updated_at = now()`,
      [
        rgm,
        String(row.aluno || '').trim() || null,
        alunoNome || null,
        JSON.stringify(materias),
        Number(row.qtd_materias) || materias.length,
        row.consultado_em || null,
        alunoInfo.id,
      ],
    );
    synced += 1;
  }

  return { synced, linked, created, namesUpdated, total: rows.length };
}

module.exports = {
  parseNome,
  fetchAllFromSupabase,
  syncFromSupabase,
  ensureAlunoForMaterias,
};
