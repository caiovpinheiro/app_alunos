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
const webchat = require('./webchat');
const syncAcessos = require('./sync-acessos');
const meuSemestre = require('./meuSemestre');
const planoImagem = require('./planoImagem');
const planoMateriasImagem = require('./planoMateriasImagem');
const materiasAlunos = require('./materiasAlunos');
const trilha = require('./trilha');
const trilhaAdmin = require('./trilha-admin');
const trilhaRelatorios = require('./trilha-relatorios');
const central = require('./central');
const acompanhamento = require('./acompanhamento');
const avaliacoes = require('./avaliacoes');
const preparo = require('./preparo');
const dadosAcesso = require('./dadosAcesso');
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

function parseMatriculaDateRange(body) {
  let de = normalizeSpaces(body?.de);
  let ate = normalizeSpaces(body?.ate);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!de && !ate) return null;
  if (de && !ate) ate = de;
  if (ate && !de) de = ate;
  if (!iso.test(de) || !iso.test(ate)) {
    const err = new Error('Informe datas válidas no filtro de matrícula.');
    err.status = 422;
    throw err;
  }
  if (de > ate) {
    const err = new Error('A data inicial não pode ser maior que a final.');
    err.status = 422;
    throw err;
  }
  return { de, ate };
}

async function resolveMatriculaFilter(body) {
  const range = parseMatriculaDateRange(body);
  if (!range) return null;
  const source = getMatriculadosPool();
  if (!source) {
    const err = new Error('Relatório de matriculados não configurado. Não dá para filtrar por data de matrícula.');
    err.status = 422;
    throw err;
  }
  const { rgms, alunos } = await matriculados.alunosEnrolledBetween(source, range);
  return { ...range, rgms, alunos };
}

async function resolveStatusFilter(query) {
  if (String(query?.total || '') === '1') return { filter: null, scoped: false };
  const filter = await resolveMatriculaFilter(query);
  return { filter, scoped: Boolean(filter) };
}

function emptyImageStatus(filter, extras) {
  return {
    success: true,
    scoped: true,
    de: filter.de,
    ate: filter.ate,
    matriculados: 0,
    running: false,
    pendentes: 0,
    processando: 0,
    concluidas: 0,
    erros: 0,
    total: 0,
    ...extras,
  };
}

