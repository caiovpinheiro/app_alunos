'use strict';

const { UNIDADES } = require('./unidades');

const STATUS = ['novo', 'contatado', 'convertido', 'descartado'];

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function defaultAcademic() {
  return digits(process.env.WHATSAPP_ACADEMICO_PADRAO || '915184535');
}

function defaultCommercial() {
  return digits(process.env.WHATSAPP_COMERCIAL_PADRAO || '917479873');
}

function toWaNumber(phone) {
  let d = digits(phone);
  if (!d) return '';
  if (!d.startsWith('55')) d = `55${d}`;
  return d;
}

function waLink(phone, text) {
  const n = toWaNumber(phone);
  if (!n) return '';
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

function pickPhone(rowValue, fallback) {
  const d = digits(rowValue);
  return d || fallback;
}

async function getAlunoPerfil(pool, alunoId) {
  const aluno = await pool.query(
    `SELECT id, email, rgm, nome FROM csu_alunos WHERE id = $1 LIMIT 1`,
    [alunoId],
  );
  const row = aluno.rows[0];
  if (!row) return null;
  const cert = await pool.query(
    `SELECT curso, unidade
     FROM csu_certificados
     WHERE aluno_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [alunoId],
  );
  const last = cert.rows[0];
  return {
    id: row.id,
    email: row.email,
    rgm: row.rgm,
    nome: row.nome,
    curso: last ? String(last.curso || '').trim() || null : null,
    polo: last ? String(last.unidade || '').trim() || null : null,
  };
}

async function resolvePhones(pool, polo) {
  let row = null;
  if (polo) {
    const result = await pool.query(
      `SELECT polo, whatsapp_academico, whatsapp_comercial
       FROM csu_contatos_polo
       WHERE lower(polo) = lower($1)
       LIMIT 1`,
      [polo],
    );
    row = result.rows[0] || null;
  }
  return {
    academico: pickPhone(row && row.whatsapp_academico, defaultAcademic()),
    comercial: pickPhone(row && row.whatsapp_comercial, defaultCommercial()),
  };
}

async function getAtendimento(pool, alunoId) {
  const perfil = await getAlunoPerfil(pool, alunoId);
  if (!perfil) return null;
  const poloLabel = perfil.polo || 'não informado';
  const phones = await resolvePhones(pool, perfil.polo);
  const academica = `Olá! Sou ${perfil.nome}, RGM ${perfil.rgm}, aluno(a) do polo ${poloLabel}. Preciso de ajuda acadêmica.`;
  const comercial = `Olá! Sou ${perfil.nome}, RGM ${perfil.rgm}, aluno(a) do polo ${poloLabel}. Gostaria de falar com o comercial.`;
  return {
    nome: perfil.nome,
    rgm: perfil.rgm,
    polo: perfil.polo,
    curso: perfil.curso,
    academico: {
      telefone: phones.academico,
      url: waLink(phones.academico, academica),
    },
    comercial: {
      telefone: phones.comercial,
      url: waLink(phones.comercial, comercial),
    },
  };
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function validateIndicacao(body) {
  const errors = {};
  const nome = normalizeText(body.nome);
  const whatsapp = digits(body.whatsapp);
  const email = normalizeText(body.email).toLowerCase();
  const curso = normalizeText(body.curso_interesse);
  const observacao = normalizeText(body.observacao);

  if (!nome) errors.nome = 'Nome é obrigatório.';
  if (whatsapp.length < 8) errors.whatsapp = 'Informe um WhatsApp válido.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'E-mail inválido.';
  if (observacao.length > 500) errors.observacao = 'Observação muito longa.';

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    sanitized: {
      nome,
      whatsapp,
      email: email || null,
      curso_interesse: curso || null,
      observacao: observacao || null,
    },
  };
}

async function createIndicacao(pool, alunoId, data) {
  const perfil = await getAlunoPerfil(pool, alunoId);
  if (!perfil) return null;
  const result = await pool.query(
    `INSERT INTO csu_indicacoes
      (aluno_id, indicador_nome, indicador_rgm, indicador_email, indicador_polo,
       indicado_nome, indicado_whatsapp, indicado_email, curso_interesse, observacao, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'novo')
     RETURNING *`,
    [
      perfil.id,
      perfil.nome,
      perfil.rgm,
      perfil.email,
      perfil.polo,
      data.nome,
      data.whatsapp,
      data.email,
      data.curso_interesse,
      data.observacao,
    ],
  );
  return result.rows[0];
}

async function notifyWebhook(row) {
  const url = String(process.env.INDICACAO_WEBHOOK_URL || '').trim();
  if (!url) return { sent: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: row.id,
        created_at: row.created_at,
        indicador: {
          nome: row.indicador_nome,
          rgm: row.indicador_rgm,
          email: row.indicador_email,
          polo: row.indicador_polo,
        },
        indicado: {
          nome: row.indicado_nome,
          whatsapp: row.indicado_whatsapp,
          email: row.indicado_email,
          curso_interesse: row.curso_interesse,
          observacao: row.observacao,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { sent: true };
  } catch (err) {
    console.error('Webhook de indicação falhou:', err.message);
    return { sent: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function markWebhook(pool, id, ok) {
  await pool.query(
    `UPDATE csu_indicacoes SET webhook_enviado = $2 WHERE id = $1`,
    [id, ok],
  );
}

async function listIndicacoes(pool, { q = '', status = '' } = {}) {
  const params = [];
  const where = [];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(
      lower(indicado_nome) LIKE $${params.length}
      OR indicado_whatsapp LIKE $${params.length}
      OR lower(coalesce(indicado_email,'')) LIKE $${params.length}
      OR lower(indicador_nome) LIKE $${params.length}
      OR indicador_rgm LIKE $${params.length}
    )`);
  }
  if (status && STATUS.includes(status)) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  const sql = `
    SELECT * FROM csu_indicacoes
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC, id DESC
    LIMIT 200`;
  const result = await pool.query(sql, params);
  return result.rows;
}

