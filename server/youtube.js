'use strict';

function validId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

function extractYoutubeId(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const bare = validId(value);
  if (bare) return bare;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'youtu.be') {
    return validId(url.pathname.split('/').filter(Boolean)[0]);
  }
  if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com'
  ) {
    const fromQuery = validId(url.searchParams.get('v'));
    if (fromQuery) return fromQuery;
    const parts = url.pathname.split('/').filter(Boolean);
    if (['embed', 'shorts', 'live', 'v'].includes(parts[0]) && parts[1]) {
      return validId(parts[1].slice(0, 11));
    }
  }
  return null;
}

function embedUrl(id) {
  return `https://www.youtube-nocookie.com/embed/${id}`;
}

function thumbUrl(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function publicTutorial(row) {
  const youtubeId = extractYoutubeId(row.video_url);
  return {
    id: row.id,
    titulo: row.titulo,
    descricao: row.descricao,
    categoria: row.categoria,
    duracao: row.duracao,
    ordem: row.ordem,
    ativo: row.ativo,
    video_url: row.video_url,
    youtube_id: youtubeId,
    thumbnail_url: row.thumbnail_url || (youtubeId ? thumbUrl(youtubeId) : ''),
  };
}

module.exports = {
  extractYoutubeId,
  embedUrl,
  thumbUrl,
  publicTutorial,
};
