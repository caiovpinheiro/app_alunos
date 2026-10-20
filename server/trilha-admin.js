'use strict';

// Números da aba "Aula Inaugural" do painel admin (GET /api/admin/trilha e o CSV).
// A regra do certificado (7 módulos = 70 pontos, 10 por módulo) é a de trilha.js (statusCertificado).
// Pontos saem sempre de concluido_em (a coluna `pontos` pode ter valores da escala antiga).

const { NIVEIS, MAX_PONTOS, ABERTURA, PONTOS_MODULO, META_CERTIFICADO, HORAS_CERTIFICADO, statusCertificado } = require('./trilha');


// Vídeo como o rastreio grava (public/js/rastreio.js, nomeVideo): últimos 2 trechos do caminho, sem .mp4.
function chaveVideo(v) {
  return String(v || '').split('?')[0].split('/').slice(-2).join('/').replace(/\.mp4$/, '');
}

// Quantos alunos deram play / viram até o fim nos vídeos de abertura (Boas-vindas, sem pontos).
// Só existe evento para quem tem o rastreio ligado (RASTREIO_LIBERADO_PARA); sem a tabela, devolve null.
// Os capítulos da "Aula completa" são os mesmos arquivos dos módulos, então o evento não separa
// um do outro e a aula completa fica de fora.
async function visualizacoesAbertura(pool) {
  if (!ABERTURA.length) return null;
  const chaves = ABERTURA.map((c) => chaveVideo(c.v));
  try {
    const r = await pool.query(
      `SELECT COUNT(DISTINCT aluno_id) FILTER (WHERE nome = 'video_inicio')::int AS iniciaram,
              COUNT(DISTINCT aluno_id) FILTER (WHERE nome = 'video_fim')::int AS terminaram
       FROM csu_eventos WHERE nome IN ('video_inicio', 'video_fim') AND dados->>'video' = ANY($1::text[])`,
      [chaves],
    );
    return { titulo: ABERTURA.map((c) => c.t).join(' + '), iniciaram: r.rows[0].iniciaram, terminaram: r.rows[0].terminaram };
  } catch (err) {
    if (err.code === '42P01') return null; // csu_eventos ainda não existe (rastreio nunca ligado)
    throw err;
  }
}

