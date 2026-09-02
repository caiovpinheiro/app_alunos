'use strict';

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
    if (!item || !item.tutorial_categoria) return;
    const key = `${item.tutorial_categoria}|${item.tutorial_hint || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({
      categoria: item.tutorial_categoria,
      hint: item.tutorial_hint || 'Ver tutoriais',
      titulo: item.titulo,
    });
  }
  atividades.forEach(add);
  add(avaliacao);
  disciplinas.forEach(add);
  return list;
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

async function getMeuSemestre(pool, alunoId) {
  const today = todayIsoSaoPaulo();
  const avisoPagamento = 'O pagamento pode levar até 1 dia útil para ser atualizado';
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

  const planos = await pool.query(
    `SELECT id, curso, periodo, titulo, ativo
     FROM csu_semestre_planos
     WHERE ativo = TRUE
     ORDER BY id DESC`,
  );
  const plano = pickPlano(planos.rows, aluno.curso, today);
  if (!plano) return empty;

  const [itensRes, eventosRes, mensalidadesRes] = await Promise.all([
    pool.query(
      `SELECT id, tipo, titulo, descricao, mes, data_inicio, data_fim,
              prova_inicio, prova_fim, prazo, prazo_preferencial,
              tutorial_categoria, tutorial_hint, destaque, ordem
       FROM csu_semestre_itens
       WHERE plano_id = $1
       ORDER BY ordem ASC, id ASC`,
      [plano.id],
    ),
    pool.query(
      `SELECT id, titulo, subtitulo, data_inicio, data_fim, tipo, ordem
       FROM csu_semestre_eventos
       WHERE plano_id = $1
       ORDER BY data_inicio ASC, ordem ASC, id ASC`,
      [plano.id],
    ),
    pool.query(
      `SELECT id, referencia, status, vencimento
       FROM csu_semestre_mensalidades
       WHERE aluno_id = $1
       ORDER BY vencimento ASC, id ASC`,
      [alunoId],
    ),
  ]);

  const itens = itensRes.rows.map(mapItem);
  const disciplinas = itens
    .filter((item) => item.tipo === 'disciplina')
    .map((item) => Object.assign({}, item, { status: disciplinaStatus(item, today) }));
  const atividades = itens.filter((item) => item.tipo === 'atividade');
  const avaliacao = itens.find((item) => item.tipo === 'avaliacao_integrada') || null;
  const eventos = eventosRes.rows.map(mapEvento);
  const mensalidades = mensalidadesRes.rows.map((row) => mapMensalidade(row, today));
  const disciplinaAtual = pickDisciplinaAtual(disciplinas, today);
  const proximaProva = pickProximaProva(disciplinas, today);
  const proximoPrazo = pickProximoPrazo(disciplinas, atividades, avaliacao, eventos, today);
  const mensalidade = pickMensalidade(mensalidades);

  return {
    plano: {
      id: plano.id,
      curso: plano.curso,
      periodo: plano.periodo,
      titulo: plano.titulo,
    },
    curso: aluno.curso || plano.curso,
    aluno: { nome: aluno.nome, curso: aluno.curso || plano.curso },
    resumo: {
      disciplina_atual: disciplinaAtual,
      proxima_prova: proximaProva,
      proximo_prazo: proximoPrazo,
      mensalidade,
    },
    disciplinas,
    atividades,
    avaliacao_integrada: avaliacao,
    calendario: mergeCalendario(eventos, mensalidades),
    mensalidades,
    tutoriais: collectTutoriais(disciplinas, atividades, avaliacao),
    aviso_pagamento: avisoPagamento,
    hoje: today,
  };
}

module.exports = {
  ITEM_TIPOS,
  EVENTO_TIPOS,
  getMeuSemestre,
  todayIsoSaoPaulo,
  toIsoDate,
  cursosMatch,
};
