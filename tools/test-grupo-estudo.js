#!/usr/bin/env node
'use strict';

// Teste ponta a ponta do grupo de estudo contra o servidor LOCAL (docs/grupo-estudo.md).
// Pré-requisitos: banco local com `node tools/seed-grupo-estudo.js` rodado e o servidor de pé.
//
//   node tools/test-grupo-estudo.js                     # http://localhost:$PORT
//   node tools/test-grupo-estudo.js --url http://localhost:3047
//   node tools/test-grupo-estudo.js --desligado         # servidor com GRUPO_ESTUDO_ATIVA_PARA vazio: tudo 404
//
// Cria sessões temporárias (aluno de teste, 2 fictícios, 1 aluno fora da lista e o 1º admin) direto no
// banco local e apaga no fim. Recusa rodar fora de localhost.

require('dotenv').config({ quiet: true });
const crypto = require('node:crypto');
const db = require('../server/db');
const grupo = require('../server/grupo-estudo');

const LOCAIS = new Set(['localhost', '127.0.0.1', '::1']);
const URL_BASE = (() => { const i = process.argv.indexOf('--url'); return i >= 0 ? process.argv[i + 1] : `http://localhost:${process.env.PORT || 3000}`; })();
const DESLIGADO = process.argv.includes('--desligado');

let falhas = 0;
function confere(cond, nome, extra) {
  console.log(`${cond ? 'OK  ' : 'FALHOU'} ${nome}${extra ? ` (${extra})` : ''}`);
  if (!cond) falhas++;
}

