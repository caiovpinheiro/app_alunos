'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

function normalizeEmail(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function seedAdminIfEmpty(pool) {
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM csu_admins');
  if (count.rows[0].n > 0) return false;

  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = String(process.env.ADMIN_PASSWORD || '');
  const nome = String(process.env.ADMIN_NOME || 'Administrador').trim() || 'Administrador';
  if (!email || password.length < 6) {
    console.warn('Nenhum admin criado: defina ADMIN_EMAIL e ADMIN_PASSWORD (mín. 6) no Environment.');
    return false;
  }
  const pwHash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO csu_admins (email, nome, pw_hash) VALUES ($1, $2, $3)`,
    [email, nome, pwHash],
  );
  console.log('Administrador inicial criado em csu_admins (ADMIN_*).');
  return true;
}

async function findAdminByEmail(pool, email) {
  const result = await pool.query(
    `SELECT id, email, nome, pw_hash, ativo FROM csu_admins WHERE lower(email) = $1 LIMIT 1`,
    [normalizeEmail(email)],
  );
  return result.rows[0] || null;
}

async function createAdminSession(pool, adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + db.TOKEN_TTL_MS);
  await pool.query(
    'INSERT INTO csu_admin_sessoes (token, admin_id, expires_at) VALUES ($1, $2, $3)',
    [token, adminId, expiresAt],
  );
  return token;
}

async function getSessionAdmin(pool, token) {
  if (!token) return null;
  const result = await pool.query(
    `SELECT a.id, a.email, a.nome, a.ativo, s.expires_at
     FROM csu_admin_sessoes s
     JOIN csu_admins a ON a.id = s.admin_id
     WHERE s.token = $1
     LIMIT 1`,
    [token],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (!row.ativo || new Date(row.expires_at).getTime() <= Date.now()) {
    await pool.query('DELETE FROM csu_admin_sessoes WHERE token = $1', [token]);
    return null;
  }
  return { id: row.id, email: row.email, nome: row.nome };
}

async function deleteAdminSession(pool, token) {
  await pool.query('DELETE FROM csu_admin_sessoes WHERE token = $1', [token]);
}

function adminMiddleware(pool) {
  return async function requireAdmin(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    try {
      const admin = await getSessionAdmin(pool, token);
      if (!admin) {
        return res.status(401).json({ success: false, message: 'Sessão administrativa inválida ou expirada.' });
      }
      req.admin = admin;
      req.adminToken = token;
      return next();
    } catch (err) {
      console.error('Falha ao validar admin:', err.message);
      return res.status(500).json({ success: false, message: 'Erro interno.' });
    }
  };
}

module.exports = {
  seedAdminIfEmpty,
  findAdminByEmail,
  createAdminSession,
  getSessionAdmin,
  deleteAdminSession,
  adminMiddleware,
};