async function getIndicacao(pool, id) {
  const result = await pool.query('SELECT * FROM csu_indicacoes WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] || null;
}

async function setIndicacaoStatus(pool, id, status) {
  if (!STATUS.includes(status)) return null;
  const result = await pool.query(
    `UPDATE csu_indicacoes SET status = $2 WHERE id = $1 RETURNING *`,
    [id, status],
  );
  return result.rows[0] || null;
}

async function listContatos(pool) {
  const result = await pool.query(
    `SELECT polo, whatsapp_academico, whatsapp_comercial FROM csu_contatos_polo`,
  );
  const byPolo = new Map(result.rows.map((row) => [String(row.polo).toLowerCase(), row]));
  return UNIDADES.map((polo) => {
    const row = byPolo.get(polo.toLowerCase());
    return {
      polo,
      whatsapp_academico: row ? digits(row.whatsapp_academico) : '',
      whatsapp_comercial: row ? digits(row.whatsapp_comercial) : '',
      academico_efetivo: pickPhone(row && row.whatsapp_academico, defaultAcademic()),
      comercial_efetivo: pickPhone(row && row.whatsapp_comercial, defaultCommercial()),
    };
  });
}

async function upsertContato(pool, polo, academico, comercial) {
  if (!UNIDADES.includes(polo)) return null;
  const result = await pool.query(
    `INSERT INTO csu_contatos_polo (polo, whatsapp_academico, whatsapp_comercial)
     VALUES ($1, $2, $3)
     ON CONFLICT (polo) DO UPDATE SET
       whatsapp_academico = EXCLUDED.whatsapp_academico,
       whatsapp_comercial = EXCLUDED.whatsapp_comercial
     RETURNING polo, whatsapp_academico, whatsapp_comercial`,
    [polo, digits(academico) || null, digits(comercial) || null],
  );
  return result.rows[0];
}

module.exports = {
  STATUS,
  getAtendimento,
  validateIndicacao,
  createIndicacao,
  notifyWebhook,
  markWebhook,
  listIndicacoes,
  getIndicacao,
  setIndicacaoStatus,
  listContatos,
  upsertContato,
};
