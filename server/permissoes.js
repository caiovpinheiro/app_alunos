'use strict';

/*
 * Permissões por conta (coluna csu_alunos.permissoes, JSONB).
 *
 * NULL (todas as contas do relatório, do webhook e do primeiro acesso) = comportamento de sempre:
 * as liberações seguem as variáveis de ambiente (VERSAO_NOVA_PARA, TRILHA_LIBERADA_PARA,
 * WEBCHAT_LIBERADO_PARA) e as demais áreas ficam abertas.
 *
 * Preenchida (conta teste criada pelo admin) = cada chave booleana manda:
 * true libera, false bloqueia, mesmo contra a variável de ambiente. Chave ausente = como NULL.
 */

const CATALOGO = [
  { chave: 'versao_nova', rotulo: 'Telas novas do portal', ajuda: 'Desmarcado, a conta vê as telas antigas.', padrao: true },
  { chave: 'aula_inaugural', rotulo: 'Aula Inaugural (trilha) e Central de ajuda', ajuda: 'Só funciona com as telas novas.', padrao: true },
  { chave: 'meu_semestre', rotulo: 'Meu semestre', ajuda: 'Calendário e matérias.', padrao: true },
  { chave: 'avisos', rotulo: 'Avisos', ajuda: 'Sino e lista de avisos.', padrao: true },
  { chave: 'tutoriais', rotulo: 'Tutoriais e vídeos', ajuda: 'Tela "Central de ajuda" e vídeos do início.', padrao: true },
  { chave: 'certificado', rotulo: 'Certificado da Aula Inaugural', ajuda: 'Emitir o PDF.', padrao: true },
  { chave: 'atendimento', rotulo: 'Comercial e indicação', ajuda: 'Tela de atendimento e envio de indicações.', padrao: true },
  { chave: 'webchat', rotulo: 'Chat com o polo', ajuda: 'Precisa de WEBCHAT_EMBED_URL e WEBCHAT_KEY no servidor.', padrao: false },
];

const CHAVES = CATALOGO.map((p) => p.chave);

// Áreas que só fecham quando a conta tem a chave = false (as outras chaves são decididas nos módulos).
const AREAS = ['meu_semestre', 'avisos', 'tutoriais', 'certificado', 'atendimento'];

// Rotas do aluno bloqueadas por área (prefixo do caminho).
const ROTAS = [
  ['/api/meu-semestre', 'meu_semestre'],
  ['/api/avisos', 'avisos'],
  ['/api/tutoriais', 'tutoriais'],
  ['/api/certificates', 'certificado'],
  ['/api/indicacoes', 'atendimento'],
];

function lerObjeto(aluno) {
  let p = aluno && aluno.permissoes;
  if (typeof p === 'string') {
    try { p = JSON.parse(p); } catch (err) { p = null; }
  }
  return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
}

// true / false quando a conta tem a chave definida; undefined = segue a regra de sempre.
function valor(aluno, chave) {
  const p = lerObjeto(aluno);
  return p && typeof p[chave] === 'boolean' ? p[chave] : undefined;
}

function permite(aluno, chave) {
  return valor(aluno, chave) !== false;
}

// Áreas abertas para a conta (o front esconde menus e telas com isso).
function areas(aluno) {
  return AREAS.reduce((m, chave) => { m[chave] = permite(aluno, chave); return m; }, {});
}

function areaDaRota(caminho) {
  const c = String(caminho || '').split('?')[0];
  const achou = ROTAS.find(([prefixo]) => c === prefixo || c.startsWith(prefixo + '/'));
  return achou ? achou[1] : null;
}

// Do corpo do admin: só as chaves conhecidas, sempre booleanas (faltando = padrão do catálogo).
function normalizar(entrada) {
  const src = entrada && typeof entrada === 'object' ? entrada : {};
  return CATALOGO.reduce((m, p) => {
    m[p.chave] = Object.prototype.hasOwnProperty.call(src, p.chave) ? Boolean(src[p.chave]) : p.padrao;
    return m;
  }, {});
}

module.exports = { CATALOGO, CHAVES, valor, permite, areas, areaDaRota, normalizar, lerObjeto };
