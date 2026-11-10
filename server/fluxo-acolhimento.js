'use strict';

// Admin › Fluxo do Acolhimento: o desenho editável das mensagens da etapa Comercial → Acolhimento.
//
// Só desenho. Nada aqui dispara mensagem, nem fala com o CRM ou com o n8n: a equipe usa a tela para
// combinar etapas, textos, botões e saídas antes de alguém montar o fluxo de verdade.
//
//   csu_fluxo_acolhimento  uma linha só (id = 1) com o fluxo em JSONB, quem salvou e quando.
//                          Sem linha = o fluxo inicial (server/dados/fluxo-acolhimento-inicial.json).
//
// Formato: { nodes: [{ id, title, content, type, x, y, buttons? }], edges: [{ from, to, label }] }.
// x e y são a posição do cartão no mapa; as saídas (edges) ligam etapas pelos ids.

const INICIAL = require('./dados/fluxo-acolhimento-inicial.json');

const TIPOS = ['trigger', 'message', 'decision', 'action', 'success'];
const LIMITES = {
  etapas: 120,
  saidas: 300,
  titulo: 120,
  conteudo: 4000,
  rotulo: 60,
  botoes: 3,     // botões de resposta do WhatsApp: até 3
  botao: 24,
  coord: 20000,
};
const ID = /^[A-Za-z0-9_-]{1,48}$/;

class FluxoInvalido extends Error {}

function texto(v, max) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').slice(0, max);
}
function coord(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(LIMITES.coord, Math.max(0, n)) : 0;
}

// Confere e limpa o fluxo que veio do navegador. Erro de formato vira FluxoInvalido (400).
// Saídas que apontam para etapa inexistente ou repetidas são descartadas, sem erro.
function normalizar(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new FluxoInvalido('O fluxo precisa ter etapas (nodes) e saídas (edges).');
  }
  if (!raw.nodes.length) throw new FluxoInvalido('O fluxo precisa ter pelo menos uma etapa.');
  if (raw.nodes.length > LIMITES.etapas) throw new FluxoInvalido(`O fluxo pode ter até ${LIMITES.etapas} etapas.`);
  if (raw.edges.length > LIMITES.saidas) throw new FluxoInvalido(`O fluxo pode ter até ${LIMITES.saidas} saídas.`);

  const ids = new Set();
  const nodes = raw.nodes.map((n, i) => {
    if (!n || typeof n !== 'object') throw new FluxoInvalido(`Etapa ${i + 1} em formato inválido.`);
    const id = String(n.id == null ? '' : n.id);
    if (!ID.test(id)) throw new FluxoInvalido(`Etapa ${i + 1}: id inválido.`);
    if (ids.has(id)) throw new FluxoInvalido(`Etapa ${i + 1}: id repetido (${id}).`);
    ids.add(id);
    const out = {
      id,
      title: texto(n.title, LIMITES.titulo).trim() || 'Sem título',
      content: texto(n.content, LIMITES.conteudo),
      type: TIPOS.includes(n.type) ? n.type : 'action',
      x: coord(n.x),
      y: coord(n.y),
    };
    const botoes = Array.isArray(n.buttons)
      ? n.buttons.map((b) => texto(b, LIMITES.botao).replace(/\n/g, ' ').trim()).filter(Boolean).slice(0, LIMITES.botoes)
      : [];
    if (botoes.length) out.buttons = botoes;
    return out;
  });

  const vistas = new Set();
  const edges = [];
  raw.edges.forEach((e) => {
    if (!e || typeof e !== 'object') return;
    const from = String(e.from == null ? '' : e.from);
    const to = String(e.to == null ? '' : e.to);
    if (!ids.has(from) || !ids.has(to)) return;
    const label = texto(e.label, LIMITES.rotulo).replace(/\n/g, ' ').trim();
    const chave = from + '\u0000' + to + '\u0000' + label;
    if (vistas.has(chave)) return;
    vistas.add(chave);
    edges.push({ from, to, label });
  });

  return { nodes, edges };
}

