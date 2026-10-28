'use strict';

// Visão geral do admin: como está a turma (Bom / Regular / Ruim), o que fazer agora e em que
// situação está cada aluno. Não grava nada: junta o que o acompanhamento, a Aula Inaugural, o funil
// e as avaliações já calculam, e dá a cada número uma faixa e uma ação.
//
// Faixas: cada indicador tem "bom" e "regular" (limites em %). Abaixo de "regular" é ruim.
// Nos indicadores em que menos é melhor (menor: true), a comparação inverte.

// Padrões das faixas. A equipe pode mudar em Admin › Configurações (salvo em csu_acomp_config.config.faixas).
const INDICADORES = [
  { id: 'entraram', rotulo: 'Entraram no portal', bom: 80, regular: 60 },
  { id: 'entraram_24h', rotulo: 'Primeiro acesso em até 24 h', bom: 60, regular: 40 },
  { id: 'comecaram_aula', rotulo: 'Começaram a Aula Inaugural', bom: 70, regular: 50 },
  { id: 'concluiram_aula', rotulo: 'Concluíram a Aula Inaugural', bom: 50, regular: 30 },
  { id: 'certificado', rotulo: 'Emitiram o certificado', bom: 90, regular: 70 },
  { id: 'ativos', rotulo: 'Acessaram nos últimos dias', bom: 60, regular: 40 },
  { id: 'travados', rotulo: 'Travados na Aula', bom: 5, regular: 15, menor: true },
  { id: 'avaliacao', rotulo: 'Avaliação dos conteúdos (joinha positivo)', bom: 85, regular: 70 },
  { id: 'videos', rotulo: 'Vídeos assistidos até o fim', bom: 70, regular: 50 },
  { id: 'fila', rotulo: 'Precisam de contato', bom: 10, regular: 25, menor: true },
];
const MENOR = INDICADORES.reduce((m, x) => { m[x.id] = Boolean(x.menor); return m; }, {});
const MIN_AMOSTRA = 5; // abaixo disso a faixa fica "poucos dados"
const DIAS_SUMIU = 7;

function faixasPadrao() {
  const ind = {};
  INDICADORES.forEach((x) => { ind[x.id] = { bom: x.bom, regular: x.regular }; });
  return { dias_sumiu: DIAS_SUMIU, ind };
}

function pctInteiro(v, padrao) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : padrao;
}

// Valida o que veio do banco ou do formulário. Limites fora de ordem (ex.: "bom" abaixo de "regular"
// num indicador em que mais é melhor) são trocados de lugar; iguais voltam ao padrão.
function normalizaFaixas(raw) {
  const base = faixasPadrao();
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = Math.round(Number(r.dias_sumiu));
  const out = { dias_sumiu: Number.isFinite(d) && d >= 1 && d <= 90 ? d : base.dias_sumiu, ind: {} };
  INDICADORES.forEach((x) => {
    const v = (r.ind && r.ind[x.id]) || {};
    let bom = pctInteiro(v.bom, base.ind[x.id].bom);
    let regular = pctInteiro(v.regular, base.ind[x.id].regular);
    if (bom === regular) { bom = base.ind[x.id].bom; regular = base.ind[x.id].regular; }
    if (x.menor ? bom > regular : bom < regular) { const t = bom; bom = regular; regular = t; }
    out.ind[x.id] = { bom, regular };
  });
  return out;
}

// Para a tela de Configurações: rótulo, se "menos é melhor" e o padrão de cada indicador.
function catalogoFaixas() {
  return INDICADORES.map((x) => ({ id: x.id, rotulo: x.rotulo, menor: Boolean(x.menor), padrao: { bom: x.bom, regular: x.regular } }));
}

