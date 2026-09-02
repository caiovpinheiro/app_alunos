require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const db = require('./db');
const cursos = require('./cursos');
const avisos = require('./avisos');
const tutoriais = require('./tutoriais');
const atendimento = require('./atendimento');
const adminAuth = require('./adminAuth');
const { UNIDADES } = require('./unidades');
const matriculados = require('./matriculados');
const syncAcessos = require('./sync-acessos');
const meuSemestre = require('./meuSemestre');
const planoImagem = require('./planoImagem');
const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 80;

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

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function unavailable(res) {
  return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
}

const requireAdmin = adminAuth.adminMiddleware(pool);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

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

app.get('/api/avisos', authMiddleware, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
  }
  try {
    const list = await avisos.listAvisosForAluno(pool, req.aluno.id);
    const nao_lidas = list.filter((item) => !item.lida).length;
    return res.json({ success: true, avisos: list, nao_lidas });
  } catch (err) {
    console.error('Falha ao listar avisos:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar os avisos.' });
  }
});

app.get('/api/avisos/nao-lidas', authMiddleware, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
  }
  try {
    const count = await avisos.countUnread(pool, req.aluno.id);
    return res.json({ success: true, count });
  } catch (err) {
    console.error('Falha ao contar avisos não lidos:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível contar os avisos.' });
  }
});

app.post('/api/avisos/:id/lida', authMiddleware, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ success: false, message: 'Aviso inválido.' });
  }
  try {
    const ok = await avisos.markRead(pool, req.aluno.id, id);
    if (!ok) {
      return res.status(404).json({ success: false, message: 'Aviso não encontrado.' });
    }
    const count = await avisos.countUnread(pool, req.aluno.id);
    return res.json({ success: true, count });
  } catch (err) {
    console.error('Falha ao marcar aviso como lido:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível marcar o aviso.' });
  }
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

    let curso = matriculados.formatCurso(aluno.curso);
    let unidade = matriculados.formatPolo(aluno.unidade);
    const sourcePool = getMatriculadosPool();
    if (sourcePool) {
      try {
        let matriculado = aluno.rgm
          ? await matriculados.findByIdentifier(sourcePool, aluno.rgm)
          : null;
        if (!matriculado && aluno.email) {
          matriculado = await matriculados.findByIdentifier(sourcePool, aluno.email);
        }
        if (matriculado) {
          curso = matriculado.curso || curso;
          unidade = matriculado.unidade || unidade;
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

app.get('/api/tutoriais', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const list = await tutoriais.listPublic(pool);
    return res.json({ success: true, categorias: tutoriais.CATEGORIAS, tutoriais: list });
  } catch (err) {
    console.error('Falha ao listar tutoriais:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar os tutoriais.' });
  }
});

app.get('/api/tutoriais/:id', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'Tutorial inválido.' });
  try {
    const item = await tutoriais.getPublicById(pool, id);
    if (!item) return res.status(404).json({ success: false, message: 'Tutorial não encontrado.' });
    return res.json({ success: true, tutorial: item });
  } catch (err) {
    console.error('Falha ao abrir tutorial:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível abrir o tutorial.' });
  }
});

app.get('/api/meu-semestre', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const data = await meuSemestre.getMeuSemestre(pool, req.aluno.id);
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error('Falha ao carregar Meu Semestre:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o semestre.' });
  }
});

app.get('/api/meu-semestre/imagem.svg', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  return planoImagem.sendAlunoImage(pool, req.aluno.id, 'svg', res);
});

app.get('/api/meu-semestre/imagem.png', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  return planoImagem.sendAlunoImage(pool, req.aluno.id, 'png', res);
});

app.get('/api/meu-semestre/imagem-url', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  return planoImagem.sendAlunoShareLink(pool, req.aluno.id, req, res);
});

app.get('/p/plano/:file', async (req, res) => {
  if (!pool) return unavailable(res);
  const match = String(req.params.file || '').match(/^([a-f0-9]{64})\.png$/i);
  if (!match) return res.status(404).end();
  return planoImagem.sendSharedImage(pool, match[1].toLowerCase(), res);
});

app.post('/api/admin/planos-imagens/gerar-lote', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const result = await planoImagem.startBatch(pool);
    return res.json({
      success: true,
      message: result.started || result.running
        ? 'Geração em lote iniciada em segundo plano.'
        : 'Nada novo para gerar agora.',
      queued: result.queued,
      total: result.total,
      running: result.running,
    });
  } catch (err) {
    console.error('Falha ao iniciar lote de planos:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível iniciar a geração em lote.' });
  }
});

