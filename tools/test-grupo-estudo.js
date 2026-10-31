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
// banco local e apaga no fim. Recusa rodar fora de localhost. Usa o mesmo .env do servidor (GRUPO_MIDIA_DIR).

require('dotenv').config({ quiet: true });
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const db = require('../server/db');
const grupo = require('../server/grupo-estudo');

const LOCAIS = new Set(['localhost', '127.0.0.1', '::1']);
const URL_BASE = (() => { const i = process.argv.indexOf('--url'); return i >= 0 ? process.argv[i + 1] : `http://localhost:${process.env.PORT || 3000}`; })();
const DESLIGADO = process.argv.includes('--desligado');
const MIDIA_DIR = process.env.GRUPO_MIDIA_DIR || path.join(__dirname, '..', 'data', 'grupo-midia');

let falhas = 0;
function confere(cond, nome, extra) {
  console.log(`${cond ? 'OK  ' : 'FALHOU'} ${nome}${extra ? ` (${extra})` : ''}`);
  if (!cond) falhas++;
}

async function chamar(token, metodo, caminho, corpo, tipo) {
  const headers = { Authorization: `Bearer ${token}` };
  let body;
  if (Buffer.isBuffer(corpo)) { headers['Content-Type'] = tipo; body = corpo; } else if (corpo) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(corpo); }
  const res = await fetch(URL_BASE + caminho, { method: metodo, headers, body });
  const ct = res.headers.get('content-type') || '';
  let dados = null;
  if (ct.includes('json')) { try { dados = await res.json(); } catch (e) { /* sem corpo */ } } else { dados = Buffer.from(await res.arrayBuffer()); }
  return { status: res.status, body: dados, tipo: ct };
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

    // Estado limpo para o teste: sem silêncio nem bloqueio de rodadas anteriores.
    await pool.query('UPDATE csu_grupo_membros SET silenciado_ate = NULL WHERE aluno_id = ANY($1)', [[teste.id, fict[0].id, fict[1].id]]).catch(() => {});
    await pool.query('DELETE FROM csu_dm_bloqueios WHERE aluno_id = ANY($1)', [[teste.id, fict[0].id, fict[1].id]]).catch(() => {});
    // O limite de 6 mensagens por minuto vale também para o teste: espera a janela de quem vai enviar.
    const ultima = (await pool.query(
      "SELECT EXTRACT(EPOCH FROM (now() - max(criado_em)))::float AS s FROM csu_grupo_mensagens WHERE aluno_id = ANY($1) AND criado_em > now() - interval '1 minute'",
      [[teste.id, fict[0].id, fict[1].id]],
    ).catch(() => ({ rows: [{}] }))).rows[0].s;
    if (ultima != null) {
      const espera = Math.ceil(61 - ultima);
      console.log(`Esperando ${espera} s (limite de mensagens por minuto de um teste anterior)…`);
      await new Promise((r) => setTimeout(r, espera * 1000));
    }

    // ----- Visibilidade -----
    const meu = await chamar(tTeste, 'GET', '/api/grupos/meu');
    confere(meu.status === 200 && meu.body.grupo, 'aluno de teste vê o grupo do curso', meu.body && meu.body.grupo && meu.body.grupo.nome);
    confere(meu.body && /apagados/.test(meu.body.aviso || ''), 'a API traz o aviso de mídia (apagada em N dias)', meu.body && `${meu.body.midia_dias} dias`);
    confere((await chamar(tFora, 'GET', '/api/grupos/meu')).status === 404, 'aluno fora da lista recebe 404');
    confere((await chamar(tFora, 'GET', '/api/grupos/meu/conversas')).status === 404, 'aluno fora da lista não vê a lista de conversas (404)');
    confere((await chamar('token-invalido', 'GET', '/api/grupos/meu')).status === 401, 'sem sessão → 401');

    // ----- Grupo: mensagem normal -----
    const marca = `(teste ${Date.now().toString(36)})`;
    const normal = await chamar(tTeste, 'POST', '/api/grupos/meu/mensagens', { texto: `Alguém tem uma dica para estudar a unidade 2? ${marca}` });
    confere(normal.body && normal.body.mensagem && normal.body.mensagem.status === 'publicada', 'mensagem normal é publicada');
    const visto = await chamar(tBruna, 'GET', '/api/grupos/meu/mensagens');
    const vistoMsg = visto.body.mensagens.find((m) => m.texto.includes(marca));
    confere(Boolean(vistoMsg), 'colega fictícia vê a mensagem normal');
    confere(vistoMsg && !('aluno_id' in vistoMsg) && /^[A-ZÀ-Ú][a-zà-ú]+( [A-Z]\.)?$/.test(vistoMsg.autor), 'colega vê só "Nome I." (sem RGM, e-mail ou id)', vistoMsg && vistoMsg.autor);

    // ----- Grupo: bloqueios com explicação -----
    // (divididos entre dois alunos por causa do limite de 6 mensagens por minuto)
    const casos = [
      ['vendo gabarito da prova', 'fraude_academica', tTeste],
      ['me chama no zap 11 98765-4321', 'dados_pessoais', tTeste],
      ['olha esse material https://bit.ly/resumo-adm', 'spam', tTeste],
      ['que pergunta idiota, p*rra', 'assedio', tBruna],
      ['meu cpf é 123.456.789-00', 'dados_pessoais', tBruna],
    ];
    for (const [texto, cat, quem] of casos) {
      const r = await chamar(quem, 'POST', '/api/grupos/meu/mensagens', { texto: `${texto} ${marca}` });
      const m = r.body && r.body.mensagem;
      confere(m && m.status === 'bloqueada' && m.explicacao, `"${texto}" é bloqueada com explicação`, m ? m.explicacao.slice(0, 50) + '…' : r.body && r.body.message);
      if (!m) continue;
      const db2 = (await pool.query('SELECT categoria FROM csu_grupo_mensagens WHERE id = $1', [m.id])).rows[0];
      confere(db2 && db2.categoria === cat, `  categoria gravada = ${cat}`, db2 && db2.categoria);
      const colega = await chamar(tCarlos, 'GET', '/api/grupos/meu/mensagens');
      confere(!colega.body.mensagens.some((x) => x.id === m.id), '  colega não vê a mensagem bloqueada');
    }

    // ----- Retida e denúncia -----
    const retida = await chamar(tCarlos, 'POST', '/api/grupos/meu/mensagens', { texto: `o gabarito oficial já saiu? ${marca}` });
    confere(retida.body.mensagem.status === 'retida', 'mensagem ambígua fica retida ("em análise")');
    const cursor = (await chamar(tTeste, 'GET', '/api/grupos/meu/mensagens')).body.cursor;
    confere((await chamar(tTeste, 'POST', '/api/grupos/mensagens/0/denuncia', { motivo: 'spam' })).status === 400, 'denúncia com id inválido → 400');
    const alvo = (await chamar(tTeste, 'GET', '/api/grupos/meu/mensagens')).body.mensagens.find((m) => !m.minha && m.status === 'publicada' && !m.denunciada);
    confere((await chamar(tTeste, 'POST', `/api/grupos/mensagens/${alvo.id}/denuncia`, { motivo: 'outro' })).status === 200, 'aluno denuncia mensagem de colega');
    const propria = (await chamar(tTeste, 'GET', '/api/grupos/meu/mensagens')).body.mensagens.find((m) => m.minha && m.status === 'publicada');
    confere((await chamar(tTeste, 'POST', `/api/grupos/mensagens/${propria.id}/denuncia`, { motivo: 'outro' })).status === 400, 'não denuncia a própria mensagem');

    await chamar(tBruna, 'POST', '/api/grupos/meu/mensagens', { texto: `Bora revisar juntos amanhã? ${marca}` });
    const novas = await chamar(tTeste, 'GET', `/api/grupos/meu/mensagens?desde=${encodeURIComponent(cursor)}`);
    confere(novas.body.mensagens.some((m) => m.texto && m.texto.startsWith('Bora revisar')), 'polling (?desde=cursor) traz a mensagem nova');

    // ----- Conversa privada -----
    const lista = await chamar(tTeste, 'GET', '/api/grupos/meu/conversas');
    const bruna = lista.body.colegas.find((c) => c.nome.startsWith('Bruna'));
    const carlos = lista.body.colegas.find((c) => c.nome.startsWith('Carlos'));
    confere(lista.status === 200 && bruna && carlos && lista.body.grupo, 'lista traz o grupo e os colegas', `${lista.body.colegas.length} colega(s)`);
    confere(bruna && /^[a-f0-9]{32}$/.test(bruna.ref) && !('aluno_id' in bruna) && !('rgm' in bruna), 'colega é identificado por ref aleatória, sem id/RGM');
    const dm = await chamar(tTeste, 'POST', `/api/grupos/conversas/${bruna.ref}/mensagens`, { texto: `Oi Bruna, vamos estudar juntas? ${marca}` });
    confere(dm.body && dm.body.mensagem && dm.body.mensagem.status === 'publicada', 'mensagem privada normal é publicada');
    const listaBruna = await chamar(tBruna, 'GET', '/api/grupos/meu/conversas');
    const comTeste = listaBruna.body.colegas.find((c) => c.ultima && c.ultima.texto.includes(marca));
    confere(comTeste && comTeste.nao_lidas >= 1, 'Bruna vê a conversa com não lida', comTeste && `${comTeste.nao_lidas} não lida(s)`);
    const dmBruna = await chamar(tBruna, 'GET', `/api/grupos/conversas/${comTeste.ref}/mensagens`);
    confere(dmBruna.body.mensagens.some((m) => m.texto.includes('vamos estudar juntas')), 'Bruna lê a mensagem privada');
    const lidaDepois = (await chamar(tBruna, 'GET', '/api/grupos/meu/conversas')).body.colegas.find((c) => c.ref === comTeste.ref);
    confere(lidaDepois.nao_lidas === 0, 'ao abrir, a conversa fica lida');
    const refBrunaParaCarlos = (await chamar(tCarlos, 'GET', '/api/grupos/meu/conversas')).body.colegas.find((c) => c.nome.startsWith('Bruna')).ref;
    const carlosVe = await chamar(tCarlos, 'GET', `/api/grupos/conversas/${refBrunaParaCarlos}/mensagens`);
    confere(!carlosVe.body.mensagens.some((m) => m.texto.includes('vamos estudar juntas')), 'terceiro não vê a conversa privada dos outros');
    confere((await chamar(tTeste, 'GET', '/api/grupos/meu/mensagens')).body.mensagens.every((m) => !m.texto.includes('vamos estudar juntas')), 'mensagem privada não aparece no grupo');
    const dmTel = await chamar(tCarlos, 'POST', `/api/grupos/conversas/${refBrunaParaCarlos}/mensagens`, { texto: `me passa teu whats ${marca}` });
    confere(dmTel.body.mensagem && dmTel.body.mensagem.status === 'bloqueada', 'no privado, pedir WhatsApp também é bloqueado');
    confere((await chamar(tTeste, 'GET', '/api/grupos/conversas/naoexiste/mensagens')).status === 404, 'ref inexistente → 404');

    // ----- Fotos e áudios -----
    const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 20, g: 80, b: 180 } } })
      .withMetadata({ exif: { IFD0: { Copyright: 'teste-gps', Artist: 'fulano' } } }).jpeg().toBuffer();
    const foto = await chamar(tCarlos, 'POST', `/api/grupos/meu/midia?tipo=imagem&legenda=${encodeURIComponent('meu resumo da unidade 3')}`, png, 'image/jpeg');
    const fm = foto.body && foto.body.mensagem;
    confere(fm && fm.status === 'retida' && fm.midia && fm.midia.tipo === 'imagem', 'foto vai para a equipe ("em análise")', fm && fm.explicacao && fm.explicacao.slice(0, 50) + '…');
    const arqRow = (await pool.query('SELECT midia_arquivo, midia_expira_em FROM csu_grupo_mensagens WHERE id = $1', [fm.id])).rows[0];
    confere(arqRow && fs.existsSync(path.join(MIDIA_DIR, arqRow.midia_arquivo)), 'arquivo gravado em disco');
    const diasExp = arqRow && (new Date(arqRow.midia_expira_em) - Date.now()) / 86400000;
    confere(diasExp > 6.9 && diasExp < 7.1, 'expira em 7 dias', diasExp && diasExp.toFixed(2));
    const meta = await sharp(fs.readFileSync(path.join(MIDIA_DIR, arqRow.midia_arquivo))).metadata();
    confere(!meta.exif && meta.format === 'webp', 'foto regravada em WebP sem metadados (EXIF)', meta.format);
    confere((await chamar(tCarlos, 'GET', `/api/grupos/midia/${fm.id}`)).status === 200, 'autor vê a própria foto em análise');
    confere((await chamar(tBruna, 'GET', `/api/grupos/midia/${fm.id}`)).status === 404, 'colega não baixa foto em análise');
    const legBloq = await chamar(tCarlos, 'POST', `/api/grupos/meu/midia?tipo=imagem&legenda=${encodeURIComponent('gabarito da AV1, vendo')}`, png, 'image/jpeg');
    confere(legBloq.body.mensagem && legBloq.body.mensagem.status === 'bloqueada' && legBloq.body.mensagem.midia.apagada, 'foto com legenda de venda de gabarito é bloqueada e o arquivo nem é guardado');
    confere((await chamar(tCarlos, 'POST', '/api/grupos/meu/midia?tipo=imagem', Buffer.from('nao sou imagem'), 'image/png')).status === 400, 'arquivo que não é imagem → 400');
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), crypto.randomBytes(2000)]);
    const au = await chamar(tTeste, 'POST', `/api/grupos/conversas/${bruna.ref}/midia?tipo=audio&duracao=4`, webm, 'audio/webm');
    confere(au.body && au.body.mensagem && au.body.mensagem.status === 'retida' && au.body.mensagem.midia.duracao === 4, 'áudio no privado vai para a equipe', au.body && au.body.message);

    // ----- Fila do admin -----
    const fila = await chamar(tAdmin, 'GET', '/api/admin/grupos/fila');
    confere(fila.status === 200, 'admin abre a fila');
    const pend = fila.body.pendentes.map((m) => m.id);
    confere(pend.includes(retida.body.mensagem.id) && pend.includes(fm.id) && pend.includes(au.body.mensagem.id), 'fila mostra retidas, foto e áudio', `${fila.body.pendentes.length} pendente(s)`);
    const auFila = fila.body.pendentes.find((m) => m.id === au.body.mensagem.id);
    confere(auFila && auFila.conversa_id && auFila.destinatario, 'áudio privado aparece como conversa privada, com o destinatário', auFila && auFila.destinatario);
    confere(fila.body.denunciadas.some((m) => m.id === alvo.id), 'fila mostra a denunciada');
    confere((await chamar(tAdmin, 'GET', `/api/admin/grupos/midia/${fm.id}`)).tipo.includes('image/webp'), 'admin vê a foto');
    confere((await chamar(tTeste, 'GET', '/api/admin/grupos/fila')).status === 401, 'aluno não acessa a fila do admin');

    confere((await chamar(tAdmin, 'POST', `/api/admin/grupos/mensagens/${retida.body.mensagem.id}/acao`, { acao: 'publicar' })).status === 200, 'admin publica a retida');
    const depois = await chamar(tTeste, 'GET', `/api/grupos/meu/mensagens?desde=${encodeURIComponent(cursor)}`);
    confere(depois.body.mensagens.some((m) => m.id === retida.body.mensagem.id && m.status === 'publicada'), 'a aprovada chega aos colegas pelo polling');
    await chamar(tAdmin, 'POST', `/api/admin/grupos/mensagens/${fm.id}/acao`, { acao: 'publicar' });
    const fotoColega = await chamar(tBruna, 'GET', `/api/grupos/midia/${fm.id}`);
    confere(fotoColega.status === 200 && fotoColega.tipo.includes('image/webp'), 'foto aprovada: colega baixa');

    // ----- Apagamento depois do prazo -----
    await pool.query("UPDATE csu_grupo_mensagens SET midia_expira_em = now() - interval '1 minute' WHERE id = $1", [fm.id]);
    await grupo.limparMidia(pool);
    confere(!fs.existsSync(path.join(MIDIA_DIR, arqRow.midia_arquivo)), 'depois do prazo o arquivo é apagado do disco');
    confere((await chamar(tBruna, 'GET', `/api/grupos/midia/${fm.id}`)).status === 410, 'mídia vencida responde 410');
    const msgVencida = (await chamar(tBruna, 'GET', '/api/grupos/meu/mensagens')).body.mensagens.find((m) => m.id === fm.id);
    confere(msgVencida && msgVencida.midia && msgVencida.midia.apagada && msgVencida.texto, 'a mensagem fica, com "foto apagada" e a legenda');

    // ----- Bloqueio no privado -----
    confere((await chamar(tBruna, 'POST', `/api/grupos/conversas/${comTeste.ref}/bloqueio`, { bloquear: true })).status === 200, 'Bruna bloqueia o colega');
    const barrado = await chamar(tTeste, 'POST', `/api/grupos/conversas/${bruna.ref}/mensagens`, { texto: `oi? ${marca}` });
    confere(barrado.status === 403, 'bloqueado não consegue mandar mensagem privada', barrado.body && barrado.body.message);
    await chamar(tBruna, 'POST', `/api/grupos/conversas/${comTeste.ref}/bloqueio`, { bloquear: false });

    // ----- Silêncio e csu_eventos -----
    const sil = await chamar(tAdmin, 'POST', `/api/admin/grupos/mensagens/${au.body.mensagem.id}/acao`, { acao: 'silenciar', horas: 24, remover: true });
    confere(sil.status === 200, 'admin silencia o autor por 24 h e remove o áudio');
    const bloqueioSil = await chamar(tTeste, 'POST', '/api/grupos/meu/mensagens', { texto: `posso falar? ${marca}` });
    confere(bloqueioSil.status === 403, 'aluno silenciado não envia', bloqueioSil.body && bloqueioSil.body.message);
    const ev = await pool.query("SELECT dados->>'acao' AS acao FROM csu_eventos WHERE nome = 'grupo_moderacao' AND criado_em > now() - interval '5 minutes'");
    const acoes = ev.rows.map((r) => r.acao);
    confere(['publicar', 'silenciar', 'denuncia', 'bloqueio_aluno'].every((a) => acoes.includes(a)), 'ações ficam em csu_eventos (grupo_moderacao)', [...new Set(acoes)].join(','));
    const evTexto = await pool.query("SELECT count(*)::int AS n FROM csu_eventos WHERE nome LIKE 'grupo_%' AND dados::text LIKE $1", [`%${marca}%`]);
    confere(evTexto.rows[0].n === 0, 'csu_eventos não guarda o texto das mensagens');

    await pool.query('UPDATE csu_grupo_membros SET silenciado_ate = NULL WHERE aluno_id = ANY($1)', [[teste.id, fict[0].id, fict[1].id]]);
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