// Situação de cada aluno (uma só, na ordem de prioridade). faixa: bom | regular | ruim.
function situacoes(diasSumiu = DIAS_SUMIU) {
  return [
    { id: 'certificado', rotulo: 'Certificado emitido', faixa: 'bom', descricao: 'Concluiu a Aula Inaugural e emitiu o certificado.', acao: 'Nada a fazer. Bom aluno para pedir indicação.' },
    { id: 'nunca_entrou', rotulo: 'Nunca entrou', faixa: 'ruim', descricao: 'A conta existe, mas o aluno nunca fez login no portal.', acao: 'Mande o link, o e-mail e a senha inicial pelo WhatsApp.' },
    { id: 'travado', rotulo: 'Travou na Aula', faixa: 'ruim', descricao: 'Tocou em "Travei" na Aula Inaugural e não concluiu.', acao: 'Chame e resolva a dúvida do módulo em que travou.' },
    { id: 'sumiu', rotulo: 'Sumiu (' + diasSumiu + '+ dias)', faixa: 'ruim', descricao: 'Entrou antes, mas está há ' + diasSumiu + ' dias ou mais sem acessar.', acao: 'Pergunte se está tudo certo com os estudos.' },
    { id: 'parou', rotulo: 'Parou a Aula', faixa: 'regular', descricao: 'Começou a Aula Inaugural e está há alguns dias sem avançar.', acao: 'Lembre que falta pouco para o certificado de 4 horas.' },
    { id: 'sem_certificado', rotulo: 'Concluiu, falta o certificado', faixa: 'regular', descricao: 'Fez os módulos, mas não emitiu o certificado.', acao: 'Avise que o certificado de 4 horas já está liberado.' },
    { id: 'sem_aula', rotulo: 'Entrou, não começou a Aula', faixa: 'regular', descricao: 'Fez login, mas não abriu a Aula Inaugural.', acao: 'Convide para começar a Aula Inaugural (certificado de 4 horas).' },
    { id: 'em_andamento', rotulo: 'Fazendo a Aula', faixa: 'bom', descricao: 'Está avançando na Aula Inaugural e acessou nos últimos dias.', acao: 'Acompanhe; não precisa chamar.' },
  ];
}
const SITUACOES = situacoes();
const SITUACAO = SITUACOES.reduce((m, s) => { m[s.id] = s; return m; }, {});

function situacaoDe(a, certificados, diasSumiu = DIAS_SUMIU) {
  const total = a.total_niveis || 7;
  const concluiu = a.niveis_concluidos >= total;
  const comecou = Boolean(a.trilha_ultima);
  if (certificados[a.id]) return 'certificado';
  if (!a.primeiro_acesso && !comecou) return 'nunca_entrou';
  const sinais = (a.sinais || []).concat(a.sinais_em_espera || []).map((s) => s.id);
  if (!concluiu && (a.travei_total > 0 || sinais.includes('travou_trilha'))) return 'travado';
  if (!concluiu && a.dias_sem_acesso != null && a.dias_sem_acesso >= diasSumiu) return 'sumiu';
  if (!concluiu && sinais.includes('parou_trilha')) return 'parou';
  if (concluiu) return 'sem_certificado';
  if (!comecou) return 'sem_aula';
  return 'em_andamento';
}

function pct(n, de) { return de ? Math.round((100 * n) / de) : null; }

function faixaDe(id, valor, amostra, F) {
  if (valor == null || amostra < MIN_AMOSTRA) return 'sem_dados';
  const f = F.ind[id];
  if (MENOR[id]) return valor <= f.bom ? 'bom' : valor <= f.regular ? 'regular' : 'ruim';
  return valor >= f.bom ? 'bom' : valor >= f.regular ? 'regular' : 'ruim';
}

function metaTexto(id, F) {
  const f = F.ind[id];
  return MENOR[id] ? 'Bom: até ' + f.bom + '% · Regular: até ' + f.regular + '%' : 'Bom: ' + f.bom + '% ou mais · Regular: ' + f.regular + '% a ' + (f.bom - 1) + '%';
}

