require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const db = require('./db');
const cursos = require('./cursos');
const matriculados = require('./matriculados');

const app = express();
const PORT = Number(process.env.PORT) || 80;

const UNIDADES = [
  'Barra Funda',
  'Taboão da Serra - Jd. Mituzi',
  'Taboão da Serra - Centro',
  'Campinas - Jd. Cristina',
  'Itapira',
  'Capivari',
  'Sapopemba (Vila Ema)',
  'Freguesia do Ó',
  'Morumbi',
  'Vila Prudente',
  'Ibirapuera',
  'Santana',
];

const pool = (() => {
  try {
    return db.createPool();
  } catch (err) {
    console.error(err.message);
    return null;
  }
})();

const matriculadosPool = (() => {
  try {
    return matriculados.createPool();
  } catch (err) {
    console.error(err.message);
    return null;
  }
})();

app.use(express.json({ limit: '20kb' }));

app.get('/health', async (req, res) => {
  const body = { ok: true, database: null, matriculados: null };
  if (pool) {
    try {
      const r = await pool.query('SELECT current_database() AS db');
      body.database = r.rows[0].db;
    } catch (err) {
      body.ok = false;
      body.databaseError = err.code || 'fail';
    }
  } else {
    body.ok = false;
  }
  if (matriculadosPool) {
    try {
      const r = await matriculadosPool.query('SELECT current_database() AS db');
      body.matriculados = r.rows[0].db;
    } catch (err) {
      body.matriculadosError = err.code || 'fail';
    }
  }
  res.status(body.ok ? 200 : 503).json(body);
});

function nowInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}-03:00`;
}

function todayInSaoPaulo() {
  return nowInSaoPaulo().slice(0, 10);
}

function normalizeSpaces(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function validateCertificatePayload(body) {
  const errors = {};
  const email = normalizeSpaces(body.email);
  const nome = normalizeSpaces(body.nome);
  const rgm = normalizeSpaces(body.rgm);
  const dataAula = normalizeSpaces(body.data_aula_inaugural);
  const curso = normalizeSpaces(body.curso);
  const unidade = normalizeSpaces(body.unidade);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'E-mail inválido.';
  if (!nome) errors.nome = 'Nome é obrigatório.';
  if (!rgm) errors.rgm = 'RGM é obrigatório.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataAula) || Number.isNaN(Date.parse(`${dataAula}T00:00:00-03:00`))) {
    errors.data_aula_inaugural = 'Data inválida.';
  } else if (dataAula > todayInSaoPaulo()) {
    errors.data_aula_inaugural = 'A data não pode ser futura.';
  }
  if (!curso) errors.curso = 'Selecione um curso da lista.';
  if (!UNIDADES.includes(unidade)) errors.unidade = 'Unidade inválida.';

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    sanitized: { email, nome, rgm, data_aula_inaugural: dataAula, curso, unidade },
  };
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  try {
    const aluno = await db.getSessionAluno(pool, token);
    if (!aluno) {
      return res.status(401).json({ success: false, message: 'Sessão inválida ou expirada.' });
    }
    req.aluno = aluno;
    req.token = token;
    return next();
  } catch (err) {
    console.error('Falha ao validar sessão:', err.message);
    return res.status(500).json({ success: false, message: 'Erro interno.' });
  }
}

app.get('/api/config', (req, res) => {
  res.json({
    certificateApiUrl: process.env.CERTIFICATE_API_URL || '/api/certificates',
  });
});

app.post('/api/auth/login', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
  }

  const identifier = normalizeSpaces(req.body?.identifier);
  const password = String(req.body?.password ?? '');

  if (!identifier || !password) {
    return res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
  }

  try {
    await db.ensureSchema(pool);
  } catch (err) {
    console.error('Falha ao garantir schema no login:', err.code || '', err.message);
    return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
  }

  try {
    let aluno = null;

    if (matriculadosPool) {
      try {
        const matriculado = await matriculados.findByIdentifier(matriculadosPool, identifier);
        if (matriculado) {
          const expected = matriculados.derivedPassword(matriculado.nome);
          if (matriculados.passwordMatches(expected, password)) {
            aluno = await db.upsertAlunoFromMatricula(pool, {
              email: matriculado.email,
              rgm: matriculado.rgm,
              nome: matriculado.nome,
              password,
            });
          }
        }
      } catch (err) {
        console.error('Falha ao consultar matriculados:', err.code || '', err.message);
      }
    }

    if (!aluno) {
      aluno = await db.findAlunoByIdentifier(pool, identifier);
      const ok = await db.verifyPassword(aluno, password);
      if (!aluno || !ok) {
        return res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
      }
    }

    if (!aluno.ativo) {
      return res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    await db.createSession(pool, aluno.id, token);
    return res.json({
      success: true,
      token,
      user: { name: aluno.nome, email: aluno.email, rgm: aluno.rgm },
    });
  } catch (err) {
    console.error('Falha no login:', err.code || '', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível entrar. Tente novamente em instantes.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
  }

  try {
    await db.ensureSchema(pool);
  } catch (err) {
    console.error('Falha ao garantir schema no cadastro:', err.code || '', err.message);
    return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
  }

  const email = normalizeSpaces(req.body?.email);
  const nome = normalizeSpaces(req.body?.nome);
  const rgm = normalizeSpaces(req.body?.rgm);
  const password = String(req.body?.password ?? '');
  const confirm = String(req.body?.confirmPassword ?? '');
  const errors = {};

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Insira um e-mail válido.';
  if (!nome) errors.nome = 'O nome completo é obrigatório.';
  if (!rgm) errors.rgm = 'O RGM é obrigatório.';
  if (password.length < 6) errors.password = 'A senha deve ter no mínimo 6 caracteres.';
  if (password !== confirm) errors.confirmPassword = 'As senhas não coincidem.';

  if (Object.keys(errors).length) {
    return res.status(422).json({ success: false, message: 'Dados inválidos.', errors });
  }

  try {
    const aluno = await db.createAluno(pool, { email, nome, rgm, password });
    const token = crypto.randomBytes(32).toString('hex');
    await db.createSession(pool, aluno.id, token);
    return res.status(201).json({
      success: true,
      token,
      user: { name: aluno.nome, email: aluno.email, rgm: aluno.rgm },
    });
  } catch (err) {
    if (err.code === 'DUPLICATE' || err.code === '23505') {
      const errorsDup = err.field === 'rgm'
        ? { rgm: 'Este RGM já possui cadastro. Use Entrar.' }
        : { email: 'Este e-mail já possui cadastro. Use Entrar.' };
      return res.status(409).json({ success: false, message: 'Aluno já cadastrado.', errors: errorsDup });
    }
    console.error('Falha no primeiro acesso:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível concluir o cadastro. Tente novamente.' });
  }
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  try {
    await db.deleteSession(pool, req.token);
  } catch (err) {
    console.error('Falha no logout:', err.message);
  }
  res.json({ success: true });
});

app.get('/api/cursos', authMiddleware, async (req, res) => {
  const q = normalizeSpaces(req.query.q).slice(0, 80);
  try {
    const names = await cursos.searchCourses(q);
    return res.json({ success: true, cursos: names });
  } catch (err) {
    console.error('Falha ao buscar cursos:', err.message);
    return res.status(502).json({ success: false, message: 'Não foi possível carregar os cursos.' });
  }
});

app.post('/api/certificates', authMiddleware, async (req, res) => {
  const { valid, errors, sanitized } = validateCertificatePayload(req.body || {});
  if (!valid) {
    return res.status(422).json({ success: false, message: 'Dados inválidos.', errors });
  }

  try {
    const known = await cursos.isKnownCourse(sanitized.curso);
    if (!known) {
      return res.status(422).json({
        success: false,
        message: 'Dados inválidos.',
        errors: { curso: 'Selecione um curso da lista.' },
      });
    }
    const catalog = await cursos.loadCourseNames();
    sanitized.curso = cursos.canonicalCourseName(sanitized.curso, catalog);
  } catch (err) {
    console.error('Falha ao validar curso:', err.message);
    return res.status(502).json({ success: false, message: 'Não foi possível validar o curso.' });
  }

  const createdAt = nowInSaoPaulo();
  const certificateId = `CSU-${createdAt.slice(0, 4)}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  try {
    await db.insertCertificate(pool, req.aluno.id, {
      certificate_id: certificateId,
      created_at: createdAt,
      ...sanitized,
    });
  } catch (err) {
    console.error('Falha ao registrar emissão:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível registrar a emissão.' });
  }

  return res.json({ success: true, certificate_id: certificateId, created_at: createdAt });
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'Recurso não encontrado.' });
});

app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err.message);
  res.status(500).json({ success: false, message: 'Erro interno.' });
});

async function start() {
  await new Promise((resolve, reject) => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Portal do Aluno escutando em 0.0.0.0:${PORT}`);
      resolve(server);
    });
    server.on('error', reject);
  });

  if (!pool) {
    console.error('Servidor no ar sem banco: confira DATABASE_* no Environment do EasyPanel.');
    return;
  }

  try {
    await db.ensureSchema(pool);
    await db.seedAlunoIfEmpty(pool);
  } catch (err) {
    console.error('Banco indisponível no boot:', err.message);
  }

  if (!matriculadosPool) {
    console.error('Login de matriculados desligado: confira MATRICULADOS_DATABASE no Environment.');
  }
}

start().catch((err) => {
  console.error('Não foi possível iniciar o servidor:', err.message);
  process.exit(1);
});
