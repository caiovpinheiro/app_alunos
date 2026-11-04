'use strict';

// Leitura do CRM para a aba Ao vivo. Uma rota só, só GET: /api/painel/portal-aluno devolve agregados.
// Com CRM_API_URL e CRM_API_TOKEN vazios, o painel segue só com o portal e avisa o que falta.

const crypto = require('node:crypto');
const { envValue } = require('./env');

const TIMEOUT_MS = 12000;
const ATRASO_MS = 5 * 60000; // sem resposta boa há 5 min: o número na tela está atrasado

// Passos de cada automação que viram número na tela. Se o id mudar no CRM, o painel avisa.
const AUTOMACOES = [
  {
    id: 'cmrw7umn317zypd017ofaroom',
    rotulo: 'BV - Calouros',
    passos: {
      oferta: 'node-1793282282699',
      login: 'node-1793291931653',
      lembrete_24h: 'node-lembrete-acesso-24h',
      espera_1h: 'node-recheca-senha-1h',
      espera_4h: 'node-recheca-senha-4h',
      mensagem_antiga: 'b9e9f48a-1656-43a9-b5b1-9196168cbec3',
    },
  },
  {
    id: 'cmw2be3rh09c7qt01pq3ffgo8',
    rotulo: 'Reenvio acesso portal - 04/11',
    passos: { oferta: 'rea-template', login: 'rea-login' },
  },
];
const FALHAS = new Set(['FAILED', 'FAILED_HANDLED']);

function configurado() {
  return Boolean(envValue('CRM_API_URL') && envValue('CRM_API_TOKEN'));
}