// `certificados`: { [aluno_id]: data da 1ª emissão } — vem de index.js (mesma fonte de certificadoEmitido),
// para a regra "quem já emitiu continua valendo" ficar num lugar só.
async function resumoAdmin(pool, certificados = {}) {
  const porAluno = await pool.query(`
    SELECT aluno_id,
           COUNT(*) FILTER (WHERE concluido_em IS NOT NULL)::int AS concluidos
    FROM csu_trilha_progresso GROUP BY aluno_id`);
  let concluiram = 0;
  let atingiram_meta = 0;
  let liberados = 0;
  let certificados_emitidos = 0;
  porAluno.rows.forEach((r) => {
    const st = statusCertificado(r);
    if (!st.faltam_modulos) concluiram += 1;
    if (!st.faltam_pontos) atingiram_meta += 1;
    if (st.liberado) liberados += 1;
    if (certificados[r.aluno_id]) certificados_emitidos += 1;
  });
  const porNivel = await pool.query(`
    SELECT nivel,
           COUNT(*)::int AS abriram,
           COUNT(*) FILTER (WHERE video_ok)::int AS viram_video,
           COUNT(*) FILTER (WHERE concluido_em IS NOT NULL)::int AS concluiram
    FROM csu_trilha_progresso GROUP BY nivel ORDER BY nivel`);
  const rows = await pool.query('SELECT nivel, respostas, travei, concluido_em FROM csu_trilha_progresso');
  const erros = {};
  const travei = {};
  const semErro = {}; // nivel → quantos concluíram acertando todas de primeira
  rows.rows.forEach((r) => {
    if (r.concluido_em && Object.values(r.respostas || {}).every((q) => (q.tries || []).length <= 1)) {
      semErro[r.nivel] = (semErro[r.nivel] || 0) + 1;
    }
    Object.keys(r.respostas || {}).forEach((k) => {
      const e = (r.respostas[k].tries || []).length - (r.respostas[k].ok ? 1 : 0);
      if (e > 0) { const key = `${r.nivel}-${k}`; erros[key] = (erros[key] || 0) + e; }
    });
    Object.keys(r.travei || {}).forEach((p) => {
      const key = `${r.nivel}-${p}`; travei[key] = (travei[key] || 0) + Number(r.travei[p] || 0);
    });
  });
  const nivelInfo = porNivel.rows.reduce((m, r) => { m[r.nivel] = r; return m; }, {});
  const iniciaram = porAluno.rows.length;
  return {
    iniciaram,
    concluiram,
    atingiram_meta,
    certificados_emitidos,
    certificados_total: Object.keys(certificados).length,
    meta: META_CERTIFICADO,
    horas: HORAS_CERTIFICADO,
    total_modulos: NIVEIS.length,
    maximo_pontos: MAX_PONTOS,
    pontos_modulo: PONTOS_MODULO,
    pontos_por_modulo: NIVEIS.map(() => PONTOS_MODULO),
    liberados,
    // Com 10 pontos por módulo, concluir os 7 = bater a meta: o funil tem 3 etapas.
    funil: [
      { etapa: 'Começaram', n: iniciaram },
      { etapa: `Concluíram os ${NIVEIS.length} módulos (${META_CERTIFICADO} pontos)`, n: liberados },
      { etapa: 'Certificado emitido', n: certificados_emitidos },
    ],
    abertura: await visualizacoesAbertura(pool),
    modulos: NIVEIS.map((l, i) => ({
      modulo: i + 1,
      titulo: l.t,
      abriram: nivelInfo[i + 1] ? nivelInfo[i + 1].abriram : 0,
      viram_video: nivelInfo[i + 1] ? nivelInfo[i + 1].viram_video : 0,
      concluiram: nivelInfo[i + 1] ? nivelInfo[i + 1].concluiram : 0,
      sem_erro: semErro[i + 1] || 0,
      maximo_pontos: PONTOS_MODULO,
    })),
    perguntas_dificeis: Object.keys(erros)
      .map((key) => { const [n, k] = key.split('-').map(Number); return { modulo: n, pergunta: NIVEIS[n - 1].qs[k].q, erros: erros[key] }; })
      .sort((a, b) => b.erros - a.erros).slice(0, 10),
    travei: Object.keys(travei)
      .map((key) => {
        const [n, p] = key.split('-').map(Number);
        const l = NIVEIS[n - 1];
        return { modulo: n, parte: l.parts && l.parts[p] ? l.parts[p].t : 'Vídeo', vezes: travei[key] };
      })
      .sort((a, b) => b.vezes - a.vezes),
  };
}

// Uma linha por aluno que começou a Aula Inaugural (para o CRM chamar quem parou).
async function exportAlunos(pool, certificados = {}) {
  const r = await pool.query(`
    SELECT a.id AS aluno_id, a.nome, a.rgm, a.email,
           COUNT(*) FILTER (WHERE p.concluido_em IS NOT NULL)::int AS concluidos,
           MAX(p.atualizado_em) AS ultimo_acesso
    FROM csu_trilha_progresso p
    JOIN csu_alunos a ON a.id = p.aluno_id
    GROUP BY a.id
    ORDER BY ultimo_acesso DESC`);
  return r.rows.map((row) => ({
    ...row,
    certificado: statusCertificado(row),
    certificado_emitido: Boolean(certificados[row.aluno_id]),
    certificado_emitido_em: certificados[row.aluno_id] || null,
  }));
}

// ---------- "Onde trava": sinais de atrito por módulo e alunos presos ----------

