'use strict';

// Base de alunos no admin: quem fica sem conta e os alertas. Não usa banco. Uso: node tools/test-base-acessos.js
const assert = require('node:assert');
const { loadLatestEmCurso, applyAcessos, resumoBase } = require('../server/sync-acessos');

const linha = (RGM, Nome, Email, situacao = 'EM CURSO') => ({ data: { RGM, Nome, Email, 'Situação Matrícula': situacao } });

function fonte(rows, rowCount = rows.length) {
  return {
    query: async (sql) => (/matriculados_snapshots/.test(sql)
      ? { rows: [{ id: 's1', file_name: 'r.csv', row_count: rowCount, created_at: new Date() }] }
      : { rows }),
  };
}

(async () => {
  const p = await loadLatestEmCurso(fonte([
    linha('111', 'Ana Souza', 'ana@exemplo.com'),
    linha('222', '', 'semnome@exemplo.com'),
    linha('333', 'Bia Lima', ''),
    linha('444', 'Caio Reis', 'ana@exemplo.com'), // e-mail de outro RGM
    linha('', 'Sem Rgm', 'semrgm@exemplo.com'),
    linha('555', 'Saiu', 'saiu@exemplo.com', 'CANCELADO'), // fora de curso não é "sem conta"
    linha('', '', ''), // linha em branco não conta
    linha('777', 'ANA  SOUZA', 'ana@exemplo.com'), // mesma pessoa, outro curso: maiúsculas e espaços não importam
    linha('778', 'Ána Souza', 'ana@exemplo.com'), // e acento também não
    linha('666', '', ''), // sem dados nesta linha...
    linha('666', 'Dani Melo', 'dani@exemplo.com'), // ...mas outra linha do mesmo RGM resolve
  ]));

  assert.deepStrictEqual(p.alunos.map((a) => a.rgm).sort(), ['111', '666']);
  const motivos = Object.fromEntries(p.fora.map((x) => [x.rgm || x.email, x.motivo]));
  assert.deepStrictEqual(motivos, {
    'semrgm@exemplo.com': 'sem_rgm', 222: 'sem_nome', 333: 'sem_email', 444: 'email_repetido',
  });
  assert.strictEqual(p.mais_de_um_curso, 2);
  assert.deepStrictEqual(p.fora.find((x) => x.rgm === '444').conflito, { nome: 'Ana Souza', rgm: '111' });
  assert.strictEqual(p.em_curso, 8); // 111, 222, 333, 444, 666, 777, 778 + o sem RGM
  assert.deepStrictEqual(p.revokeRgms, ['555']);

  // Falha ao criar a conta vai para a lista, com o aluno.
  const incompleto = await loadLatestEmCurso(fonte([linha('111', 'Ana', 'a@exemplo.com')], 5));
  assert.strictEqual(incompleto.incomplete, true);
  const destino = { query: async () => { throw new Error('falha de teste'); } };
  const erroOriginal = console.error;
  console.error = () => {};
  const aplicado = await applyAcessos(destino, [{ nome: 'Ana Souza', rgm: '111', email: 'ana@exemplo.com' }]);
  console.error = erroOriginal;
  assert.strictEqual(aplicado.skipped, 1);
  assert.strictEqual(aplicado.falhas[0].motivo, 'erro');

  // Alertas
  const agora = Date.parse('2026-11-03T12:00:00Z');
  const hora = (h) => new Date(agora - h * 3600000);
  const emDia = resumoBase({ snapshot_at: hora(2), synced_at: hora(2), verificado_em: hora(0.2), fora_count: 0, fora: [] }, { agora, intervaloMin: 30 });
  assert.deepStrictEqual(emDia.alertas, []);
  assert.strictEqual(emDia.fora_total, 0);

  const antigo = resumoBase({ snapshot_at: hora(30), verificado_em: hora(5), ultimo_erro: 'falhou', ultimo_erro_em: hora(1) }, { agora, intervaloMin: 30 });
  assert.deepStrictEqual(antigo.alertas.map((a) => a.tipo), ['erro', 'aviso', 'aviso']);
  assert.strictEqual(antigo.fora_total, null); // ainda não calculado é diferente de zero

  const vazio = resumoBase(null, { configurada: false, agora });
  assert.strictEqual(vazio.relatorio, null);
  assert.strictEqual(vazio.alertas.length, 1);

  const comFora = resumoBase({ snapshot_at: hora(1), fora_count: 1, fora: [{ rgm: '9', motivo: 'sem_email' }] }, { agora });
  assert.strictEqual(comFora.fora[0].motivo_rotulo, 'Sem e-mail no relatório');

  console.log('ok');
})().catch((err) => { console.error(err); process.exit(1); });

