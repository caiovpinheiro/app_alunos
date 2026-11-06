'use strict';
/*
 * Link de acesso (link mágico): abre o portal já logado, sem digitar RGM e senha.
 *
 * Quem gera: o n8n (ou o CRM) chama POST /api/integracoes/link-acesso com o RGM e o segredo
 * LINK_ACESSO_SEGREDO, recebe a URL e grava num campo do negócio (ex.: link_acesso). A régua manda a
 * URL no WhatsApp (botão "Primeiro Acesso" do BV).
 *
 * Regras:
 *   - o token tem 32 bytes aleatórios; o banco guarda só o sha256 dele;
 *   - vale uma vez e expira em LINK_ACESSO_DIAS dias (padrão 7);
 *   - um link novo da venda invalida os anteriores ainda não usados; o link de um lembrete da régua
 *     (server/regua-fup.js) não invalida, para o botão da mensagem anterior continuar funcionando;
 *   - quando um link é usado, os outros ainda abertos daquela conta são cancelados;
 *   - o id do negócio do CRM (negocio), quando vem, fica guardado para o app marcar app_entrou nele;
 *   - quem entra pelo link e ainda não criou a senha própria cai na tela de criar senha
 *     (server/senha.js), se a troca estiver ligada para a conta;
 *   - link usado, vencido ou inválido abre a tela de login normal, com o RGM preenchido quando dá.
 * Sem o segredo configurado, o gerador responde 503 e nada muda.
 */
const crypto = require('crypto');
const { envValue } = require('./env');
const senha = require('./senha');
const vigia = require('./vigia'); // conta o resultado de cada pedido (link saindo vazio)

const TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;

function dias() {
  const n = Number(envValue('LINK_ACESSO_DIAS', '7'));
  return Number.isFinite(n) && n >= 1 && n <= 30 ? n : 7;
}

function sha(v) {
  return crypto.createHash('sha256').update(String(v)).digest('hex');
}

function segredoOk(recebido) {
  const segredo = envValue('LINK_ACESSO_SEGREDO');
  if (!segredo || !recebido) return false;
  return crypto.timingSafeEqual(Buffer.from(sha(recebido)), Buffer.from(sha(segredo)));
}

function base() {
  return String(envValue('APP_PUBLIC_URL') || 'https://app.cruzeiroead.com.br').trim().replace(/\/$/, '');
}

let pronto = null;
function ensureSchema(pool) {
  if (!pronto) {
    pronto = pool.query(`
      CREATE TABLE IF NOT EXISTS csu_links_acesso (
        id SERIAL PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
        origem TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        expira_em TIMESTAMPTZ NOT NULL,
        usado_em TIMESTAMPTZ,
        cancelado_em TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_csu_links_acesso_aluno ON csu_links_acesso (aluno_id);
      ALTER TABLE csu_links_acesso ADD COLUMN IF NOT EXISTS negocio TEXT;
      CREATE INDEX IF NOT EXISTS idx_csu_links_acesso_em ON csu_links_acesso (criado_em DESC);
    `).catch((err) => { pronto = null; throw err; });
  }
  return pronto;
}

const NEGOCIO_RE = /^[A-Za-z0-9_-]{6,64}$/;
function limparNegocio(v) {
  const s = String(v == null ? '' : v).trim();
  return NEGOCIO_RE.test(s) ? s : null;
}

// codigo = o que vai depois de /a/ (token e ?o=), para o botão de URL dinâmica do template.
async function gerar(pool, alunoId, origem, { negocio = null, manterAnteriores = false } = {}) {
  await ensureSchema(pool);
  const token = crypto.randomBytes(32).toString('base64url');
  const expira = new Date(Date.now() + dias() * 86400000);
  if (!manterAnteriores) {
    await pool.query(
      `UPDATE csu_links_acesso SET cancelado_em = now()
       WHERE aluno_id = $1 AND usado_em IS NULL AND cancelado_em IS NULL`,
      [alunoId],
    );
  }
  await pool.query(
    'INSERT INTO csu_links_acesso (token_hash, aluno_id, origem, expira_em, negocio) VALUES ($1, $2, $3, $4, $5)',
    [sha(token), alunoId, origem || null, expira, limparNegocio(negocio)],
  );
  const o = origem ? `?o=${encodeURIComponent(origem)}` : '';
  return { url: `${base()}/a/${token}${o}`, codigo: `${token}${o}`, expira_em: expira.toISOString() };
}

// Último negócio do CRM conhecido para a conta (vem do n8n ou do lembrete da régua).
async function negocioDe(pool, alunoId) {
  await ensureSchema(pool);
  const r = await pool.query(
    'SELECT negocio FROM csu_links_acesso WHERE aluno_id = $1 AND negocio IS NOT NULL ORDER BY criado_em DESC LIMIT 1', [alunoId]);
  return r.rows[0] ? r.rows[0].negocio : null;
}

