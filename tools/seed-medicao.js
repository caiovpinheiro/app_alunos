#!/usr/bin/env node
'use strict';

// Seed LOCAL da aba Medição: ~140 contas fictícias nas últimas 11 semanas, com acessos, entradas (?o=),
// falhas de login, módulos concluídos, "Conseguiu fazer?", saídas para a faculdade, "Fazer agora",
// ofertas e pedidos de ajuda. Recusa rodar fora de localhost. Rodar de novo apaga e recria o que criou.
//
//   node tools/seed-medicao.js            # cria e muda o corte (contar_desde) do banco local para 11 semanas atrás
//   node tools/seed-medicao.js --limpar   # só apaga as contas fictícias
//
// Contas: medicao.N@exemplo.invalid, RGM 9800NNNN. Números aleatórios com semente fixa (sempre os mesmos).

require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const db = require('../server/db');
const acompanhamento = require('../server/acompanhamento');
const trilha = require('../server/trilha');
const avaliacoes = require('../server/avaliacoes');
const ajudaPedidos = require('../server/ajuda-pedidos');
const instrumentacao = require('../server/instrumentacao');

const LOCAIS = new Set(['localhost', '127.0.0.1', '::1']);
const DIA = 86400000;
const AGORA = Date.now();

let semente = 20261106;
function rnd() { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; }
function chance(p) { return rnd() < p; }
function escolhe(l) { return l[Math.floor(rnd() * l.length)]; }
function ate(t) { return new Date(Math.min(t, AGORA - 60000)); }

