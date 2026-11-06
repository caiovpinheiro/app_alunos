'use strict';
// Certificado no mesmo dia: node tools/test-certificado.js
//
// Parte 1, sem banco: o PDF sem polo (a linha some, nada diz o que não se sabe) e com polo; o polo da planilha.
// Parte 2, com um Postgres LOCAL descartável: cria um banco temporário (createdb), roda a migração duas vezes
// e o fluxo real de server/certificado.js: 422 sem RGM, emissão sem polo, data da conclusão, idempotência
// (inclusive cliques simultâneos), polo do admin no mesmo dia, preenchimento depois do sync, avisos e
// atendimento lendo a conta, e a lista de quem ficou para trás. Apaga o banco no fim.
// Nunca lê o .env: só conecta em localhost / socket local. Sem Postgres local, a parte 2 é pulada (e diz isso).
// Os PDFs ficam em tools/output/certificado_sem_polo.pdf e certificado_completado.pdf.

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const CertificateGenerator = require('../public/js/certificate.js');
const dadosAcesso = require('../server/dadosAcesso');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'output');
let falhas = 0;
let passos = 0;

async function caso(nome, fn) {
  try {
    await fn();
    passos += 1;
    console.log(`  OK   ${nome}`);
  } catch (err) {
    falhas += 1;
    console.log(`  FALHOU ${nome} :: ${err.message}`);
  }
}

const assets = {
  backgroundBytes: new Uint8Array(readFileSync(path.join(ROOT, 'public/assets/certificado-modelo.jpg'))),
  fontBytes: new Uint8Array(readFileSync(path.join(ROOT, 'public/assets/fonts/Montserrat-Regular.ttf'))),
  boldBytes: new Uint8Array(readFileSync(path.join(ROOT, 'public/assets/fonts/Montserrat-Bold.ttf'))),
  assinaturaBytes: new Uint8Array(readFileSync(path.join(ROOT, 'public/assets/certificado-assinatura.png'))),
};

async function textoDoPdf(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');
}

// O que a rota devolve vira PDF do mesmo jeito que public/js/app.js faz.
function pdfDe(body) {
  return CertificateGenerator.generateCertificate({
    nome: body.nome,
    rgm: body.rgm,
    unidade: body.unidade,
    dataAulaISO: body.data_aula_inaugural,
    emissaoISO: body.created_at,
  }, assets);
}

async function semBanco() {
  console.log('\n=== Parte 1: PDF e planilha (sem banco) ===');
  mkdirSync(OUT_DIR, { recursive: true });
  const base = { nome: 'Ana Teste Silva', rgm: '1234567', dataAulaISO: '2026-11-05', emissaoISO: '2026-11-06T10:00:00-03:00' };

  await caso('PDF sem polo: sai, sem a linha do polo e sem texto inventado', async () => {
    const t = await textoDoPdf(await CertificateGenerator.generateCertificate({ ...base, unidade: null }, assets));
    const c = t.replace(/\s+/g, '');
    assert.ok(c.includes('ANATESTESILVA'), 'nome');
    assert.ok(c.includes('RGM1234567'), 'RGM');
    assert.ok(c.includes('05/11/2026'), 'data');
    assert.ok(!/polo/i.test(t), `não pode citar polo: "${t}"`);
    assert.ok(!/informad|pendente|aguard/i.test(t), 'nada de "não informado"/"pendente" no PDF');
  });

  await caso('PDF com polo: a linha "Polo Barra Funda" aparece', async () => {
    const t = await textoDoPdf(await CertificateGenerator.generateCertificate({ ...base, unidade: 'Barra Funda' }, assets));
    assert.ok(t.includes('Polo Barra Funda'), t);
  });

  await caso('PDF continua exigindo nome, RGM e data', async () => {
    await assert.rejects(CertificateGenerator.generateCertificate({ ...base, rgm: '' }, assets));
  });

  await caso('planilha do polo: polo reconhecido pela lista oficial', () => {
    assert.strictEqual(dadosAcesso.poloOficial('polo barra funda'), 'Barra Funda');
    assert.strictEqual(dadosAcesso.poloOficial('Freguesia do O'), 'Freguesia do Ó');
    assert.strictEqual(dadosAcesso.poloOficial('Taboão da Serra'), null); // dois polos
    assert.strictEqual(dadosAcesso.poloOficial(''), '');
    const linha = dadosAcesso.validarLinha({ rgm: '123.456-7', curso: 'Pedagogia', unidade: 'itapira' });
    assert.deepStrictEqual(linha.dados, { rgm: '1234567', curso: 'Pedagogia', unidade: 'Itapira', email_academico: '' });
    assert.strictEqual(dadosAcesso.validarLinha({ rgm: '1234567', unidade: 'Lua' }).ok, false);
  });
}