async function ensureFilterAlunos(appPool, filter) {
  if (!filter || !Array.isArray(filter.alunos) || !filter.alunos.length) {
    return { created: 0, updated: 0 };
  }
  await db.ensureSchema(appPool);
  let created = 0;
  let updated = 0;
  for (const aluno of filter.alunos) {
    if (!aluno.rgm || !aluno.nome) continue;
    const email = aluno.email || `rgm.${aluno.rgm}@matricula.portal`;
    try {
      const row = await db.upsertAcessoDerived(appPool, {
        email,
        rgm: aluno.rgm,
        nome: aluno.nome,
        curso: aluno.curso,
        unidade: aluno.unidade,
      });
      if (row.created) created += 1;
      else updated += 1;
    } catch (err) {
      console.error('Falha ao garantir aluno do filtro:', aluno.rgm, err.code || err.message);
    }
  }
  return { created, updated };
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

  // Com a base de matriculados configurada: RGM que está no relatório com matrícula
  // inativa (cancelada, trancada...) não cria acesso. RGM que ainda não está no relatório
  // pode criar (a matrícula de hoje só aparece lá em até 2 dias úteis); curso, polo e
  // certificado ficam para quando o cadastro chegar. Sem a base (local), segue como antes.
  let matriculado = null;
  let cadastroPendente = false;
  const sourcePool = getMatriculadosPool();
  if (sourcePool) {
    try {
      const encontrado = await matriculados.lookupByIdentifier(sourcePool, rgm);
      if (encontrado && encontrado.situacao && encontrado.situacao !== matriculados.SITUACAO_ATIVA) {
        return res.status(422).json({
          success: false,
          message: 'Matrícula inativa.',
          errors: { rgm: `Esse RGM está com a matrícula "${encontrado.situacao.toLowerCase()}". Chame o setor acadêmico para regularizar antes de criar o acesso.` },
        });
      }
      matriculado = encontrado && encontrado.curso && encontrado.unidade ? encontrado : null;
      cadastroPendente = !encontrado;
    } catch (lookupErr) {
      console.error('Falha ao conferir RGM no cadastro:', lookupErr.message);
    }
  }

  try {
    const aluno = await db.createAluno(pool, { email, nome, rgm, password });
    if (matriculado && matriculado.curso && matriculado.unidade) {
      try {
        await db.upsertAcessoDerived(pool, { email, rgm, nome, curso: matriculado.curso, unidade: matriculado.unidade });
      } catch (deriveErr) {
        console.error('Falha ao gravar curso/polo do novo acesso:', deriveErr.message);
      }
    }
    const token = crypto.randomBytes(32).toString('hex');
    await db.createSession(pool, aluno.id, token);
    return res.status(201).json({
      success: true,
      token,
      cadastro_pendente: cadastroPendente,
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
    const names = await cursos.searchCourses(pool, q);
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

    // Aula Inaugural como programa: com a trilha liberada, o certificado de 4 horas exige os
    // 7 módulos concluídos e a meta de pontos. Quem já emitiu antes continua podendo emitir.
    if (trilha.liberadaPara(req.aluno)) {
      const ja = await certificadoEmitido(aluno.id);
      if (!ja.emitido) {
        await ensureTrilha();
        const st = trilha.statusCertificado(await trilha.getProgresso(pool, aluno.id));
        if (!st.liberado) {
          // Cada módulo vale 10 pontos: o que falta em módulos é o que falta em pontos.
          const falta = `${st.faltam_modulos === 1 ? 'Falta 1 módulo' : `Faltam ${st.faltam_modulos} módulos`} (${st.faltam_pontos} pontos)`;
          return res.status(422).json({
            success: false,
            codigo: 'aula_incompleta',
            certificado: st,
            message: `Para emitir o certificado de ${st.horas} horas, conclua os ${st.total} módulos da Aula Inaugural (${st.meta} pontos). ${falta}.`,
          });
        }
      }
    }

    // Acesso em preparação: o certificado leva o RGM, então espera ele chegar (o progresso fica salvo).
    if (!aluno.rgm) {
      return res.status(422).json({
        success: false,
        codigo: 'sem_rgm',
        message: 'Você concluiu a Aula Inaugural! O certificado sai assim que o seu RGM chegar: o polo já está providenciando. Seu progresso fica salvo.',
      });
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
        message: 'Ainda não encontramos o curso e o polo da sua matrícula, então o certificado não pode ser emitido agora. O cadastro costuma ser atualizado em até 1 dia útil: tente de novo amanhã ou chame o acadêmico.',
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
    const comTrilha = trilha.liberadaPara(req.aluno);
    return res.json({ success: true, categorias: tutoriais.CATEGORIAS, tutoriais: comTrilha ? list : trilha.semTrilha(list) });
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

// ---------- Trilha EaD para Iniciantes ----------

// Recursos liberados para o aluno logado (a tela usa para mostrar ou esconder a trilha).
app.get('/api/recursos', authMiddleware, async (req, res) => {
  const chat = webchat.configPara(req.aluno);
  if (chat && pool) {
    // Curso e polo vêm da última emissão/derivação gravada no portal (podem ainda não existir).
    let perfil = null;
    try {
      const r = await pool.query('SELECT curso, unidade FROM csu_alunos WHERE id = $1', [req.aluno.id]);
      perfil = r.rows[0] || null;
    } catch (err) {
      console.error('Falha ao ler curso/polo para o chat:', err.message);
    }
    chat.identity = webchat.identidadePara(req.aluno, { curso: perfil && perfil.curso, polo: perfil && perfil.unidade });
  }
  // preparo: conta sem RGM ("acesso em preparação"); a tela leva à Aula Inaugural.
  res.json({
    success: true,
    trilha: trilha.liberadaPara(req.aluno),
    webchat: chat,
    rastreio: acompanhamento.liberadoPara(req.aluno),
    preparo: !req.aluno.rgm,
  });
});

// Enquanto a trilha estiver em teste, só as contas de TRILHA_LIBERADA_PARA acessam.
app.use('/api/trilha', authMiddleware, (req, res, next) => {
  if (trilha.liberadaPara(req.aluno)) return next();
  return res.status(404).json({ success: false, message: 'Recurso não encontrado.' });
});

let trilhaSchemaReady = null;
function ensureTrilha() {
  if (!trilhaSchemaReady) {
    trilhaSchemaReady = trilha.ensureSchema(pool).catch((err) => {
      trilhaSchemaReady = null;
      throw err;
    });
  }
  return trilhaSchemaReady;
}

async function trilhaWhatsapp(alunoId) {
  try {
    const info = await atendimento.getAtendimento(pool, alunoId);
    return info && info.academico ? info.academico : null;
  } catch (err) {
    return null;
  }
}

app.get('/api/trilha', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    await ensureTrilha();
    const [whatsapp, progresso] = await Promise.all([
      trilhaWhatsapp(req.aluno.id),
      trilha.getProgresso(pool, req.aluno.id),
    ]);
    const conteudo = trilha.publicContent(whatsapp && whatsapp.telefone);
    // Link do polo só quando o número tem DDD; senão, o do setor acadêmico.
    conteudo.whatsapp_url = whatsapp && whatsapp.url && trilha.formatPhone(whatsapp.telefone)
      ? whatsapp.url
      : 'https://wa.me/5511915184535';
    return res.json({ success: true, conteudo, progresso, nome: req.aluno.nome, rgm: req.aluno.rgm });
  } catch (err) {
    console.error('Falha ao carregar trilha:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar a trilha.' });
  }
});

// Central de ajuda: mesma liberação da trilha (contas de TRILHA_LIBERADA_PARA).
app.get('/api/central', authMiddleware, async (req, res) => {
  if (!trilha.liberadaPara(req.aluno)) return res.status(404).json({ success: false, message: 'Recurso não encontrado.' });
  const whatsapp = pool ? await trilhaWhatsapp(req.aluno.id) : null;
  const numero = (whatsapp && trilha.formatPhone(whatsapp.telefone)) || '(11) 91518-4535';
  const conteudo = central.publicContent(numero, (n) => (trilha.NIVEIS[n - 1] ? trilha.NIVEIS[n - 1].t : null));
  conteudo.whatsapp = numero;
  conteudo.whatsapp_url = whatsapp && whatsapp.url && trilha.formatPhone(whatsapp.telefone)
    ? whatsapp.url
    : 'https://wa.me/5511915184535';
  return res.json({ success: true, conteudo });
});

async function trilhaAction(req, res, fn) {
  if (!pool) return unavailable(res);
  const nivel = trilha.nivelValido(req.body?.nivel);
  if (!nivel) return res.status(400).json({ success: false, message: 'Nível inválido.' });
  try {
    await ensureTrilha();
    const out = await fn(nivel);
    if (!out) return res.status(400).json({ success: false, message: 'Dados inválidos.' });
    const progresso = await trilha.getProgresso(pool, req.aluno.id);
    return res.json({ success: true, ...out, pontos: progresso.pontos, concluidos: progresso.concluidos });
  } catch (err) {
    console.error('Falha ao salvar trilha:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível salvar seu progresso.' });
  }
}

// Já emitiu o certificado da Aula Inaugural? (quem emitiu antes da regra de pontos continua valendo)
async function certificadoEmitido(alunoId) {
  try {
    const r = await pool.query('SELECT created_at FROM csu_certificados WHERE aluno_id = $1 ORDER BY created_at ASC LIMIT 1', [alunoId]);
    return { emitido: Boolean(r.rows[0]), emitido_em: r.rows[0] ? r.rows[0].created_at : null };
  } catch (err) {
    return { emitido: false, emitido_em: null };
  }
}

// Mesma fonte, para o painel admin: { [aluno_id]: data da 1ª emissão } de todos os alunos.
async function certificadosEmitidos() {
  try {
    const r = await pool.query('SELECT aluno_id, MIN(created_at) AS emitido_em FROM csu_certificados GROUP BY aluno_id');
    return r.rows.reduce((m, row) => { m[row.aluno_id] = row.emitido_em; return m; }, {});
  } catch (err) {
    return {};
  }
}

app.get('/api/trilha/resumo', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    await ensureTrilha();
    const p = await trilha.getProgresso(pool, req.aluno.id);
    const atual = p.niveis.findIndex((n) => !n.concluido);
    return res.json({
      success: true,
      total: trilha.NIVEIS.length,
      concluidos: p.concluidos,
      feitos: p.niveis.map((n) => n.concluido),
      pontos: p.pontos,
      maximo: trilha.MAX_PONTOS,
      atual: atual === -1 ? null : { nivel: atual + 1, titulo: trilha.NIVEIS[atual].t },
      comecou: p.niveis.some((n) => n.video_ok || n.pulou_video || n.partes_vistas.length || Object.keys(n.respostas).length),
      certificado: { ...trilha.statusCertificado(p), ...(await certificadoEmitido(req.aluno.id)) },
    });
  } catch (err) {
    console.error('Falha no resumo da trilha:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar a trilha.' });
  }
});

