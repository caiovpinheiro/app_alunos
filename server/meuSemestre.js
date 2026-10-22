'use strict';

const { guiaTrilha } = require('./trilha');

const ITEM_TIPOS = ['disciplina', 'atividade', 'avaliacao_integrada'];
const EVENTO_TIPOS = ['prova', 'prazo', 'financeiro', 'encerramento', 'recuperacao', 'divulgacao', 'disciplina'];
const MENSALIDADE_STATUS = ['aberto', 'pago', 'atrasado'];
const MONTHS_SHORT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

function todayIsoSaoPaulo(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function toIsoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function parseIso(iso) {
  const raw = toIsoDate(iso);
  if (!raw) return null;
  const [year, month, day] = raw.split('-').map(Number);
  if (!year || !month || !day) return null;
  return { iso: raw, year, month, day };
}

function monthLabel(iso) {
  const parsed = parseIso(iso);
  if (!parsed) return '';
  return MONTHS_SHORT[parsed.month - 1] || '';
}

function normalizeCurso(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cursosMatch(alunoCurso, planoCurso) {
  const aluno = normalizeCurso(alunoCurso);
  const plano = normalizeCurso(planoCurso);
  if (!aluno || !plano) return false;
  if (aluno === plano) return true;
  const re = new RegExp(`(^|\\s)${escapeRegex(plano)}(\\s|$)`);
  return re.test(aluno);
}

function periodoContem(periodo, isoDate) {
  const match = String(periodo || '').match(/^(\d{4})\/([12])$/);
  if (!match || !isoDate) return false;
  const year = match[1];
  const sem = match[2];
  if (sem === '1') return isoDate >= `${year}-01-01` && isoDate <= `${year}-07-31`;
  return isoDate >= `${year}-08-01` && isoDate <= `${year}-12-31`;
}

function comparePeriodo(a, b) {
  const ma = String(a || '').match(/^(\d{4})\/([12])$/);
  const mb = String(b || '').match(/^(\d{4})\/([12])$/);
  const va = ma ? Number(ma[1]) * 10 + Number(ma[2]) : 0;
  const vb = mb ? Number(mb[1]) * 10 + Number(mb[2]) : 0;
  return vb - va;
}

function disciplinaStatus(item, today) {
  if (!item.data_inicio && !item.data_fim) return null;
  if (item.data_inicio && today < item.data_inicio) return 'proxima';
  if (item.data_fim && today > item.data_fim) return 'encerrada';
  return 'atual';
}

function mapItem(row) {
  return {
    id: row.id,
    tipo: row.tipo,
    titulo: row.titulo,
    descricao: row.descricao || '',
    mes: row.mes || monthLabel(row.data_inicio),
    data_inicio: toIsoDate(row.data_inicio),
    data_fim: toIsoDate(row.data_fim),
    prova_inicio: toIsoDate(row.prova_inicio),
    prova_fim: toIsoDate(row.prova_fim),
    prazo: toIsoDate(row.prazo),
    prazo_preferencial: toIsoDate(row.prazo_preferencial),
    tutorial_categoria: row.tutorial_categoria || null,
    tutorial_hint: row.tutorial_hint || null,
    trilha: guiaTrilha(row.tutorial_categoria, row.tipo),
    destaque: Boolean(row.destaque),
    ordem: Number(row.ordem) || 0,
  };
}

function mapEvento(row) {
  return {
    id: row.id,
    titulo: row.titulo,
    subtitulo: row.subtitulo || '',
    data_inicio: toIsoDate(row.data_inicio),
    data_fim: toIsoDate(row.data_fim),
    tipo: row.tipo,
    ordem: Number(row.ordem) || 0,
  };
}

function situacaoMensalidade(status, vencimento, today) {
  if (status === 'pago') {
    return { situacao: 'pago', situacao_label: 'Pago' };
  }
  if (status === 'atrasado') {
    return { situacao: 'atrasado', situacao_label: 'Em atraso' };
  }
  if (status === 'aberto' && vencimento && vencimento >= today) {
    return { situacao: 'aberto_no_prazo', situacao_label: 'Em aberto — pagamento dentro do prazo' };
  }
  if (status === 'aberto') {
    return { situacao: 'aberto_vencido', situacao_label: 'Em aberto — vencido' };
  }
  return { situacao: status || 'aberto', situacao_label: 'Em aberto' };
}

function mapMensalidade(row, today) {
  const vencimento = toIsoDate(row.vencimento);
  const status = MENSALIDADE_STATUS.includes(row.status) ? row.status : 'aberto';
  const situacao = situacaoMensalidade(status, vencimento, today);
  return {
    id: row.id,
    referencia: row.referencia,
    status,
    vencimento,
    ...situacao,
  };
}

function pickPlano(planos, alunoCurso, today) {
  const matches = planos.filter((plano) => cursosMatch(alunoCurso, plano.curso));
  if (!matches.length) return null;
  const vigentes = matches.filter((plano) => periodoContem(plano.periodo, today));
  const pool = vigentes.length ? vigentes : matches;
  pool.sort((a, b) => comparePeriodo(a.periodo, b.periodo) || b.id - a.id);
  return pool[0];
}

function pickDisciplinaAtual(disciplinas, today) {
  const atuais = disciplinas.filter((item) => disciplinaStatus(item, today) === 'atual');
  if (atuais.length) return atuais[0];
  const proximas = disciplinas.filter((item) => disciplinaStatus(item, today) === 'proxima');
  if (proximas.length) return proximas[0];
  return disciplinas[disciplinas.length - 1] || null;
}

function pickProximaProva(disciplinas, today) {
  const upcoming = disciplinas
    .filter((item) => item.prova_inicio && item.prova_fim && item.prova_fim >= today)
    .sort((a, b) => a.prova_inicio.localeCompare(b.prova_inicio));
  return upcoming[0] || null;
}

function prazoDate(item) {
  return item.prazo_preferencial || item.prazo || null;
}

function pickProximoPrazo(disciplinas, atividades, avaliacao, eventos, today) {
  const candidates = [];

  disciplinas.forEach((item) => {
    if (item.data_fim && item.data_fim >= today) {
      candidates.push({
        titulo: item.titulo,
        label: 'Fim do período de estudo',
        data: item.data_fim,
        tipo: 'disciplina',
      });
    }
  });

  atividades.forEach((item) => {
    const data = prazoDate(item);
    if (data && data >= today) {
      candidates.push({
        titulo: item.titulo,
        label: item.prazo_preferencial ? 'Finalizar preferencialmente' : 'Prazo final',
        data,
        tipo: 'atividade',
      });
    }
  });

  if (avaliacao) {
    const data = prazoDate(avaliacao);
    if (data && data >= today) {
      candidates.push({
        titulo: avaliacao.titulo,
        label: 'Prazo final',
        data,
        tipo: 'avaliacao_integrada',
      });
    }
  }

  eventos.forEach((evento) => {
    if (!evento.data_inicio || evento.data_inicio < today) return;
    if (evento.tipo === 'prova' || evento.tipo === 'financeiro') return;
    candidates.push({
      titulo: evento.titulo,
      label: evento.subtitulo || evento.titulo,
      data: evento.data_inicio,
      tipo: evento.tipo,
    });
  });

  candidates.sort((a, b) => a.data.localeCompare(b.data) || a.titulo.localeCompare(b.titulo));
  return candidates[0] || null;
}

function pickMensalidade(rows) {
  const abertas = rows
    .filter((row) => row.status === 'aberto' || row.status === 'atrasado')
    .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  if (abertas.length) return abertas[0];
  return null;
}

function mergeCalendario(eventos, mensalidades) {
  const extra = mensalidades.map((item) => ({
    id: `mensalidade-${item.id}`,
    titulo: `Mensalidade ${item.referencia}`,
    subtitulo: item.situacao_label,
    data_inicio: item.vencimento,
    data_fim: item.vencimento,
    tipo: 'financeiro',
    ordem: 0,
  }));
  return eventos.concat(extra).sort((a, b) => {
    const da = a.data_inicio || '';
    const db = b.data_inicio || '';
    if (da !== db) return da.localeCompare(db);
    return (a.ordem || 0) - (b.ordem || 0);
  });
}

function collectTutoriais(disciplinas, atividades, avaliacao) {
  const seen = new Set();
  const list = [];
  function add(item) {
    if (!item || (!item.tutorial_categoria && !item.trilha)) return;
    const key = item.trilha ? `n${item.trilha.nivel}` : `${item.tutorial_categoria}|${item.tutorial_hint || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({
      categoria: item.tutorial_categoria,
      hint: item.tutorial_hint || 'Ver tutoriais',
      titulo: item.titulo,
      trilha: item.trilha || null,
    });
  }
  atividades.forEach(add);
  add(avaliacao);
  disciplinas.forEach(add);
  return list;
}

function parseBrRangeToIso(raw) {
  const match = String(raw || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s*a\s*(\d{2})\/(\d{2})\/(\d{4}))?/);
  if (!match) return { inicio: null, fim: null };
  const inicio = `${match[3]}-${match[2]}-${match[1]}`;
  const fim = match[4] ? `${match[6]}-${match[5]}-${match[4]}` : inicio;
  return { inicio, fim };
}

function materiaTitle(item) {
  if (item == null) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'object') {
    return String(item.disciplina || item.nome || item.titulo || item.materia || '').trim();
  }
  return String(item).trim();
}

function materiaPeriodo(item) {
  if (item && typeof item === 'object') return String(item.data || item.periodo || '').trim();
  return '';
}

function isMandatoryActivity(title) {
  const t = String(title || '').toLowerCase();
  return t.includes('ambienta')
    || t.includes('carreira')
    || t.includes('extens')
    || t.includes('projeto')
    || t.includes('avalia')
    || t.includes('multidisciplinar');
}

function mapMateriasToItens(materias) {
  const list = Array.isArray(materias) ? materias : [];
  const itens = [];
  list.forEach((item, index) => {
    const titulo = materiaTitle(item);
    if (!titulo) return;
    const range = parseBrRangeToIso(materiaPeriodo(item));
    const tipo = isMandatoryActivity(titulo)
      ? (titulo.toLowerCase().includes('avalia') ? 'avaliacao_integrada' : 'atividade')
      : 'disciplina';
    itens.push({
      id: index + 1,
      tipo,
      titulo,
      descricao: '',
      mes: monthLabel(range.inicio),
      data_inicio: tipo === 'disciplina' ? range.inicio : null,
      data_fim: tipo === 'disciplina' ? range.fim : null,
      prova_inicio: null,
      prova_fim: null,
      prazo: tipo === 'disciplina' ? null : range.fim,
      prazo_preferencial: null,
      tutorial_categoria: null,
      tutorial_hint: null,
      destaque: tipo !== 'disciplina',
      ordem: index + 1,
    });
  });
  return itens;
}

async function getMateriasByRgm(pool, rgm) {
  if (!rgm) return null;
  const raw = String(rgm).trim();
  const digits = raw.replace(/\D/g, '');
  let fonte = { rows: [] };
  try {
    fonte = await pool.query(
      `SELECT materias
       FROM materias_alunos
       WHERE rgm = $1
          OR regexp_replace(rgm, '\\D', '', 'g') = $2
       ORDER BY consultado_em DESC NULLS LAST
       LIMIT 1`,
      [raw, digits],
    );
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }
  const row = fonte.rows[0];
  if (row && Array.isArray(row.materias) && row.materias.length) return row;

  const copia = await pool.query(
    `SELECT materias
     FROM csu_materias_alunos
     WHERE rgm = $1
        OR regexp_replace(rgm, '\\D', '', 'g') = $2
     LIMIT 1`,
    [raw, digits],
  );
  return copia.rows[0] || null;
}

function formatBrCurto(iso) {
  const parsed = parseIso(iso);
  if (!parsed) return '';
  return `${String(parsed.day).padStart(2, '0')}/${String(parsed.month).padStart(2, '0')}`;
}

// Calendário Acadêmico Graduação EaD 2026. A prova de maio e junho é a mesma,
// e a de novembro e dezembro também. O nome em cada linha é a matéria do aluno.
const CALENDARIO_2026 = {
  '2026-02': { inicio: '2026-02-02', provaInicio: '2026-03-13', provaFim: '2026-03-16', recurso: '2026-03-17', notas: '2026-03-30', semestre: '2026-1' },
  '2026-03': { inicio: '2026-03-02', provaInicio: '2026-04-10', provaFim: '2026-04-13', recurso: '2026-04-14', notas: '2026-04-27', semestre: '2026-1' },
  '2026-04': { inicio: '2026-04-01', provaInicio: '2026-05-08', provaFim: '2026-05-11', recurso: '2026-05-12', notas: '2026-05-25', semestre: '2026-1' },
  '2026-05': { inicio: '2026-05-04', provaInicio: '2026-05-29', provaFim: '2026-06-01', recurso: '2026-06-02', notas: '2026-06-11', semestre: '2026-1' },
  '2026-06': { inicio: null, provaInicio: '2026-05-29', provaFim: '2026-06-01', recurso: '2026-06-02', notas: '2026-06-11', semestre: '2026-1' },
  '2026-08': { inicio: '2026-08-03', provaInicio: '2026-09-11', provaFim: '2026-09-14', recurso: '2026-09-15', notas: '2026-09-29', semestre: '2026-2' },
  '2026-09': { inicio: '2026-09-01', provaInicio: '2026-10-02', provaFim: '2026-10-05', recurso: '2026-10-06', notas: '2026-10-19', semestre: '2026-2' },
  '2026-10': { inicio: '2026-10-01', provaInicio: '2026-11-06', provaFim: '2026-11-09', recurso: '2026-11-10', notas: '2026-11-23', semestre: '2026-2' },
  '2026-11': { inicio: '2026-11-03', provaInicio: '2026-11-27', provaFim: '2026-11-30', recurso: '2026-12-01', notas: '2026-12-07', semestre: '2026-2' },
  '2026-12': { inicio: null, provaInicio: '2026-11-27', provaFim: '2026-11-30', recurso: '2026-12-01', notas: '2026-12-07', semestre: '2026-2' },
};

const CALENDARIO_FIXO = {
  '2026-1': [
    { titulo: 'Prova AF', subtitulo: 'Disciplinas mensais reprovadas', data_inicio: '2026-06-26', data_fim: '2026-06-27', tipo: 'recuperacao' },
    { titulo: 'Solicitação de recurso da Prova AF', subtitulo: '', data_inicio: '2026-06-28', data_fim: '2026-06-28', tipo: 'prazo' },
    { titulo: 'Término do semestre letivo', subtitulo: '', data_inicio: '2026-06-30', data_fim: '2026-06-30', tipo: 'encerramento' },
    { titulo: 'Liberação de notas da Prova AF', subtitulo: '', data_inicio: '2026-07-06', data_fim: '2026-07-06', tipo: 'divulgacao' },
  ],
  '2026-2': [
    { titulo: 'Prova AF', subtitulo: 'Disciplinas mensais reprovadas', data_inicio: '2026-12-11', data_fim: '2026-12-12', tipo: 'recuperacao' },
    { titulo: 'Solicitação de recurso da Prova AF', subtitulo: '', data_inicio: '2026-12-13', data_fim: '2026-12-13', tipo: 'prazo' },
    { titulo: 'Término do envio de atividades complementares', subtitulo: '', data_inicio: '2026-12-14', data_fim: '2026-12-14', tipo: 'prazo' },
    { titulo: 'Término do semestre letivo', subtitulo: '', data_inicio: '2026-12-19', data_fim: '2026-12-19', tipo: 'encerramento' },
    { titulo: 'Liberação de notas da Prova AF', subtitulo: '', data_inicio: '2026-12-21', data_fim: '2026-12-21', tipo: 'divulgacao' },
  ],
};

function calendarioDoAluno(itens) {
  const eventos = [];
  const semestres = new Set();
  let ordem = 1;
  const push = (evento) => {
    eventos.push(Object.assign({ id: ordem, ordem }, evento));
    ordem += 1;
  };
  itens.filter((item) => item.tipo === 'disciplina').forEach((item) => {
    const month = String(item.data_inicio || item.data_fim || '').slice(0, 7);
    const slot = CALENDARIO_2026[month];
    if (!slot) return;
    semestres.add(slot.semestre);
    if (slot.inicio) {
      push({
        titulo: 'Início das aulas',
        subtitulo: item.titulo,
        data_inicio: slot.inicio,
        data_fim: slot.inicio,
        tipo: 'disciplina',
      });
    }
    item.prova_inicio = slot.provaInicio;
    item.prova_fim = slot.provaFim;
    push({
      titulo: 'Prova A1',
      subtitulo: `${item.titulo} · até ${formatBrCurto(slot.provaFim)}`,
      data_inicio: slot.provaInicio,
      data_fim: slot.provaFim,
      tipo: 'prova',
    });
    push({
      titulo: 'Solicitação de recurso da Prova A1',
      subtitulo: item.titulo,
      data_inicio: slot.recurso,
      data_fim: slot.recurso,
      tipo: 'prazo',
    });
    push({
      titulo: 'Liberação de notas',
      subtitulo: item.titulo,
      data_inicio: slot.notas,
      data_fim: slot.notas,
      tipo: 'divulgacao',
    });
  });
  semestres.forEach((semestre) => {
    (CALENDARIO_FIXO[semestre] || []).forEach((evento) => push(evento));
  });
  return eventos;
}

async function getAlunoCurso(pool, alunoId) {
  const result = await pool.query(
    `SELECT id, nome, email, rgm, curso
     FROM csu_alunos
     WHERE id = $1
     LIMIT 1`,
    [alunoId],
  );
  return result.rows[0] || null;
}

function assembleSemestre({ aluno, plano, itens, eventos, mensalidadesRows, today, avisoPagamento }) {
  const disciplinas = itens
    .filter((item) => item.tipo === 'disciplina')
    .map((item) => Object.assign({}, item, { status: disciplinaStatus(item, today) }));
  const atividades = itens.filter((item) => item.tipo === 'atividade');
  const avaliacao = itens.find((item) => item.tipo === 'avaliacao_integrada') || null;
  const eventosMapped = (eventos || []).map(mapEvento);
  const disciplinaAtual = pickDisciplinaAtual(disciplinas, today);
  const proximaProva = pickProximaProva(disciplinas, today);
  const proximoPrazo = pickProximoPrazo(disciplinas, atividades, avaliacao, eventosMapped, today);

  return {
    plano,
    curso: aluno.curso || (plano && plano.curso) || null,
    aluno: { nome: aluno.nome, curso: aluno.curso || (plano && plano.curso) || null },
    resumo: {
      disciplina_atual: disciplinaAtual,
      proxima_prova: proximaProva,
      proximo_prazo: proximoPrazo,
      mensalidade: null,
    },
    disciplinas,
    atividades,
    avaliacao_integrada: avaliacao,
    calendario: mergeCalendario(eventosMapped, []),
    mensalidades: [],
    tutoriais: collectTutoriais(disciplinas, atividades, avaliacao),
    aviso_pagamento: avisoPagamento,
    hoje: today,
  };
}

async function getMeuSemestre(pool, alunoId) {
  const today = todayIsoSaoPaulo();
  // Frase-padrão da mensalidade: é a mesma do painel, do FAQ, da Trilha e do vídeo "Quanto eu pago?".
  const avisoPagamento = 'A mensalidade vence todo dia 25. Na 1ª mensalidade (a do mês da sua turma), todos os descontos valem até o dia 25. Da 2ª em diante: até o dia 10, 25% de desconto de pontualidade; do dia 11 ao 25, 15%; depois do dia 25, sem esse desconto (a bolsa continua). Se o dia 10 ou o 25 cair em fim de semana ou feriado, vale o próximo dia útil.';
  const empty = {
    plano: null,
    curso: null,
    aluno: null,
    resumo: {
      disciplina_atual: null,
      proxima_prova: null,
      proximo_prazo: null,
      mensalidade: null,
    },
    disciplinas: [],
    atividades: [],
    avaliacao_integrada: null,
    calendario: [],
    mensalidades: [],
    tutoriais: [],
    aviso_pagamento: avisoPagamento,
    hoje: today,
  };

  const aluno = await getAlunoCurso(pool, alunoId);
  if (!aluno) return empty;

  empty.curso = aluno.curso || null;
  empty.aluno = { nome: aluno.nome, curso: aluno.curso || null };

  const mensalidadesRes = await pool.query(
    `SELECT id, referencia, status, vencimento
     FROM csu_semestre_mensalidades
     WHERE aluno_id = $1
     ORDER BY vencimento ASC, id ASC`,
    [alunoId],
  );

  const materiasRow = await getMateriasByRgm(pool, aluno.rgm);
  if (materiasRow) {
    const itens = mapMateriasToItens(materiasRow.materias).map(mapItem);
    if (itens.length) {
      return assembleSemestre({
        aluno,
        plano: {
          id: 0,
          curso: aluno.curso || 'Curso',
          periodo: process.env.MATERIAS_PERIODO || '2026/2',
          titulo: 'Meu Semestre',
        },
        itens,
        eventos: calendarioDoAluno(itens),
        mensalidadesRows: mensalidadesRes.rows,
        today,
        avisoPagamento,
      });
    }
  }

  const planos = await pool.query(
    `SELECT id, curso, periodo, titulo, ativo
     FROM csu_semestre_planos
     WHERE ativo = TRUE
     ORDER BY id DESC`,
  );
  const plano = pickPlano(planos.rows, aluno.curso, today);
  if (!plano) return empty;

  const itensRes = await pool.query(
    `SELECT id, tipo, titulo, descricao, mes, data_inicio, data_fim,
            prova_inicio, prova_fim, prazo, prazo_preferencial,
            tutorial_categoria, tutorial_hint, destaque, ordem
     FROM csu_semestre_itens
     WHERE plano_id = $1
     ORDER BY ordem ASC, id ASC`,
    [plano.id],
  );
  const itens = itensRes.rows.map(mapItem);

  return assembleSemestre({
    aluno,
    plano: {
      id: plano.id,
      curso: plano.curso,
      periodo: plano.periodo,
      titulo: plano.titulo,
    },
    itens,
    eventos: calendarioDoAluno(itens),
    mensalidadesRows: mensalidadesRes.rows,
    today,
    avisoPagamento,
  });
}

module.exports = {
  ITEM_TIPOS,
  EVENTO_TIPOS,
  getMeuSemestre,
  todayIsoSaoPaulo,
  toIsoDate,
  cursosMatch,
};