function indicador(F, id, rotulo, n, de, explica, acao) {
  const valor = pct(n, de);
  return { id, rotulo, valor, n, de, faixa: faixaDe(id, valor, de, F), meta: metaTexto(id, F), explica, acao: acao || null };
}

async function votosPorRgm(pool) {
  try {
    const r = await pool.query(`SELECT rgm, COUNT(*) FILTER (WHERE voto > 0)::int AS positivos, COUNT(*) FILTER (WHERE voto < 0)::int AS negativos
                                FROM csu_avaliacoes GROUP BY rgm`);
    return r.rows.reduce((m, x) => { m[x.rgm] = { positivos: x.positivos, negativos: x.negativos }; return m; }, {});
  } catch (err) {
    if (err.code === '42P01') return {};
    throw err;
  }
}

async function buscasSemResultado(pool, dias) {
  try {
    const r = await pool.query(
      `SELECT lower(trim(dados->>'termo')) AS termo, COUNT(*)::int AS vezes, COUNT(DISTINCT aluno_id)::int AS alunos
       FROM csu_eventos
       WHERE nome = 'central_busca_sem_resultado' AND criado_em >= now() - ($1::int * interval '1 day') AND COALESCE(trim(dados->>'termo'), '') <> ''
       GROUP BY 1 ORDER BY vezes DESC LIMIT 5`, [dias]);
    return r.rows;
  } catch (err) {
    if (err.code === '42P01') return [];
    throw err;
  }
}

