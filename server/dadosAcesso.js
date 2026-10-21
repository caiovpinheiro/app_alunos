'use strict';

// Dados de acesso do aluno à faculdade (portal/AVA/Duda): RGM, curso e e-mail acadêmico.
// O polo sobe curso + RGM + e-mail acadêmico (opcional) pelo admin (aba "Alunos"), um a um
// ou em planilha. Fica numa tabela própria, por RGM (só dígitos), porque o sync de matriculados
// regrava csu_alunos.curso; assim o que o polo sobe não é sobrescrito, e quem ainda não entrou
// no app recebe os dados quando entrar.
//
// Contrato:
//   GET  /api/meu-acesso (aluno)             -> {success, preparo, rgm, curso, email_academico, senha_inicio}
//   GET  /api/admin/dados-acesso?busca=      -> {success, total, itens:[{rgm,nome,tem_acesso,curso,curso_app,email_academico,atualizado_em}]}
//   PUT  /api/admin/dados-acesso/:rgm        {curso, email_academico} -> {success, item}   (vazio limpa; os dois vazios apaga)
//   POST /api/admin/dados-acesso/importar    {linhas:[{n,rgm,curso,email_academico}]} (até 200 por envio)
//        -> {success, salvos, com_acesso, sem_acesso, erros:[{n,rgm,motivo}]}   (célula vazia NÃO apaga o que já existe)
//
// Primeira senha do portal/Duda (regra da faculdade, confirmada em 20/10): 3 primeiras letras do nome
// (1ª maiúscula, resto minúsculo, com acento; nome curto continua nas letras seguintes, sem espaço)
// + "@" + 3 primeiros números do RGM + 4 primeiros números do CPF. O Duda NÃO mostra essa senha.
// O app não tem CPF: o servidor devolve só o começo (senha_inicio, ex.: "Ana@512"), calculado na hora,
// sem guardar nem logar; o aluno digita os 4 números do CPF na tela e o navegador junta (o CPF não sai do aparelho).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_ACADEMICO_RE = /@cs\.(cruzeirodosul|unicid)\.edu\.br$/i;
const MAX_LINHAS = 200;
const CACHE_TTL_MS = 10 * 60 * 1000;

let schemaPronto = null;
const cacheRelatorio = new Map();

function ensureSchema(pool) {
  if (!schemaPronto) {
    schemaPronto = pool.query(`
      CREATE TABLE IF NOT EXISTS csu_dados_acesso (
        rgm TEXT PRIMARY KEY,
        curso TEXT,
        email_academico TEXT,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_por TEXT
      )
    `).catch((err) => { schemaPronto = null; throw err; });
  }
  return schemaPronto;
}

function texto(v, max) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function soDigitos(v) {
  return String(v ?? '').replace(/\D+/g, '');
}

// Valida uma linha (admin). Devolve {ok, motivo, dados}.
function validarLinha(raw) {
  const rgm = soDigitos(raw && raw.rgm);
  const curso = texto(raw && raw.curso, 160);
  const email = texto(raw && raw.email_academico, 160).toLowerCase();
  if (!rgm) return { ok: false, motivo: 'RGM vazio.' };
  if (rgm.length < 4 || rgm.length > 15) return { ok: false, motivo: 'RGM deve ter de 4 a 15 números.' };
  if (email && !EMAIL_RE.test(email)) return { ok: false, motivo: 'E-mail acadêmico inválido.' };
  return { ok: true, dados: { rgm, curso, email_academico: email } };
}

async function emailDoRelatorio(getMatriculadosPool, rgm) {
  const fonte = typeof getMatriculadosPool === 'function' ? getMatriculadosPool() : null;
  if (!fonte || !rgm) return '';
  const hit = cacheRelatorio.get(rgm);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.email;
  let email = '';
  try {
    // eslint-disable-next-line global-require
    const linha = await require('./matriculados').lookupByIdentifier(fonte, rgm);
    email = (linha && linha.email_academico) || '';
  } catch (err) {
    console.error('Falha ao buscar e-mail acadêmico no relatório:', err.message);
  }
  cacheRelatorio.set(rgm, { email, at: Date.now() });
  return email;
}