async function chamar(token, metodo, caminho, corpo) {
  const res = await fetch(URL_BASE + caminho, {
    method: metodo,
    headers: Object.assign({ Authorization: `Bearer ${token}` }, corpo ? { 'Content-Type': 'application/json' } : {}),
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  let body = null;
  try { body = await res.json(); } catch (e) { /* sem corpo */ }
  return { status: res.status, body };
}

async function main() {
  if (!LOCAIS.has(String(process.env.DATABASE_HOST || '').trim())) {
    console.error('Recusado: DATABASE_HOST não é local.');
    process.exit(1);
  }
  const pool = db.createPool();
  const tokens = [];
  const adminTokens = [];
  const sessao = async (alunoId) => {
    const t = crypto.randomBytes(24).toString('hex');
    await pool.query("INSERT INTO csu_sessoes (token, aluno_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [t, alunoId]);
    tokens.push(t);
    return t;
  };
  try {
    const alunos = (await pool.query('SELECT id, rgm, email, curso FROM csu_alunos WHERE ativo ORDER BY id')).rows;
    const fict = alunos.filter((a) => ['99000001', '99000002'].includes(a.rgm));
    const teste = alunos.find((a) => grupo.liberadoPara(a) && !fict.includes(a) && a.curso);
    const fora = alunos.find((a) => !grupo.liberadoPara(a));
    const admin = (await pool.query('SELECT id FROM csu_admins WHERE ativo ORDER BY id LIMIT 1')).rows[0];
    if (!teste || fict.length < 2 || !fora || !admin) throw new Error('Faltam dados: rode o seed e confira GRUPO_ESTUDO_ATIVA_PARA no .env.');
    const tTeste = await sessao(teste.id);
    const tBruna = await sessao(fict[0].id);
    const tCarlos = await sessao(fict[1].id);
    const tFora = await sessao(fora.id);
    const tAdmin = crypto.randomBytes(24).toString('hex');
    await pool.query("INSERT INTO csu_admin_sessoes (token, admin_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [tAdmin, admin.id]);
    adminTokens.push(tAdmin);

    if (DESLIGADO) {
      confere((await chamar(tTeste, 'GET', '/api/grupos/meu')).status === 404, 'flag vazia: /api/grupos/meu → 404 para o aluno de teste');
      confere((await chamar(tAdmin, 'GET', '/api/admin/grupos/fila')).status === 404, 'flag vazia: /api/admin/grupos/fila → 404');
      return;
    }

    // O limite de 6 mensagens por minuto vale também para o teste: espera a janela de quem vai enviar.
    const ultima = (await pool.query(
      "SELECT EXTRACT(EPOCH FROM (now() - max(criado_em)))::float AS s FROM csu_grupo_mensagens WHERE aluno_id = ANY($1) AND criado_em > now() - interval '1 minute'",
      [[teste.id, fict[0].id, fict[1].id]],
    )).rows[0].s;
    if (ultima != null) {
      const espera = Math.ceil(61 - ultima);
      console.log(`Esperando ${espera} s (limite de mensagens por minuto de um teste anterior)…`);
      await new Promise((r) => setTimeout(r, espera * 1000));
    }

    // Visibilidade
    const meu = await chamar(tTeste, 'GET', '/api/grupos/meu');
    confere(meu.status === 200 && meu.body.grupo, 'aluno de teste vê o grupo do curso', meu.body && meu.body.grupo && meu.body.grupo.nome);
    confere((await chamar(tFora, 'GET', '/api/grupos/meu')).status === 404, 'aluno fora da lista recebe 404');
    confere((await chamar(tFora, 'GET', '/api/grupos/meu/mensagens')).status === 404, 'aluno fora da lista não lista mensagens (404)');
    confere((await chamar('token-invalido', 'GET', '/api/grupos/meu')).status === 401, 'sem sessão → 401');

    // Mensagem normal aparece para os colegas
    const marca = `(teste ${Date.now().toString(36)})`;
    const normal = await chamar(tTeste, 'POST', '/api/grupos/meu/mensagens', { texto: `Alguém tem uma dica para estudar a unidade 2? ${marca}` });
    confere(normal.body && normal.body.mensagem && normal.body.mensagem.status === 'publicada', 'mensagem normal é publicada');
    const visto = await chamar(tBruna, 'GET', '/api/grupos/meu/mensagens');
    const vistoMsg = visto.body.mensagens.find((m) => m.texto.includes(marca));
    confere(Boolean(vistoMsg), 'colega fictícia vê a mensagem normal');
    confere(vistoMsg && !('aluno_id' in vistoMsg) && !/@|\d{6,}/.test(vistoMsg.autor) && /^[A-ZÀ-Ú][a-zà-ú]+( [A-Z]\.)?$/.test(vistoMsg.autor), 'colega vê só "Nome I." (sem RGM, e-mail ou id)', vistoMsg && vistoMsg.autor);

    // Bloqueios com explicação
    const casos = [
      ['vendo gabarito da prova', 'fraude_academica'],
      ['me chama no zap 11 98765-4321', 'dados_pessoais'],
      ['olha esse material https://bit.ly/resumo-adm', 'spam'],
    ];
    for (const [texto, cat] of casos) {
      const r = await chamar(tTeste, 'POST', '/api/grupos/meu/mensagens', { texto: `${texto} ${marca}` });
      const m = r.body && r.body.mensagem;
      confere(m && m.status === 'bloqueada' && m.explicacao, `"${texto}" é bloqueada com explicação`, m ? m.explicacao && m.explicacao.slice(0, 60) + '…' : r.body && r.body.message);
      if (!m) continue;
      const db2 = (await pool.query('SELECT categoria FROM csu_grupo_mensagens WHERE id = $1', [m.id])).rows[0];
      confere(db2 && db2.categoria === cat, `  categoria gravada = ${cat}`, db2 && db2.categoria);
      const colega = await chamar(tCarlos, 'GET', '/api/grupos/meu/mensagens');
      confere(!colega.body.mensagens.some((x) => x.id === m.id), '  colega não vê a mensagem bloqueada');
    }

    // Retida (sinal sem bloqueio certo) e denúncia
    const retida = await chamar(tCarlos, 'POST', '/api/grupos/meu/mensagens', { texto: `o gabarito oficial já saiu? ${marca}` });
    confere(retida.body.mensagem.status === 'retida', 'mensagem ambígua fica retida ("em análise")');
    const ofensa = await chamar(tBruna, 'POST', '/api/grupos/meu/mensagens', { texto: `que pergunta idiota ${marca}` });
    confere(ofensa.body.mensagem.status === 'retida', 'ofensa leve fica retida para revisão humana');
    const cursor = (await chamar(tTeste, 'GET', '/api/grupos/meu/mensagens')).body.cursor;
    const den = await chamar(tTeste, 'POST', '/api/grupos/mensagens/0/denuncia', { motivo: 'spam' });
    confere(den.status === 400, 'denúncia com id inválido → 400');
    const alvo = (await chamar(tTeste, 'GET', '/api/grupos/meu/mensagens')).body.mensagens.find((m) => !m.minha && m.status === 'publicada');
    const den2 = await chamar(tTeste, 'POST', `/api/grupos/mensagens/${alvo.id}/denuncia`, { motivo: 'outro' });
    confere(den2.status === 200, 'aluno denuncia mensagem de colega');
    const propria = (await chamar(tTeste, 'GET', '/api/grupos/meu/mensagens')).body.mensagens.find((m) => m.minha && m.status === 'publicada');
    confere((await chamar(tTeste, 'POST', `/api/grupos/mensagens/${propria.id}/denuncia`, { motivo: 'outro' })).status === 400, 'não denuncia a própria mensagem');

    // Polling por cursor
    await chamar(tBruna, 'POST', '/api/grupos/meu/mensagens', { texto: `Bora revisar juntos amanhã? ${marca}` });
    const novas = await chamar(tTeste, 'GET', `/api/grupos/meu/mensagens?desde=${encodeURIComponent(cursor)}`);
    confere(novas.body.mensagens.some((m) => m.texto && m.texto.startsWith('Bora revisar')), 'polling (?desde=cursor) traz a mensagem nova');

    // Fila do admin
    const fila = await chamar(tAdmin, 'GET', '/api/admin/grupos/fila');
    confere(fila.status === 200, 'admin abre a fila');
    const pend = fila.body.pendentes.map((m) => m.id);
    confere(pend.includes(retida.body.mensagem.id) && pend.includes(ofensa.body.mensagem.id), 'fila mostra as retidas', `${fila.body.pendentes.length} pendente(s)`);
    confere(fila.body.denunciadas.some((m) => m.id === alvo.id), 'fila mostra a denunciada');
    confere(fila.body.bloqueadas.length >= 3, 'fila mostra as bloqueadas recentes', `${fila.body.bloqueadas.length}`);
    confere((await chamar(tTeste, 'GET', '/api/admin/grupos/fila')).status === 401, 'aluno não acessa a fila do admin');

    // Ações do admin + csu_eventos
    const aprovar = await chamar(tAdmin, 'POST', `/api/admin/grupos/mensagens/${retida.body.mensagem.id}/acao`, { acao: 'publicar' });
    confere(aprovar.status === 200, 'admin publica a retida');
    const depois = await chamar(tTeste, 'GET', `/api/grupos/meu/mensagens?desde=${encodeURIComponent(cursor)}`);
    confere(depois.body.mensagens.some((m) => m.id === retida.body.mensagem.id && m.status === 'publicada'), 'a aprovada chega aos colegas pelo polling');
    await chamar(tAdmin, 'POST', `/api/admin/grupos/mensagens/${ofensa.body.mensagem.id}/acao`, { acao: 'remover' });
    const sil = await chamar(tAdmin, 'POST', `/api/admin/grupos/mensagens/${ofensa.body.mensagem.id}/acao`, { acao: 'silenciar', horas: 24 });
    confere(sil.status === 200, 'admin silencia a autora por 24 h');
    const bloqueio = await chamar(tBruna, 'POST', '/api/grupos/meu/mensagens', { texto: `posso falar? ${marca}` });
    confere(bloqueio.status === 403, 'aluna silenciada não envia', bloqueio.body && bloqueio.body.message);
    const ev = await pool.query("SELECT dados->>'acao' AS acao FROM csu_eventos WHERE nome = 'grupo_moderacao' AND criado_em > now() - interval '5 minutes'");
    const acoes = ev.rows.map((r) => r.acao);
    confere(['publicar', 'remover', 'silenciar', 'denuncia'].every((a) => acoes.includes(a)), 'ações ficam em csu_eventos (grupo_moderacao)', acoes.join(','));
    const evTexto = await pool.query("SELECT count(*)::int AS n FROM csu_eventos WHERE nome LIKE 'grupo_%' AND dados::text LIKE $1", [`%${marca}%`]);
    confere(evTexto.rows[0].n === 0, 'csu_eventos não guarda o texto das mensagens');

    // Limpeza do silêncio (para o teste manual seguir)
    await pool.query("UPDATE csu_grupo_membros SET silenciado_ate = NULL WHERE aluno_id = $1", [fict[0].id]);
  } finally {
    if (tokens.length) await pool.query('DELETE FROM csu_sessoes WHERE token = ANY($1)', [tokens]);
    if (adminTokens.length) await pool.query('DELETE FROM csu_admin_sessoes WHERE token = ANY($1)', [adminTokens]);
    await pool.end();
  }
  console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
}

main().catch((err) => {
  console.error('Erro no teste:', err.message);
  process.exit(1);
});