const GAP_ATIVO_MS = 5 * 60 * 1000; // intervalo entre eventos acima disso = aluno parado, não conta como tempo no módulo

// Vídeo (chave como o rastreio grava) → módulo. Vídeo principal/capítulos e o passo a passo opcional.
const MODULO_DO_VIDEO = (() => {
  const m = {};
  NIVEIS.forEach((l, i) => {
    if (l.video) m[chaveVideo(l.video)] = i + 1;
    (l.parts || []).forEach((p) => { m[chaveVideo(p.v)] = i + 1; });
    (l.passo_a_passo || []).forEach((p) => { m[chaveVideo(p.v)] = i + 1; });
  });
  return m;
})();

function mediana(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

// Lê os eventos do rastreio (só alunos com RASTREIO_LIBERADO_PARA) e organiza por aluno:
// tempo ativo por módulo, pausas e WhatsApp por módulo, e um registro por vídeo (play, fim, % máximo, pausas).
// Sem a tabela csu_eventos (rastreio nunca ligado) devolve disponivel: false. Vídeo fora de módulo
// (Central, abertura) entra em `videos` com modulo null.
async function lerEventos(pool) {
  let rows;
  try {
    rows = (await pool.query(
      `SELECT aluno_id, nome, dados, criado_em FROM csu_eventos
       WHERE nome IN ('tela_aberta', 'trilha_nivel_aberto', 'trilha_video_assistido', 'trilha_video_pulado', 'trilha_travei',
                      'trilha_resposta', 'trilha_nivel_concluido', 'trilha_tarefa', 'whatsapp_clicado',
                      'video_inicio', 'video_progresso', 'video_pausa', 'video_fim', 'video_retomado')
       ORDER BY aluno_id, criado_em`,
    )).rows;
  } catch (err) {
    if (err.code === '42P01') return { disponivel: false, rastreados: 0, porAluno: {} };
    throw err;
  }
  const porAluno = {};
  const alunoDe = (id) => porAluno[id] || (porAluno[id] = { tempo: {}, pausas: {}, whatsapp: {}, videos: {} });
  let alunoAtual = null;
  let ctx = null;
  let anterior = null;
  rows.forEach((e) => {
    if (e.aluno_id !== alunoAtual) { alunoAtual = e.aluno_id; ctx = null; anterior = null; }
    const a = alunoDe(e.aluno_id);
    const d = e.dados || {};
    const t = new Date(e.criado_em).getTime();
    if (e.nome === 'tela_aberta') { ctx = null; anterior = t; return; }
    let modulo = null;
    if (e.nome.startsWith('trilha_') && Number(d.nivel)) modulo = Number(d.nivel);
    else if (e.nome.startsWith('video_') && MODULO_DO_VIDEO[d.video]) modulo = MODULO_DO_VIDEO[d.video];
    else if (e.nome === 'whatsapp_clicado') modulo = d.origem === 'trilha' || d.origem === 'portal' ? ctx : null;
    if (e.nome.startsWith('video_') && d.video) {
      const v = a.videos[d.video] || (a.videos[d.video] = { modulo, inicio: false, fim: false, pct: 0, pausas: 0, primeiro_em: e.criado_em, ultimo_em: e.criado_em });
      if (e.nome === 'video_inicio') v.inicio = true;
      if (e.nome === 'video_fim') { v.fim = true; v.pct = 100; }
      if (e.nome === 'video_progresso') v.pct = Math.max(v.pct, Number(d.pct) || 0);
      if (e.nome === 'video_pausa') v.pausas += 1;
      v.ultimo_em = e.criado_em;
    }
    if (modulo && NIVEIS[modulo - 1]) {
      if (ctx === modulo && anterior != null) a.tempo[modulo] = (a.tempo[modulo] || 0) + Math.min(Math.max(0, t - anterior), GAP_ATIVO_MS);
      ctx = modulo;
      if (e.nome === 'whatsapp_clicado') a.whatsapp[modulo] = (a.whatsapp[modulo] || 0) + 1;
      if (e.nome === 'video_pausa') a.pausas[modulo] = (a.pausas[modulo] || 0) + 1;
    } else {
      ctx = null;
    }
    anterior = t;
  });
  return { disponivel: true, rastreados: Object.keys(porAluno).length, porAluno };
}

// Agrega lerEventos() por módulo para a tabela "Onde trava".
async function sinaisDosEventos(pool) {
  const ev = await lerEventos(pool);
  const porModulo = {};
  NIVEIS.forEach((_, i) => { porModulo[i + 1] = { tempos: [], videos: {}, pausas: 0, whatsapp: 0, alunos: new Set() }; });
  Object.keys(ev.porAluno).forEach((alunoId) => {
    const a = ev.porAluno[alunoId];
    Object.keys(a.tempo).forEach((m) => { porModulo[m].tempos.push(a.tempo[m] / 60000); porModulo[m].alunos.add(alunoId); });
    Object.keys(a.pausas).forEach((m) => { porModulo[m].pausas += a.pausas[m]; porModulo[m].alunos.add(alunoId); });
    Object.keys(a.whatsapp).forEach((m) => { porModulo[m].whatsapp += a.whatsapp[m]; });
    Object.values(a.videos).forEach((v) => {
      if (!v.inicio || !v.modulo || !porModulo[v.modulo]) return;
      const m = porModulo[v.modulo];
      m.alunos.add(alunoId);
      m.videos.iniciados = (m.videos.iniciados || 0) + 1;
      if (!v.fim) { m.videos.abandonados = (m.videos.abandonados || 0) + 1; m.videos.pct = (m.videos.pct || []).concat(v.pct); }
    });
  });
  return { porModulo, rastreados: ev.rastreados, disponivel: ev.disponivel };
}

// 👍/👎 por módulo (csu_avaliacoes, tipo 'aula', id 'modulo-N'). Sem a tabela, tudo zero.
async function votosPorModulo(pool) {
  const out = {};
  NIVEIS.forEach((_, i) => { out[i + 1] = { positivos: 0, negativos: 0, rgms_negativos: new Set() }; });
  try {
    const r = await pool.query(`SELECT rgm, conteudo_id, voto FROM csu_avaliacoes WHERE tipo = 'aula' AND conteudo_id LIKE 'modulo-%'`);
    r.rows.forEach((v) => {
      const n = Number(v.conteudo_id.slice(7));
      if (!out[n]) return;
      if (v.voto > 0) out[n].positivos += 1;
      else { out[n].negativos += 1; out[n].rgms_negativos.add(String(v.rgm)); }
    });
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }
  return out;
}

async function ondeTrava(pool) {
  const [eventos, votos, progresso] = await Promise.all([
    sinaisDosEventos(pool),
    votosPorModulo(pool),
    pool.query(`
      SELECT p.aluno_id, a.nome, a.rgm, p.nivel, p.partes_vistas, p.video_ok, p.pulou_video, p.respostas, p.travei, p.pontos,
             p.concluido_em, p.atualizado_em
      FROM csu_trilha_progresso p JOIN csu_alunos a ON a.id = p.aluno_id ORDER BY p.aluno_id, p.nivel`),
  ]);
  const porModulo = {};
  NIVEIS.forEach((_, i) => { porModulo[i + 1] = { erros: 0, travei: 0, abandonaram_aqui: 0 }; });
  const alunos = {};
  progresso.rows.forEach((r) => {
    const m = porModulo[r.nivel];
    if (!m) return;
    const erros = Object.values(r.respostas || {}).reduce((n, q) => n + Math.max(0, (q.tries || []).length - (q.ok ? 1 : 0)), 0);
    const travei = Object.values(r.travei || {}).reduce((n, x) => n + (Number(x) || 0), 0);
    m.erros += erros;
    m.travei += travei;
    const a = alunos[r.aluno_id] || (alunos[r.aluno_id] = { aluno_id: r.aluno_id, nome: r.nome, rgm: r.rgm, concluidos: 0, pontos: 0, ultimo: null, modulos: {} });
    if (r.concluido_em) a.concluidos += 1;
    a.pontos += r.concluido_em ? PONTOS_MODULO : 0;
    const partes = NIVEIS[r.nivel - 1].parts ? NIVEIS[r.nivel - 1].parts.length : 1;
    a.modulos[r.nivel] = {
      erros, travei, concluido: Boolean(r.concluido_em), atualizado_em: r.atualizado_em,
      video_pendente: !r.video_ok && !r.pulou_video && (r.partes_vistas || []).length < partes,
      negativo: votos[r.nivel].rgms_negativos.has(String(r.rgm)),
    };
    if (!a.ultimo || new Date(r.atualizado_em) > new Date(a.ultimo.atualizado_em)) a.ultimo = { nivel: r.nivel, atualizado_em: r.atualizado_em };
  });
  const agora = Date.now();
  const presos = Object.values(alunos)
    .filter((a) => a.concluidos < NIVEIS.length && a.ultimo)
    .map((a) => {
      const n = a.ultimo.nivel;
      const m = a.modulos[n];
      const motivos = m.concluido ? ['concluiu este módulo e não abriu outro'] : [];
      if (m.travei) motivos.push(`tocou em Travei ${m.travei}x`);
      if (m.negativo) motivos.push('deu 👎 no módulo');
      if (m.erros) motivos.push(`${m.erros} erro(s) nas perguntas`);
      if (m.video_pendente) motivos.push('não terminou o vídeo');
      if (!motivos.length) motivos.push('abriu e não concluiu');
      porModulo[n].abandonaram_aqui += 1;
      return {
        aluno_id: a.aluno_id, nome: a.nome, rgm: a.rgm, concluidos: a.concluidos, pontos: a.pontos,
        modulo: n, modulo_titulo: NIVEIS[n - 1].t,
        dias_parado: Math.floor((agora - new Date(a.ultimo.atualizado_em).getTime()) / 86400000),
        ultimo_acesso: a.ultimo.atualizado_em,
        motivos,
      };
    })
    .sort((x, y) => y.dias_parado - x.dias_parado || y.modulo - x.modulo)
    .slice(0, 100);
  const modulos = NIVEIS.map((l, i) => {
    const n = i + 1;
    const ev = eventos.porModulo[n];
    const p = porModulo[n];
    const v = votos[n];
    const abandonados = ev.videos.abandonados || 0;
    const atrito = p.travei * 3 + v.negativos * 3 + p.abandonaram_aqui * 2 + abandonados + p.erros;
    return {
      modulo: n,
      titulo: l.t,
      alunos_rastreados: ev.alunos.size,
      tempo_mediano_min: ev.tempos.length ? Math.round(mediana(ev.tempos) * 10) / 10 : null,
      videos_iniciados: ev.videos.iniciados || 0,
      videos_abandonados: abandonados,
      parou_em_pct: abandonados ? Math.round(ev.videos.pct.reduce((s, x) => s + x, 0) / abandonados) : null,
      pausas: ev.pausas,
      whatsapp: ev.whatsapp,
      erros: p.erros,
      travei: p.travei,
      abandonaram_aqui: p.abandonaram_aqui,
      positivos: v.positivos,
      negativos: v.negativos,
      atrito,
    };
  });
  return {
    rastreio_disponivel: eventos.disponivel,
    alunos_rastreados: eventos.rastreados,
    gap_ativo_min: GAP_ATIVO_MS / 60000,
    modulos,
    alunos_presos: presos,
  };
}

module.exports = { resumoAdmin, exportAlunos, ondeTrava, lerEventos, chaveVideo, MODULO_DO_VIDEO, GAP_ATIVO_MS };