// Começo da primeira senha: "Ana@512" (sem o CPF). Nome curto continua nas letras seguintes ("Li Na" -> "Lin").
function senhaInicio(nome, rgm) {
  const letras = Array.from(String(nome ?? '').normalize('NFC')).filter((c) => /\p{L}/u.test(c)).slice(0, 3);
  const num = soDigitos(rgm).slice(0, 3);
  if (!letras.length || num.length < 3) return null;
  const tres = letras[0].toLocaleUpperCase('pt-BR') + letras.slice(1).join('').toLocaleLowerCase('pt-BR');
  return `${tres}@${num}`;
}

async function dadosDoAluno(pool, aluno, getMatriculadosPool) {
  const rgm = soDigitos(aluno.rgm);
  if (!rgm) return { preparo: true, rgm: null, curso: null, email_academico: null, senha_inicio: null };
  await ensureSchema(pool);
  const r = await pool.query(
    `SELECT a.curso AS curso_app, a.email, d.curso, d.email_academico
       FROM csu_alunos a
       LEFT JOIN csu_dados_acesso d ON d.rgm = $2
      WHERE a.id = $1`,
    [aluno.id, rgm],
  );
  const row = r.rows[0] || {};
  let email = row.email_academico || '';
  if (!email && EMAIL_ACADEMICO_RE.test(row.email || '')) email = String(row.email).toLowerCase();
  if (!email) email = await emailDoRelatorio(getMatriculadosPool, rgm);
  return {
    preparo: false,
    rgm: aluno.rgm,
    curso: row.curso || row.curso_app || null,
    email_academico: email || null,
    senha_inicio: senhaInicio(aluno.nome, rgm),
  };
}

async function buscar(pool, busca) {
  const termo = texto(busca, 80);
  const digitos = /^[\d.\-\s]+$/.test(termo) ? soDigitos(termo) : '';
  let where = 'd.rgm IS NOT NULL';
  const params = [];
  if (digitos) {
    params.push(`${digitos}%`);
    where = 'COALESCE(d.rgm, a.rgm_d) LIKE $1';
  } else if (termo) {
    params.push(`%${termo}%`);
    where = '(a.nome ILIKE $1 OR d.email_academico ILIKE $1 OR d.curso ILIKE $1)';
  }
  const r = await pool.query(
    `SELECT COALESCE(d.rgm, a.rgm_d) AS rgm, a.nome, (a.id IS NOT NULL) AS tem_acesso,
            d.curso, a.curso AS curso_app, d.email_academico, d.atualizado_em
       FROM (SELECT id, nome, curso, regexp_replace(rgm, '\\D', '', 'g') AS rgm_d
               FROM csu_alunos WHERE rgm IS NOT NULL) a
       FULL OUTER JOIN csu_dados_acesso d ON d.rgm = a.rgm_d
      WHERE ${where}
      ORDER BY d.atualizado_em DESC NULLS LAST, a.nome
      LIMIT 50`,
    params,
  );
  const total = await pool.query('SELECT COUNT(*)::int AS n FROM csu_dados_acesso');
  return { total: total.rows[0].n, itens: r.rows };
}

async function comAcesso(pool, rgms) {
  if (!rgms.length) return new Set();
  const r = await pool.query(
    `SELECT DISTINCT regexp_replace(rgm, '\\D', '', 'g') AS rgm
       FROM csu_alunos WHERE regexp_replace(rgm, '\\D', '', 'g') = ANY($1::text[])`,
    [rgms],
  );
  return new Set(r.rows.map((x) => x.rgm));
}

