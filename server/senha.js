'use strict';
/*
 * Senha própria do aluno.
 *
 * Problema: toda conta nasce com a senha inicial "primeiro nome + 123@" (matriculados.derivedPassword),
 * a regra está escrita na tela de login e a senha vai em texto no WhatsApp. Quem sabe o nome e o RGM
 * entra na conta. Antes desta mudança o login aceitava a senha inicial para sempre, mesmo de quem já
 * tinha criado a própria no cadastro.
 *
 * Regra (só para as contas em TROCA_SENHA_PARA: RGMs/e-mails separados por vírgula, ou "*"):
 *   - entrou com a senha inicial  -> a sessão nasce presa (csu_sessoes.troca_senha) e só serve para
 *     criar a senha própria (POST /api/auth/trocar-senha) ou sair. As outras APIs respondem 403
 *     com codigo "troca_senha" e a tela de criar senha abre.
 *   - criou a senha (ou entrou com a senha própria do cadastro) -> csu_alunos.senha_trocada_em é
 *     preenchida e a senha inicial deixa de entrar.
 *   - esqueceu -> o atendimento volta a conta para a senha inicial pelo admin
 *     (POST /api/admin/alunos/:id/senha-inicial), e ele cria outra no próximo login.
 * Fora da lista, nada muda. Só vale para quem vê as telas novas (server/versao.js): as telas antigas
 * (public-antigo/) não têm a tela de criar senha.
 */
const bcrypt = require('bcryptjs');
const { envValue } = require('./env');
const matriculados = require('./matriculados');
const versao = require('./versao');

const BCRYPT_ROUNDS = 12;
const MIN = 8;
const CODIGO = 'troca_senha';
// Com a sessão presa, só isto responde. /api/eventos fica livre para medir a tela de criar senha.
const ROTAS_LIVRES = new Set(['/api/auth/trocar-senha', '/api/auth/logout', '/api/eventos', '/api/versao']);