app.post('/api/trilha/video', authMiddleware, (req, res) =>
  trilhaAction(req, res, (nivel) => trilha.marcarVideo(pool, req.aluno.id, nivel, req.body?.parte)));

app.post('/api/trilha/pular', authMiddleware, (req, res) =>
  trilhaAction(req, res, (nivel) => trilha.pularVideo(pool, req.aluno.id, nivel)));

app.post('/api/trilha/travei', authMiddleware, (req, res) =>
  trilhaAction(req, res, (nivel) => trilha.marcarTravei(pool, req.aluno.id, nivel, req.body?.parte)));

app.post('/api/trilha/resposta', authMiddleware, (req, res) =>
  trilhaAction(req, res, (nivel) => trilha.responder(pool, req.aluno.id, nivel, req.body?.pergunta, req.body?.opcao)));

app.post('/api/trilha/tarefa', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    await ensureTrilha();
    const ok = await trilha.marcarTarefa(pool, req.aluno.id, String(req.body?.tarefa || ''), Boolean(req.body?.feita));
    if (!ok) return res.status(400).json({ success: false, message: 'Tarefa inválida.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('Falha ao salvar tarefa da trilha:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível salvar a tarefa.' });
  }
});

app.post('/api/trilha/reiniciar', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    await ensureTrilha();
    await trilha.reiniciar(pool, req.aluno.id);
    const progresso = await trilha.getProgresso(pool, req.aluno.id);
    return res.json({ success: true, progresso });
  } catch (err) {
    console.error('Falha ao reiniciar trilha:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível reiniciar a trilha.' });
  }
});

