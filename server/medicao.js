'use strict';

// Aba Medição do admin (GET /api/admin/medicao?dias=30): as perguntas que decidem o que produzir.
//   1. Retenção por coorte semanal de criação da conta: voltou até D+1, D+7 e D+14 (csu_acessos).
//   2. Resultado prático ("Conseguiu fazer?") por módulo, tutorial e dúvida da Central.
//   3. Saídas para o sistema da faculdade (evento saida_externa) por destino e por onde o aluno estava,
//      e a taxa de quem tocou em "Fazer agora" no módulo 1 e saiu em seguida.
//   4. Ofertas de ajuda: oferecida → aceita → resolvida, com tempo mediano, por origem.
//   5. Origem do primeiro acesso (?o=) por coorte e falhas de login por dia.
//
// Só lê. Conta só as contas criadas a partir de contar_desde (Configurações › Faixas, recorte.js).
// As contas ficam nas funções puras abaixo (sem banco), testadas em tools/test-instrumentacao.js.
// Não há faixa Bom/Regular/Ruim aqui: estes números ainda não têm meta (plano de 06/11/2026, seção 5).
// Fica o "poucos dados" da Visão geral: menos de 5 alunos na conta.

const recorte = require('./recorte');

const TZ = 'America/Sao_Paulo';
const JANELAS = [1, 7, 14];
const SEMANAS = 12;
const MIN_AMOSTRA = 5;
const JANELA_SAIDA_H = 24; // "Fazer agora" → saiu para a faculdade em até 24 h

const DESTINOS = {
  ava: 'AVA (Blackboard)',
  area_aluno: 'Área do Aluno',
  email_academico: 'E-mail acadêmico',
  loja_duda: 'Loja: app Duda',
  loja_authenticator: 'Loja: Authenticator',
};
const ORIGENS_AJUDA = {
  travei: 'Tocou em "Travei"',
  quiz_erros: 'Errou 2 vezes a mesma pergunta',
  video_pausas: 'Pausou o vídeo várias vezes',
  busca_vazia: 'Buscou na Central e não achou',
  certificado_erro: 'Erro ao gerar o certificado',
  parado: 'Ficou parado no módulo',
  nao_funcionou: 'Disse que não funcionou',
  ajuda_painel: 'Pediu ajuda pelo painel (sem oferta)',
};
const TELAS = { '/inicio': 'Início', '/meu-semestre': 'Meu semestre', '/tutoriais': 'Central de ajuda', '/trilha': 'Aula Inaugural', '/avisos': 'Avisos', '/atendimento': 'Atendimento' };

// ---------- datas: dias no horário de Brasília, como texto 'AAAA-MM-DD' ----------

const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function diaSP(d) { return fmtDia.format(d instanceof Date ? d : new Date(d)); }
function utc(dia) { return Date.parse(dia + 'T00:00:00Z'); }
function addDias(dia, n) { return new Date(utc(dia) + n * 86400000).toISOString().slice(0, 10); }
function difDias(de, ate) { return Math.round((utc(ate) - utc(de)) / 86400000); }
// Semana começa na segunda-feira.
function inicioSemana(dia) { const dow = new Date(utc(dia)).getUTCDay(); return addDias(dia, -((dow + 6) % 7)); }

