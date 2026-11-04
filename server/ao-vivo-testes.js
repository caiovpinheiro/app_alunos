'use strict';

// Testes A/B/C da régua: cruza, pelo RGM, quem foi avisado em cada variante com o que fez no portal.
// A resposta só leva contagens. O grupo de cada pessoa é o do primeiro aviso daquele teste.

const { soDigitos } = require('./ao-vivo-regua');

const HORA = 3600000;

// Nenhum teste começou. Para ligar um, acrescente aqui e publique, sem mudar a lista durante o teste:
// { id: 'rodada-1', titulo: 'Depois do login', inicio: 'AAAA-MM-DD', duracao_dias: 21, por_grupo: 250,
//   metrica: 'comecou_24h', variantes: [{ id: 'A', rotulo: 'Login atual' }, ...] }
// No CRM, cada caminho do rodízio avisa com passo "variante", o `teste` e a `variante`.
// A primeira variante é a de comparação.
const TESTES = [];

const METRICAS = {
  entrou_24h: { rotulo: 'Entrou em 24 h', janela: 24 * HORA },
  comecou_24h: { rotulo: 'Começou a Aula em 24 h', janela: 24 * HORA },
  concluiu_7d: { rotulo: 'Concluiu a Aula em 7 dias', janela: 7 * 24 * HORA },
};
// Com 3 grupos são 2 comparações contra a variante A: margem mais rígida (correção de Bonferroni).
const margemZ = (grupos) => (grupos > 2 ? 2.24 : 1.96);
const pct = (n, de) => (de ? Math.round((100 * n) / de) : null);

// Primeiro início e conclusão da Aula de cada conta, para medir o prazo a partir do aviso.
async function marcosAula(pool, ids) {
  const mapa = new Map();
  if (!ids.length) return mapa;
  const r = await pool.query(
    `SELECT aluno_id, MIN(criado_em) AS comecou_em, MAX(concluido_em) AS ultimo_concluido, COUNT(concluido_em)::int AS concluidos
     FROM csu_trilha_progresso WHERE aluno_id = ANY($1::int[]) GROUP BY aluno_id`, [ids]);
  r.rows.forEach((x) => mapa.set(x.aluno_id, x));
  return mapa;
}

function atingiu(id, aluno, marco, em, total) {
  const limite = em + METRICAS[id].janela;
  const ate = (d) => Boolean(d) && new Date(d).getTime() <= limite;
  if (id === 'entrou_24h') return ate(aluno.primeiro_acesso);
  if (id === 'comecou_24h') return Boolean(marco) && ate(marco.comecou_em);
  return Boolean(marco) && marco.concluidos >= total && ate(marco.ultimo_concluido);
}

function primeirasPassagens(def, eventos, inicioMs, fimMs) {
  const validas = new Set(def.variantes.map((v) => v.id));
  const porPessoa = new Map();
  let outraVariante = 0;
  let semRgm = 0;
  eventos.forEach((e) => {
    if (e.passo !== 'variante' || e.teste !== def.id || !validas.has(e.variante)) return;
    const em = new Date(e.criado_em).getTime();
    if (em < inicioMs || em >= fimMs) return;
    if (!e.rgm) { semRgm += 1; return; }
    const antes = porPessoa.get(e.rgm);
    if (!antes) porPessoa.set(e.rgm, { variante: e.variante, em });
    else {
      if (antes.variante !== e.variante) outraVariante += 1;
      if (em < antes.em) porPessoa.set(e.rgm, { variante: e.variante, em });
    }
  });
  return { porPessoa, outraVariante, semRgm };
}

function comparar(def, grupos, status) {
  const base = grupos[0].metricas[def.metrica];
  const z = margemZ(grupos.length);
  return grupos.slice(1).map((g) => {
    const m = g.metricas[def.metrica];
    if (!m.de || !base.de) return { id: g.id, diferenca: null, leitura: 'sem_dados' };
    const a = base.n / base.de;
    const b = m.n / m.de;
    const dif = b - a;
    const erro = Math.sqrt((a * (1 - a)) / base.de + (b * (1 - b)) / m.de);
    const saida = { id: g.id, diferenca: Math.round(dif * 100), leitura: 'parcial' };
    if (status !== 'encerrado') return saida;
    saida.margem = Math.round(z * erro * 100);
    if (dif - z * erro > 0) saida.leitura = 'melhor';
    else if (dif + z * erro < 0) saida.leitura = 'pior';
    else saida.leitura = 'sem_diferenca';
    return saida;
  });
}

