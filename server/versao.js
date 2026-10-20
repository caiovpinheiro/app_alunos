'use strict';

/*
 * Duas versões das telas do aluno no mesmo servidor (liberação gradual da versão nova).
 *
 * VERSAO_NOVA_PARA: RGMs ou e-mails (separados por vírgula, ponto e vírgula ou espaço) que veem
 * as telas novas (public/). "*" = todos. Vazio = ninguém: todos veem as telas congeladas da
 * produção anterior (public-antigo/, servidas em /antigo/...). O servidor (as APIs) é um só.
 *
 * Como a página é escolhida antes do login, a escolha viaja num cookie (app_versao=nova).
 * O cookie só decide qual index.html entregar; as permissões continuam nas APIs (a Aula
 * Inaugural e a Central exigem também a conta nesta lista, ver trilha.liberadaPara).
 */

const COOKIE = 'app_versao';

function lista() {
  return String(process.env.VERSAO_NOVA_PARA || '')
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function paraTodos() {
  return lista().includes('*');
}

function novaPara(aluno) {
  const l = lista();
  if (l.includes('*')) return true;
  if (!aluno) return false;
  const rgm = String(aluno.rgm || '').replace(/\D+/g, '');
  const email = String(aluno.email || '').trim().toLowerCase();
  return (rgm !== '' && l.includes(rgm)) || (email !== '' && l.includes(email));
}

function cookieNova(req) {
  const header = String(req.headers.cookie || '');
  return header.split(';').some((par) => par.trim() === COOKIE + '=nova');
}

// Página a entregar para este pedido: todos na nova, ou o cookie gravado no login.
function verNova(req) {
  return paraTodos() || cookieNova(req);
}

function gravarCookie(req, res, nova) {
  const https = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const fim = 'Path=/; SameSite=Lax; HttpOnly' + (https ? '; Secure' : '');
  res.append('Set-Cookie', nova ? `${COOKIE}=nova; Max-Age=31536000; ${fim}` : `${COOKIE}=; Max-Age=0; ${fim}`);
}

module.exports = { novaPara, paraTodos, verNova, gravarCookie };
