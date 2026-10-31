'use strict';

// Utilidades de texto em português usadas pelo stub determinístico e pela heurística de prova.
// Nada aqui chama rede: é a base que funciona sem chave de LLM.

const STOP = new Set(`a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas
para pra com sem sob sobre entre ate desde e ou mas que se como quando onde qual quais quem cujo cuja
ao aos à às é são ser foi era eram sera sao esta este estes estas isso isto esse essa esses essas aquele
aquela aquilo seu sua seus suas meu minha nosso nossa ele ela eles elas voce voces nao sim mais menos muito
muita muitos muitas tambem ja ainda so apenas pode podem deve devem ha tem ter tinha sendo sido
outro outra outros outras todo toda todos todas cada qualquer mesmo mesma onde assim entao porque pois
lhe lhes nos vos me te num numa dum duma pelo pela tal tais seja sejam esta estao estava fazer feito faz
algum alguma alguns algumas nenhum nenhuma varios varias diversos diversas certos certas grande grandes pequeno pequena
the of and to in is for on with by an be this that from are`.split(/\s+/).filter(Boolean));

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normaliza(s) {
  return semAcento(s).toLowerCase();
}

// Raiz simples (corta plurais e terminações comuns) para comparar respostas discursivas.
function raiz(p) {
  let w = normaliza(p).replace(/[^a-z0-9]/g, '');
  if (w.length > 5) w = w.replace(/(mente|coes|cao|oes|ais|eis|ores|ados|idas|idos|adas|ando|endo|indo)$/, '');
  if (w.length > 4) w = w.replace(/(es|s|a|o|e)$/, '');
  return w;
}

function palavras(s) {
  return (String(s || '').match(/[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9-]*/g) || []);
}

function conteudo(s) {
  return palavras(s).filter((w) => w.length >= 4 && !STOP.has(normaliza(w)) && !/^\d+$/.test(w));
}

// Linhas que não são conteúdo: aviso de cookies e textos de site, crédito de figura, links, numeração de página.
const RUIDO = /(cookies?|direitos autorais|este material pode ser|impresso por|uso pessoal e privado|[\w.+-]+@[\w-]+\.[\w.]+|e-?mail\s*:|pol[ií]tica de privacidade|passei ?direto|termos de uso|todos os direitos|baixe o app|fa[cç]a (o )?login|cadastre-se|denunciar|https?:\/\/|www\.|^\s*fonte\s*:|^\s*fig(ura)?\.?\s*\d|^\s*p[aá]g(ina)?\.?\s*\d+\s*$|^\s*\d+\s*$)/i;

// Carimbo de data e hora que o navegador põe ao imprimir uma página em PDF ("31/10/2026, 11:44:02").
const CARIMBO = /\s*\b\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(:\d{2})?\b\s*/g;

// Linhas limpas: sem ruído e sem cabeçalho/rodapé repetido (linha curta que aparece 3+ vezes no documento).
function linhasLimpas(texto) {
  const linhas = String(texto || '').replace(/\r/g, '').split('\n').map((l) => l.replace(CARIMBO, ' ').trim());
  const conta = new Map();
  linhas.forEach((l) => { const k = normaliza(l.trim()); if (k && k.length < 80) conta.set(k, (conta.get(k) || 0) + 1); });
  return linhas.filter((l) => {
    const t = l.trim();
    if (!t) return true; // mantém quebra de parágrafo
    if (RUIDO.test(t)) return false;
    return !(t.length < 80 && conta.get(normaliza(t)) >= 3);
  });
}

// Junta as linhas que o PDF quebrou no meio da frase (linha longa sem ponto final, ou próxima começando
// em minúscula). Título curto seguido de linha em maiúscula fica separado.
function juntaLinhas(linhas) {
  const out = [];
  for (const bruta of linhas) {
    const l = bruta.trim();
    const ant = out.length ? out[out.length - 1] : null;
    if (!l) { out.push(''); continue; }
    const marcador = /^[•·▪●◦\-–]\s/;
    if (ant && !marcador.test(l) && !marcador.test(ant) && !/[.!?:;]$/.test(ant) && (/^[a-zà-ÿ(,]/.test(l) || ant.length > 50)) {
      out[out.length - 1] = /[a-zà-ÿ]-$/i.test(ant) && /^[a-zà-ÿ]/.test(l) ? ant.slice(0, -1) + l : `${ant} ${l}`;
    } else out.push(l);
  }
  return out;
}

// Texto só com o conteúdo (base para vocabulário, termos e resumo).
function limpo(texto) {
  return juntaLinhas(linhasLimpas(texto)).join('\n');
}

function frases(texto) {
  return juntaLinhas(linhasLimpas(texto)).join('\n')
    .replace(/([.!?;])\s+/g, '$1\n')
    .split(/\n+/)
    .map((f) => f.replace(/\s+/g, ' ').trim()
      // tira numeração de questão/alternativa e pontuação: "3) (1,0 ponto) ..."
      .replace(/^(\(?\d{1,2}\s*[).\-–]|\(?[a-e]\s*\))\s*/i, '')
      .replace(/^\(\s*\d+([.,]\d+)?\s*(pontos?|pts?)\s*\)\s*/i, ''))
    .filter((f) => f.length >= 40 && f.length <= 420 && !/\?$/.test(f) && /[.!;)"”]$/.test(f) && !/[•·▪●◦]/.test(f) && !RUIDO.test(f) && conteudo(f).length >= 4);
}

// Frequência de termos (por raiz), guardando a forma mais comum de cada raiz para exibir.
function termos(texto) {
  const cont = new Map();
  const forma = new Map();
  for (const w of conteudo(texto)) {
    const r = raiz(w);
    if (r.length < 4) continue;
    cont.set(r, (cont.get(r) || 0) + 1);
    const f = forma.get(r) || new Map();
    const lw = w.toLowerCase();
    f.set(lw, (f.get(lw) || 0) + 1);
    forma.set(r, f);
  }
  return [...cont.entries()]
    .map(([r, n]) => {
      const formas = [...forma.get(r).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return { raiz: r, termo: formas[0][0], n };
    })
    .sort((a, b) => b.n - a.n || a.termo.localeCompare(b.termo));
}

// Hash estável (para escolhas "aleatórias" reproduzíveis no stub).
function hash(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function embaralha(lista, semente) {
  const out = lista.slice();
  let h = hash(semente) || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Heurística grosseira para tirar verbos conjugados de distratores e conceitos-chave.
const VERBOS = new Set(['acontece', 'ocorre', 'produz', 'libera', 'gera', 'usa', 'forma', 'divide', 'contem', 'permite',
  'depende', 'possui', 'apresenta', 'envolve', 'transforma', 'garante', 'origina', 'realiza', 'limita', 'quebra', 'migra', 'existe']);
function pareceVerbo(w) {
  const n = normaliza(w);
  return VERBOS.has(n) || /(am|em|ou|ndo|ava|avam|iam|aram|eram|iram|ar|er|ir|ado|ida|ido)$/.test(n);
}

function capitaliza(s) {
  const t = String(s || '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

module.exports = { limpo, linhasLimpas, juntaLinhas, pareceVerbo, semAcento, normaliza, raiz, palavras, conteudo, frases, termos, hash, embaralha, capitaliza, STOP };