app.get('/api/admin/planos-imagens/status', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const status = await planoImagem.getStatus(pool);
    return res.json({ success: true, ...status });
  } catch (err) {
    console.error('Falha ao consultar status das imagens:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível consultar o status.' });
  }
});

app.get('/api/atendimento', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const data = await atendimento.getAtendimento(pool, req.aluno.id);
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error('Falha ao carregar atendimento:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o atendimento.' });
  }
});

app.post('/api/indicacoes', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  const { valid, errors, sanitized } = atendimento.validateIndicacao(req.body || {});
  if (!valid) return res.status(422).json({ success: false, message: 'Dados inválidos.', errors });
  try {
    const row = await atendimento.createIndicacao(pool, req.aluno.id, sanitized);
    const hook = await atendimento.notifyWebhook(row);
    await atendimento.markWebhook(pool, row.id, Boolean(hook.sent));
    return res.status(201).json({ success: true, id: row.id });
  } catch (err) {
    console.error('Falha ao registrar indicação:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível registrar a indicação.' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  if (!pool) return unavailable(res);
  const email = normalizeSpaces(req.body?.email);
  const password = String(req.body?.password ?? '');
  if (!email || !password) {
    return res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
  }
  try {
    const admin = await adminAuth.findAdminByEmail(pool, email);
    const ok = await db.verifyPassword(admin, password);
    if (!admin || !ok || !admin.ativo) {
      return res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
    }
    const token = await adminAuth.createAdminSession(pool, admin.id);
    return res.json({ success: true, token, user: { name: admin.nome, email: admin.email } });
  } catch (err) {
    console.error('Falha no login admin:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível entrar.' });
  }
});

app.post('/api/admin/logout', requireAdmin, async (req, res) => {
  try {
    await adminAuth.deleteAdminSession(pool, req.adminToken);
  } catch (err) {
    console.error('Falha no logout admin:', err.message);
  }
  res.json({ success: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ success: true, user: req.admin });
});

app.get('/api/admin/avisos', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    return res.json({ success: true, avisos: await avisos.listAll(pool), unidades: UNIDADES });
  } catch (err) {
    console.error('Falha ao listar avisos (admin):', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível listar os avisos.' });
  }
});

app.post('/api/admin/avisos', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  const { valid, errors, sanitized } = avisos.validateAdminAviso(req.body || {});
  if (!valid) return res.status(422).json({ success: false, message: 'Dados inválidos.', errors });
  try {
    const item = await avisos.create(pool, sanitized);
    return res.status(201).json({ success: true, aviso: item });
  } catch (err) {
    console.error('Falha ao criar aviso:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível criar o aviso.' });
  }
});

app.put('/api/admin/avisos/:id', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'Aviso inválido.' });
  const { valid, errors, sanitized } = avisos.validateAdminAviso(req.body || {});
  if (!valid) return res.status(422).json({ success: false, message: 'Dados inválidos.', errors });
  try {
    const item = await avisos.update(pool, id, sanitized);
    if (!item) return res.status(404).json({ success: false, message: 'Aviso não encontrado.' });
    return res.json({ success: true, aviso: item });
  } catch (err) {
    console.error('Falha ao editar aviso:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível editar o aviso.' });
  }
});

app.post('/api/admin/avisos/:id/toggle', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'Aviso inválido.' });
  try {
    const current = (await avisos.listAll(pool)).find((item) => item.id === id);
    if (!current) return res.status(404).json({ success: false, message: 'Aviso não encontrado.' });
    const item = await avisos.setAtivo(pool, id, !current.ativo);
    return res.json({ success: true, aviso: item });
  } catch (err) {
    console.error('Falha ao alternar aviso:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível atualizar o aviso.' });
  }
});

app.delete('/api/admin/avisos/:id', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'Aviso inválido.' });
  try {
    const ok = await avisos.remove(pool, id);
    if (!ok) return res.status(404).json({ success: false, message: 'Aviso não encontrado.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('Falha ao excluir aviso:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível excluir o aviso.' });
  }
});

app.get('/api/admin/tutoriais', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    return res.json({ success: true, categorias: tutoriais.CATEGORIAS, tutoriais: await tutoriais.listAll(pool) });
  } catch (err) {
    console.error('Falha ao listar tutoriais (admin):', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível listar os tutoriais.' });
  }
});

