#!/usr/bin/env node
'use strict';

// Turma de demonstração para ver o admin com dados (Visão geral, Quem contatar, Aula Inaugural).
// Só roda contra banco local (DATABASE_HOST = localhost / 127.0.0.1). Uso:
//   node tools/seed-demo.js          cria ~48 alunos fictícios com e-mail @demo.local
//   node tools/seed-demo.js --limpar apaga só esses alunos (e tudo ligado a eles)

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const trilha = require('../server/trilha');

const host = String(process.env.DATABASE_HOST || '');
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`Recusado: DATABASE_HOST="${host}" não é local. Este script só roda em banco de teste.`);
  process.exit(1);
}

const pool = new Pool({
  host, port: Number(process.env.DATABASE_PORT) || 5432, database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, ssl: false,
});

const DOMINIO = '@demo.local';
const NOMES = ['Ana Paula Lima', 'Bruno Costa', 'Carla Mendes', 'Diego Rocha', 'Eduarda Alves', 'Felipe Souza', 'Gabriela Nunes', 'Henrique Dias',
  'Isabela Ramos', 'João Pedro Silva', 'Karina Lopes', 'Lucas Martins', 'Mariana Teixeira', 'Nicolas Barbosa', 'Olívia Cardoso', 'Paulo Henrique',
  'Queila Moraes', 'Rafael Gomes', 'Sabrina Pires', 'Thiago Araújo', 'Úrsula Freitas', 'Vinícius Castro', 'Wesley Ribeiro', 'Yasmin Correia',
  'Amanda Duarte', 'Breno Farias', 'Camila Vieira', 'Daniel Pacheco', 'Elaine Monteiro', 'Fábio Rezende', 'Giovana Borges', 'Hugo Batista',
  'Ingrid Sales', 'Jéssica Prado', 'Kevin Moura', 'Larissa Campos', 'Matheus Peixoto', 'Natália Brito', 'Otávio Leal', 'Patrícia Siqueira',
  'Renan Tavares', 'Simone Aguiar', 'Tatiane Rangel', 'Ulisses Fontes', 'Valéria Cunha', 'William Rocha', 'Ximena Paiva', 'Yuri Andrade'];
const CURSOS = ['Administração', 'Pedagogia', 'Ciências Contábeis', 'Gestão de Recursos Humanos', 'Análise e Desenvolvimento de Sistemas'];
const POLOS = ['Barra Funda', 'Sapopemba (Vila Ema)', 'Vila Prudente', 'Santana', 'Morumbi'];

// Perfil → quantos alunos. Cada perfil vira uma situação da Visão geral.
const PERFIS = [
  ['nunca_entrou', 8], ['sem_aula', 6], ['em_andamento', 10], ['travado', 7], ['sumiu', 5], ['sem_certificado', 4], ['certificado', 8],
];

const dia = 86400000;
const agora = Date.now();
const em = (diasAtras, horas = 0) => new Date(agora - diasAtras * dia + horas * 3600000);
const sorteio = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

async function limpar(c) {
  const r = await c.query(`DELETE FROM csu_alunos WHERE email LIKE '%' || $1 RETURNING id`, [DOMINIO]);
  return r.rowCount;
}

async function progresso(c, alunoId, nivel, { concluido, travei, quando, erros }) {
  const l = trilha.NIVEIS[nivel - 1];
  const respostas = {};
  if (concluido) l.qs.forEach((_, k) => { respostas[k] = { tries: erros && k === 0 ? [0, 1] : [1], ok: true }; });
  else if (erros) respostas[0] = { tries: [0, 2], ok: false };
  const partes = l.parts ? l.parts.map((_, i) => i) : [0];
  await c.query(
    `INSERT INTO csu_trilha_progresso (aluno_id, nivel, partes_vistas, video_ok, respostas, travei, pontos, concluido_em, criado_em, atualizado_em)
     VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $9)`,
    [alunoId, nivel, JSON.stringify(concluido ? partes : partes.slice(0, 1)), Boolean(concluido), JSON.stringify(respostas),
      JSON.stringify(travei ? { 0: travei } : {}), concluido ? trilha.PONTOS_MODULO : 0, concluido ? quando : null, quando],
  );
}

async function acesso(c, alunoId, quando, minutos) {
  const s = crypto.randomUUID();
  await c.query(`INSERT INTO csu_sessoes (token, aluno_id, created_at, expires_at) VALUES ($1, $2, $3, $3::timestamptz + interval '7 days')`,
    [crypto.randomBytes(24).toString('hex'), alunoId, quando]);
  await c.query(`INSERT INTO csu_acessos (sessao, aluno_id, inicio, fim, segundos_ativos, telas, cliques, dispositivo)
                 VALUES ($1, $2, $3, $3::timestamptz + ($4::int * interval '1 minute'), $5, $6, $7, 'celular')`,
    [s, alunoId, quando, minutos, minutos * 60, sorteio(2, 9), sorteio(5, 40)]);
  return s;
}