app.get('/api/meu-semestre', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const data = await meuSemestre.getMeuSemestre(pool, req.aluno.id);
    return res.json({ success: true, ...(trilha.liberadaPara(req.aluno) ? data : trilha.semTrilha(data)) });
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
    const filter = await resolveMatriculaFilter(req.body);
    if (filter && filter.rgms.size === 0) {
      return res.json({
        success: true,
        message: `Nenhum aluno EM CURSO matriculado entre ${filter.de} e ${filter.ate}.`,
        queued: 0,
        total: 0,
        running: false,
      });
    }
    const ensured = await ensureFilterAlunos(pool, filter);
    const result = await planoImagem.startBatch(pool, filter);
    const periodo = filter
      ? ` (${filter.rgms.size} matriculados de ${filter.de} a ${filter.ate}; ${ensured.created} novos no portal)`
      : '';
    return res.json({
      success: true,
      message: result.started || result.running
        ? `Geração em lote iniciada em segundo plano.${periodo}`
        : 'Nada novo para gerar agora.',
      queued: result.queued,
      total: result.total,
      matched: filter ? filter.rgms.size : null,
      running: result.running,
    });
  } catch (err) {
    console.error('Falha ao iniciar lote de planos:', err.message);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: status === 422 ? err.message : 'Não foi possível iniciar a geração em lote.',
    });
  }
});

