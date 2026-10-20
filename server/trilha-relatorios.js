'use strict';

// Relatórios da Aula Inaugural para o painel admin e para o CRM:
//  - porAluno(): uma linha por aluno × módulo (fez / não fez / parou onde), sem resumir — quem trata é o sistema.
//  - dashboardUso(): uso geral (tempo ativo, minutos de vídeo, vídeos mais vistos, 👍/👎).
// Dados: csu_trilha_progresso (todos), csu_avaliacoes (todos), csu_acessos e csu_eventos (só alunos com rastreio ligado).

const fs = require('node:fs');
const path = require('node:path');
const trilha = require('./trilha');
const { lerEventos, chaveVideo, MODULO_DO_VIDEO } = require('./trilha-admin');
const { tituloDe, carregarTitulos } = require('./avaliacoes');

const { NIVEIS, ABERTURA, PONTOS_MODULO, statusCertificado } = trilha;

function lerJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', rel), 'utf8')); } catch (err) { return null; }
}

function segundos(duracao) {
  const p = String(duracao || '').split(':').map(Number);
  if (p.length === 2 && p.every(Number.isFinite)) return p[0] * 60 + p[1];
  if (p.length === 3 && p.every(Number.isFinite)) return p[0] * 3600 + p[1] * 60 + p[2];
  return null;
}

// Catálogo de vídeos como o rastreio grava (chaveVideo): título, duração e qual joinha avalia o vídeo.
const CATALOGO = (() => {
  const c = {};
  const aula = lerJson('central/aula-inaugural.json');
  ((aula && aula.capitulos) || []).forEach((cap, i) => {
    if (cap && cap.v) c[chaveVideo(cap.v)] = { titulo: 'Aula Inaugural · ' + cap.titulo, duracao_s: segundos(cap.duracao), avaliacao: { tipo: 'video', id: 'aula-cap-' + i }, modulo: cap.nivel_trilha || null };
  });
  const videos = lerJson('central/videos.json');
  ((videos && videos.videos) || []).forEach((v) => {
    if (v && v.v) c[chaveVideo(v.v)] = { titulo: 'Central · ' + v.titulo, duracao_s: segundos(v.duracao), avaliacao: { tipo: 'video', id: String(v.id) }, modulo: v.nivel_trilha || null };
  });
  ABERTURA.forEach((v) => { c[chaveVideo(v.v)] = { titulo: 'Aula Inaugural · ' + v.t + ' (abertura)', duracao_s: segundos(v.duracao), avaliacao: { tipo: 'aula', id: 'boasvindas' }, modulo: null }; });
  NIVEIS.forEach((l, i) => {
    const add = (v, t) => { const k = chaveVideo(v); if (!c[k]) c[k] = { titulo: 'Módulo ' + (i + 1) + ' · ' + t, duracao_s: null, avaliacao: null, modulo: i + 1 }; };
    if (l.video) add(l.video, l.t);
    (l.parts || []).forEach((p) => add(p.v, p.t));
    (l.passo_a_passo || []).forEach((p) => add(p.v, p.t + ' (passo a passo)'));
  });
  return c;
})();

async function votos(pool) {
  try {
    const r = await pool.query('SELECT rgm, tipo, conteudo_id, voto FROM csu_avaliacoes');
    return r.rows;
  } catch (err) {
    if (err.code === '42P01') return [];
    throw err;
  }
}

async function acessos(pool) {
  try {
    const r = await pool.query(`
      SELECT aluno_id, COUNT(*)::int AS acessos, COALESCE(SUM(segundos_ativos), 0)::int AS segundos,
             MIN(inicio) AS primeiro, MAX(fim) AS ultimo
      FROM csu_acessos GROUP BY aluno_id`);
    return r.rows;
  } catch (err) {
    if (err.code === '42P01') return [];
    throw err;
  }
}

function pct(n, de) { return de ? Math.round((100 * n) / de) : null; }

// ---------- por aluno × módulo ----------

