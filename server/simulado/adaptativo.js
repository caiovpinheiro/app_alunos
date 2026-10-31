'use strict';

// Ensino adaptativo: domínio por tópico (média móvel), repetição espaçada (SM-2 simplificado)
// e distribuição das questões do próximo simulado com mais peso nos tópicos fracos ou vencidos.

const DIA = 86400000;

// score: 0 a 1 (média do tópico neste simulado/quiz). Devolve o novo estado.
function atualizar(estado, score, agora = new Date()) {
  const e = { dominio: null, tentativas: 0, acertos: 0, ef: 2.5, repeticoes: 0, intervalo_dias: 0, ...(estado || {}) };
  const s = Math.max(0, Math.min(1, Number(score) || 0));
  e.dominio = e.dominio == null ? s : 0.6 * Number(e.dominio) + 0.4 * s;
  e.tentativas += 1;
  e.acertos = Number(e.acertos) + s;
  const q = Math.round(s * 5);
  if (q < 3) {
    e.repeticoes = 0;
    e.intervalo_dias = 1;
  } else {
    e.repeticoes += 1;
    e.intervalo_dias = e.repeticoes === 1 ? 1 : e.repeticoes === 2 ? 3 : Math.round(Math.max(1, e.intervalo_dias) * e.ef);
  }
  e.ef = Math.max(1.3, Number(e.ef) + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  e.proxima_revisao = new Date(agora.getTime() + e.intervalo_dias * DIA);
  e.dominio = Math.round(e.dominio * 1000) / 1000;
  e.ef = Math.round(e.ef * 100) / 100;
  return e;
}

// Peso de um tópico para o próximo simulado.
function peso(t, agora = new Date()) {
  if (t.dominio == null) return 1.5; // nunca avaliado
  let p = (1 - Number(t.dominio)) * 2 + 0.2;
  if (t.proxima_revisao && new Date(t.proxima_revisao).getTime() <= agora.getTime()) p += 1;
  return Math.round(p * 100) / 100;
}

// Reparte n questões entre os tópicos proporcionalmente ao peso (maiores restos), pelo menos 1
// para cada tópico fraco/vencido enquanto houver vagas. Devolve Map(topico_id -> qtd).
function distribuir(topicos, n, agora = new Date()) {
  const lista = topicos.map((t) => ({ id: t.id, p: peso(t, agora) })).sort((a, b) => b.p - a.p || a.id - b.id);
  const out = new Map(lista.map((t) => [t.id, 0]));
  if (!lista.length || n <= 0) return out;
  const soma = lista.reduce((s, t) => s + t.p, 0);
  const brutos = lista.map((t) => ({ id: t.id, v: (t.p / soma) * n }));
  let usados = 0;
  brutos.forEach((b) => { const k = Math.floor(b.v); out.set(b.id, k); usados += k; });
  brutos.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)) || a.id - b.id);
  for (const b of brutos) { if (usados >= n) break; out.set(b.id, out.get(b.id) + 1); usados += 1; }
  // Garante presença dos mais pesados (fracos) se algum ficou com zero e outro com sobra.
  for (const t of lista) {
    if (out.get(t.id) > 0 || t.p < 1) continue;
    const doador = [...out.entries()].filter(([, q]) => q > 1).sort((a, b) => b[1] - a[1])[0];
    if (!doador) break;
    out.set(doador[0], doador[1] - 1);
    out.set(t.id, 1);
  }
  return out;
}

function recomendacao(t, agora = new Date()) {
  const nome = t.nome;
  const quando = t.proxima_revisao ? new Date(t.proxima_revisao) : null;
  const vencido = quando && quando.getTime() <= agora.getTime();
  const data = quando ? quando.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) : null;
  if (t.dominio == null) return `Você ainda não foi avaliado em ${nome}. Faça um quiz relâmpago para começar.`;
  if (t.dominio < 0.4) return `Releia o resumo e os trechos de ${nome}, revise os flashcards hoje e depois faça um quiz relâmpago.`;
  if (t.dominio < 0.7) return `Revise os flashcards de ${nome} e faça um quiz relâmpago${vencido ? ' hoje' : data ? ` até ${data}` : ''}.`;
  return vencido ? `Hora de revisar ${nome} para não esquecer: um quiz relâmpago basta.` : `Você está bem em ${nome}. Próxima revisão: ${data}.`;
}

module.exports = { atualizar, peso, distribuir, recomendacao };