app.get('/api/admin/imagens/previsualizar', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const filter = await resolveMatriculaFilter(req.query);
    if (filter && filter.rgms.size === 0) {
      return res.json({
        success: true,
        de: filter.de,
        ate: filter.ate,
        matriculados: 0,
        planos: { pessoas: 0, com_plano: 0, ja_tem: 0, gerar: 0 },
        materias: { pessoas: 0, ja_tem: 0, gerar: 0 },
      });
    }
    const [planos, materias] = await Promise.all([
      planoImagem.previewBatch(pool, filter),
      planoMateriasImagem.previewBatch(pool, filter),
    ]);
    return res.json({
      success: true,
      de: filter ? filter.de : null,
      ate: filter ? filter.ate : null,
      matriculados: filter ? filter.rgms.size : null,
      planos,
      materias,
    });
  } catch (err) {
    console.error('Falha ao pré-visualizar imagens:', err.message);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: status === 422 ? err.message : 'Não foi possível contar os alunos do filtro.',
    });
  }
});

app.get('/api/admin/planos-imagens/status', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const { filter, scoped } = await resolveStatusFilter(req.query);
    if (filter && filter.rgms.size === 0) return res.json(emptyImageStatus(filter));
    const status = await planoImagem.getStatus(pool, filter);
    return res.json({
      success: true,
      scoped,
      de: filter ? filter.de : null,
      ate: filter ? filter.ate : null,
      matriculados: filter ? filter.rgms.size : null,
      ...status,
    });
  } catch (err) {
    console.error('Falha ao consultar status das imagens:', err.message);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: status === 422 ? err.message : 'Não foi possível consultar o status.',
    });
  }
});

app.post('/api/admin/materias-imagens/sync', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    await db.ensureSchema(pool);
    const result = await materiasAlunos.syncFromPostgres(pool);
    return res.json({
      success: true,
      message: `Sincronizados ${result.synced} alunos de materias_alunos (Postgres).`,
      ...result,
    });
  } catch (err) {
    console.error('Falha ao sincronizar matérias:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Não foi possível sincronizar as matérias.' });
  }
});

app.post('/api/admin/materias-imagens/gerar-lote', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const filter = await resolveMatriculaFilter(req.body);
    if (filter && filter.rgms.size === 0) {
      return res.json({
        success: true,
        message: `Nenhum aluno EM CURSO matriculado entre ${filter.de} e ${filter.ate}.`,
        queued: 0,
        total: 0,
        running: false,
      });
    }
    await ensureFilterAlunos(pool, filter);
    const result = await planoMateriasImagem.startBatch(pool, filter);
    const periodo = filter ? ` (${filter.rgms.size} matriculados de ${filter.de} a ${filter.ate})` : '';
    return res.json({
      success: true,
      message: result.started || result.running
        ? `Geração de imagens por matérias iniciada em segundo plano.${periodo}`
        : 'Nada novo para gerar agora.',
      queued: result.queued,
      total: result.total,
      matched: filter ? filter.rgms.size : null,
      running: result.running,
    });
  } catch (err) {
    console.error('Falha ao iniciar lote de matérias:', err.message);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: status === 422 ? err.message : 'Não foi possível iniciar a geração em lote.',
    });
  }
});

app.get('/api/admin/materias-imagens/status', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const { filter, scoped } = await resolveStatusFilter(req.query);
    if (filter && filter.rgms.size === 0) {
      return res.json(emptyImageStatus(filter, { materias_synced: 0 }));
    }
    const status = await planoMateriasImagem.getStatus(pool, filter);
    return res.json({
      success: true,
      scoped,
      de: filter ? filter.de : null,
      ate: filter ? filter.ate : null,
      matriculados: filter ? filter.rgms.size : null,
      ...status,
    });
  } catch (err) {
    console.error('Falha ao consultar status das matérias:', err.message);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: status === 422 ? err.message : 'Não foi possível consultar o status.',
    });
  }
});

