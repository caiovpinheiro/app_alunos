'use strict';

// Central de ajuda (tela /tutoriais para contas com a trilha liberada):
// vídeos curtos próprios, Aula Inaugural por capítulos e perguntas frequentes.
// Conteúdo em server/assets/central/*.json; mudar texto = commit.

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'assets', 'central');

function lerJson(nome, padrao) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, nome), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Central de ajuda: ${nome} inválido:`, err.message);
    return padrao;
  }
}

const FAQ = lerJson('faq.json', { grupos: [] });
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Narração do vídeo (o mesmo .txt de "Ler a narração") para a busca da Central achar o assunto falado.
const narracoes = {};
function narracao(v) {
  if (!v || typeof v !== 'string' || !v.startsWith('/trilha-midia/')) return '';
  if (narracoes[v] !== undefined) return narracoes[v];
  try {
    narracoes[v] = fs.readFileSync(path.join(PUBLIC_DIR, v + '.txt'), 'utf8').replace(/\s+/g, ' ').trim().slice(0, 4000);
  } catch (err) {
    narracoes[v] = '';
  }
  return narracoes[v];
}
const AULA = lerJson('aula-inaugural.json', null);
const VIDEOS = lerJson('videos.json', { videos: [] });
// Temas da Central (temas.json): ordem da jornada; cada vídeo e cada pergunta em um tema só.
const TEMAS = lerJson('temas.json', { temas: [], comece: [] });

// Onde está cada id: { tema, ordem }. O que não estiver em temas.json vai para o último tema.
function posicoes(chave) {
  const out = {};
  (TEMAS.temas || []).forEach((t) => (t[chave] || []).forEach((id, i) => { out[id] = { tema: t.id, ordem: i + 1 }; }));
  return out;
}
const TEMA_VIDEO = posicoes('videos');
const TEMA_FAQ = posicoes('faq');
const ULTIMO_TEMA = (TEMAS.temas || []).length ? TEMAS.temas[TEMAS.temas.length - 1].id : null;
function temaDe(mapa, id) {
  return mapa[id] || (ULTIMO_TEMA ? { tema: ULTIMO_TEMA, ordem: 999 } : { tema: null, ordem: null });
}

function fill(text, whatsapp) {
  return typeof text === 'string' ? text.split('{whatsapp}').join(whatsapp) : text;
}

function publicContent(whatsapp, nivelTitulo) {
  const nivel = (n) => (n && nivelTitulo(n) ? { nivel: n, titulo: nivelTitulo(n) } : null);
  const out = {
    videos: (VIDEOS.videos || [])
      .filter((v) => v.ativo !== false)
      .map((v) => ({
        id: v.id,
        titulo: v.titulo,
        resumo: fill(v.resumo || '', whatsapp),
        categoria: v.categoria || '',
        capa: v.capa || null,
        duracao: v.duracao || '',
        v: v.v || null,
        // Vídeo do YouTube (sem mp4 próprio): toca no modal por iframe youtube-nocookie.
        yt: /^[\w-]{11}$/.test(v.yt || '') ? v.yt : null,
        termos: [narracao(v.v), v.termos || ''].join(' ').trim(),
        trilha: nivel(v.nivel_trilha),
        // Série de vídeos (ex.: "estagio", partes 1..3): a Central mostra juntos e em ordem.
        serie: v.serie || null,
        parte: Number(v.parte) || null,
      }))
      // Capítulos da Aula Inaugural que explicam o que os vídeos rápidos não cobrem (na_central):
      // entram na mesma grade, com a categoria "Entenda como funciona".
      .concat(AULA && Array.isArray(AULA.capitulos)
        ? AULA.capitulos.map((c, i) => ({ c, i })).filter((x) => x.c.na_central && x.c.v).map((x) => ({
            id: 'aula-cap-' + x.i,
            titulo: x.c.titulo,
            resumo: fill(x.c.resumo || '', whatsapp),
            categoria: 'Entenda como funciona',
            tipo: 'entenda',
            capa: x.c.capa || null,
            duracao: x.c.duracao || '',
            v: x.c.v,
            termos: narracao(x.c.v),
            trilha: nivel(x.c.nivel_trilha),
          }))
        : []),
    aula: AULA && Array.isArray(AULA.capitulos)
      ? {
          // Com `v` em cada capítulo, a aula toca do próprio app (um vídeo por capítulo);
          // sem `v`, usa a gravação do YouTube (`video_id`) e pula para `inicio_s`.
          video_id: AULA.video_id || null,
          titulo: AULA.titulo || 'Aula Inaugural',
          duracao_s: AULA.duracao_s || null,
          capitulos: AULA.capitulos.map((c) => ({
            titulo: c.titulo,
            resumo: fill(c.resumo || '', whatsapp),
            inicio_s: Math.max(0, Math.floor(Number(c.inicio_s) || 0)),
            v: c.v || null,
            duracao: c.duracao || '',
            trilha: nivel(c.nivel_trilha),
          })),
        }
      : null,
    faq: (FAQ.grupos || []).map((g) => ({
      id: g.id,
      titulo: g.titulo,
      perguntas: (g.perguntas || []).map((p) => ({
        id: p.id,
        q: p.q,
        a: fill(p.a, whatsapp),
        tags: p.tags || [],
        trilha: nivel(p.nivel_trilha),
      })),
    })),
  };
  // Temas: só campos a mais. O formato antigo (videos, aula, faq por grupo) continua igual,
  // então a Central congelada (public-antigo) segue funcionando com a mesma resposta.
  out.videos.forEach((v) => Object.assign(v, temaDe(TEMA_VIDEO, v.id)));
  out.faq.forEach((g) => g.perguntas.forEach((p) => Object.assign(p, temaDe(TEMA_FAQ, p.id))));
  out.temas = (TEMAS.temas || []).map((t) => ({ id: t.id, nome: t.nome, curto: t.curto || t.nome, icone: t.icone || null, linha: t.linha || '' }));
  out.comece = (TEMAS.comece || []).map((c) => ({ video: c.video || null, tema: c.tema || null, titulo: c.titulo }));
  return out;
}

module.exports = { publicContent };
