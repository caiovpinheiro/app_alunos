'use strict';

// Chat do CRM (webchat) no portal, em teste: só as contas em WEBCHAT_LIBERADO_PARA
// (RGM ou e-mail, separados por vírgula ou espaço) recebem o script. "*" libera para
// todos. Vazio = ninguém. O script e a chave vêm só do Environment (WEBCHAT_EMBED_URL e
// WEBCHAT_KEY): nada fica no código nem no HTML. Sem a chave, o chat não carrega.

const { envValue } = require('./env');


function listaLiberada() {
  return envValue('WEBCHAT_LIBERADO_PARA')
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function liberadoPara(aluno) {
  const lista = listaLiberada();
  if (!lista.length) return false;
  if (lista.includes('*')) return true;
  if (!aluno) return false;
  const rgm = String(aluno.rgm || '').replace(/\D+/g, '');
  const email = String(aluno.email || '').trim().toLowerCase();
  return (rgm && lista.includes(rgm)) || (email && lista.includes(email));
}

// O que o front precisa para montar a tag <script async src data-key>.
function configPara(aluno) {
  if (!liberadoPara(aluno)) return null;
  const src = envValue('WEBCHAT_EMBED_URL');
  const key = envValue('WEBCHAT_KEY');
  if (!src || !key) return null;
  return { src, key };
}

module.exports = { liberadoPara, configPara };