app.get('/api/admin/materias-imagens/export.csv', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    let phones = new Map();
    const source = getMatriculadosPool();
    if (source) {
      const rgms = (await pool.query(
        `SELECT rgm FROM csu_materias_imagens WHERE status = 'concluida' AND share_token IS NOT NULL`,
      )).rows.map((row) => row.rgm);
      try {
        phones = await matriculados.phonesByRgms(source, rgms);
      } catch (err) {
        console.error('Telefones de matriculados indisponíveis no export:', err.message);
      }
    }
    return planoMateriasImagem.sendExportCsv(pool, req, res, phones);
  } catch (err) {
    console.error('Falha ao exportar CSV de matérias:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível exportar o CSV.' });
  }
});

app.get('/api/admin/materias-imagens/crm', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rows = await planoMateriasImagem.listCrmRows(pool, req, { limit, offset });
    return res.json({ success: true, rows, limit, offset });
  } catch (err) {
    console.error('Falha ao listar URLs de matérias:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível listar as URLs.' });
  }
});

app.get('/api/atendimento/padrao', (req, res) => {
  return res.json({ success: true, ...atendimento.getAtendimentoPadrao() });
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

// ---------- Acompanhamento do aluno (acessos, tempo, cliques, vídeos, onde travou) ----------
let acompSchemaReady = null;
function ensureAcompanhamento() {
  if (!acompSchemaReady) {
    acompSchemaReady = Promise.all([ensureTrilha(), acompanhamento.ensureSchema(pool)]).catch((err) => {
      acompSchemaReady = null;
      throw err;
    });
  }
  return acompSchemaReady;
}

// Lote de eventos do navegador (fetch com keepalive ao sair da página).
app.post('/api/eventos', authMiddleware, async (req, res) => {
  if (!pool) return unavailable(res);
  if (!acompanhamento.liberadoPara(req.aluno)) return res.status(204).end();
  try {
    await ensureAcompanhamento();
    const r = await acompanhamento.registrarLote(pool, req.aluno, req.body);
    if (!r.ok) return res.status(400).json({ success: false, message: 'Lote inválido.' });
    return res.status(204).end();
  } catch (err) {
    console.error('Falha ao gravar eventos:', err.message);
    return res.status(500).json({ success: false });
  }
});

async function telefonesDe(rgms) {
  const mapa = new Map();
  if (!rgms.length) return mapa;
  try {
    const r = await pool.query('SELECT rgm, telefone FROM csu_materias_alunos WHERE rgm = ANY($1::text[]) AND telefone IS NOT NULL', [rgms]);
    r.rows.forEach((x) => mapa.set(x.rgm, x.telefone));
  } catch (err) { /* tabela pode não existir neste ambiente */ }
  const source = getMatriculadosPool();
  if (source) {
    try {
      const m = await matriculados.phonesByRgms(source, rgms);
      m.forEach((tel, rgm) => { if (tel) mapa.set(rgm, tel); });
    } catch (err) {
      console.error('Telefones de matriculados indisponíveis no acompanhamento:', err.message);
    }
  }
  return mapa;
}

function waNumero(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return null;
  if (!d.startsWith('55')) d = '55' + d;
  return d.length >= 12 ? d : null;
}

async function listaAcompanhamento(req) {
  await ensureAcompanhamento();
  const { dias, rows } = await acompanhamento.listar(pool, { dias: req.query.dias, q: req.query.q });
  const cfg = await acompanhamento.lerConfig(pool);
  let lista = acompanhamento.montar(rows, trilha.NIVEIS, cfg);
  const filtro = String(req.query.sinal || 'com_sinal');
  if (filtro === 'com_sinal') lista = lista.filter((x) => x.sinais.length);
  else if (filtro !== 'todos' && filtro !== 'em_espera') lista = lista.filter((x) => x.sinais.some((s) => s.id === filtro));
  else if (filtro === 'em_espera') lista = lista.filter((x) => x.em_espera);
  lista.sort((a, b) => a.prioridade - b.prioridade || new Date(b.ultimo_acesso || 0) - new Date(a.ultimo_acesso || 0));
  return { dias, lista, rows, cfg };
}

app.get('/api/admin/acompanhamento', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const { dias, lista, rows, cfg } = await listaAcompanhamento(req);
    const pagina = lista.slice(0, 300);
    const tels = await telefonesDe(pagina.map((x) => x.rgm));
    pagina.forEach((x) => { const n = waNumero(tels.get(x.rgm)); x.whatsapp_numero = n; });
    const ativos = rows.filter((r) => r.acessos > 0);
    const totais = {
      alunos: rows.length,
      ativos_periodo: ativos.length,
      acessos_periodo: ativos.reduce((n, r) => n + r.acessos, 0),
      minutos_medio: ativos.length ? Math.round(ativos.reduce((n, r) => n + r.segundos, 0) / ativos.length / 60) : 0,
      videos_iniciados: rows.reduce((n, r) => n + r.videos_inicio, 0),
      videos_concluidos: rows.reduce((n, r) => n + r.videos_fim, 0),
      com_sinal: acompanhamento.montar(rows, trilha.NIVEIS, cfg).filter((x) => x.sinais.length).length,
    };
    const sinais = acompanhamento.catalogo().filter((x) => cfg.sinais[x.id].ativo);
    return res.json({ success: true, dias, totais, sinais, total_filtrado: lista.length, alunos: pagina });
  } catch (err) {
    console.error('Falha no acompanhamento:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o acompanhamento.' });
  }
});