function hostLocal() {
  const h = process.env.PGHOST || 'localhost';
  if (!/^(localhost|127\.0\.0\.1|::1|\/.*)$/.test(h)) throw new Error(`PGHOST=${h} não é local: o teste só roda em Postgres local.`);
  return h;
}

async function comBanco() {
  console.log('\n=== Parte 2: fluxo com Postgres local descartável ===');
  const host = hostLocal();
  const nomeDb = `test_certificado_${process.pid}`;
  try {
    execFileSync('createdb', ['-h', host, nomeDb], { stdio: 'pipe' });
  } catch (err) {
    console.log(`  PULADO: sem Postgres local para criar o banco de teste (${String(err.message).split('\n')[0]}).`);
    return;
  }
  // Os módulos do servidor criam o próprio pool a partir de DATABASE_*: aqui nada disso é usado.
  const pool = new Pool({ host, database: nomeDb, user: process.env.PGUSER || os.userInfo().username, max: 6 });
  try {
    await fluxo(pool);
  } finally {
    await pool.end();
    execFileSync('dropdb', ['-h', host, nomeDb], { stdio: 'pipe' });
  }
}

async function fluxo(pool) {
  const db = require('../server/db');
  const trilha = require('../server/trilha');
  const certificado = require('../server/certificado');
  const avisos = require('../server/avisos');
  const atendimento = require('../server/atendimento');
  const sync = require('../server/sync-acessos');
  const TOTAL = trilha.NIVEIS.length;

  // Banco "de produção antiga": certificados com curso e polo NOT NULL e uma linha repetida.
  await pool.query(`
    CREATE TABLE csu_alunos (id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, rgm TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
      pw_hash TEXT NOT NULL, ativo BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE csu_certificados (id SERIAL PRIMARY KEY, certificate_id TEXT NOT NULL UNIQUE, aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id),
      email TEXT NOT NULL, nome TEXT NOT NULL, rgm TEXT NOT NULL, data_aula_inaugural DATE NOT NULL, curso TEXT NOT NULL,
      unidade TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL);
  `);
  await db.ensureSchema(pool);
  await db.ensureSchema(pool); // idempotente
  await trilha.ensureSchema(pool);

  await caso('migração: curso e polo do certificado aceitam NULL; colunas novas existem', async () => {
    const r = await pool.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'csu_certificados'`);
    const col = Object.fromEntries(r.rows.map((x) => [x.column_name, x.is_nullable]));
    assert.strictEqual(col.curso, 'YES');
    assert.strictEqual(col.unidade, 'YES');
    assert.ok(col.completado_em && col.baixado_em);
  });

  async function aluno(nome, rgm, extra = {}) {
    const email = `${nome.split(' ')[0].toLowerCase()}${rgm || 'x'}@teste.local`;
    const r = await pool.query(
      'INSERT INTO csu_alunos (email, rgm, nome, pw_hash, curso, unidade) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [email, rgm, nome, 'x', extra.curso || null, extra.unidade || null],
    );
    return r.rows[0].id;
  }
  async function concluir(id, quando, modulos = TOTAL) {
    for (let n = 1; n <= modulos; n += 1) {
      await pool.query(
        `INSERT INTO csu_trilha_progresso (aluno_id, nivel, pontos, concluido_em) VALUES ($1, $2::int, 10, $3::timestamptz + $2::int * interval '3 min')`,
        [id, n, quando],
      );
    }
  }
  // Mesma regra da rota (server/index.js): a 1ª emissão exige os módulos.
  const deps = {
    totalModulos: TOTAL,
    agora: new Date('2026-11-06T13:00:00Z'),
    exigirAula: async (alunoId) => {
      const st = trilha.statusCertificado(await trilha.getProgresso(pool, alunoId));
      return st.liberado ? null : { status: 422, body: { success: false, codigo: 'aula_incompleta' } };
    },
  };
  const qtd = async (id) => (await pool.query('SELECT count(*)::int AS n FROM csu_certificados WHERE aluno_id = $1', [id])).rows[0].n;

  const semRgm = await aluno('Bia Preparo', null);
  const bruno = await aluno('Bruno Hoje Santos', '2000001');
  const carla = await aluno('Carla Meio', '2000002');
  const davi = await aluno('Davi Clique', '2000003');
  const eva = await aluno('Eva Planilha', '2000004');
  await concluir(semRgm, '2026-11-06 09:00-03');
  await concluir(bruno, '2026-11-05 22:30-03'); // último módulo às 22:51 do dia 05 em Brasília (01:51 UTC do dia 06)
  await concluir(carla, '2026-11-06 09:00-03', 4);
  await concluir(davi, '2026-11-06 09:00-03');
  await concluir(eva, '2026-11-06 09:00-03');

  await caso('422 sem RGM: codigo sem_rgm e nada gravado', async () => {
    const out = await certificado.emitir(pool, semRgm, deps);
    assert.strictEqual(out.status, 422);
    assert.strictEqual(out.body.codigo, 'sem_rgm');
    assert.strictEqual(await qtd(semRgm), 0);
  });

  await caso('Aula incompleta continua bloqueando', async () => {
    const out = await certificado.emitir(pool, carla, deps);
    assert.strictEqual(out.status, 422);
    assert.strictEqual(out.body.codigo, 'aula_incompleta');
  });

  let primeiro;
  await caso('emissão sem polo no dia da conclusão: sai, com aviso e polo NULL', async () => {
    const out = await certificado.emitir(pool, bruno, deps);
    assert.strictEqual(out.status, 200, JSON.stringify(out.body));
    primeiro = out.body;
    assert.strictEqual(primeiro.unidade, null);
    assert.strictEqual(primeiro.curso, null);
    assert.strictEqual(primeiro.polo_pendente, true);
    assert.strictEqual(primeiro.aviso, certificado.MSG_SEM_POLO);
    const row = (await pool.query('SELECT curso, unidade FROM csu_certificados WHERE aluno_id = $1', [bruno])).rows[0];
    assert.deepStrictEqual(row, { curso: null, unidade: null });
  });

  await caso('data impressa = dia da conclusão em Brasília (05/11), não o do clique (06/11)', () => {
    assert.strictEqual(primeiro.data_aula_inaugural, '2026-11-05');
    assert.strictEqual(primeiro.created_at, '2026-11-06T10:00:00-03:00');
  });

  await caso('Início sabe que saiu sem polo', async () => {
    const e = await certificado.estado(pool, bruno);
    assert.deepStrictEqual({ ...e, emitido_em: undefined }, { emitido: true, emitido_em: undefined, sem_polo: true, polo_completado: false });
  });

  let pdfSemPolo;
  await caso('PDF do certificado sem polo gerado', async () => {
    pdfSemPolo = await pdfDe(primeiro);
    writeFileSync(path.join(OUT_DIR, 'certificado_sem_polo.pdf'), pdfSemPolo);
    const t = await textoDoPdf(pdfSemPolo);
    assert.ok(!/polo/i.test(t) && t.replace(/\s+/g, '').includes('05/11/2026'), t);
  });

  await caso('baixar de novo: mesmo registro e mesmo certificate_id', async () => {
    const out = await certificado.emitir(pool, bruno, deps);
    assert.strictEqual(out.body.certificate_id, primeiro.certificate_id);
    assert.strictEqual(out.body.reaproveitado, true);
    assert.strictEqual(await qtd(bruno), 1);
  });

  await caso('5 cliques ao mesmo tempo: um certificado só', async () => {
    const outs = await Promise.all([1, 2, 3, 4, 5].map(() => certificado.emitir(pool, davi, deps)));
    assert.ok(outs.every((o) => o.status === 200));
    assert.strictEqual(new Set(outs.map((o) => o.body.certificate_id)).size, 1);
    assert.strictEqual(await qtd(davi), 1);
  });

  await caso('linhas repetidas antigas: reaproveita a mais antiga', async () => {
    const id = await aluno('Fabio Antigo', '2000006', { curso: 'Pedagogia', unidade: 'Santana' });
    await pool.query(`INSERT INTO csu_certificados (certificate_id, aluno_id, email, nome, rgm, data_aula_inaugural, curso, unidade, created_at) VALUES
      ('CSU-2026-ANTIGO1', $1, 'f@t', 'Fabio Antigo', '2000006', '2026-10-01', 'Pedagogia', 'Santana', '2026-10-01 10:00-03'),
      ('CSU-2026-ANTIGO2', $1, 'f@t', 'Fabio Antigo', '2000006', '2026-10-02', 'Pedagogia', 'Santana', '2026-10-02 10:00-03')`, [id]);
    const out = await certificado.emitir(pool, id, deps);
    assert.strictEqual(out.body.certificate_id, 'CSU-2026-ANTIGO1');
    assert.strictEqual(out.body.data_aula_inaugural, '2026-10-01');
    assert.strictEqual(await qtd(id), 2);
  });

  await caso('polo enviado pelo polo no admin (csu_dados_acesso) entra no mesmo dia', async () => {
    await dadosAcesso.ensureSchema(pool);
    await pool.query(`INSERT INTO csu_dados_acesso (rgm, curso, unidade) VALUES ('2000004', 'Administração', 'Itapira')`);
    const out = await certificado.emitir(pool, eva, deps);
    assert.strictEqual(out.body.unidade, 'Itapira');
    assert.strictEqual(out.body.curso, 'Administração');
    assert.strictEqual(out.body.polo_pendente, false);
    const conta = (await pool.query('SELECT curso, unidade FROM csu_alunos WHERE id = $1', [eva])).rows[0];
    assert.deepStrictEqual(conta, { curso: 'Administração', unidade: 'Itapira' });
  });

  await caso('sync sem curso e polo não apaga o que a conta tem (COALESCE)', async () => {
    await db.upsertAcessoDerived(pool, { email: 'eva2000004@teste.local', rgm: '2000004', nome: 'Eva Planilha' });
    const conta = (await pool.query('SELECT curso, unidade FROM csu_alunos WHERE id = $1', [eva])).rows[0];
    assert.deepStrictEqual(conta, { curso: 'Administração', unidade: 'Itapira' });
  });

  await caso('preenchimento depois do sync: curso e polo chegam e o certificado é completado', async () => {
    // O relatório chega (o sync grava na conta) e o passo do fim do sync completa os certificados.
    await db.upsertAcessoDerived(pool, { email: 'bruno2000001@teste.local', rgm: '2000001', nome: 'Bruno Hoje Santos', curso: 'Pedagogia', unidade: 'Barra Funda' });
    const r = await sync.completarCertificados(pool);
    assert.strictEqual(r.completados, 1);
    const row = (await pool.query('SELECT curso, unidade, completado_em FROM csu_certificados WHERE aluno_id = $1', [bruno])).rows[0];
    assert.strictEqual(row.unidade, 'Barra Funda');
    assert.strictEqual(row.curso, 'Pedagogia');
    assert.ok(row.completado_em);
    assert.strictEqual((await certificado.estado(pool, bruno)).polo_completado, true);
    assert.strictEqual(await certificado.completarPendentes(pool), 0); // rodar de novo não muda nada
  });

  let completo;
  await caso('o download seguinte já sai completo, com o mesmo protocolo e a mesma data', async () => {
    const out = await certificado.emitir(pool, bruno, deps);
    completo = out.body;
    assert.strictEqual(completo.certificate_id, primeiro.certificate_id);
    assert.strictEqual(completo.unidade, 'Barra Funda');
    assert.strictEqual(completo.polo_pendente, false);
    assert.strictEqual(completo.aviso, null);
    assert.strictEqual(completo.data_aula_inaugural, '2026-11-05');
    assert.strictEqual(completo.created_at, primeiro.created_at);
    assert.strictEqual((await certificado.estado(pool, bruno)).polo_completado, false); // já baixou a versão completa
    const pdf = await pdfDe(completo);
    writeFileSync(path.join(OUT_DIR, 'certificado_completado.pdf'), pdf);
    assert.ok((await textoDoPdf(pdf)).includes('Polo Barra Funda'));
  });

  await caso('avisos e atendimento leem curso e polo da conta, sem precisar de certificado', async () => {
    const gil = await aluno('Gil Sem Certificado', '2000007', { curso: 'Pedagogia', unidade: 'Morumbi' });
    await pool.query(`INSERT INTO csu_avisos (titulo, descricao, categoria, prioridade, data_inicio, data_fim, publico, polo)
      VALUES ('Aviso do Morumbi', 'x', 'Geral', 'media', '2026-01-01', '2099-12-31', 'polo', 'Morumbi')`);
    const lista = await avisos.listAvisosForAluno(pool, gil);
    assert.ok(lista.some((a) => a.titulo === 'Aviso do Morumbi'));
    const at = await atendimento.getAtendimento(pool, gil);
    assert.strictEqual(at.polo, 'Morumbi');
  });

  await caso('lista de quem ficou para trás: erro ao emitir, sem certificado, já com curso e polo', async () => {
    // csu_eventos é do rastreio (server/acompanhamento.js); aqui só a forma mínima.
    await pool.query(`CREATE TABLE csu_eventos (id BIGSERIAL PRIMARY KEY, aluno_id INTEGER NOT NULL REFERENCES csu_alunos(id),
      nome TEXT NOT NULL, dados JSONB NOT NULL DEFAULT '{}'::jsonb, criado_em TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const hana = await aluno('Hana Voltar', '2000008', { curso: 'Letras', unidade: 'Capivari' }); // erro e agora tem polo
    const ivo = await aluno('Ivo Esperando', '2000009'); // erro e ainda sem polo
    const jo = await aluno('Jo Concluiu', '2000010', { curso: 'Letras', unidade: 'Capivari' }); // concluiu e nunca tentou
    await concluir(jo, '2026-11-04 10:00-03');
    await pool.query(`INSERT INTO csu_eventos (aluno_id, nome) VALUES ($1, 'certificado_erro'), ($1, 'certificado_erro'), ($2, 'certificado_erro'), ($3, 'certificado_erro')`, [hana, ivo, bruno]);
    const erro = await certificado.pendentesDeAviso(pool, { totalModulos: TOTAL });
    assert.deepStrictEqual(erro.map((a) => a.rgm), ['2000008']);
    assert.strictEqual(erro[0].erros, 2);
    const todos = await certificado.pendentesDeAviso(pool, { concluiram: true, totalModulos: TOTAL });
    assert.deepStrictEqual(todos.map((a) => [a.rgm, a.motivo]), [['2000008', 'erro_ao_emitir'], ['2000010', 'concluiu_sem_emitir']]);
    assert.ok(certificado.paraCsv(todos).startsWith('nome;rgm;email;curso;polo;motivo'));
  });

  await caso('cadastro: RGM com pontos e hífen não duplica conta', async () => {
    await assert.rejects(db.createAluno(pool, { email: 'outro@teste.local', nome: 'Outro', rgm: '2.000.001', password: 'segredo1' }), (err) => err.code === 'DUPLICATE' && err.field === 'rgm');
  });
}

(async () => {
  await semBanco();
  await comBanco();
  console.log(falhas ? `\n*** ${falhas} FALHA(S) em ${passos + falhas} casos ***` : `\nTodos os ${passos} casos passaram.`);
  if (falhas) process.exitCode = 1;
})().catch((err) => {
  console.error('Erro no teste:', err);
  process.exitCode = 1;
});