function placar(def, dados) {
  const { lista, marcos, eventos, login, agora = Date.now(), totalNiveis = 7 } = dados;
  const inicioMs = Date.parse(`${def.inicio}T00:00:00-03:00`);
  const fimMs = inicioMs + def.duracao_dias * 24 * HORA;
  const leituraMs = fimMs + METRICAS[def.metrica].janela; // todos precisam ter tido o prazo inteiro
  const status = agora < inicioMs ? 'agendado' : agora < fimMs ? 'em_andamento' : agora < leituraMs ? 'amadurecendo' : 'encerrado';
  const base = {
    id: def.id, titulo: def.titulo, inicio: def.inicio, duracao_dias: def.duracao_dias, por_grupo: def.por_grupo,
    metrica: def.metrica, metrica_rotulo: METRICAS[def.metrica].rotulo, status,
    fim_em: new Date(fimMs).toISOString(), leitura_em: new Date(leituraMs).toISOString(),
  };
  if (!eventos) return { ...base, status: 'indisponivel', grupos: [], comparacoes: [], avisos: ['Os avisos da régua não puderam ser lidos.'] };

  const contas = new Map();
  lista.forEach((a) => { const r = soDigitos(a.rgm); if (r) contas.set(r, a); });
  const { porPessoa, outraVariante, semRgm } = primeirasPassagens(def, eventos, inicioMs, fimMs);
  const grupos = def.variantes.map((v) => {
    const metricas = {};
    Object.keys(METRICAS).forEach((id) => { metricas[id] = { n: 0, de: 0, pct: null }; });
    return { id: v.id, rotulo: v.rotulo, sorteados: 0, login: 0, vinculados: 0, sem_conta: 0, metricas };
  });
  const porId = new Map(grupos.map((g) => [g.id, g]));

  porPessoa.forEach((p, rgm) => {
    const g = porId.get(p.variante);
    g.sorteados += 1;
    if (login && login.has(rgm)) g.login += 1;
    const aluno = contas.get(rgm);
    if (!aluno) { g.sem_conta += 1; return; }
    g.vinculados += 1;
    const marco = marcos.get(aluno.id);
    Object.keys(METRICAS).forEach((id) => {
      // Só entra quem já teve o prazo inteiro; antes disso o número subestima as entradas mais novas.
      if (agora - p.em < METRICAS[id].janela) return;
      const m = g.metricas[id];
      m.de += 1;
      if (atingiu(id, aluno, marco, p.em, totalNiveis)) m.n += 1;
    });
  });
  grupos.forEach((g) => { Object.values(g.metricas).forEach((m) => { m.pct = pct(m.n, m.de); }); });

  const avisos = [];
  const qtds = grupos.map((g) => g.sorteados);
  const media = qtds.reduce((a, b) => a + b, 0) / (qtds.length || 1);
  if (Math.max(...qtds) - Math.min(...qtds) > Math.max(5, media * 0.1)) avisos.push('Grupos com tamanhos muito diferentes: confira o rodízio antes de confiar no placar.');
  if (outraVariante) avisos.push(`${outraVariante} aviso(s) de quem já estava em outra variante: vale só o primeiro.`);
  if (semRgm) avisos.push(`${semRgm} aviso(s) sem RGM ficaram fora do placar.`);
  if (status === 'encerrado' && grupos.some((g) => g.sorteados < def.por_grupo)) avisos.push(`Terminou abaixo dos ${def.por_grupo} alunos por grupo planejados: uma diferença real pode não aparecer.`);

  return { ...base, grupos, comparacoes: comparar(def, grupos, status), avisos };
}

module.exports = { TESTES, METRICAS, marcosAula, placar, atingiu };