async function porAluno(pool, certificados = {}) {
  const [prog, vs, ev, ac] = await Promise.all([
    pool.query(`
      SELECT p.aluno_id, a.nome, a.rgm, a.email, p.nivel, p.partes_vistas, p.video_ok, p.pulou_video, p.respostas, p.travei,
             p.pontos, p.concluido_em, p.criado_em, p.atualizado_em
      FROM csu_trilha_progresso p JOIN csu_alunos a ON a.id = p.aluno_id ORDER BY a.nome, p.nivel`),
    votos(pool),
    lerEventos(pool),
    acessos(pool),
  ]);
  const votoModulo = {}; // rgm → { modulo: voto }
  vs.forEach((v) => {
    const m = /^modulo-(\d+)$/.exec(v.conteudo_id);
    if (v.tipo !== 'aula' || !m) return;
    (votoModulo[v.rgm] = votoModulo[v.rgm] || {})[Number(m[1])] = v.voto;
  });
  const acessoDe = {};
  ac.forEach((r) => { acessoDe[r.aluno_id] = r; });
  const alunos = {};
  prog.rows.forEach((r) => {
    const a = alunos[r.aluno_id] || (alunos[r.aluno_id] = {
      aluno_id: r.aluno_id, nome: r.nome, rgm: r.rgm, email: r.email, concluidos: 0, pontos: 0,
      comecou_em: r.criado_em, ultimo_acesso: r.atualizado_em, rows: {},
    });
    a.rows[r.nivel] = r;
    if (r.concluido_em) a.concluidos += 1;
    a.pontos = trilha.pontosDe(a.concluidos); // pontos saem dos módulos concluídos; a coluna pontos é só cache
    if (new Date(r.criado_em) < new Date(a.comecou_em)) a.comecou_em = r.criado_em;
    if (new Date(r.atualizado_em) > new Date(a.ultimo_acesso)) a.ultimo_acesso = r.atualizado_em;
  });
  return Object.values(alunos).map((a) => {
    const eventos = ev.porAluno[a.aluno_id] || null;
    const cert = statusCertificado(a);
    const modulos = NIVEIS.map((l, i) => {
      const n = i + 1;
      const r = a.rows[n];
      const partes = l.parts ? l.parts.length : 1;
      const vistas = r ? (r.partes_vistas || []).length : 0;
      const qs = l.qs.length;
      const respostas = r ? r.respostas || {} : {};
      const acertos = Object.values(respostas).filter((q) => q.ok).length;
      const erros = Object.values(respostas).reduce((s, q) => s + Math.max(0, (q.tries || []).length - (q.ok ? 1 : 0)), 0);
      const travei = r ? Object.values(r.travei || {}).reduce((s, x) => s + (Number(x) || 0), 0) : 0;
      let etapa = 'nao_abriu';
      if (r && r.concluido_em) etapa = 'concluido';
      else if (r && acertos) etapa = 'perguntas';
      else if (r && (r.video_ok || r.pulou_video || vistas)) etapa = 'video';
      else if (r) etapa = 'abriu';
      return {
        modulo: n,
        titulo: l.t,
        etapa, // nao_abriu | abriu | video | perguntas | concluido
        abriu: Boolean(r),
        video_pct: r ? (r.video_ok ? 100 : pct(vistas, partes)) : 0,
        video_pulou: Boolean(r && r.pulou_video),
        perguntas: qs,
        acertos,
        erros,
        travei,
        concluido: Boolean(r && r.concluido_em),
        concluido_em: r ? r.concluido_em : null,
        pontos: r && r.concluido_em ? PONTOS_MODULO : 0,
        pontos_max: PONTOS_MODULO,
        avaliacao: (votoModulo[a.rgm] && votoModulo[a.rgm][n]) || 0,
        tempo_min: eventos && eventos.tempo[n] ? Math.round(eventos.tempo[n] / 6000) / 10 : null,
        whatsapp: eventos ? eventos.whatsapp[n] || 0 : 0,
        aberto_em: r ? r.criado_em : null,
        atualizado_em: r ? r.atualizado_em : null,
      };
    });
    const parado = [...modulos].filter((m) => m.abriu).sort((x, y) => new Date(y.atualizado_em) - new Date(x.atualizado_em))[0];
    const acc = acessoDe[a.aluno_id];
    return {
      aluno_id: a.aluno_id,
      nome: a.nome,
      rgm: a.rgm,
      email: a.email,
      comecou_em: a.comecou_em,
      ultimo_acesso: a.ultimo_acesso,
      concluidos: a.concluidos,
      total_modulos: NIVEIS.length,
      pontos: a.pontos,
      meta: cert.meta,
      certificado_liberado: cert.liberado,
      certificado_emitido: Boolean(certificados[a.aluno_id]),
      certificado_emitido_em: certificados[a.aluno_id] || null,
      parou_em: cert.liberado ? null : (parado ? parado.modulo : null),
      rastreado: Boolean(eventos),
      acessos: acc ? acc.acessos : null,
      tempo_ativo_min: acc ? Math.round(acc.segundos / 60) : null,
      modulos,
    };
  });
}