// Regras dos sinais (editáveis no admin). PUT com { reset: true } volta ao padrão.
app.get('/api/admin/acompanhamento/regras', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    await ensureAcompanhamento();
    return res.json({ success: true, regras: await acompanhamento.lerConfig(pool), padrao: acompanhamento.configPadrao(), catalogo: acompanhamento.catalogo() });
  } catch (err) {
    console.error('Falha ao ler regras do acompanhamento:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar as regras.' });
  }
});

app.put('/api/admin/acompanhamento/regras', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    await ensureAcompanhamento();
    const regras = await acompanhamento.salvarConfig(pool, req.body && req.body.reset ? null : req.body, req.admin && req.admin.id);
    return res.json({ success: true, regras });
  } catch (err) {
    console.error('Falha ao salvar regras do acompanhamento:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível salvar as regras.' });
  }
});

app.get('/api/admin/acompanhamento/export.csv', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    const { lista } = await listaAcompanhamento(req);
    const tels = await telefonesDe(lista.map((x) => x.rgm));
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['nome;rgm;email;telefone;curso;polo;sinal;mensagem_sugerida;acessos_periodo;minutos_periodo;ultimo_acesso;niveis_trilha;ultimo_followup'];
    lista.forEach((x) => {
      const s = x.sinais[0];
      lines.push([x.nome, x.rgm, x.email, waNumero(tels.get(x.rgm)) || '', x.curso, x.unidade, s ? s.rotulo : '', s ? s.mensagem : '',
        x.acessos, Math.round(x.segundos / 60), x.ultimo_acesso ? new Date(x.ultimo_acesso).toISOString() : '',
        x.niveis_concluidos, x.followup_em ? new Date(x.followup_em).toISOString() : ''].map(esc).join(';'));
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="acompanhamento-alunos.csv"');
    return res.send(String.fromCharCode(0xfeff) + lines.join('\n'));
  } catch (err) {
    console.error('Falha no CSV do acompanhamento:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível exportar.' });
  }
});

app.get('/api/admin/acompanhamento/:id', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false });
  try {
    await ensureAcompanhamento();
    return res.json({ success: true, ...(await acompanhamento.percurso(pool, id)) });
  } catch (err) {
    console.error('Falha no percurso do aluno:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o percurso.' });
  }
});

app.post('/api/admin/acompanhamento/:id/followup', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false });
  try {
    await ensureAcompanhamento();
    await acompanhamento.registrarFollowup(pool, id, req.admin && req.admin.id, req.body);
    return res.json({ success: true });
  } catch (err) {
    console.error('Falha ao registrar follow-up:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível registrar.' });
  }
});

