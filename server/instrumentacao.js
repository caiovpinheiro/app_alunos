'use strict';

// Antes do login: de onde o aluno veio (?o= do link da régua) e onde a entrada falhou.
//
//   csu_entradas     uma linha por login ou cadastro que deu certo: aluno, origem (?o=), se foi a
//                    primeira entrada da conta e por onde entrou (login ou cadastro).
//   csu_login_falhas uma linha por login recusado ou toque em "Esqueci minha senha": motivo, origem,
//                    horário e o id do aluno só quando o que foi digitado bate com uma conta.
//
// Nada do que foi digitado (RGM, e-mail, senha) é guardado: o identificador só serve para achar o id.
// Sem IP. Não depende de RASTREIO_LIBERADO_PARA: antes do login não se sabe quem é o aluno, e nada
// aqui é dado pessoal novo. Gravar nunca atrasa nem impede a entrada (tudo em segundo plano).
// Os relatórios ficam em server/medicao.js (aba Medição do admin).

const { envValue } = require('./env');

const ORIGEM = /^[a-z0-9_-]{1,24}$/;
const MOTIVOS = {
  campos_vazios: 'Sem RGM/e-mail ou senha',
  conta_nao_encontrada: 'RGM ou e-mail sem conta',
  conta_inativa: 'Conta desativada',
  senha_incorreta: 'Senha incorreta',
  erro_interno: 'Erro no servidor',
  esqueci_senha: 'Tocou em "Esqueci minha senha"',
  link_invalido: 'Link de acesso inválido',
  link_usado: 'Link de acesso já usado',
  link_expirado: 'Link de acesso expirado',
};

// ?o=bv, ?o=reenvio, ?o=polo... Minúsculas, até 24 caracteres; o resto vira "sem origem".
function limparOrigem(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return ORIGEM.test(s) ? s : null;
}

function retencaoDias() {
  const n = Number(envValue('RASTREIO_RETENCAO_DIAS', '180'));
  return Number.isFinite(n) && n >= 30 ? Math.floor(n) : 180;
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS csu_entradas (
      id BIGSERIAL PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id) ON DELETE CASCADE,
      origem TEXT,
      primeira BOOLEAN NOT NULL DEFAULT FALSE,
      via TEXT NOT NULL DEFAULT 'login',
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_csu_entradas_aluno ON csu_entradas (aluno_id, criado_em);
    CREATE INDEX IF NOT EXISTS idx_csu_entradas_em ON csu_entradas (criado_em DESC);

    CREATE TABLE IF NOT EXISTS csu_login_falhas (
      id BIGSERIAL PRIMARY KEY,
      aluno_id INTEGER REFERENCES csu_alunos(id) ON DELETE CASCADE,
      motivo TEXT NOT NULL,
      origem TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_csu_login_falhas_em ON csu_login_falhas (criado_em DESC);
  `);
  // A primeira entrada de cada conta nunca é apagada (é a origem do primeiro acesso); o resto segue a retenção do rastreio.
  const dias = retencaoDias();
  await pool.query(`DELETE FROM csu_entradas WHERE NOT primeira AND criado_em < now() - ($1::int * interval '1 day')`, [dias]);
  await pool.query(`DELETE FROM csu_login_falhas WHERE criado_em < now() - ($1::int * interval '1 day')`, [dias]);
}

let pronto = null;
function garantir(pool) {
  if (!pronto) pronto = ensureSchema(pool).catch((err) => { pronto = null; throw err; });
  return pronto;
}

// Limite contra enxurrada (a rota de login é pública): no máximo 600 falhas gravadas por minuto.
let janela = { inicio: 0, n: 0 };
function cabe() {
  const agora = Date.now();
  if (agora - janela.inicio > 60000) janela = { inicio: agora, n: 0 };
  janela.n += 1;
  return janela.n <= 600;
}

function avisar(rotulo) {
  return (err) => { console.error(`Falha ao registrar ${rotulo}:`, err.code || '', err.message); };
}

// Chamar antes de criar a sessão: a conta nunca tinha entrado? (null se não der para saber)
async function primeiraEntrada(pool, alunoId) {
  try {
    const r = await pool.query('SELECT primeiro_login_em IS NULL AS primeira FROM csu_alunos WHERE id = $1', [alunoId]);
    return r.rows[0] ? Boolean(r.rows[0].primeira) : null;
  } catch (err) {
    return null;
  }
}

// Quem quer saber de cada entrada (ex.: server/regua-fup.js marca app_entrou no negócio do CRM).
const ouvintes = [];
function quandoEntrar(fn) { if (typeof fn === 'function') ouvintes.push(fn); }

// Login ou cadastro que deu certo. Não espera: devolve a promessa só para os testes.
function entrada(pool, { alunoId, origem, primeira, via }) {
  if (!pool || !alunoId) return Promise.resolve();
  return garantir(pool)
    .then(() => pool.query(
      'INSERT INTO csu_entradas (aluno_id, origem, primeira, via) VALUES ($1, $2, $3, $4)',
      [alunoId, limparOrigem(origem), primeira === true, ['cadastro', 'link'].includes(via) ? via : 'login'],
    ))
    .catch(avisar('a entrada'))
    .then(() => Promise.all(ouvintes.map((fn) => Promise.resolve().then(() => fn(pool, { alunoId, primeira, via })).catch(avisar('o aviso de entrada')))));
}

// Login recusado ou "Esqueci minha senha". alunoId só quando o identificador bate com uma conta.
function falha(pool, { alunoId, motivo, origem }) {
  if (!pool || !MOTIVOS[motivo] || !cabe()) return Promise.resolve();
  return garantir(pool)
    .then(() => pool.query(
      'INSERT INTO csu_login_falhas (aluno_id, motivo, origem) VALUES ($1, $2, $3)',
      [Number.isInteger(alunoId) ? alunoId : null, motivo, limparOrigem(origem)],
    ))
    .catch(avisar('a falha de login'));
}

// POST /api/auth/esqueci {identifier?, origem?} -> 204. Chamado pelo link "Esqueci minha senha" da tela
// de login (sendBeacon), que continua abrindo o WhatsApp do acadêmico como antes.
function registrarRotas(app, { getPool, findAluno }) {
  app.post('/api/auth/esqueci', async (req, res) => {
    const pool = getPool();
    res.status(204).end();
    if (!pool) return;
    let alunoId = null;
    const identifier = String((req.body && req.body.identifier) || '').trim().slice(0, 120);
    if (identifier) {
      try {
        const a = await findAluno(pool, identifier);
        if (a) alunoId = a.id;
      } catch (err) { /* sem o id: grava só o motivo */ }
    }
    await falha(pool, { alunoId, motivo: 'esqueci_senha', origem: req.body && req.body.origem });
  });
}

module.exports = { MOTIVOS, limparOrigem, ensureSchema, garantir, primeiraEntrada, entrada, quandoEntrar, falha, registrarRotas };
