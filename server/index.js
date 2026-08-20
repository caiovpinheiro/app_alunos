require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const db = require('./db');
const cursos = require('./cursos');
const matriculados = require('./matriculados');
const syncAcessos = require('./sync-acessos');

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

let matriculadosPool = null;
function getMatriculadosPool() {
  if (!matriculados.isConfigured()) return null;
  if (!matriculadosPool) {
    try {
      matriculadosPool = matriculados.createPool();
    } catch (err) {
      console.error(err.message);
      return null;
    }
  }
  return matriculadosPool;
}

app.post('/api/admin/sync-acessos', express.json({ limit: '8mb' }), async (req, res) => {
  const secret = process.env.IMPORT_SECRET;
  if (!secret || req.get('x-import-secret') !== secret) {
    return res.status(404).json({ success: false, message: 'Recurso não encontrado.' });
  }
  if (!pool) {
    return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
  }

  const alunos = req.body?.alunos;
  if (!Array.isArray(alunos) || alunos.length === 0) {
    return res.status(422).json({ success: false, message: 'Lista de alunos vazia.' });
  }
  if (alunos.length > 60000) {
    return res.status(413).json({ success: false, message: 'Lista grande demais.' });
  }

  try {
    await db.ensureSchema(pool);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const raw of alunos) {
      const nome = normalizeSpaces(raw?.nome);
      const email = normalizeSpaces(raw?.email).toLowerCase();
      const rgm = String(raw?.rgm ?? '').replace(/\D+/g, '');
      if (!nome || !email || !rgm) {
        skipped += 1;
        continue;
      }
      try {
        const row = await db.upsertAcessoDerived(pool, { nome, email, rgm });
        if (row.created) created += 1;
        else updated += 1;
      } catch (err) {
        skipped += 1;
        console.error('Falha ao upsert acesso:', rgm, err.code || err.message);
      }
    }
    return res.json({ success: true, created, updated, skipped, total: alunos.length });
  } catch (err) {
    console.error('Falha no sync de acessos:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível importar os acessos.' });
  }
});

app.post('/api/admin/sync-from-matriculados', async (req, res) => {
  const secret = process.env.IMPORT_SECRET;
  if (!secret || req.get('x-import-secret') !== secret) {
    return res.status(404).json({ success: false, message: 'Recurso não encontrado.' });
  }
  if (!pool) {
    return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
  }
  try {
    const force = req.query.force === '1' || req.body?.force === true;
    const result = await syncAcessos.syncFromMatriculados(pool, { force });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('Falha no sync automático de matriculados:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.use(express.json({ limit: '20kb' }));

app.get('/health', async (req, res) => {
  const body = { ok: true, database: null };
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
    const aluno = await db.findAlunoByIdentifier(pool, identifier);
    if (!aluno || !aluno.ativo) {
      return res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
    }

    const derived = matriculados.derivedPassword(aluno.nome);
    const derivedOk = matriculados.passwordMatches(derived, password);
    const hashOk = await db.verifyPassword(aluno, password);
    if (!derivedOk && !hashOk) {
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
  try {
    await db.ensureSchema(pool);
    const aluno = await db.getAlunoForCertificate(pool, req.aluno.id);
    if (!aluno || !aluno.ativo) {
      return res.status(401).json({ success: false, message: 'Sessão inválida ou expirada.' });
    }

    let curso = normalizeSpaces(aluno.curso);
    let unidade = normalizeSpaces(aluno.unidade);
    const sourcePool = getMatriculadosPool();
    if (sourcePool) {
      try {
        const matriculado = await matriculados.findByIdentifier(sourcePool, aluno.rgm || aluno.email);
        if (matriculado) {
          curso = normalizeSpaces(matriculado.curso) || curso;
          unidade = normalizeSpaces(matriculado.unidade) || unidade;
          if (curso && unidade) {
            await db.upsertAcessoDerived(pool, {
              email: aluno.email,
              rgm: aluno.rgm,
              nome: aluno.nome,
              curso,
              unidade,
            });
          }
        }
      } catch (lookupErr) {
        console.error('Falha ao buscar matrícula para certificado:', lookupErr.message);
      }
    }

    if (!curso || !unidade) {
      return res.status(422).json({
        success: false,
        message: 'Não encontramos curso e unidade da sua matrícula para emitir o certificado.',
      });
    }

    const createdAt = nowInSaoPaulo();
    const dataAula = createdAt.slice(0, 10);
    const certificateId = `CSU-${createdAt.slice(0, 4)}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    await db.insertCertificate(pool, aluno.id, {
      certificate_id: certificateId,
      created_at: createdAt,
      email: aluno.email,
      nome: aluno.nome,
      rgm: aluno.rgm,
      data_aula_inaugural: dataAula,
      curso,
      unidade,
    });

    return res.json({
      success: true,
      certificate_id: certificateId,
      created_at: createdAt,
      nome: aluno.nome,
      email: aluno.email,
      rgm: aluno.rgm,
      curso,
      unidade,
      data_aula_inaugural: dataAula,
    });
  } catch (err) {
    console.error('Falha ao registrar emissão:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível gerar o certificado.' });
  }
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

  startAcessosSyncScheduler();
}

let acessosSyncRunning = false;

async function runAcessosSync(reason) {
  if (!pool || !matriculados.isConfigured() || acessosSyncRunning) return;
  acessosSyncRunning = true;
  try {
    console.log('Iniciando sync de acessos:', reason);
    const result = await syncAcessos.syncFromMatriculados(pool, { force: false });
    if (result.skippedRun) {
      console.log('Sync de acessos: snapshot já aplicado', result.snapshot_id);
    }
  } catch (err) {
    console.error('Sync automático de acessos falhou:', err.message);
  } finally {
    acessosSyncRunning = false;
  }
}

function startAcessosSyncScheduler() {
  if (!matriculados.isConfigured()) {
    console.log('Sync automático de acessos desligado: defina MATRICULADOS_HOST e MATRICULADOS_DATABASE.');
    return;
  }
  const minutes = Number(process.env.ACESSOS_SYNC_INTERVAL_MIN || 30);
  const delayMs = Math.max(5, minutes) * 60 * 1000;
  setTimeout(() => runAcessosSync('boot'), 15000);
  setInterval(() => runAcessosSync('intervalo'), delayMs);
  console.log(`Sync automático de acessos a cada ${Math.max(5, minutes)} min (novos do relatório de matriculados).`);
}

start().catch((err) => {
  console.error('Não foi possível iniciar o servidor:', err.message);
  process.exit(1);
});
