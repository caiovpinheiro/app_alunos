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
 *   - vale para um aparelho e expira em LINK_ACESSO_DIAS dias (padrão 7). Na primeira entrada o
 *     aparelho recebe um cookie (csu_link, só o sha256 vai para o banco); tocar de novo no link
 *     no mesmo aparelho entra de novo (o aluno volta à mensagem do WhatsApp, e cada toque abre uma
 *     aba nova, sem a sessão anterior). Em outro aparelho o link conta como já usado;
 *   - um link novo para o mesmo aluno invalida os anteriores;
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
      ALTER TABLE csu_links_acesso ADD COLUMN IF NOT EXISTS aparelho_hash TEXT;
      ALTER TABLE csu_links_acesso ADD COLUMN IF NOT EXISTS reusos INTEGER NOT NULL DEFAULT 0;
    `).catch((err) => { pronto = null; throw err; });
  }
  return pronto;
}

async function gerar(pool, alunoId, origem) {
  await ensureSchema(pool);
  const token = crypto.randomBytes(32).toString('base64url');
  const expira = new Date(Date.now() + dias() * 86400000);
  await pool.query(
    // Cancela também os já usados: o link antigo deixa de entrar até no aparelho que o usou.
    `UPDATE csu_links_acesso SET cancelado_em = now()
     WHERE aluno_id = $1 AND cancelado_em IS NULL`,
    [alunoId],
  );
  await pool.query(
    'INSERT INTO csu_links_acesso (token_hash, aluno_id, origem, expira_em) VALUES ($1, $2, $3, $4)',
    [sha(token), alunoId, origem || null, expira],
  );
  const o = origem ? `?o=${encodeURIComponent(origem)}` : '';
  return { url: `${base()}/a/${token}${o}`, expira_em: expira.toISOString() };
}

// Teto de entradas repetidas pelo mesmo link no mesmo aparelho (contra uso indevido do cookie).
const MAX_REUSOS = 30;
const APARELHO_RE = /^[A-Za-z0-9_-]{40,60}$/;

// Consome o token. `aparelho` é o valor do cookie csu_link (ou nada).
// Devolve { aluno, aparelho?, reuso? } ou { erro: 'link_invalido'|'link_usado'|'link_expirado', rgm? }.
// `aparelho` só volta na primeira entrada: é o valor novo que a rota grava no cookie.
async function consumir(pool, token, aparelho) {
  if (!TOKEN_RE.test(String(token || ''))) return { erro: 'link_invalido' };
  await ensureSchema(pool);
  const novoAparelho = crypto.randomBytes(32).toString('base64url');
  const r = await pool.query(
    `UPDATE csu_links_acesso SET usado_em = now(), aparelho_hash = $2
     WHERE token_hash = $1 AND usado_em IS NULL AND cancelado_em IS NULL AND expira_em > now()
     RETURNING aluno_id`,
    [sha(token), sha(novoAparelho)],
  );
  let alunoId = r.rows[0] ? r.rows[0].aluno_id : null;
  let reuso = false;
  // Já usado: entra de novo só no mesmo aparelho, enquanto o link vale e não foi trocado por outro.
  if (!alunoId && APARELHO_RE.test(String(aparelho || ''))) {
    const r2 = await pool.query(
      `UPDATE csu_links_acesso SET reusos = reusos + 1
       WHERE token_hash = $1 AND usado_em IS NOT NULL AND cancelado_em IS NULL AND expira_em > now()
         AND aparelho_hash = $2 AND reusos < $3
       RETURNING aluno_id`,
      [sha(token), sha(aparelho), MAX_REUSOS],
    );
    alunoId = r2.rows[0] ? r2.rows[0].aluno_id : null;
    reuso = Boolean(alunoId);
  }
  if (!alunoId) {
    const x = await pool.query(
      `SELECT l.usado_em, l.cancelado_em, l.expira_em, a.rgm
       FROM csu_links_acesso l JOIN csu_alunos a ON a.id = l.aluno_id WHERE l.token_hash = $1`,
      [sha(token)],
    );
    const row = x.rows[0];
    if (!row) return { erro: 'link_invalido' };
    // Trocado por um link novo conta como usado; vencido vale mais que usado (o aluno precisa de outro).
    const venceu = new Date(row.expira_em).getTime() <= Date.now();
    const erro = row.cancelado_em ? 'link_usado' : venceu ? 'link_expirado' : 'link_usado';
    return { erro, rgm: row.rgm };
  }
  const a = await pool.query(
    'SELECT id, email, rgm, nome, ativo, created_at, senha_trocada_em FROM csu_alunos WHERE id = $1',
    [alunoId],
  );
  const aluno = a.rows[0];
  if (!aluno || !aluno.ativo) return { erro: 'link_invalido' };
  return reuso ? { aluno, reuso: true } : { aluno, aparelho: novoAparelho };
}

const COOKIE = 'csu_link';
const COOKIE_PATH = '/api/auth/link';

function aparelhoDoPedido(req) {
  const par = String(req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(COOKIE + '='));
  return par ? par.slice(COOKIE.length + 1) : null;
}

// Só a rota do link lê o cookie (Path), e o JavaScript da página não enxerga (HttpOnly).
function gravarAparelho(req, res, valor) {
  const https = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const maxAge = dias() * 86400;
  res.append('Set-Cookie', `${COOKIE}=${valor}; Max-Age=${maxAge}; Path=${COOKIE_PATH}; SameSite=Lax; HttpOnly${https ? '; Secure' : ''}`);
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
      const r = await gerar(pool, aluno.id, origem);
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
      const r = await consumir(pool, req.body && req.body.token, aparelhoDoPedido(req));
      if (r.erro) {
        instrumentacao.falha(pool, { motivo: r.erro, origem });
        const msg = r.erro === 'link_usado'
          ? 'Este link já foi usado em outro aparelho. Entre com o seu RGM e a sua senha.'
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
      if (r.aparelho) gravarAparelho(req, res, r.aparelho);
      res.set('Cache-Control', 'no-store');
      instrumentacao.entrada(pool, { alunoId: aluno.id, origem, primeira, via: r.reuso ? 'link_de_novo' : 'link' });
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

module.exports = { gerar, consumir, ensureSchema, registrarRotas, TOKEN_RE };