// Junta tudo. `lista` = acompanhamento.montar(...) de todos os alunos ativos (com sinais).
async function visaoGeral(pool, { dias, lista, certificados, funil, uso, ondeTrava, resumoAula, cfg }) {
  const F = normalizaFaixas(cfg && cfg.faixas);
  const dSumiu = F.dias_sumiu;
  const sits = situacoes(dSumiu);
  const contagem = {};
  sits.forEach((s) => { contagem[s.id] = 0; });
  lista.forEach((a) => { contagem[situacaoDe(a, certificados, dSumiu)] += 1; });

  const total = lista.length;
  const entraram = lista.filter((a) => a.primeiro_acesso || a.trilha_ultima).length;
  const comecaram = lista.filter((a) => a.trilha_ultima).length;
  const concluiram = lista.filter((a) => a.niveis_concluidos >= a.total_niveis).length;
  const comCertificado = lista.filter((a) => certificados[a.id]).length;
  const ativos = lista.filter((a) => a.dias_sem_acesso != null && a.dias_sem_acesso < dSumiu).length;
  const travados = lista.filter((a) => a.trilha_ultima && a.niveis_concluidos < a.total_niveis && a.travei_total > 0).length;
  const videosIni = lista.reduce((n, a) => n + a.videos_inicio, 0);
  const videosFim = lista.reduce((n, a) => n + a.videos_fim, 0);
  const comSinal = lista.filter((a) => a.sinais.length).length;
  const av = (uso && uso.avaliacoes) || { positivos: 0, total: 0, piores: [] };
  const ft = (funil && funil.total) || { contas: 0, entraram_24h: 0 };

  const link = (situacao) => ({ aba: 'acompanhamento', situacao });
  const indicadores = [
    indicador(F, 'entraram', 'Entraram no portal', entraram, total, 'Alunos ativos que já fizeram login pelo menos uma vez.',
      contagem.nunca_entrou ? { texto: `${contagem.nunca_entrou} nunca entraram`, ...link('nunca_entrou') } : null),
    indicador(F, 'entraram_24h', 'Primeiro acesso em até 24 h', ft.entraram_24h, ft.contas, `Contas criadas nos últimos ${funil ? funil.dias : dias} dias que entraram em até 24 h.`),
    indicador(F, 'comecaram_aula', 'Começaram a Aula Inaugural', comecaram, entraram, 'De quem já entrou, quantos abriram a Aula Inaugural.',
      contagem.sem_aula ? { texto: `${contagem.sem_aula} entraram e não começaram`, ...link('sem_aula') } : null),
    indicador(F, 'concluiram_aula', 'Concluíram a Aula Inaugural', concluiram, comecaram, 'De quem começou, quantos fizeram todos os módulos.',
      contagem.travado ? { texto: `${contagem.travado} travaram ou pararam`, ...link('travado') } : null),
    indicador(F, 'certificado', 'Emitiram o certificado', comCertificado, concluiram, 'De quem concluiu os módulos, quantos emitiram o certificado.',
      contagem.sem_certificado ? { texto: `${contagem.sem_certificado} sem certificado`, ...link('sem_certificado') } : null),
    indicador(F, 'ativos', `Acessaram nos últimos ${dSumiu} dias`, ativos, entraram, 'De quem já entrou, quantos estiveram no portal na última semana.',
      contagem.sumiu ? { texto: `${contagem.sumiu} sumiram`, ...link('sumiu') } : null),
    indicador(F, 'travados', 'Travados na Aula (menos é melhor)', travados, comecaram, 'De quem começou a Aula, quantos tocaram em "Travei" e não concluíram.',
      travados ? { texto: 'Ver onde travam', aba: 'trilha', sub: 'onde-trava' } : null),
    indicador(F, 'avaliacao', 'Avaliação dos conteúdos (👍)', av.positivos, av.total, 'Joinhas positivos sobre o total de avaliações de vídeos, perguntas e módulos.',
      av.negativos ? { texto: `${av.negativos} 👎 para revisar`, aba: 'avaliacoes' } : null),
    indicador(F, 'videos', 'Vídeos assistidos até o fim', videosFim, videosIni, `Vídeos terminados sobre os começados nos últimos ${dias} dias (só contas com rastreio).`),
    indicador(F, 'fila', 'Precisam de contato (menos é melhor)', comSinal, total, 'Alunos com algum sinal: travou, parou, sumiu, erro no certificado...',
      comSinal ? { texto: `Abrir a fila (${comSinal})`, ...link('com_sinal') } : null),
  ];

  // O que fazer agora: uma frase, o porquê e o botão. Ordem: o que trava a jornada primeiro.
  const acoes = [];
  const add = (gravidade, titulo, porque, botao) => acoes.push({ gravidade, titulo, porque, botao });
  if (contagem.nunca_entrou) add('ruim', `Mandar o acesso para ${contagem.nunca_entrou} aluno(s) que nunca entraram`,
    'Sem o primeiro login o aluno não vê a Aula, as datas nem o passo a passo do AVA. A mensagem já vai com e-mail e senha inicial.',
    { texto: 'Ver quem nunca entrou', ...link('nunca_entrou') });
  const modPior = ondeTrava && ondeTrava.modulos ? [...ondeTrava.modulos].sort((x, y) => y.atrito - x.atrito)[0] : null;
  if (contagem.travado) add('ruim', `Destravar ${contagem.travado} aluno(s) na Aula Inaugural`,
    modPior && modPior.travei ? `O módulo ${modPior.modulo} (${modPior.titulo}) é onde mais tocam em "Travei" (${modPior.travei}x).` : 'Tocaram em "Travei" e não concluíram.',
    { texto: 'Ver quem travou', ...link('travado') });
  const certErros = lista.filter((a) => a.sinais.some((s) => s.id === 'certificado_erro')).length;
  if (certErros) add('ruim', `Resolver o erro de certificado de ${certErros} aluno(s)`, 'Tentaram gerar o certificado e deu erro (curso ou polo faltando, na maioria das vezes).',
    { texto: 'Ver quem teve erro', aba: 'acompanhamento', sinal: 'certificado_erro' });
  if (contagem.sumiu) add('regular', `Chamar ${contagem.sumiu} aluno(s) que sumiram`, `Estão há ${dSumiu} dias ou mais sem entrar e ainda não concluíram a Aula.`,
    { texto: 'Ver quem sumiu', ...link('sumiu') });
  if (contagem.parou) add('regular', `Lembrar ${contagem.parou} aluno(s) que pararam a Aula Inaugural`, 'Começaram e estão há alguns dias sem avançar. Falta pouco para o certificado.',
    { texto: 'Ver quem parou', ...link('parou') });
  if (contagem.sem_certificado) add('regular', `Avisar ${contagem.sem_certificado} aluno(s) que o certificado já está liberado`, 'Concluíram os módulos e não emitiram. É só entrar e gerar.',
    { texto: 'Ver quem falta emitir', ...link('sem_certificado') });
  if (contagem.sem_aula) add('regular', `Convidar ${contagem.sem_aula} aluno(s) para começar a Aula Inaugural`, 'Entraram no portal, mas não abriram a Aula.',
    { texto: 'Ver quem não começou', ...link('sem_aula') });
  if (modPior && modPior.atrito >= 3) add('conteudo', `Revisar o módulo ${modPior.modulo}: ${modPior.titulo}`,
    'É o módulo com mais atrito: ' + [modPior.travei && `${modPior.travei}x "Travei"`, modPior.erros && `${modPior.erros} erro(s) nas perguntas`,
      modPior.abandonaram_aqui && `${modPior.abandonaram_aqui} pararam nele`, modPior.negativos && `${modPior.negativos} 👎`].filter(Boolean).join(', ') + '.',
    { texto: 'Ver onde trava', aba: 'trilha', sub: 'onde-trava' });
  const pergunta = resumoAula && resumoAula.perguntas_dificeis && resumoAula.perguntas_dificeis[0];
  if (pergunta && pergunta.erros >= 3) add('conteudo', `Reescrever a pergunta mais errada (módulo ${pergunta.modulo})`, `"${pergunta.pergunta}" teve ${pergunta.erros} erro(s).`,
    { texto: 'Ver perguntas difíceis', aba: 'trilha', sub: 'onde-trava' });
  const pior = av.piores && av.piores[0];
  if (pior && pior.negativos >= 2) add('conteudo', `Revisar "${pior.titulo}"`, `Recebeu ${pior.negativos} 👎 e ${pior.positivos} 👍.`, { texto: 'Ver avaliações', aba: 'avaliacoes' });
  const buscas = await buscasSemResultado(pool, dias);
  if (buscas.length) add('conteudo', 'Criar respostas para o que procuram e não acham na Central',
    'Buscas sem resultado: ' + buscas.map((b) => `"${b.termo}" (${b.vezes}x)`).join(', ') + '.', { texto: 'Abrir tutoriais', aba: 'tutoriais' });
  const ordem = { ruim: 0, regular: 1, conteudo: 2 };
  acoes.sort((x, y) => ordem[x.gravidade] - ordem[y.gravidade]);

  const resumoFaixas = { bom: 0, regular: 0, ruim: 0 };
  indicadores.forEach((i) => { if (resumoFaixas[i.faixa] != null) resumoFaixas[i.faixa] += 1; });

  return {
    dias,
    gerado_em: new Date().toISOString(),
    total_alunos: total,
    resumo_faixas: resumoFaixas,
    indicadores,
    acoes,
    situacoes: sits.map((x) => ({ ...x, total: contagem[x.id] })),
    dias_sumiu: dSumiu,
    buscas_sem_resultado: buscas,
    rastreio: Boolean(videosIni || lista.some((a) => a.acessos > 0)),
    ocultar_contatados_dias: cfg ? cfg.ocultar_contatados_dias : 0,
  };
}

module.exports = { visaoGeral, situacaoDe, situacoes, votosPorRgm, SITUACOES, SITUACAO, faixasPadrao, normalizaFaixas, catalogoFaixas };