// Consome o token. Devolve { aluno } ou { erro: 'link_invalido'|'link_usado'|'link_expirado', aluno? }.
async function consumir(pool, token) {
  if (!TOKEN_RE.test(String(token || ''))) return { erro: 'link_invalido' };
  await ensureSchema(pool);
  const r = await pool.query(
    `UPDATE csu_links_acesso SET usado_em = now()
     WHERE token_hash = $1 AND usado_em IS NULL AND cancelado_em IS NULL AND expira_em > now()
     RETURNING aluno_id`,
    [sha(token)],
  );
  const alunoId = r.rows[0] ? r.rows[0].aluno_id : null;
  if (!alunoId) {
    const x = await pool.query(
      `SELECT l.usado_em, l.cancelado_em, l.expira_em, a.rgm
       FROM csu_links_acesso l JOIN csu_alunos a ON a.id = l.aluno_id WHERE l.token_hash = $1`,
      [sha(token)],
    );
    const row = x.rows[0];
    if (!row) return { erro: 'link_invalido' };
    return { erro: row.usado_em || row.cancelado_em ? 'link_usado' : 'link_expirado', rgm: row.rgm };
  }
  const a = await pool.query(
    'SELECT id, email, rgm, nome, ativo, created_at, senha_trocada_em FROM csu_alunos WHERE id = $1',
    [alunoId],
  );
  const aluno = a.rows[0];
  if (!aluno || !aluno.ativo) return { erro: 'link_invalido' };
  // Entrou: os outros links ainda abertos (de lembretes anteriores) não servem mais.
  await pool.query(
    `UPDATE csu_links_acesso SET cancelado_em = now()
     WHERE aluno_id = $1 AND token_hash <> $2 AND usado_em IS NULL AND cancelado_em IS NULL`,
    [alunoId, sha(token)],
  );
  return { aluno };
}

function registrarRotas(app, { getPool, findAluno, createSession, instrumentacao, ensureSchemaAlunos }) {
  // n8n / CRM: gera o link de um RGM. Segredo no cabeçalho X-Segredo ou no corpo (segredo).
  app.post('/api/integracoes/link-acesso', async (req, res) => {
    const pool = getPool();
    if (!envValue('LINK_ACESSO_SEGREDO')) return res.status(503).json({ success: false, message: 'Link de acesso desligado.' });
    if (!segredoOk(req.get('x-segredo') || (req.body && req.body.segredo))) {
      return res.status(401).json({ success: false, message: 'Segredo inválido.' });
    }
    if (!pool) return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
    const rgm = String((req.body && req.body.rgm) || '').replace(/\D+/g, '');
    const origem = instrumentacao.limparOrigem(req.body && req.body.origem) || 'link';
    if (!rgm) {
      vigia.registrarPedidoLink(pool, 'sem_rgm', origem);
      return res.status(400).json({ success: false, message: 'Informe o RGM.' });
    }
    try {
      if (ensureSchemaAlunos) await ensureSchemaAlunos();
      const aluno = await findAluno(pool, rgm);
      if (!aluno || !aluno.ativo) {
        vigia.registrarPedidoLink(pool, 'conta_nao_encontrada', origem);
        return res.status(404).json({ success: false, motivo: 'conta_nao_encontrada', message: 'Nenhuma conta ativa com esse RGM.' });
      }
      const r = await gerar(pool, aluno.id, origem, { negocio: req.body && req.body.negocio });
      vigia.registrarPedidoLink(pool, 'ok', origem);
      return res.json({ success: true, url: r.url, expira_em: r.expira_em });
    } catch (err) {
      vigia.registrarPedidoLink(pool, 'erro', origem);
      console.error('Falha ao gerar link de acesso:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível gerar o link.' });
    }
  });

  // Tela /a/<token>: o app chama aqui e recebe a sessão, como no login.
  app.post('/api/auth/link', async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
    const origem = instrumentacao.limparOrigem(req.body && req.body.origem);
    try {
      if (ensureSchemaAlunos) await ensureSchemaAlunos();
      const r = await consumir(pool, req.body && req.body.token);
      if (r.erro) {
        instrumentacao.falha(pool, { motivo: r.erro, origem });
        const msg = r.erro === 'link_usado'
          ? 'Este link já foi usado. Entre com o seu RGM e a sua senha.'
          : r.erro === 'link_expirado'
            ? 'Este link venceu. Entre com o seu RGM e a sua senha.'
            : 'Link de acesso inválido. Entre com o seu RGM e a sua senha.';
        return res.status(401).json({ success: false, codigo: r.erro, message: msg, rgm: r.rgm || null });
      }
      const aluno = r.aluno;
      const trocaSenha = senha.ativaPara(aluno) && !aluno.senha_trocada_em;
      const token = crypto.randomBytes(32).toString('hex');
      const primeira = await instrumentacao.primeiraEntrada(pool, aluno.id);
      await createSession(pool, aluno.id, token, { trocaSenha });
      instrumentacao.entrada(pool, { alunoId: aluno.id, origem, primeira, via: 'link' });
      return res.json({
        success: true,
        token,
        troca_senha: trocaSenha,
        user: { name: aluno.nome, email: aluno.email, rgm: aluno.rgm },
      });
    } catch (err) {
      console.error('Falha ao entrar pelo link:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível entrar. Tente de novo.' });
    }
  });
}

module.exports = { gerar, consumir, ensureSchema, registrarRotas, negocioDe, limparNegocio, segredoOk, TOKEN_RE };