function lista() {
  return envValue('TROCA_SENHA_PARA').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

function ativaPara(aluno) {
  const l = lista();
  if (!l.length || !aluno || !versao.novaPara(aluno)) return false;
  if (l.includes('*')) return true;
  const rgm = String(aluno.rgm || '').replace(/\D+/g, '');
  const email = String(aluno.email || '').trim().toLowerCase();
  return Boolean((rgm && l.map((x) => x.replace(/\D+/g, '')).includes(rgm)) || (email && l.includes(email)));
}

// Decide o login. derivedOk: digitou a senha inicial; hashOk: digitou a senha guardada.
// Devolve { ok, trocaSenha, marcarPropria }.
function avaliarLogin(aluno, { derivedOk, hashOk }) {
  if (!ativaPara(aluno)) return { ok: derivedOk || hashOk, trocaSenha: false, marcarPropria: false };
  if (aluno.senha_trocada_em) return { ok: hashOk && !derivedOk, trocaSenha: false, marcarPropria: false };
  if (derivedOk) return { ok: true, trocaSenha: true, marcarPropria: false };
  if (hashOk) return { ok: true, trocaSenha: false, marcarPropria: true };
  return { ok: false, trocaSenha: false, marcarPropria: false };
}

// Erros por campo, no formato do cadastro ({ password, confirmPassword }). Vazio = senha aceita.
function validarNova(aluno, senha, confirmar) {
  const errors = {};
  const s = String(senha ?? '');
  const inicial = matriculados.derivedPassword(aluno && aluno.nome);
  const primeiro = inicial ? inicial.slice(0, -4).toLowerCase() : '';
  const rgm = String((aluno && aluno.rgm) || '').replace(/\D+/g, '');
  if (s.length < MIN) errors.password = `Use pelo menos ${MIN} caracteres.`;
  else if (inicial && s.toLowerCase() === inicial.toLowerCase()) errors.password = 'Essa é a senha inicial. Crie uma diferente.';
  else if (primeiro && primeiro.length >= 3 && s.toLowerCase().startsWith(`${primeiro}123`)) errors.password = 'Não use o seu nome com 123. Quem sabe o seu nome adivinha.';
  else if (rgm && s.replace(/\D+/g, '') === rgm && s.replace(/\d+/g, '').length < 3) errors.password = 'Não use o seu RGM como senha.';
  else if (/^(.)\1+$/.test(s) || /^(12345678|123456789|87654321|abcdefgh|senha123|password)$/i.test(s)) errors.password = 'Essa senha é fácil de adivinhar. Misture letras e números.';
  if (!errors.password && s !== String(confirmar ?? '')) errors.confirmPassword = 'As senhas não são iguais.';
  return errors;
}

async function definir(pool, alunoId, senha, tokenAtual) {
  const hash = await bcrypt.hash(String(senha), BCRYPT_ROUNDS);
  await pool.query('UPDATE csu_alunos SET pw_hash = $2, senha_trocada_em = now() WHERE id = $1', [alunoId, hash]);
  // Quem tinha a senha inicial pode ter entrado em outro aparelho: só a sessão atual continua.
  await pool.query('DELETE FROM csu_sessoes WHERE aluno_id = $1 AND token <> $2', [alunoId, tokenAtual || '']);
  await pool.query('UPDATE csu_sessoes SET troca_senha = FALSE WHERE token = $1', [tokenAtual || '']);
}

async function marcarPropria(pool, alunoId) {
  await pool.query('UPDATE csu_alunos SET senha_trocada_em = COALESCE(senha_trocada_em, now()) WHERE id = $1', [alunoId]);
}

// Atendimento: o aluno esqueceu a senha própria. Volta para a senha inicial e derruba as sessões.
async function voltarInicial(pool, alunoId) {
  const r = await pool.query(
    `UPDATE csu_alunos SET pw_hash = 'DERIVED', senha_trocada_em = NULL WHERE id = $1 RETURNING id, nome`,
    [alunoId],
  );
  if (!r.rowCount) return null;
  await pool.query('DELETE FROM csu_sessoes WHERE aluno_id = $1', [alunoId]);
  return { id: r.rows[0].id, senha_inicial: matriculados.derivedPassword(r.rows[0].nome) };
}

// Chamado pelo authMiddleware depois de achar a sessão. true = já respondeu (403).
function bloquear(req, res) {
  if (!req.aluno || !req.aluno.troca_senha) return false;
  if (ROTAS_LIVRES.has(req.path)) return false;
  res.status(403).json({ success: false, codigo: CODIGO, message: 'Crie a sua senha para continuar.' });
  return true;
}

function registrarRotas(app, { getPool, authMiddleware, requireAdmin, registrarEvento }) {
  app.post('/api/auth/trocar-senha', authMiddleware, async (req, res) => {
    const pool = getPool();
    if (!pool) return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
    const errors = validarNova(req.aluno, req.body && req.body.password, req.body && req.body.confirmPassword);
    if (Object.keys(errors).length) return res.status(422).json({ success: false, message: 'Confira a senha.', errors });
    try {
      await definir(pool, req.aluno.id, req.body.password, req.token);
      if (registrarEvento) registrarEvento(req.aluno.id, 'senha_criada', { obrigatoria: Boolean(req.aluno.troca_senha) });
      return res.json({ success: true });
    } catch (err) {
      console.error('Falha ao trocar a senha:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível salvar a senha. Tente de novo.' });
    }
  });

  app.post('/api/admin/alunos/:id/senha-inicial', requireAdmin, async (req, res) => {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!pool) return res.status(503).json({ success: false, message: 'Serviço de dados indisponível.' });
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'Aluno inválido.' });
    try {
      const r = await voltarInicial(pool, id);
      if (!r) return res.status(404).json({ success: false, message: 'Aluno não encontrado.' });
      return res.json({ success: true, senha_inicial: r.senha_inicial });
    } catch (err) {
      console.error('Falha ao voltar a senha inicial:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível voltar a senha inicial.' });
    }
  });
}

module.exports = { CODIGO, ativaPara, avaliarLogin, validarNova, definir, marcarPropria, voltarInicial, bloquear, registrarRotas, MIN };