app.post('/api/admin/tutoriais', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  const { valid, errors, sanitized } = tutoriais.validatePayload(req.body || {});
  if (!valid) return res.status(422).json({ success: false, message: 'Dados inválidos.', errors });
  try {
    const item = await tutoriais.create(pool, sanitized);
    return res.status(201).json({ success: true, tutorial: item });
  } catch (err) {
    console.error('Falha ao criar tutorial:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível criar o tutorial.' });
  }
});

app.put('/api/admin/tutoriais/:id', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'Tutorial inválido.' });
  const { valid, errors, sanitized } = tutoriais.validatePayload(req.body || {});
  if (!valid) return res.status(422).json({ success: false, message: 'Dados inválidos.', errors });
  try {
    const item = await tutoriais.update(pool, id, sanitized);
    if (!item) return res.status(404).json({ success: false, message: 'Tutorial não encontrado.' });
    return res.json({ success: true, tutorial: item });
  } catch (err) {
    console.error('Falha ao editar tutorial:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível editar o tutorial.' });
  }
});

app.post('/api/admin/tutoriais/:id/toggle', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'Tutorial inválido.' });
  try {
    const current = (await tutoriais.listAll(pool)).find((item) => item.id === id);
    if (!current) return res.status(404).json({ success: false, message: 'Tutorial não encontrado.' });
    const item = await tutoriais.setAtivo(pool, id, !current.ativo);
    return res.json({ success: true, tutorial: item });
  } catch (err) {
    console.error('Falha ao alternar tutorial:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível atualizar o tutorial.' });
  }
});

app.delete('/api/admin/tutoriais/:id', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'Tutorial inválido.' });
  try {
    const ok = await tutoriais.remove(pool, id);
    if (!ok) return res.status(404).json({ success: false, message: 'Tutorial não encontrado.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('Falha ao excluir tutorial:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível excluir o tutorial.' });
  }
});

app.get('/api/admin/contatos', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    return res.json({ success: true, contatos: await atendimento.listContatos(pool) });
  } catch (err) {
    console.error('Falha ao listar contatos:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível listar os contatos.' });
  }
});

app.put('/api/admin/contatos', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  const polo = normalizeSpaces(req.body?.polo);
  try {
    const item = await atendimento.upsertContato(pool, polo, req.body?.whatsapp_academico, req.body?.whatsapp_comercial);
    if (!item) return res.status(400).json({ success: false, message: 'Polo inválido.' });
    return res.json({ success: true, contato: item });
  } catch (err) {
    console.error('Falha ao salvar contato:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível salvar o contato.' });
  }
});

app.get('/api/admin/indicacoes', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const list = await atendimento.listIndicacoes(pool, {
      q: normalizeSpaces(req.query.q).slice(0, 80),
      status: normalizeSpaces(req.query.status),
    });
    return res.json({ success: true, indicacoes: list });
  } catch (err) {
    console.error('Falha ao listar indicações:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível listar as indicações.' });
  }
});

app.get('/api/admin/indicacoes/:id', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'Indicação inválida.' });
  try {
    const item = await atendimento.getIndicacao(pool, id);
    if (!item) return res.status(404).json({ success: false, message: 'Indicação não encontrada.' });
    return res.json({ success: true, indicacao: item });
  } catch (err) {
    console.error('Falha ao abrir indicação:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível abrir a indicação.' });
  }
});

app.patch('/api/admin/indicacoes/:id/status', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'Indicação inválida.' });
  try {
    const item = await atendimento.setIndicacaoStatus(pool, id, String(req.body?.status || ''));
    if (!item) return res.status(400).json({ success: false, message: 'Status inválido.' });
    return res.json({ success: true, indicacao: item });
  } catch (err) {
    console.error('Falha ao atualizar status:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível atualizar o status.' });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

const STUDENT_PAGES = [
  '/login',
  '/primeiro-acesso',
  '/inicio',
  '/meu-semestre',
  '/avisos',
  '/tutoriais',
  '/atendimento',
  '/certificado',
  '/sucesso',
];
app.get(STUDENT_PAGES, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

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
    await tutoriais.seedIfEmpty(pool);
    await adminAuth.seedAdminIfEmpty(pool);
  } catch (err) {
    console.error('Banco indisponível no boot:', err.message);
  }

  startAcessosSyncScheduler();
  planoImagem.startAutoSync(pool);
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
