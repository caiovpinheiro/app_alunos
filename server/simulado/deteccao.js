'use strict';

// Detecção de "prova do próprio aluno" no upload: heurística no texto + classificação do LLM.
// Limites e falsos positivos/negativos documentados em docs/simulado.md.

const { normaliza } = require('./texto');

// Cada sinal: peso e uma função que devolve true/nº de ocorrências. O texto chega normalizado
// (minúsculo, sem acento). `inicio` = primeiros ~800 caracteres (cabeçalho).
const SINAIS = [
  {
    id: 'cabecalho_prova', rotulo: 'Cabeçalho de prova ou avaliação', peso: 2,
    teste: ({ inicio }) => /\b(prova|avaliacao|exame|atividade avaliativa|teste (bimestral|mensal)|av ?[123]|ap ?[123]|np ?[12]|recuperacao)\b/.test(inicio),
  },
  {
    id: 'campos_aluno', rotulo: 'Campos de identificação (nome, RA/matrícula, turma, data)', peso: 0,
    // peso calculado: 1 campo = 1; 2 = 2,5; 3+ = 3,5
    teste: ({ t }) => {
      const campos = [
        /\b(nome( do aluno| completo)?)\s*:/,
        /\b(ra|rgm|r\.a\.|matricula|n[ºo°]? ?de matricula)\s*:/,
        /\b(turma|serie|classe|curso)\s*:/,
        /\bdata\s*:\s*(_{2,}|\.{3,}|\s*\/\s*\/)/,
        /\b(professor(a)?|docente)\s*:/,
      ];
      return campos.filter((re) => re.test(t)).length;
    },
    pesoDe: (n) => (n >= 3 ? 3.5 : n === 2 ? 2.5 : n === 1 ? 1 : 0),
  },
  {
    id: 'valor_questao', rotulo: '"Valor da questão" ou pontuação por questão', peso: 2,
    teste: ({ t }) => /valor (da|de cada) questao|\bvalor\s*:\s*\d|\(\s*\d+([.,]\d+)?\s*(pontos?|pts?)\s*\)|\bpeso\s*:\s*\d/.test(t),
  },
  {
    id: 'campo_nota', rotulo: 'Campo de nota', peso: 1,
    teste: ({ t }) => /\bnota\s*(final)?\s*:\s*(_{2,}|\.{3,}|$)|\bnota\s*:/m.test(t),
  },
  {
    id: 'questoes_alternativas', rotulo: 'Questões numeradas com alternativas a–e', peso: 0,
    teste: ({ linhas }) => {
      const q = linhas.filter((l) => /^\s*(questao\s*)?\d{1,2}\s*[).\-–:]\s*\S/.test(l)).length;
      const a = linhas.filter((l) => /^\s*\(?[a-e]\s*[).]\s*\S/.test(l)).length;
      return { q, a };
    },
    pesoDe: ({ q, a }) => (q >= 5 && a >= 12 ? 2 : q >= 3 && a >= 8 ? 1.5 : 0),
  },
  {
    id: 'gabarito', rotulo: 'Gabarito ou folha de respostas', peso: 1.5,
    teste: ({ t }) => /\b(gabarito|folha de respostas?|cartao[- ]resposta)\b/.test(t),
  },
  {
    id: 'assinatura', rotulo: 'Espaço para assinatura', peso: 2,
    teste: ({ t }) => /assinatura( do (aluno|estudante|candidato|professor))?\s*:?\s*_{3,}|_{8,}\s*\n?\s*assinatura/.test(t) || /\bassinatura do (aluno|estudante|candidato)\b/.test(t),
  },
  {
    id: 'instrucoes_prova', rotulo: 'Instruções típicas de prova', peso: 1.5,
    teste: ({ t }) => /(boa prova|leia atentamente|nao (e|sera) permitid[oa]|sem consulta|tempo de prova|duracao( da prova)?\s*:|desligue o celular|rasuras? (nao|anula))/.test(t),
  },
  {
    id: 'respostas_preenchidas', rotulo: 'Marcas de resposta ou correção (X na alternativa, "certo/errado", nota dada)', peso: 1,
    teste: ({ t }) => /\(\s*x\s*\)|\[\s*x\s*\]|\bnota obtida\b|\bacertos?\s*:\s*\d/.test(t),
  },
];

const PONTUACAO_MAX = 12; // soma que já consideramos "certeza" pela heurística

function heuristica(texto) {
  const t = normaliza(texto).slice(0, 60000);
  const inicio = t.slice(0, 800);
  const linhas = t.split('\n');
  const ctx = { t, inicio, linhas };
  let soma = 0;
  const sinais = [];
  for (const s of SINAIS) {
    const r = s.teste(ctx);
    const pts = s.pesoDe ? s.pesoDe(r) : (r ? s.peso : 0);
    if (pts > 0) {
      soma += pts;
      sinais.push({ id: s.id, rotulo: s.rotulo, pontos: pts });
    }
  }
  // Um material longo (apostila) com algumas questões no fim não é uma prova: reduz.
  const tamanho = t.length;
  if (tamanho > 25000 && soma > 0) soma *= 0.6;
  return { pontuacao: Math.round(soma * 10) / 10, confianca: Math.min(1, soma / PONTUACAO_MAX), sinais };
}

// Junta heurística e LLM. Com o stub (llm.real = false) vale só a heurística.
// Faixas: >= 0,70 alta (bloqueia), >= 0,40 média (pede confirmação e marca para revisão).
const FAIXA_ALTA = 0.7;
const FAIXA_MEDIA = 0.4;

async function detectar(texto, llm) {
  const h = heuristica(texto);
  let ia = null;
  try {
    ia = await llm.classificarProva(texto.slice(0, 20000), h);
  } catch (err) {
    ia = { erro: err.message };
  }
  let confianca = h.confianca;
  let fonte = 'heuristica';
  if (ia && !ia.erro && llm.real) {
    const pIa = ia.eh_prova ? ia.confianca : 1 - ia.confianca;
    confianca = 0.4 * h.confianca + 0.6 * pIa;
    // Discordância forte: não deixa um lado sozinho bloquear sem o outro (vira média).
    if (Math.abs(h.confianca - pIa) > 0.6) confianca = Math.min(confianca, FAIXA_ALTA - 0.01);
    fonte = 'heuristica+llm';
  }
  confianca = Math.round(confianca * 100) / 100;
  const nivel = confianca >= FAIXA_ALTA ? 'alta' : confianca >= FAIXA_MEDIA ? 'media' : 'baixa';
  return {
    nivel,
    confianca,
    fonte,
    heuristica: h,
    llm: ia ? { provedor: llm.nome, eh_prova: ia.eh_prova ?? null, confianca: ia.confianca ?? null, motivo: ia.motivo || ia.erro || null } : null,
  };
}

module.exports = { detectar, heuristica, FAIXA_ALTA, FAIXA_MEDIA };