async function evento(c, alunoId, sessao, nome, dados, quando) {
  await c.query(`INSERT INTO csu_eventos (aluno_id, sessao, nome, dados, criado_em) VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [alunoId, sessao, nome, JSON.stringify(dados || {}), quando]);
}

async function voto(c, rgm, n, v) {
  await c.query(`INSERT INTO csu_avaliacoes (rgm, tipo, conteudo_id, voto) VALUES ($1, 'aula', $2, $3) ON CONFLICT DO NOTHING`, [rgm, 'modulo-' + n, v]);
}

async function criar(c) {
  const hash = await bcrypt.hash(crypto.randomBytes(12).toString('hex'), 8);
  const total = trilha.NIVEIS.length;
  let i = 0;
  for (const [perfil, n] of PERFIS) {
    for (let k = 0; k < n; k += 1, i += 1) {
      const nome = NOMES[i % NOMES.length];
      const rgm = String(26000000 + i * 137);
      const criada = em(sorteio(2, 25));
      const { rows: [a] } = await c.query(
        `INSERT INTO csu_alunos (email, rgm, nome, pw_hash, curso, unidade, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [nome.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(/ /g, '.') + i + DOMINIO, rgm, nome, hash, CURSOS[i % CURSOS.length], POLOS[i % POLOS.length], criada],
      );
      const id = a.id;
      if (perfil === 'nunca_entrou') continue;

      const ultimoDia = { sumiu: sorteio(9, 18), travado: sorteio(3, 8) }[perfil] ?? sorteio(0, 3);
      const primeiro = new Date(Math.min(agora - ultimoDia * dia, criada.getTime() + sorteio(1, 30) * 3600000));
      const nAcessos = perfil === 'sumiu' ? sorteio(1, 2) : sorteio(2, 7);
      let sessao = null;
      for (let j = 0; j < nAcessos; j += 1) {
        const t = new Date(primeiro.getTime() + ((agora - ultimoDia * dia - primeiro.getTime()) * j) / Math.max(1, nAcessos - 1));
        sessao = await acesso(c, id, t, sorteio(4, 25));
      }
      await c.query(`UPDATE csu_alunos SET primeiro_login_em = $2, ultimo_login_em = $3, logins = $4 WHERE id = $1`, [id, primeiro, em(ultimoDia), nAcessos]);

      const videos = sorteio(1, 5);
      for (let v = 0; v < videos; v += 1) {
        await evento(c, id, sessao, 'video_inicio', { video: 'tut_0' + v }, em(ultimoDia));
        if (Math.random() < 0.65) await evento(c, id, sessao, 'video_fim', { video: 'tut_0' + v }, em(ultimoDia));
      }
      if (i % 5 === 0) await evento(c, id, sessao, 'central_busca_sem_resultado', { termo: ['rematrícula', 'boleto atrasado', 'trancar curso', 'boleto atrasado'][i % 4] }, em(ultimoDia));

      if (perfil === 'sem_aula') continue;
      const feitos = { em_andamento: sorteio(2, 5), travado: sorteio(1, 3), sumiu: sorteio(1, 2), sem_certificado: total, certificado: total }[perfil];
      for (let m = 1; m <= Math.min(total, feitos + (feitos < total ? 1 : 0)); m += 1) {
        const concluido = m <= feitos;
        const travou = perfil === 'travado' && !concluido;
        await progresso(c, id, m, { concluido, travei: travou ? sorteio(1, 3) : 0, quando: em(ultimoDia), erros: m === 3 || (travou && Math.random() < 0.7) });
        if (concluido && Math.random() < 0.6) await voto(c, rgm, m, m === 3 && Math.random() < 0.5 ? -1 : 1);
        if (travou) {
          await evento(c, id, sessao, 'trilha_travei', { nivel: m }, em(ultimoDia));
          if (Math.random() < 0.6) await voto(c, rgm, m, -1);
        }
      }
      if (perfil === 'sem_certificado' && k < 2) await evento(c, id, sessao, 'certificado_erro', { mensagem: 'Curso não informado' }, em(ultimoDia));
      if (perfil === 'certificado') {
        await c.query(`INSERT INTO csu_certificados (certificate_id, aluno_id, email, nome, rgm, data_aula_inaugural, curso, unidade, created_at)
                       VALUES ($1, $2, $8, $3, $4, CURRENT_DATE, $5, $6, $7)`,
          ['DEMO-' + crypto.randomBytes(5).toString('hex'), id, nome, rgm, CURSOS[i % CURSOS.length], POLOS[i % POLOS.length], em(ultimoDia), 'demo' + id + DOMINIO]);
      }
      if (perfil === 'travado' && k === 0) {
        await c.query(`INSERT INTO csu_followups (aluno_id, motivo, canal, nota, criado_em) VALUES ($1, 'travou_trilha', 'whatsapp', 'Explicado o módulo 3', $2)`, [id, em(1)]);
      }
    }
  }
  return i;
}

(async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const removidos = await limpar(c);
    const criados = process.argv.includes('--limpar') ? 0 : await criar(c);
    await c.query('COMMIT');
    console.log(`Turma de demonstração: ${removidos} removido(s), ${criados} criado(s).`);
  } catch (err) {
    await c.query('ROLLBACK');
    console.error('Falhou:', err.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