// ---------- Avaliação dos conteúdos (joinha pra cima / pra baixo) ----------
avaliacoes.registrarRotas(app, { getPool: () => pool, authMiddleware, requireAdmin });
// Acesso em preparação (aluno sem RGM): o polo cria a conta e depois informa o RGM.
preparo.registrar(app, { pool, requireAdmin });
// Dados de acesso à faculdade (RGM, curso, e-mail acadêmico): o polo sobe; o aluno consulta.
dadosAcesso.registrar(app, { pool, authMiddleware, requireAdmin, getMatriculadosPool });

app.get('/api/admin/trilha', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    await ensureTrilha();
    const certificados = await certificadosEmitidos();
    const [resumo, ondeTrava] = await Promise.all([trilhaAdmin.resumoAdmin(pool, certificados), trilhaAdmin.ondeTrava(pool)]);
    return res.json({ success: true, ...resumo, onde_trava: ondeTrava });
  } catch (err) {
    console.error('Falha no resumo da Aula Inaugural:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar a Aula Inaugural.' });
  }
});

app.get('/api/admin/trilha/export.csv', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    await ensureTrilha();
    const rows = await trilhaAdmin.exportAlunos(pool, await certificadosEmitidos());
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const data = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
    const lines = ['nome;rgm;email;modulos_concluidos;total_modulos;pontos;meta_pontos;certificado_emitido;certificado_emitido_em;ultimo_acesso'];
    rows.forEach((r) => {
      lines.push([r.nome, r.rgm, r.email, r.certificado.concluidos, r.certificado.total, r.certificado.pontos, r.certificado.meta,
        r.certificado_emitido ? 'sim' : 'não', data(r.certificado_emitido_em),
        r.ultimo_acesso ? new Date(r.ultimo_acesso).toISOString() : ''].map(esc).join(';'));
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="aula-inaugural-alunos.csv"');
    return res.send(String.fromCharCode(0xfeff) + lines.join('\n'));
  } catch (err) {
    console.error('Falha no CSV da Aula Inaugural:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível exportar.' });
  }
});

// Relatório por aluno × módulo (fez / não fez / parou onde), para o painel e para o CRM.
app.get('/api/admin/trilha/alunos', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    await ensureTrilha();
    return res.json({ success: true, total_modulos: trilha.NIVEIS.length, alunos: await trilhaRelatorios.porAluno(pool, await certificadosEmitidos()) });
  } catch (err) {
    console.error('Falha no relatório por aluno:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o relatório por aluno.' });
  }
});

app.get('/api/admin/trilha/alunos.csv', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    await ensureTrilha();
    const alunos = await trilhaRelatorios.porAluno(pool, await certificadosEmitidos());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="aula-inaugural-por-aluno-modulo.csv"');
    return res.send(trilhaRelatorios.csvPorAluno(alunos));
  } catch (err) {
    console.error('Falha no CSV por aluno:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível exportar.' });
  }
});

// Dashboard de uso: tempo ativo, minutos de vídeo, vídeos mais vistos, 👍/👎.
app.get('/api/admin/trilha/uso', requireAdmin, async (req, res) => {
  if (!pool) return unavailable(res);
  try {
    await ensureTrilha();
    return res.json({ success: true, ...(await trilhaRelatorios.dashboardUso(pool)) });
  } catch (err) {
    console.error('Falha no dashboard de uso:', err.message);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o uso.' });
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
  '/trilha',
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
    // Os tutoriais de exemplo só saem do ar quando a trilha for liberada para todos.
    if (trilha.liberadaParaTodos()) await tutoriais.retirarExemplos(pool);
    else await tutoriais.seedIfEmpty(pool);
    await ensureTrilha();
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
    if (result.incomplete) {
      console.log('Sync de acessos: snapshot incompleto, nova tentativa em 2 min');
      setTimeout(() => runAcessosSync('snapshot-incompleto'), 2 * 60 * 1000);
    } else if (result.skippedRun) {
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