const ETAPA_CSV = { nao_abriu: 'não abriu', abriu: 'abriu', video: 'viu o vídeo', perguntas: 'respondendo', concluido: 'concluído' };

function csvPorAluno(alunos) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const dt = (d) => (d ? new Date(d).toISOString() : '');
  const sn = (b) => (b ? 'sim' : 'não');
  const lines = ['rgm;nome;email;modulo;modulo_titulo;etapa;abriu;video_pct;video_pulou;perguntas;acertos;erros;travei;concluido;concluido_em;pontos;pontos_max;avaliacao;tempo_min;whatsapp;aberto_em;atualizado_em;modulos_concluidos_aluno;pontos_aluno;certificado_liberado;certificado_emitido;certificado_emitido_em;ultimo_acesso_aluno'];
  alunos.forEach((a) => {
    a.modulos.forEach((m) => {
      lines.push([a.rgm, a.nome, a.email, m.modulo, m.titulo, ETAPA_CSV[m.etapa], sn(m.abriu), m.video_pct ?? '', sn(m.video_pulou), m.perguntas, m.acertos, m.erros, m.travei,
        sn(m.concluido), dt(m.concluido_em), m.pontos, m.pontos_max, m.avaliacao > 0 ? 'positiva' : m.avaliacao < 0 ? 'negativa' : '', m.tempo_min ?? '', m.whatsapp,
        dt(m.aberto_em), dt(m.atualizado_em), a.concluidos, a.pontos, sn(a.certificado_liberado), sn(a.certificado_emitido), dt(a.certificado_emitido_em), dt(a.ultimo_acesso)]
        .map(esc).join(';'));
    });
  });
  return String.fromCharCode(0xfeff) + lines.join('\n');
}

// ---------- dashboard de uso ----------