function inicial() {
  return normalizar(JSON.parse(JSON.stringify(INICIAL)));
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS csu_fluxo_acolhimento (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      fluxo JSONB NOT NULL,
      admin_id INTEGER REFERENCES csu_admins(id) ON DELETE SET NULL,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

let pronto = null;
function garantir(pool) {
  if (!pronto) pronto = ensureSchema(pool).catch((err) => { pronto = null; throw err; });
  return pronto;
}

// { fluxo, inicial: true|false, atualizado_em, atualizado_por }
async function ler(pool) {
  const r = await pool.query(`
    SELECT f.fluxo, f.atualizado_em, a.nome AS admin_nome
      FROM csu_fluxo_acolhimento f LEFT JOIN csu_admins a ON a.id = f.admin_id
     WHERE f.id = 1`);
  const row = r.rows[0];
  if (!row) return { fluxo: inicial(), inicial: true, atualizado_em: null, atualizado_por: null };
  let fluxo;
  try { fluxo = normalizar(row.fluxo); } catch (err) { fluxo = inicial(); }
  return { fluxo, inicial: false, atualizado_em: row.atualizado_em.toISOString(), atualizado_por: row.admin_nome || null };
}

class Conflito extends Error {}

// base = atualizado_em que a tela carregou (null se carregou o inicial). Se outra pessoa salvou
// depois disso, recusa (Conflito) para ninguém apagar a edição do outro sem ver.
async function salvar(pool, raw, { adminId, base } = {}) {
  const fluxo = normalizar(raw);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const atual = await client.query('SELECT atualizado_em FROM csu_fluxo_acolhimento WHERE id = 1 FOR UPDATE');
    const emAtual = atual.rows[0] ? atual.rows[0].atualizado_em.toISOString() : null;
    if (base !== undefined && (base || null) !== emAtual) throw new Conflito('Outra pessoa salvou o fluxo depois que você abriu a tela.');
    await client.query(
      `INSERT INTO csu_fluxo_acolhimento (id, fluxo, admin_id, atualizado_em) VALUES (1, $1::jsonb, $2, now())
       ON CONFLICT (id) DO UPDATE SET fluxo = EXCLUDED.fluxo, admin_id = EXCLUDED.admin_id, atualizado_em = now()`,
      [JSON.stringify(fluxo), adminId || null],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return ler(pool);
}

// Volta ao fluxo inicial (apaga a linha salva).
async function restaurar(pool) {
  await pool.query('DELETE FROM csu_fluxo_acolhimento WHERE id = 1');
  return ler(pool);
}

// GET /api/admin/fluxo-acolhimento        -> { success, fluxo, inicial, atualizado_em, atualizado_por, limites, tipos }
// PUT /api/admin/fluxo-acolhimento        { fluxo, base } -> o mesmo; 400 formato, 409 outra pessoa salvou antes
// PUT /api/admin/fluxo-acolhimento        { reset: true }  -> volta ao fluxo inicial
// O corpo do PUT pode passar dos 20 KB do parser geral: index.js põe um parser de 300 KB nesta rota.
function registrarRotas(app, { getPool, requireAdmin }) {
  const semBanco = (res) => res.status(503).json({ success: false, message: 'Banco de dados indisponível.' });
  const resposta = (r) => ({ success: true, ...r, limites: LIMITES, tipos: TIPOS });

  app.get('/api/admin/fluxo-acolhimento', requireAdmin, async (req, res) => {
    const pool = getPool();
    if (!pool) return semBanco(res);
    try {
      await garantir(pool);
      return res.json(resposta(await ler(pool)));
    } catch (err) {
      console.error('Falha ao ler o fluxo do acolhimento:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível carregar o fluxo.' });
    }
  });

  app.put('/api/admin/fluxo-acolhimento', requireAdmin, async (req, res) => {
    const pool = getPool();
    if (!pool) return semBanco(res);
    const body = req.body || {};
    try {
      await garantir(pool);
      if (body.reset === true) return res.json(resposta(await restaurar(pool)));
      const base = Object.prototype.hasOwnProperty.call(body, 'base') ? body.base : undefined;
      return res.json(resposta(await salvar(pool, body.fluxo, { adminId: req.admin && req.admin.id, base })));
    } catch (err) {
      if (err instanceof FluxoInvalido) return res.status(400).json({ success: false, message: err.message });
      if (err instanceof Conflito) return res.status(409).json({ success: false, message: err.message + ' Recarregue para ver a versão nova.' });
      console.error('Falha ao salvar o fluxo do acolhimento:', err.message);
      return res.status(500).json({ success: false, message: 'Não foi possível salvar o fluxo.' });
    }
  });
}

module.exports = { TIPOS, LIMITES, FluxoInvalido, Conflito, normalizar, inicial, ensureSchema, garantir, ler, salvar, restaurar, registrarRotas };