function pct(n, de) { return de ? Math.round((100 * n) / de) : null; }
function mediana(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function minutos(de, ate) { return de && ate ? (new Date(ate).getTime() - new Date(de).getTime()) / 60000 : NaN; }

// ---------- 1. retenção ----------

// contas: [{ criada: 'AAAA-MM-DD', entrou: bool, dias: ['AAAA-MM-DD', ...] }] (dias com acesso registrado).
// D0 = primeiro dia com acesso registrado. "Voltou até D+N" = teve acesso em outro dia, entre o dia seguinte
// e N dias depois. A conta só entra na conta de D+N quando esse prazo terminou (hoje não conta: o dia não
// acabou). A coorte só é comparada quando a semana de criação terminou há mais de N dias.
function retencao(contas, hoje, janelas = JANELAS) {
  const porSemana = new Map();
  (contas || []).forEach((c) => {
    if (!c || !c.criada) return;
    const semana = inicioSemana(c.criada);
    let x = porSemana.get(semana);
    if (!x) {
      x = { semana, fim: addDias(semana, 6), contas: 0, entraram: 0, rastreadas: 0, janelas: {} };
      janelas.forEach((n) => { x.janelas[n] = { elegiveis: 0, voltaram: 0, no_prazo: 0 }; });
      porSemana.set(semana, x);
    }
    x.contas += 1;
    if (c.entrou) x.entraram += 1;
    const dias = Array.from(new Set((c.dias || []).filter(Boolean))).sort();
    if (!dias.length) return;
    x.rastreadas += 1;
    const d0 = dias[0];
    janelas.forEach((n) => {
      const j = x.janelas[n];
      if (difDias(d0, hoje) <= n) { j.no_prazo += 1; return; }
      j.elegiveis += 1;
      if (dias.some((d) => { const k = difDias(d0, d); return k >= 1 && k <= n; })) j.voltaram += 1;
    });
  });
  const coortes = Array.from(porSemana.values()).sort((a, b) => (a.semana < b.semana ? 1 : -1)).map((x) => {
    const out = { ...x, janelas: {} };
    janelas.forEach((n) => {
      const j = x.janelas[n];
      out.janelas[n] = { ...j, pct: pct(j.voltaram, j.elegiveis), completa: difDias(x.fim, hoje) > n, poucos: j.elegiveis < MIN_AMOSTRA };
    });
    return out;
  });
  // Comparação: só coortes com o prazo completo e amostra suficiente.
  const comparacao = {};
  janelas.forEach((n) => {
    const ok = coortes.filter((c) => c.janelas[n].completa && !c.janelas[n].poucos);
    const el = ok.reduce((s, c) => s + c.janelas[n].elegiveis, 0);
    const vo = ok.reduce((s, c) => s + c.janelas[n].voltaram, 0);
    const ord = ok.slice().sort((a, b) => b.janelas[n].pct - a.janelas[n].pct);
    comparacao[n] = {
      coortes: ok.length,
      pct: pct(vo, el),
      melhor: ord[0] ? { semana: ord[0].semana, pct: ord[0].janelas[n].pct } : null,
      pior: ord.length > 1 ? { semana: ord[ord.length - 1].semana, pct: ord[ord.length - 1].janelas[n].pct } : null,
    };
  });
  return { janelas, coortes, comparacao };
}

// ---------- 2. resultado prático ----------

// bases: quem viu o conteúdo depois que a pergunta existia [{ chave: 'modulo:1'|'video:id'|'faq:id', rgm }].
// votos: csu_avaliacoes tipo 'pratica' [{ chave, rgm, voto }]. Quem respondeu sem estar na base também conta.
function resultadoPratico(bases, votos, opts) {
  const o = opts || {};
  const titulo = o.titulo || ((tipo, id) => `${tipo} ${id}`);
  const itens = new Map();
  const item = (chave) => {
    let x = itens.get(chave);
    if (!x) {
      const i = chave.indexOf(':');
      x = { chave, tipo: chave.slice(0, i), id: chave.slice(i + 1), viram: new Set(), sim: new Set(), nao: new Set() };
      itens.set(chave, x);
    }
    return x;
  };
  (o.modulos || []).forEach((n) => item(`modulo:${n}`));
  (bases || []).forEach((b) => { if (b && b.chave && b.chave.indexOf(':') > 0) item(b.chave).viram.add(String(b.rgm)); });
  (votos || []).forEach((v) => {
    if (!v || !v.chave || v.chave.indexOf(':') < 1) return;
    const x = item(v.chave);
    (Number(v.voto) > 0 ? x.sim : x.nao).add(String(v.rgm));
  });
  const lista = Array.from(itens.values()).map((x) => {
    const responderam = new Set([...x.sim, ...x.nao]);
    const base = new Set([...x.viram, ...responderam]);
    return {
      chave: x.chave, tipo: x.tipo, id: x.id, titulo: titulo(x.tipo, x.id),
      base: base.size, conseguiu: x.sim.size, nao_conseguiu: x.nao.size, sem_resposta: base.size - responderam.size,
      pct_conseguiu: pct(x.sim.size, responderam.size), pct_nao: pct(x.nao.size, responderam.size), pct_resposta: pct(responderam.size, base.size),
      poucos: responderam.size < MIN_AMOSTRA,
    };
  });
  const modulos = lista.filter((x) => x.tipo === 'modulo').sort((a, b) => Number(a.id) - Number(b.id));
  const conteudos = lista.filter((x) => x.tipo !== 'modulo' && (x.conseguiu + x.nao_conseguiu + x.base) > 0)
    .sort((a, b) => b.nao_conseguiu - a.nao_conseguiu || b.base - a.base);
  // Com amostra (5+ respostas) primeiro: 1 "não funcionou" em 1 resposta não passa na frente de 4 em 7.
  const piores = lista.filter((x) => x.nao_conseguiu > 0)
    .sort((a, b) => a.poucos - b.poucos || b.pct_nao - a.pct_nao || b.nao_conseguiu - a.nao_conseguiu || b.base - a.base).slice(0, 5);
  const totais = {};
  ['modulo', 'video', 'faq'].forEach((t) => {
    const l = lista.filter((x) => x.tipo === t);
    const s = l.reduce((m, x) => ({ base: m.base + x.base, conseguiu: m.conseguiu + x.conseguiu, nao: m.nao + x.nao_conseguiu }), { base: 0, conseguiu: 0, nao: 0 });
    totais[t] = { ...s, sem_resposta: s.base - s.conseguiu - s.nao, pct_conseguiu: pct(s.conseguiu, s.conseguiu + s.nao) };
  });
  return { modulos, conteudos, piores, totais };
}

// ---------- 3. saídas para a faculdade ----------

function rotuloOrigemSaida(e) {
  const m = Number(e.modulo);
  if (Number.isInteger(m) && m > 0) return { chave: `modulo:${m}`, rotulo: `Aula Inaugural · Módulo ${m}` };
  const tela = String(e.tela || '').split('#')[0];
  return { chave: `tela:${tela || '?'}`, rotulo: TELAS[tela] || tela || 'Outra tela' };
}

// eventos: [{ aluno_id, destino, modulo, tela }]
function saidas(eventos, titulosModulo) {
  const dest = new Map();
  const orig = new Map();
  const alunos = new Set();
  (eventos || []).forEach((e) => {
    if (!e || !DESTINOS[e.destino]) return;
    alunos.add(e.aluno_id);
    let d = dest.get(e.destino);
    if (!d) { d = { destino: e.destino, rotulo: DESTINOS[e.destino], cliques: 0, alunos: new Set() }; dest.set(e.destino, d); }
    d.cliques += 1; d.alunos.add(e.aluno_id);
    const o = rotuloOrigemSaida(e);
    let x = orig.get(o.chave);
    if (!x) {
      const m = /^modulo:(\d+)$/.exec(o.chave);
      x = { chave: o.chave, rotulo: m && titulosModulo && titulosModulo[m[1]] ? `${o.rotulo} (${titulosModulo[m[1]]})` : o.rotulo, cliques: 0, alunos: new Set(), destinos: {} };
      orig.set(o.chave, x);
    }
    x.cliques += 1; x.alunos.add(e.aluno_id);
    x.destinos[e.destino] = (x.destinos[e.destino] || 0) + 1;
  });
  const fim = (x) => ({ ...x, alunos: x.alunos.size });
  return {
    cliques: Array.from(dest.values()).reduce((s, d) => s + d.cliques, 0),
    alunos: alunos.size,
    por_destino: Array.from(dest.values()).map(fim).sort((a, b) => b.cliques - a.cliques),
    por_origem: Array.from(orig.values()).map(fim).sort((a, b) => {
      const ma = /^modulo:(\d+)$/.exec(a.chave); const mb = /^modulo:(\d+)$/.exec(b.chave);
      if (ma && mb) return Number(ma[1]) - Number(mb[1]);
      if (ma || mb) return ma ? -1 : 1;
      return b.cliques - a.cliques;
    }),
  };
}

// Módulo 1: de quem tocou em "Fazer agora", quantos saíram para a faculdade (e para o AVA) em até 24 h.
// escolhas: [{ aluno_id, escolha: 'agora'|'depois', em }]; saidasEv: [{ aluno_id, destino, em }].
function fazerAgora(escolhas, saidasEv, horas = JANELA_SAIDA_H) {
  const primeiro = new Map();
  const depois = new Set();
  (escolhas || []).forEach((e) => {
    if (!e) return;
    if (e.escolha === 'depois') { depois.add(e.aluno_id); return; }
    if (e.escolha !== 'agora') return;
    const t = new Date(e.em).getTime();
    if (!primeiro.has(e.aluno_id) || t < primeiro.get(e.aluno_id)) primeiro.set(e.aluno_id, t);
  });
  const lim = horas * 3600000;
  const saiu = new Set();
  const saiuAva = new Set();
  const porDestino = {};
  (saidasEv || []).forEach((s) => {
    if (!s || !primeiro.has(s.aluno_id) || !DESTINOS[s.destino]) return;
    const dt = new Date(s.em).getTime() - primeiro.get(s.aluno_id);
    if (dt < 0 || dt > lim) return;
    if (!saiu.has(s.aluno_id)) porDestino[s.destino] = (porDestino[s.destino] || 0) + 1;
    saiu.add(s.aluno_id);
    if (s.destino === 'ava') saiuAva.add(s.aluno_id);
  });
  const n = primeiro.size;
  return {
    horas, agora: n, depois: Array.from(depois).filter((id) => !primeiro.has(id)).length,
    sairam: saiu.size, pct_sairam: pct(saiu.size, n), sairam_ava: saiuAva.size, pct_ava: pct(saiuAva.size, n),
    primeiro_destino: porDestino, poucos: n < MIN_AMOSTRA,
  };
}

// ---------- 4. ofertas de ajuda ----------

// eventos: [{ nome: 'ajuda_oferecida'|'ajuda_recusada', origem }]; pedidos: csu_pedidos_ajuda.
function ajuda(eventos, pedidos) {
  const m = new Map();
  const de = (origem) => {
    const k = origem || 'outra';
    let x = m.get(k);
    if (!x) { x = { origem: k, rotulo: ORIGENS_AJUDA[k] || k, oferecida: 0, recusada: 0, aceita: 0, resolvida: 0, atendida: 0, t_resolver: [], t_atender: [] }; m.set(k, x); }
    return x;
  };
  (eventos || []).forEach((e) => {
    if (!e) return;
    if (e.nome === 'ajuda_oferecida') de(e.origem).oferecida += 1;
    else if (e.nome === 'ajuda_recusada') de(e.origem).recusada += 1;
  });
  (pedidos || []).forEach((p) => {
    if (!p) return;
    const x = de(p.origem);
    x.aceita += 1;
    if (p.atendido_em) { x.atendida += 1; x.t_atender.push(minutos(p.criado_em, p.atendido_em)); }
    if (p.situacao === 'resolvido' && p.resolvido_em) { x.resolvida += 1; x.t_resolver.push(minutos(p.criado_em, p.resolvido_em)); }
  });
  const fim = (x) => {
    const mr = mediana(x.t_resolver); const ma = mediana(x.t_atender);
    return {
      origem: x.origem, rotulo: x.rotulo, oferecida: x.oferecida, recusada: x.recusada, aceita: x.aceita, atendida: x.atendida, resolvida: x.resolvida,
      pct_aceita: pct(x.aceita, x.oferecida), pct_resolvida: pct(x.resolvida, x.aceita),
      mediana_atender_min: ma == null ? null : Math.round(ma), mediana_resolver_min: mr == null ? null : Math.round(mr),
    };
  };
  const linhas = Array.from(m.values()).map(fim).sort((a, b) => b.oferecida - a.oferecida || b.aceita - a.aceita);
  const tot = Array.from(m.values()).reduce((t, x) => {
    t.oferecida += x.oferecida; t.recusada += x.recusada; t.aceita += x.aceita; t.atendida += x.atendida; t.resolvida += x.resolvida;
    t.t_resolver.push(...x.t_resolver); t.t_atender.push(...x.t_atender);
    return t;
  }, { origem: 'total', rotulo: 'Total', oferecida: 0, recusada: 0, aceita: 0, atendida: 0, resolvida: 0, t_resolver: [], t_atender: [] });
  const total = fim(tot);
  // No total, a taxa de aceite só olha as origens que têm oferta (o pedido pelo painel não passa por ela).
  const comOferta = linhas.filter((x) => x.oferecida > 0);
  total.pct_aceita = pct(comOferta.reduce((s, x) => s + x.aceita, 0), total.oferecida);
  return { origens: linhas, total };
}

// ---------- 5. entrada: origem do primeiro acesso e falhas de login ----------

// contas: [{ criada, entrou, medida (tem a 1ª entrada gravada), origem }]
function origens(contas) {
  const porSemana = new Map();
  const vistas = new Set();
  (contas || []).forEach((c) => {
    if (!c || !c.criada) return;
    const semana = inicioSemana(c.criada);
    let x = porSemana.get(semana);
    if (!x) { x = { semana, contas: 0, nao_entrou: 0, antes: 0, origens: {} }; porSemana.set(semana, x); }
    x.contas += 1;
    if (!c.entrou && !c.medida) { x.nao_entrou += 1; return; }
    if (!c.medida) { x.antes += 1; return; }
    const o = c.origem || 'sem_origem';
    vistas.add(o);
    x.origens[o] = (x.origens[o] || 0) + 1;
  });
  const lista = Array.from(vistas).sort((a, b) => (a === 'sem_origem') - (b === 'sem_origem') || a.localeCompare(b));
  return { origens: lista, coortes: Array.from(porSemana.values()).sort((a, b) => (a.semana < b.semana ? 1 : -1)) };
}

// falhas: [{ dia, motivo, aluno_id }] -> uma linha por dia (mais recente primeiro) e o total por motivo.
function falhasPorDia(falhas) {
  const dias = new Map();
  const motivos = {};
  const contas = new Set();
  (falhas || []).forEach((f) => {
    if (!f || !f.dia || !f.motivo) return;
    let d = dias.get(f.dia);
    if (!d) { d = { dia: f.dia, total: 0, motivos: {}, contas: new Set() }; dias.set(f.dia, d); }
    d.total += 1;
    d.motivos[f.motivo] = (d.motivos[f.motivo] || 0) + 1;
    motivos[f.motivo] = (motivos[f.motivo] || 0) + 1;
    if (f.aluno_id != null) { d.contas.add(f.aluno_id); contas.add(f.aluno_id); }
  });
  return {
    total: Array.from(dias.values()).reduce((s, d) => s + d.total, 0),
    contas_identificadas: contas.size,
    motivos,
    dias: Array.from(dias.values()).map((d) => ({ ...d, contas: d.contas.size })).sort((a, b) => (a.dia < b.dia ? 1 : -1)),
  };
}

// ---------- consultas ----------

async function seguro(promessa, vazio) {
  try { return await promessa; } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return vazio; // tabela ou coluna ainda não existe
    throw err;
  }
}