// DDD + 8 últimos dígitos: igual ao CRM, para o mesmo número com e sem o nono dígito se encontrar.
function chaveTelefone(tel) {
  let d = String(tel == null ? '' : tel).replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

function chaveEmbaralhada(segredo, tel) {
  const k = chaveTelefone(tel);
  return k ? crypto.createHmac('sha256', segredo).update(k).digest('hex').slice(0, 32) : null;
}

function novaLinha(dia) {
  return { dia, oferta: 0, login: 0, lembrete_24h: 0, espera_1h: 0, espera_4h: 0, mensagem_antiga: 0, falhas: 0 };
}

// Transforma o que veio do CRM em totais e linhas por dia, com um aviso para passo que sumiu.
function resumirAutomacao(def, a) {
  if (!a) return { id: def.id, rotulo: def.rotulo, encontrada: false, avisos: ['Automação não encontrada no CRM.'], total: novaLinha(null), dias: [] };
  const metrica = {};
  Object.entries(def.passos).forEach(([nome, passo]) => { metrica[passo] = nome; });
  const existentes = new Set(a.passos.map((p) => p.id));
  const faltando = Object.entries(def.passos).filter(([, passo]) => !existentes.has(passo)).map(([nome]) => nome);
  const total = novaLinha(null);
  const dias = new Map();
  a.porDia.forEach((l) => {
    if (!dias.has(l.dia)) dias.set(l.dia, novaLinha(l.dia));
    const d = dias.get(l.dia);
    const add = (campo) => { d[campo] += l.n; total[campo] += l.n; };
    if (FALHAS.has(l.status)) add('falhas');
    else if (l.status === 'SUCCESS' && metrica[l.passo]) add(metrica[l.passo]);
  });
  return {
    id: a.id,
    rotulo: a.nome,
    encontrada: true,
    ativa: a.ativa,
    alterada_em: a.atualizadaEm,
    ultimo_registro_em: a.ultimoRegistroEm,
    avisos: faltando.length ? [`Passo não encontrado no CRM: ${faltando.join(', ')}. Esse número fica zerado até ajustar o painel.`] : [],
    total,
    dias: [...dias.values()].sort((x, y) => (x.dia < y.dia ? 1 : -1)),
  };
}

// Reúne as chaves dos passos de oferta e de login, de todas as automações.
function alcanceDe(payload) {
  if (!payload.alcance || !payload.alcance.ok) return null;
  const de = (campo) => new Set(AUTOMACOES.flatMap((a) => (a.passos[campo] ? payload.alcance.data[a.passos[campo]] || [] : [])));
  return { oferta: de('oferta'), login: de('login') };
}

function fonte(id, rotulo, bloco, emOk, detalheOk, agora) {
  if (bloco === 'nao_ligado') return { id, rotulo, status: 'nao_ligado', atualizado_em: null, detalhe: 'Falta ligar o CRM (CRM_API_URL e CRM_API_TOKEN).' };
  if (!bloco || !bloco.ok) return { id, rotulo, status: emOk ? 'atrasado' : 'indisponivel', atualizado_em: emOk, detalhe: 'O CRM não devolveu este bloco na última leitura.' };
  const velho = emOk && agora - new Date(emOk).getTime() > ATRASO_MS;
  return { id, rotulo, status: velho ? 'atrasado' : 'em_dia', atualizado_em: emOk, detalhe: velho ? 'O CRM não responde: mostrando a última leitura boa.' : detalheOk };
}

const ROTULOS = { automacoes: 'CRM: régua e reenvio', alcance: 'CRM: quem recebeu oferta e login', coorte: 'CRM: testes A/B/C', atendimento: 'CRM: fila de atendimento', atendentes: 'CRM: por atendente' };
const DETALHES = { automacoes: 'Registros das duas automações.', alcance: 'Cruzado por telefone embaralhado.', coorte: 'Cruzado por telefone embaralhado.', atendimento: 'Conversas de todo o CRM, não só de alunos novos.', atendentes: 'Só atendentes humanos.' };

function fontes(estado, agora, { comTestes = false } = {}) {
  const blocos = Object.keys(ROTULOS).filter((k) => comTestes || k !== 'coorte');
  if (!estado) return blocos.map((k) => fonte(`crm_${k}`, ROTULOS[k], 'nao_ligado', null, '', agora));
  return blocos.map((k) => fonte(`crm_${k}`, ROTULOS[k], (estado.payload || {})[k], estado.blocoOkEm[k] || null, DETALHES[k], agora));
}

function resumir(payload) {
  const lidas = payload.automacoes && payload.automacoes.ok ? payload.automacoes.data : null;
  return {
    automacoes: lidas ? AUTOMACOES.map((def) => resumirAutomacao(def, lidas.find((a) => a.id === def.id))) : null,
    atendimento: payload.atendimento && payload.atendimento.ok ? payload.atendimento.data : null,
    atendentes: payload.atendentes && payload.atendentes.ok ? payload.atendentes.data : null,
  };
}

async function buscar(desde, fetchFn = fetch, passosCoorte = []) {
  const base = envValue('CRM_API_URL').replace(/\/+$/, '');
  const passos = [...new Set(AUTOMACOES.flatMap((a) => [a.passos.oferta, a.passos.login]))];
  const qs = new URLSearchParams({ automacoes: AUTOMACOES.map((a) => a.id).join(','), desde, alcance: passos.join(',') });
  if (passosCoorte.length) qs.set('coorte', passosCoorte.join(','));
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(`${base}/api/painel/portal-aluno?${qs}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${envValue('CRM_API_TOKEN')}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`CRM respondeu ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Guarda a última resposta boa de cada bloco: uma falha não apaga o que já estava na tela.
function novoLeitor(fetchFn = fetch) {
  const estado = { payload: null, blocoOkEm: {}, ultimos: {}, erro: null };
  return {
    estado,
    async ler(desde, agora = Date.now(), passosCoorte = []) {
      if (!configurado()) return null;
      try {
        const p = await buscar(desde, fetchFn, passosCoorte);
        estado.erro = null;
        estado.payload = {};
        Object.keys(ROTULOS).forEach((k) => {
          if (p[k] && p[k].ok) {
            estado.ultimos[k] = p[k];
            estado.blocoOkEm[k] = new Date(agora).toISOString();
            estado.payload[k] = p[k];
          } else {
            estado.payload[k] = p[k] || null;
          }
        });
      } catch (err) {
        estado.erro = err.message;
        console.error('Ao vivo: leitura do CRM falhou:', err.message);
        estado.payload = {};
        Object.keys(ROTULOS).forEach((k) => { estado.payload[k] = null; });
      }
      const usar = {};
      Object.keys(ROTULOS).forEach((k) => { usar[k] = (estado.payload[k] && estado.payload[k].ok) ? estado.payload[k] : estado.ultimos[k] || null; });
      return { resumo: resumir(usar), alcance: alcanceDe(usar), coorte: usar.coorte ? usar.coorte.data : null, chave: envValue('CRM_API_TOKEN'), estado };
    },
  };
}

module.exports = { AUTOMACOES, configurado, chaveTelefone, chaveEmbaralhada, resumirAutomacao, resumir, alcanceDe, fontes, buscar, novoLeitor };
