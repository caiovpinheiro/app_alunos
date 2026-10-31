#!/usr/bin/env node
'use strict';

// Seed LOCAL do grupo de estudo: cria 2 alunos fictícios no mesmo curso do aluno de teste e algumas
// mensagens publicadas, para testar a conversa entre contas. Recusa rodar fora de localhost.
//
//   node tools/seed-grupo-estudo.js                    # curso do 1º aluno de GRUPO_ESTUDO_ATIVA_PARA que tem curso
//   node tools/seed-grupo-estudo.js --curso "Pedagogia"
//
// Contas fictícias (só no banco local; senha no padrão inicial do portal, Nome123@):
//   RGM 99000001 / grupo.teste1@exemplo.invalid / Bruna123@   (Bruna Teixeira Lopes)
//   RGM 99000002 / grupo.teste2@exemplo.invalid / Carlos123@  (Carlos Eduardo Nunes)
// Para elas verem o grupo, os RGMs precisam estar em GRUPO_ESTUDO_ATIVA_PARA (e em VERSAO_NOVA_PARA,
// se essa lista não for "*"), no .env local.

require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const db = require('../server/db');
const grupo = require('../server/grupo-estudo');
const acompanhamento = require('../server/acompanhamento');

const LOCAIS = new Set(['localhost', '127.0.0.1', '::1']);
const FICTICIOS = [
  { rgm: '99000001', email: 'grupo.teste1@exemplo.invalid', nome: 'Bruna Teixeira Lopes', senha: 'Bruna123@' },
  { rgm: '99000002', email: 'grupo.teste2@exemplo.invalid', nome: 'Carlos Eduardo Nunes', senha: 'Carlos123@' },
];
const MENSAGENS = [
  [0, 'Oi, turma! Alguém já começou a unidade 1? Fiquei com dúvida no conceito de planejamento estratégico.'],
  [1, 'Comecei sim! O resumo do final da unidade ajuda bastante. Planejamento estratégico é o de longo prazo, da empresa toda.'],
  [0, 'Valeu, Carlos! Bora combinar de revisar juntos antes da AV1?'],
];

function arg(nome) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const host = String(process.env.DATABASE_HOST || '').trim();
  if (!LOCAIS.has(host)) {
    console.error('Recusado: DATABASE_HOST não é local. Este seed só roda contra o banco local.');
    process.exit(1);
  }
  const pool = db.createPool();
  try {
    await db.ensureSchema(pool);
    await acompanhamento.ensureSchema(pool);
    await grupo.ensureSchema(pool);

    let curso = arg('--curso');
    if (!curso) {
      const r = await pool.query("SELECT id, rgm, email, curso FROM csu_alunos WHERE curso IS NOT NULL AND btrim(curso) <> '' ORDER BY id");
      const teste = r.rows.find((a) => grupo.liberadoPara(a) && !FICTICIOS.some((f) => f.rgm === a.rgm));
      if (!teste) throw new Error('Nenhum aluno de GRUPO_ESTUDO_ATIVA_PARA tem curso. Use --curso "Nome do curso".');
      curso = teste.curso;
      console.log(`Curso do aluno de teste (id ${teste.id}): ${curso}`);
    }

    const ids = [];
    for (const f of FICTICIOS) {
      const hash = await bcrypt.hash(f.senha, 10);
      const r = await pool.query(
        `INSERT INTO csu_alunos (email, rgm, nome, pw_hash, curso)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (rgm) DO UPDATE SET curso = EXCLUDED.curso, nome = EXCLUDED.nome, pw_hash = EXCLUDED.pw_hash, ativo = TRUE
         RETURNING id`,
        [f.email, f.rgm, f.nome, hash, curso],
      );
      ids.push(r.rows[0].id);
      console.log(`Aluno fictício ${f.rgm} → id ${r.rows[0].id}`);
    }

    const chave = grupo.chaveCurso(curso);
    const g = (await pool.query(
      `INSERT INTO csu_grupos (chave, nome) VALUES ($1, $2) ON CONFLICT (chave) DO UPDATE SET chave = EXCLUDED.chave RETURNING id`,
      [chave, curso.replace(/\s+/g, ' ').trim()],
    )).rows[0];
    for (const id of ids) {
      await pool.query("INSERT INTO csu_grupo_membros (grupo_id, aluno_id, ref) VALUES ($1, $2, md5(random()::text || clock_timestamp()::text)) ON CONFLICT DO NOTHING", [g.id, id]);
    }
    const ja = await pool.query("SELECT count(*)::int AS n FROM csu_grupo_mensagens WHERE grupo_id = $1 AND moderador = 'seed'", [g.id]);
    if (!ja.rows[0].n) {
      let min = MENSAGENS.length * 7;
      for (const [quem, texto] of MENSAGENS) {
        await pool.query(
          `INSERT INTO csu_grupo_mensagens (grupo_id, aluno_id, texto, status, categoria, moderador, criado_em, publicada_em, atualizado_em)
           VALUES ($1, $2, $3, 'publicada', 'ok', 'seed', now() - ($4::int * interval '1 minute'), now() - ($4::int * interval '1 minute'), now() - ($4::int * interval '1 minute'))`,
          [g.id, ids[quem], texto, min],
        );
        min -= 7;
      }
      console.log(`${MENSAGENS.length} mensagens de exemplo no grupo "${curso}".`);
    } else {
      console.log('Mensagens de exemplo já existiam; nada novo.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Falha no seed:', err.message);
  process.exit(1);
});