async function dashboardUso(pool) {
  const [ev, vs, ac] = await Promise.all([lerEventos(pool), votos(pool), acessos(pool)]);
  const titulos = carregarTitulos();

  // Acessos (csu_acessos: sessões do rastreio).
  const totalSeg = ac.reduce((s, r) => s + r.segundos, 0);
  const totalAcessos = ac.reduce((s, r) => s + r.acessos, 0);
  const acessosOut = ac.length ? {
    alunos: ac.length,
    acessos: totalAcessos,
    tempo_ativo_total_min: Math.round(totalSeg / 60),
    tempo_ativo_medio_min: Math.round(totalSeg / 60 / ac.length),
    tempo_medio_por_acesso_min: totalAcessos ? Math.round(totalSeg / 60 / totalAcessos * 10) / 10 : 0,
    acessos_por_aluno: Math.round((totalAcessos / ac.length) * 10) / 10,
  } : null;

  // Vídeos (csu_eventos): minutos estimados = % máximo assistido × duração conhecida.
  const porVideo = {};
  let segAssistidos = 0;
  let plays = 0;
  let terminados = 0;
  const semDuracao = new Set();
  Object.keys(ev.porAluno).forEach((alunoId) => {
    Object.keys(ev.porAluno[alunoId].videos).forEach((k) => {
      const v = ev.porAluno[alunoId].videos[k];
      if (!v.inicio) return;
      const cat = CATALOGO[k] || { titulo: k, duracao_s: null, avaliacao: null, modulo: MODULO_DO_VIDEO[k] || null };
      const pv = porVideo[k] || (porVideo[k] = { key: k, titulo: cat.titulo, modulo: cat.modulo, duracao_s: cat.duracao_s, avaliacao: cat.avaliacao, alunos: 0, terminaram: 0, pct: 0, pausas: 0 });
      pv.alunos += 1; plays += 1;
      if (v.fim) { pv.terminaram += 1; terminados += 1; }
      pv.pct += v.pct;
      pv.pausas += v.pausas;
      if (cat.duracao_s) segAssistidos += (v.pct / 100) * cat.duracao_s;
      else semDuracao.add(k);
    });
  });
  const votosDe = {};
  vs.forEach((v) => {
    const k = v.tipo + ':' + v.conteudo_id;
    const x = votosDe[k] || (votosDe[k] = { positivos: 0, negativos: 0 });
    if (v.voto > 0) x.positivos += 1; else x.negativos += 1;
  });
  const top = Object.values(porVideo)
    .map((pv) => {
      const av = pv.avaliacao ? votosDe[pv.avaliacao.tipo + ':' + pv.avaliacao.id] : null;
      return {
        key: pv.key, titulo: pv.titulo, modulo: pv.modulo, duracao_s: pv.duracao_s,
        alunos: pv.alunos, terminaram: pv.terminaram, pct_conclusao: pct(pv.terminaram, pv.alunos),
        pct_medio_assistido: Math.round(pv.pct / pv.alunos), pausas: pv.pausas,
        positivos: av ? av.positivos : 0, negativos: av ? av.negativos : 0,
      };
    })
    .sort((x, y) => y.alunos - x.alunos || y.terminaram - x.terminaram)
    .slice(0, 15);
  const videosOut = {
    rastreados: ev.rastreados,
    disponivel: ev.disponivel,
    plays,
    terminados,
    pct_conclusao: pct(terminados, plays),
    minutos_assistidos_total: Math.round(segAssistidos / 60),
    minutos_por_aluno: ev.rastreados ? Math.round(segAssistidos / 60 / ev.rastreados) : 0,
    videos_sem_duracao: semDuracao.size,
    top,
  };

  // Joinha: geral, por tipo e os piores.
  const porTipo = { video: { positivos: 0, negativos: 0 }, faq: { positivos: 0, negativos: 0 }, aula: { positivos: 0, negativos: 0 } };
  vs.forEach((v) => { const t = porTipo[v.tipo]; if (!t) return; if (v.voto > 0) t.positivos += 1; else t.negativos += 1; });
  const pos = vs.filter((v) => v.voto > 0).length;
  const neg = vs.length - pos;
  const piores = Object.keys(votosDe)
    .map((k) => { const [tipo, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]; return { tipo, id, titulo: tituloDe(titulos, tipo, id), ...votosDe[k] }; })
    .filter((x) => x.negativos)
    .sort((x, y) => y.negativos - x.negativos || x.positivos - y.positivos)
    .slice(0, 5);
  const avaliacoesOut = {
    positivos: pos, negativos: neg, total: vs.length, pct_positivo: pct(pos, vs.length),
    por_tipo: Object.keys(porTipo).map((tipo) => ({ tipo, ...porTipo[tipo], pct_positivo: pct(porTipo[tipo].positivos, porTipo[tipo].positivos + porTipo[tipo].negativos) })),
    piores,
  };
  return { acessos: acessosOut, videos: videosOut, avaliacoes: avaliacoesOut };
}

module.exports = { porAluno, csvPorAluno, dashboardUso, CATALOGO };