// Resultado: base única, etapas cumulativas, números iguais aos filtros da lista.
(() => {
  const resultado = require('../server/resultado');
  const agora = Date.parse('2026-11-03T15:00:00Z');
  const hora = (h) => new Date(agora - h * 3600000).toISOString();
  const aluno = (id, idadeH, extra) => ({ id, created_at: hora(idadeH), total_niveis: 7, niveis_concluidos: 0, primeiro_acesso: null, trilha_ultima: null, dias_sem_acesso: null, ...extra });
  const lista = [
    aluno(1, 1), // conta nova, ainda não entrou
    aluno(2, 2, { primeiro_acesso: hora(1), dias_sem_acesso: 0 }),
    aluno(3, 48, { primeiro_acesso: hora(40), trilha_ultima: hora(30), dias_sem_acesso: 1 }),
    aluno(4, 72, { primeiro_acesso: hora(70), trilha_ultima: hora(60), niveis_concluidos: 7, dias_sem_acesso: 2 }),
    aluno(5, 96, { niveis_concluidos: 1 }), // certificado sem login registrado conta em todas as etapas
    aluno(6, 24 * 20, { primeiro_acesso: hora(24 * 19), dias_sem_acesso: 19 }), // fora dos 7 dias
    aluno(7, 24 * 9), // período anterior
  ];
  const certs = { 5: hora(90) };
  const r = resultado.calcular(lista, certs, '7', { agora });
  assert.strictEqual(r.contas, 5);
  assert.deepStrictEqual(r.etapas.map((e) => e.n), [4, 3, 2, 1]);
  assert.deepStrictEqual(r.etapas.map((e) => e.pct_contas), [80, 60, 40, 20]);
  assert.strictEqual(r.contas_anterior, 1);
  assert.strictEqual(r.etapas[0].falta.n, 1);
  // Contas 1 e 2 têm menos de 24 h: ficam fora do "em até 24 h". Só a 3 e a 4 entraram no prazo (a 5 não tem login).
  assert.deepStrictEqual([r.primeiro_acesso_24h.n, r.primeiro_acesso_24h.de], [2, 3]);
  const nomes = (etapa) => lista.filter((a) => resultado.criadaDesde(a, 7, agora) && resultado.temEtapa(a, etapa, certs, 7)).length;
  r.etapas.forEach((e) => { if (e.falta) assert.strictEqual(nomes(e.falta.etapa), e.falta.n, e.id); });
  assert.strictEqual(nomes('parou_de_acessar'), r.acessando.falta.n);
  const soma = r.evolucao.linhas.reduce((n, l) => n + l.contas, 0);
  assert.strictEqual(soma, 5);
  assert.strictEqual(resultado.calcular(lista, certs, 'hoje', { agora }).contas, 2);
  const tudo = resultado.calcular(lista, certs, 'todos', { agora });
  assert.strictEqual(tudo.contas, 7);
  assert.strictEqual(tudo.contas_anterior, null);
  assert.strictEqual(tudo.evolucao.linhas.reduce((n, l) => n + l.contas, 0), 7);
  // Semanas começam na segunda-feira
  const noventa = resultado.calcular(lista, certs, '90', { agora });
  assert.strictEqual(noventa.evolucao.agrupado, 'semana');
  assert.strictEqual(new Date(`${noventa.evolucao.linhas[0].inicio}T12:00:00Z`).getUTCDay(), 1);
  // Calendário: intervalo, datas invertidas, futuro e data inválida.
  const p = resultado.periodoDe('datas', '2026-10-31', '2026-11-02', agora);
  assert.deepStrictEqual([p.id, p.de, p.ate, p.dias], ['datas', '2026-10-31', '2026-11-02', 3]);
  const noIntervalo = resultado.calcular(lista, certs, p, { agora });
  assert.strictEqual(noIntervalo.contas, 2); // contas 3 e 4
  assert.deepStrictEqual(noIntervalo.evolucao.linhas.map((l) => l.inicio), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.strictEqual(noIntervalo.evolucao.linhas.reduce((n, l) => n + l.contas, 0), 2);
  assert.strictEqual(noIntervalo.contas_anterior, 1); // conta 5, nos 3 dias anteriores
  assert.deepStrictEqual(resultado.intervaloDe('2026-11-02', '2026-10-31', agora), { de: '2026-10-31', ate: '2026-11-02' });
  assert.strictEqual(resultado.intervaloDe('2026-11-01', '2030-01-01', agora).ate, '2026-11-03');
  assert.strictEqual(resultado.intervaloDe('2026-02-31', 'lixo', agora), null);
  assert.strictEqual(resultado.periodoDe('datas', 'lixo', '', agora).id, '30'); // sem data válida, volta ao padrão
  // Intervalo longo agrupa por semana sem contar dias de fora dele.
  const longo = resultado.periodoDe('datas', '2026-08-01', '2026-11-03', agora);
  const rLongo = resultado.calcular(lista, certs, longo, { agora });
  assert.strictEqual(rLongo.evolucao.agrupado, 'semana');
  assert.strictEqual(rLongo.evolucao.linhas.reduce((n, l) => n + l.contas, 0), rLongo.contas);
  // Corte: antes dele não há comparação nem colunas no gráfico.
  const painel = require('../server/painel');
  assert.strictEqual(painel.normalizaFaixas({}).contar_desde, '2026-10-29');
  assert.strictEqual(painel.normalizaFaixas({ contar_desde: '' }).contar_desde, null);
  assert.strictEqual(painel.normalizaFaixas({ contar_desde: 'lixo' }).contar_desde, '2026-10-29');
  assert.strictEqual(painel.normalizaFaixas({ contar_desde: '2026-11-01' }).contar_desde, '2026-11-01');
  const comCorte = resultado.calcular(lista, certs, '7', { agora, contar_desde: '2026-10-29' });
  assert.strictEqual(comCorte.contas_anterior, null);
  assert.strictEqual(comCorte.etapas[0].variacao, null);
  assert.strictEqual(comCorte.evolucao.linhas[0].inicio, '2026-10-29');
  assert.strictEqual(resultado.calcular(lista, certs, 'todos', { agora, contar_desde: '2026-10-29' }).periodo.rotulo, 'desde 29/10/2026');
  console.log('ok resultado');
})();