const corteAluno = (n) => `($${n}::date IS NULL OR a.created_at >= (($${n}::date)::timestamp AT TIME ZONE '${TZ}'))`;
const chaveRgm = `COALESCE(NULLIF(trim(a.rgm), ''), 'sem-rgm-' || a.id)`;

const cache = new Map();

async function relatorio(pool, opts) {
  const dias = Math.max(7, Math.min(180, Math.round(Number(opts && opts.dias)) || 30));
  const c = cache.get(dias);
  if (c && Date.now() - c.em < 30000) return c.valor;
  const valor = await calcular(pool, dias);
  cache.set(dias, { em: Date.now(), valor });
  return valor;
}

async function calcular(pool, dias) {
  const desde = await recorte.contarDesde(pool);
  const hoje = diaSP(new Date());
  const inicioCoortes = addDias(inicioSemana(hoje), -7 * (SEMANAS - 1));
  const janela = `now() - ($2::int * interval '1 day')`;
  const avaliacoes = require('./avaliacoes'); // títulos dos conteúdos
  const titulos = avaliacoes.carregarTitulos();
  const tituloDe = (tipo, id) => (tipo === 'modulo' ? avaliacoes.tituloDe(titulos, 'aula', `modulo-${id}`) : avaliacoes.tituloDe(titulos, tipo, id));
  const NIVEIS = require('./trilha').NIVEIS;
  const titulosModulo = {};
  NIVEIS.forEach((l, i) => { titulosModulo[i + 1] = l.t; });

  const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
  const inicioPratica = (await seguro(q(`SELECT MIN(criado_em) AS em FROM csu_avaliacoes WHERE tipo = 'pratica'`), [{}]))[0].em || null;

  const [contas, votos, basesMod, basesCentral, saidasEv, escolhas, ajudaEv, pedidos, entradas, falhas, inicios] = await Promise.all([
    // 1 e 5: contas das últimas 12 semanas, com os dias de acesso registrados e a primeira entrada gravada.
    seguro(q(`
      SELECT to_char((a.created_at AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS criada,
             a.primeiro_login_em IS NOT NULL AS entrou,
             COALESCE((SELECT array_agg(DISTINCT to_char((ac.inicio AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD'))
                       FROM csu_acessos ac WHERE ac.aluno_id = a.id), '{}') AS dias,
             pe.id IS NOT NULL AS medida, pe.origem
      FROM csu_alunos a
      LEFT JOIN LATERAL (SELECT id, origem FROM csu_entradas e WHERE e.aluno_id = a.id AND e.primeira ORDER BY e.criado_em LIMIT 1) pe ON TRUE
      WHERE a.ativo AND ${corteAluno(1)} AND a.created_at >= (($2::date)::timestamp AT TIME ZONE '${TZ}')`, [desde, inicioCoortes]), []),
    // 2: respostas do "Conseguiu fazer?" no período.
    seguro(q(`
      SELECT v.conteudo_id AS chave, v.rgm, v.voto FROM csu_avaliacoes v
      WHERE v.tipo = 'pratica' AND v.atualizado_em >= ${janela}
        AND v.rgm IN (SELECT ${chaveRgm} FROM csu_alunos a WHERE ${corteAluno(1)})`, [desde, dias]), []),
    inicioPratica ? seguro(q(`
      SELECT DISTINCT 'modulo:' || p.nivel AS chave, ${chaveRgm} AS rgm
      FROM csu_trilha_progresso p JOIN csu_alunos a ON a.id = p.aluno_id
      WHERE p.concluido_em >= GREATEST($3::timestamptz, ${janela}) AND ${corteAluno(1)}`, [desde, dias, inicioPratica]), []) : [],
    inicioPratica ? seguro(q(`
      SELECT DISTINCT (CASE e.nome WHEN 'central_video' THEN 'video:' ELSE 'faq:' END) || (e.dados->>'id') AS chave, ${chaveRgm} AS rgm
      FROM csu_eventos e JOIN csu_alunos a ON a.id = e.aluno_id
      WHERE e.nome IN ('central_video', 'faq_aberta') AND e.dados ? 'id'
        AND e.criado_em >= GREATEST($3::timestamptz, ${janela}) AND ${corteAluno(1)}`, [desde, dias, inicioPratica]), []) : [],
    // 3: saídas e escolhas do módulo 1 (24 h a mais de saídas para quem escolheu no começo do período).
    seguro(q(`
      SELECT e.aluno_id, e.dados->>'destino' AS destino, e.dados->>'modulo' AS modulo, e.tela, e.criado_em AS em
      FROM csu_eventos e WHERE e.nome = 'saida_externa' AND e.criado_em >= ${janela}
        AND e.aluno_id IN (SELECT a.id FROM csu_alunos a WHERE ${corteAluno(1)})`, [desde, dias]), []),
    seguro(q(`
      SELECT e.aluno_id, e.dados->>'escolha' AS escolha, e.criado_em AS em
      FROM csu_eventos e WHERE e.nome = 'aula_pratica_escolha' AND e.criado_em >= ${janela}
        AND e.aluno_id IN (SELECT a.id FROM csu_alunos a WHERE ${corteAluno(1)})`, [desde, dias]), []),
    // 4: ofertas (rastreio) e pedidos.
    seguro(q(`
      SELECT e.nome, e.dados->>'origem' AS origem FROM csu_eventos e
      WHERE e.nome IN ('ajuda_oferecida', 'ajuda_recusada') AND e.criado_em >= ${janela}
        AND e.aluno_id IN (SELECT a.id FROM csu_alunos a WHERE ${corteAluno(1)})`, [desde, dias]), []),
    seguro(q(`
      SELECT p.origem, p.situacao, p.criado_em, p.atendido_em, p.resolvido_em FROM csu_pedidos_ajuda p
      WHERE p.criado_em >= ${janela} AND p.aluno_id IN (SELECT a.id FROM csu_alunos a WHERE ${corteAluno(1)})`, [desde, dias]), []),
    // 5: entradas do período por origem e falhas de login por dia.
    seguro(q(`
      SELECT COALESCE(e.origem, 'sem_origem') AS origem, COUNT(*)::int AS entradas, COUNT(*) FILTER (WHERE e.primeira)::int AS primeiras,
             COUNT(DISTINCT e.aluno_id)::int AS alunos
      FROM csu_entradas e WHERE e.criado_em >= ${janela}
        AND e.aluno_id IN (SELECT a.id FROM csu_alunos a WHERE ${corteAluno(1)})
      GROUP BY 1 ORDER BY 2 DESC`, [desde, dias]), []),
    seguro(q(`
      SELECT to_char((f.criado_em AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS dia, f.motivo, f.aluno_id
      FROM csu_login_falhas f
      WHERE f.criado_em >= ${janela} AND ($1::date IS NULL OR f.criado_em >= (($1::date)::timestamp AT TIME ZONE '${TZ}'))`, [desde, dias]), []),
    // Desde quando cada medida existe (antes disso, o relatório fica vazio por falta de dado, não por zero).
    seguro(q(`
      SELECT (SELECT MIN(criado_em) FROM csu_eventos WHERE nome = 'saida_externa') AS saidas,
             (SELECT MIN(criado_em) FROM csu_entradas) AS entradas,
             (SELECT MIN(criado_em) FROM csu_login_falhas) AS falhas,
             (SELECT MIN(inicio) FROM csu_acessos) AS acessos`), [{}]),
  ]);

  const ret = retencao(contas, hoje);
  return {
    gerado_em: new Date().toISOString(),
    hoje,
    dias,
    contar_desde: desde,
    min_amostra: MIN_AMOSTRA,
    desde: { ...(inicios[0] || {}), pratica: inicioPratica },
    retencao: ret,
    resultado: resultadoPratico([...basesMod, ...basesCentral], votos, { titulo: tituloDe, modulos: NIVEIS.map((_, i) => i + 1) }),
    saidas: { ...saidas(saidasEv, titulosModulo), destinos: DESTINOS, fazer_agora: fazerAgora(escolhas, saidasEv) },
    ajuda: ajuda(ajudaEv, pedidos),
    entrada: { ...origens(contas), entradas, falhas: falhasPorDia(falhas) },
  };
}

module.exports = {
  JANELAS, DESTINOS, MIN_AMOSTRA,
  diaSP, addDias, difDias, inicioSemana, mediana,
  retencao, resultadoPratico, saidas, fazerAgora, ajuda, origens, falhasPorDia,
  relatorio,
};
