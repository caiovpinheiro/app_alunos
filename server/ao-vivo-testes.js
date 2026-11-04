'use strict';

// Testes A/B/C da régua: cruza quem passou por cada variante no CRM com o que fez no portal.
// A resposta só leva contagens. O grupo de cada pessoa é o da primeira passagem, e quem falhou no
// envio continua no grupo, para a variante que mais falha não parecer melhor.

const { chaveEmbaralhada } = require('./ao-vivo-crm');

const HORA = 3600000;

// Nenhum teste começou. Para ligar um, acrescente aqui e publique, sem mudar a lista durante o teste:
// { id: 'rodada-1', titulo: 'Depois do login', inicio: 'AAAA-MM-DD', duracao_dias: 21, por_grupo: 250,
//   metrica: 'comecou_24h', variantes: [{ id: 'A', rotulo: 'Login atual', passo: 'id-do-passo' }, ...] }
// A primeira variante é a de comparação. Passos do login pedido vêm de ao-vivo-crm.js.
const TESTES = [];

const METRICAS = {
  entrou_24h: { rotulo: 'Entrou em 24 h', janela: 24 * HORA },
  comecou_24h: { rotulo: 'Começou a Aula em 24 h', janela: 24 * HORA },
  concluiu_7d: { rotulo: 'Concluiu a Aula em 7 dias', janela: 7 * 24 * HORA },
};
// Com 3 grupos são 2 comparações contra a variante A: margem mais rígida (correção de Bonferroni).
const margemZ = (grupos) => (grupos > 2 ? 2.24 : 1.96);
const pct = (n, de) => (de ? Math.round((100 * n) / de) : null);

function passosDe(defs) {
  return [...new Set(defs.flatMap((t) => t.variantes.map((v) => v.passo)))];
}

// Primeiro início e conclusão da Aula de cada conta, para medir o prazo a partir do envio.
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

// Telefone embaralhado de cada conta. Um telefone em mais de uma conta não dá para atribuir: fica de fora.
function indiceContas(lista, telefones, chave) {
  const indice = new Map();
  const repetidos = new Set();
  lista.forEach((a) => {
    const k = chaveEmbaralhada(chave, telefones.get(a.rgm));
    if (!k) return;
    if (indice.has(k)) repetidos.add(k);
    indice.set(k, a);
  });
  repetidos.forEach((k) => indice.delete(k));
  return { indice, repetidos };
}

function primeirasPassagens(def, coorte, inicioMs, fimMs) {
  const porPessoa = new Map();
  let outraVariante = 0;
  def.variantes.forEach((v) => {
    (coorte[v.passo] || []).forEach((item) => {
      const em = new Date(item.em).getTime();
      if (em < inicioMs || em >= fimMs) return;
      const antes = porPessoa.get(item.k);
      if (!antes) porPessoa.set(item.k, { variante: v.id, em, ok: item.ok });
      else {
        outraVariante += 1;
        if (em < antes.em) porPessoa.set(item.k, { variante: v.id, em, ok: item.ok });
      }
    });
  });
  return { porPessoa, outraVariante };
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
  const { lista, telefones, marcos, coorte, login, chave, agora = Date.now(), totalNiveis = 7 } = dados;
  const inicioMs = Date.parse(`${def.inicio}T00:00:00-03:00`);
  const fimMs = inicioMs + def.duracao_dias * 24 * HORA;
  const leituraMs = fimMs + METRICAS[def.metrica].janela; // todos precisam ter tido o prazo inteiro
  const status = agora < inicioMs ? 'agendado' : agora < fimMs ? 'em_andamento' : agora < leituraMs ? 'amadurecendo' : 'encerrado';
  const base = {
    id: def.id, titulo: def.titulo, inicio: def.inicio, duracao_dias: def.duracao_dias, por_grupo: def.por_grupo,
    metrica: def.metrica, metrica_rotulo: METRICAS[def.metrica].rotulo, status,
    fim_em: new Date(fimMs).toISOString(), leitura_em: new Date(leituraMs).toISOString(),
  };
  if (!coorte || !telefones || !chave) return { ...base, status: 'indisponivel', grupos: [], comparacoes: [], avisos: ['Sem dados do CRM ou da base de telefones na última leitura.'] };

  const { indice, repetidos } = indiceContas(lista, telefones, chave);
  const { porPessoa, outraVariante } = primeirasPassagens(def, coorte, inicioMs, fimMs);
  const grupos = def.variantes.map((v) => {
    const metricas = {};
    Object.keys(METRICAS).forEach((id) => { metricas[id] = { n: 0, de: 0, pct: null }; });
    return { id: v.id, rotulo: v.rotulo, sorteados: 0, enviados: 0, falhas: 0, login: 0, vinculados: 0, sem_conta: 0, metricas };
  });
  const porId = new Map(grupos.map((g) => [g.id, g]));

  porPessoa.forEach((p, k) => {
    const g = porId.get(p.variante);
    g.sorteados += 1;
    if (p.ok) g.enviados += 1;
    else g.falhas += 1;
    if (login && login.has(k)) g.login += 1;
    const aluno = indice.get(k);
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
  if (outraVariante) avisos.push(`${outraVariante} passagem(ns) de quem já estava em outra variante: vale só a primeira.`);
  if (repetidos.size) avisos.push(`${repetidos.size} telefone(s) em mais de uma conta ficaram sem vínculo com o portal.`);
  const abaixo = status === 'encerrado' && grupos.some((g) => g.sorteados < def.por_grupo);
  if (abaixo) avisos.push(`Terminou abaixo dos ${def.por_grupo} alunos por grupo planejados: uma diferença real pode não aparecer.`);

  return { ...base, grupos, comparacoes: comparar(def, grupos, status), avisos };
}

module.exports = { TESTES, METRICAS, passosDe, marcosAula, placar, atingiu };