async function importar(pool, linhas, quem) {
  const erros = [];
  const porRgm = new Map();
  linhas.forEach((raw, i) => {
    const n = Number(raw && raw.n) || i + 1;
    const v = validarLinha(raw);
    if (!v.ok) { erros.push({ n, rgm: texto(raw && raw.rgm, 20), motivo: v.motivo }); return; }
    porRgm.set(v.dados.rgm, v.dados); // RGM repetido: vale a última linha
  });
  const validas = [...porRgm.values()];
  for (const d of validas) {
    // Célula vazia não apaga o que já existe.
    await pool.query(
      `INSERT INTO csu_dados_acesso (rgm, curso, email_academico, atualizado_por)
       VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4)
       ON CONFLICT (rgm) DO UPDATE SET
         curso = COALESCE(NULLIF(EXCLUDED.curso, ''), csu_dados_acesso.curso),
         email_academico = COALESCE(NULLIF(EXCLUDED.email_academico, ''), csu_dados_acesso.email_academico),
         atualizado_em = now(),
         atualizado_por = EXCLUDED.atualizado_por`,
      [d.rgm, d.curso, d.email_academico, quem],
    );
  }
  const existentes = await comAcesso(pool, validas.map((d) => d.rgm));
  return {
    salvos: validas.length,
    com_acesso: validas.filter((d) => existentes.has(d.rgm)).length,
    sem_acesso: validas.filter((d) => !existentes.has(d.rgm)).length,
    erros,
  };
}

function registrar(app, { pool, authMiddleware, requireAdmin, getMatriculadosPool }) {
  function semBanco(res) {
    return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
  }

  app.get('/api/meu-acesso', authMiddleware, async (req, res) => {
    if (!pool) return semBanco(res);
    res.set('Cache-Control', 'no-store');
    try {
      const dados = await dadosDoAluno(pool, req.aluno, getMatriculadosPool);
      return res.json({ success: true, ...dados });
    } catch (err) {
      console.error('Falha ao ler dados de acesso:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível carregar seus dados de acesso.' });
    }
  });

  app.get('/api/admin/dados-acesso', requireAdmin, async (req, res) => {
    if (!pool) return semBanco(res);
    try {
      await ensureSchema(pool);
      return res.json({ success: true, ...(await buscar(pool, req.query.busca)) });
    } catch (err) {
      console.error('Falha ao buscar dados de acesso:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível buscar.' });
    }
  });

  app.put('/api/admin/dados-acesso/:rgm', requireAdmin, async (req, res) => {
    if (!pool) return semBanco(res);
    const v = validarLinha({ ...req.body, rgm: req.params.rgm });
    if (!v.ok) return res.status(422).json({ success: false, message: v.motivo });
    const d = v.dados;
    try {
      await ensureSchema(pool);
      if (!d.curso && !d.email_academico) {
        await pool.query('DELETE FROM csu_dados_acesso WHERE rgm = $1', [d.rgm]);
      } else {
        await pool.query(
          `INSERT INTO csu_dados_acesso (rgm, curso, email_academico, atualizado_por)
           VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4)
           ON CONFLICT (rgm) DO UPDATE SET curso = EXCLUDED.curso, email_academico = EXCLUDED.email_academico,
             atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
          [d.rgm, d.curso, d.email_academico, (req.admin && req.admin.email) || null],
        );
      }
      cacheRelatorio.delete(d.rgm);
      const { itens } = await buscar(pool, d.rgm);
      return res.json({ success: true, item: itens.find((x) => x.rgm === d.rgm) || null });
    } catch (err) {
      console.error('Falha ao salvar dados de acesso:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível salvar.' });
    }
  });

  app.post('/api/admin/dados-acesso/importar', requireAdmin, async (req, res) => {
    if (!pool) return semBanco(res);
    const linhas = req.body && req.body.linhas;
    if (!Array.isArray(linhas) || !linhas.length) {
      return res.status(422).json({ success: false, message: 'Nenhuma linha para importar.' });
    }
    if (linhas.length > MAX_LINHAS) {
      return res.status(413).json({ success: false, message: `Envie no máximo ${MAX_LINHAS} linhas por vez.` });
    }
    try {
      await ensureSchema(pool);
      const r = await importar(pool, linhas, (req.admin && req.admin.email) || null);
      cacheRelatorio.clear();
      return res.json({ success: true, ...r });
    } catch (err) {
      console.error('Falha ao importar dados de acesso:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível importar.' });
    }
  });
}

module.exports = { registrar, validarLinha, senhaInicio };