async function main() {
  const host = String(process.env.DATABASE_HOST || '').trim();
  if (!LOCAIS.has(host)) { console.error(`Recusado: DATABASE_HOST="${host}" não é local.`); process.exit(1); }
  const pool = db.createPool();
  await db.ensureSchema(pool);
  await Promise.all([acompanhamento.ensureSchema(pool), trilha.ensureSchema(pool), avaliacoes.ensureSchema(pool), instrumentacao.ensureSchema(pool)]);
  await ajudaPedidos.ensureSchema(pool);

  await pool.query(`DELETE FROM csu_avaliacoes WHERE rgm LIKE '9800%'`);
  await pool.query(`DELETE FROM csu_alunos WHERE email LIKE 'medicao.%@exemplo.invalid'`);
  if (process.argv.includes('--limpar')) { console.log('Contas fictícias apagadas.'); await pool.end(); return; }

  const corte = new Date(AGORA - 77 * DIA).toISOString().slice(0, 10);
  await acompanhamento.salvarConfig(pool, { faixas: { ...(await acompanhamento.lerConfig(pool)).faixas, contar_desde: corte } }, null);

  const hash = await bcrypt.hash('naousada', 4);
  const medicaoDesde = AGORA - 21 * DIA;   // origem (?o=) e falhas passam a ser gravadas 3 semanas atrás
  const praticaDesde = AGORA - 21 * DIA;   // "Conseguiu fazer?" existe há 3 semanas
  const videos = ['acesso-email-senha', 'acesso-criar-senha', 'acesso-authenticator', 'acesso-entrar-duda', 'tut_11', 'tut_dp', 'pagar-pix', 'pagar-boleto'];
  const faqs = ['senha-nao-funciona', 'numero-authenticator', 'email-academico', 'onde-aulas', 'dp-adaptacao', 'primeira-mensalidade', 'vencimento-desconto'];
  const ruins = { 'video:acesso-authenticator': 0.55, 'faq:numero-authenticator': 0.6, 'video:acesso-email-senha': 0.3, 'faq:senha-nao-funciona': 0.4 };
  const naoModulo = { 1: 0.38, 2: 0.12, 3: 0.22 };
  let n = 0; let eventos = 0;

  let pk = 0;
  // Pedido de ajuda aceito a partir de uma oferta, com atendimento e resolução em tempos variados.
  const pedido = async (alunoId, origem, em) => {
    pk += 1;
    const criado = Math.min(em, AGORA - 600000);
    const atendido = chance(0.8) ? criado + Math.floor(rnd() * 5 * 3600000) + 300000 : null;
    const resolvido = atendido && chance(0.75) ? atendido + Math.floor(rnd() * 20 * 3600000) + 600000 : null;
    await pool.query(
      `INSERT INTO csu_pedidos_ajuda (protocolo, aluno_id, origem, situacao, criado_em, atendido_em, resolvido_em) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [`AJ-SEED${pk}`, alunoId, origem, resolvido ? 'resolvido' : atendido ? 'em_atendimento' : 'aberto', new Date(criado), atendido ? ate(atendido) : null, resolvido ? ate(resolvido) : null]);
  };
  const ev = async (alunoId, nome, tela, dados, em) => {
    eventos += 1;
    await pool.query('INSERT INTO csu_eventos (aluno_id, sessao, nome, tela, dados, criado_em) VALUES ($1, $2, $3, $4, $5::jsonb, $6)',
      [alunoId, 'seed-medicao', nome, tela, JSON.stringify(dados), ate(em)]);
  };

  for (let semana = 10; semana >= 0; semana -= 1) {
    const qtd = 8 + Math.round((10 - semana) * 1.4) + Math.floor(rnd() * 4);
    const fatorVolta = 0.55 + 0.35 * Math.sin(semana);  // coortes diferentes entre si
    for (let i = 0; i < qtd; i += 1) {
      n += 1;
      const criada = AGORA - semana * 7 * DIA - Math.floor(rnd() * 7 * DIA);
      if (criada > AGORA - 3600000) continue;
      const rgm = String(98000000 + n);
      const entrou = chance(0.62);
      const primeiro = entrou ? ate(criada + Math.floor(rnd() * (chance(0.6) ? 0.4 : 3)) * DIA + 3600000).getTime() : null;
      const r = await pool.query(
        `INSERT INTO csu_alunos (email, rgm, nome, pw_hash, created_at, primeiro_login_em, ultimo_login_em, logins)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7) RETURNING id`,
        [`medicao.${n}@exemplo.invalid`, rgm, `Aluno Fictício ${n}`, hash, new Date(criada), primeiro ? new Date(primeiro) : null, entrou ? 1 : 0]);
      const id = r.rows[0].id;
      if (!entrou) continue;

      // Acessos: D0 e voltas que ficam mais raras com o tempo.
      const dias = [0];
      for (let k = 1; k <= 20; k += 1) if (chance((0.42 * fatorVolta) / Math.sqrt(k))) dias.push(k);
      for (const k of dias) {
        const ini = primeiro + k * DIA + Math.floor(rnd() * 3 * 3600000);
        if (ini > AGORA) break;
        await pool.query(
          `INSERT INTO csu_acessos (sessao, aluno_id, inicio, fim, segundos_ativos, telas, cliques, dispositivo) VALUES ($1, $2, $3, $4, $5, 3, 9, $6)`,
          [`seed-${id}-${k}`, id, new Date(ini), ate(ini + 900000), 300 + Math.floor(rnd() * 900), chance(0.7) ? 'celular' : 'computador']);
      }

      // Origem do primeiro acesso: só existe para quem entrou depois que a medida começou.
      if (primeiro >= medicaoDesde) {
        const origem = escolhe(['bv', 'bv', 'bv', 'bv', 'reenvio', 'reenvio', 'polo', null, null, null]);
        await pool.query('INSERT INTO csu_entradas (aluno_id, origem, primeira, via, criado_em) VALUES ($1, $2, TRUE, $3, $4)', [id, origem, chance(0.1) ? 'cadastro' : 'login', new Date(primeiro)]);
        if (dias.length > 1) await pool.query('INSERT INTO csu_entradas (aluno_id, origem, primeira, criado_em) VALUES ($1, $2, FALSE, $3)', [id, chance(0.3) ? 'reenvio' : null, ate(primeiro + dias[1] * DIA)]);
      }

      // Aula: quem começa, até onde vai (o módulo 1 segura mais gente).
      if (!chance(0.7)) continue;
      let t = primeiro + 600000;
      const m1 = t;
      if (t >= praticaDesde) {
        const escolha = chance(0.5) ? 'agora' : chance(0.6) ? 'depois' : null;
        if (escolha) await ev(id, 'aula_pratica_escolha', '/trilha', { escolha }, t + 120000);
        if (escolha === 'agora') {
          if (chance(0.6)) await ev(id, 'saida_externa', '/trilha', { destino: escolhe(['email_academico', 'email_academico', 'loja_authenticator', 'loja_duda']), tela: '/trilha', modulo: 1 }, t + 300000);
          if (chance(0.3)) await ev(id, 'saida_externa', '/trilha', { destino: 'ava', tela: '/trilha', modulo: 1 }, t + 900000);
        }
        await ev(id, 'aula_cartao_exibido', '/trilha', { estado: 'comecar', modulo: 1 }, t);
        if (chance(0.15)) await ev(id, 'aula_preferencia', '/trilha', { preferencia: escolhe(['letra_maior', 'video_devagar', 'ver_tudo']), ligado: true }, t + 60000);
      }
      for (let nivel = 1; nivel <= 7; nivel += 1) {
        if (!chance(nivel === 1 ? 0.68 : 0.93)) {
          if (t >= praticaDesde - DIA && chance(0.8)) {
            const origem = escolhe(['travei', 'travei', 'quiz_erros', 'video_pausas', 'parado']);
            await ev(id, 'ajuda_oferecida', '/trilha', { origem, nivel, automatica: true }, t + 600000);
            if (chance(0.4)) await ev(id, 'ajuda_recusada', '/trilha', { origem, nivel }, t + 660000);
            else if (chance(0.6)) await pedido(id, origem, t + 700000);
          }
          break;
        }
        t += Math.floor(rnd() * 0.6 * DIA) + 1200000;
        if (t > AGORA) break;
        await pool.query(`INSERT INTO csu_trilha_progresso (aluno_id, nivel, video_ok, pontos, concluido_em, atualizado_em) VALUES ($1, $2, TRUE, 10, $3, $3)`, [id, nivel, new Date(t)]);
        if (t >= praticaDesde && chance(0.68)) {
          await pool.query(`INSERT INTO csu_avaliacoes (rgm, tipo, conteudo_id, voto, criado_em, atualizado_em) VALUES ($1, 'pratica', $2, $3, $4, $4)`,
            [rgm, `modulo:${nivel}`, chance(naoModulo[nivel] || 0.07) ? -1 : 1, ate(t + 60000)]);
        }
        if (nivel === 2 && t >= medicaoDesde && chance(0.5)) await ev(id, 'saida_externa', '/trilha', { destino: 'area_aluno', tela: '/trilha', modulo: 2 }, t);
        if (nivel === 3 && t >= medicaoDesde && chance(0.55)) await ev(id, 'saida_externa', '/trilha', { destino: 'ava', tela: '/trilha', modulo: 3 }, t);
      }
      if (m1 >= medicaoDesde && chance(0.35)) await ev(id, 'saida_externa', '/meu-semestre', { destino: escolhe(['ava', 'ava', 'area_aluno']), tela: '/meu-semestre' }, m1 + 2 * DIA);

      // Central: vídeos e dúvidas abertos, com resposta para parte deles.
      if (primeiro >= praticaDesde - 3 * DIA && chance(0.55)) {
        const quantos = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < quantos; k += 1) {
          const tipo = chance(0.55) ? 'video' : 'faq';
          const cid = escolhe(tipo === 'video' ? videos : faqs);
          const em = Math.max(primeiro, praticaDesde) + Math.floor(rnd() * 2 * DIA);
          await ev(id, tipo === 'video' ? 'central_video' : 'faq_aberta', '/tutoriais', { id: cid }, em);
          if (chance(0.5)) {
            const ruim = chance(ruins[`${tipo}:${cid}`] || 0.1);
            await pool.query(`INSERT INTO csu_avaliacoes (rgm, tipo, conteudo_id, voto, criado_em, atualizado_em) VALUES ($1, 'pratica', $2, $3, $4, $4)
                              ON CONFLICT DO NOTHING`, [rgm, `${tipo}:${cid}`, ruim ? -1 : 1, ate(em + 120000)]);
            if (ruim && chance(0.9)) {
              await ev(id, 'ajuda_oferecida', '/tutoriais', { origem: 'nao_funcionou', automatica: false }, em + 130000);
              if (chance(0.35)) await ev(id, 'ajuda_recusada', '/tutoriais', { origem: 'nao_funcionou' }, em + 140000);
              else if (chance(0.6)) await pedido(id, 'nao_funcionou', em + 150000);
            }
          }
        }
      }
    }
  }

  // Pedidos pelo painel de Ajuda (sem oferta antes).
  const alunos = (await pool.query(`SELECT id FROM csu_alunos WHERE email LIKE 'medicao.%' AND primeiro_login_em > now() - interval '20 days'`)).rows;
  for (let k = 0; k < 3 && alunos.length; k += 1) await pedido(escolhe(alunos).id, 'ajuda_painel', AGORA - Math.floor(rnd() * 18 * DIA));

  // Falhas de login nos últimos 21 dias.
  const ids = (await pool.query(`SELECT id FROM csu_alunos WHERE email LIKE 'medicao.%'`)).rows.map((x) => x.id);
  for (let d = 0; d < 21; d += 1) {
    const qtd = Math.floor(rnd() * 9);
    for (let k = 0; k < qtd; k += 1) {
      const motivo = escolhe(['senha_incorreta', 'senha_incorreta', 'senha_incorreta', 'conta_nao_encontrada', 'conta_nao_encontrada', 'esqueci_senha', 'campos_vazios']);
      const alunoId = motivo === 'conta_nao_encontrada' || motivo === 'campos_vazios' ? null : escolhe(ids);
      await pool.query('INSERT INTO csu_login_falhas (aluno_id, motivo, origem, criado_em) VALUES ($1, $2, $3, $4)',
        [alunoId, motivo, chance(0.5) ? 'bv' : null, ate(AGORA - d * DIA - Math.floor(rnd() * DIA))]);
    }
  }

  console.log(`${n} contas fictícias, ${eventos} eventos. Corte do admin local (contar_desde): ${corte}.`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
