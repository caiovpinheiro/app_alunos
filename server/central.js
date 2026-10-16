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
const AULA = lerJson('aula-inaugural.json', null);
const VIDEOS = lerJson('videos.json', { videos: [] });

function fill(text, whatsapp) {
  return typeof text === 'string' ? text.split('{whatsapp}').join(whatsapp) : text;
}

function publicContent(whatsapp, nivelTitulo) {
  const nivel = (n) => (n && nivelTitulo(n) ? { nivel: n, titulo: nivelTitulo(n) } : null);
  return {
    videos: (VIDEOS.videos || [])
      .filter((v) => v.ativo !== false)
      .map((v) => ({
        id: v.id,
        titulo: v.titulo,
        resumo: fill(v.resumo || '', whatsapp),
        categoria: v.categoria || '',
        duracao: v.duracao || '',
        v: v.v,
        trilha: nivel(v.nivel_trilha),
      })),
    aula: AULA && Array.isArray(AULA.capitulos)
      ? {
          video_id: AULA.video_id,
          titulo: AULA.titulo || 'Aula Inaugural',
          duracao_s: AULA.duracao_s || null,
          capitulos: AULA.capitulos.map((c) => ({
            titulo: c.titulo,
            resumo: fill(c.resumo || '', whatsapp),
            inicio_s: Math.max(0, Math.floor(Number(c.inicio_s) || 0)),
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
}

module.exports = { publicContent };
