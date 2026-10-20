'use strict';

/*
 * Duas versões das telas do aluno no mesmo servidor (liberação gradual da versão nova).
 *
 * VERSAO_NOVA_PARA: RGMs ou e-mails (separados por vírgula, ponto e vírgula ou espaço) que veem
 * as telas novas (public/). "*" = todos. Vazio = ninguém: todos veem as telas congeladas da
 * produção anterior (public-antigo/, servidas em /antigo/...). O servidor (as APIs) é um só.
 * VERSAO_NOVA_DESDE: contas criadas a partir de uma data também veem a nova (ver desde()).
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

// VERSAO_NOVA_DESDE (AAAA-MM-DD): contas criadas a partir desse dia (00h de Brasília) também veem a
// versão nova. É assim que os novos matriculados entram nela sem ser listados um a um (a conta nasce
// na sincronização do relatório de matriculados, até 30 min depois de o aluno aparecer nele).
function desde() {
  const v = String(process.env.VERSAO_NOVA_DESDE || '').trim();
  if (!v) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00-03:00` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function novaPara(aluno) {
  const l = lista();
  if (l.includes('*')) return true;
  if (!aluno) return false;
  const d = desde();
  if (d && aluno.created_at && new Date(aluno.created_at).getTime() >= d.getTime()) return true;
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

module.exports = { novaPara, paraTodos, verNova, gravarCookie, desde };
