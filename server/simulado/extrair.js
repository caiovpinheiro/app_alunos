'use strict';

// Extrai texto de PDF, DOCX e TXT. Imagem só com um provedor de LLM com visão (ver llm.js).
// O arquivo original não é guardado: só o texto extraído (e só se não for bloqueado como prova).

const zlib = require('node:zlib');

const LIMITE_TEXTO = 200000; // caracteres guardados por documento

function tipoPorBytes(buf, nome) {
  const ext = String(nome || '').toLowerCase().split('.').pop();
  if (buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return ext === 'docx' || buf.includes(Buffer.from('word/document.xml')) ? 'docx' : 'zip';
  }
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (ext === 'doc') return 'doc';
  // Texto: sem bytes nulos nos primeiros 4 KB.
  if (!buf.slice(0, 4096).includes(0)) return 'txt';
  return 'desconhecido';
}

async function textoPdf(buf) {
  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (err) {
    const e = new Error('Leitor de PDF indisponível neste servidor.');
    e.status = 501;
    throw e;
  }
  const tarefa = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false });
  const doc = await tarefa.promise;
  const paginas = [];
  for (let i = 1; i <= Math.min(doc.numPages, 300); i += 1) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    // Junta por linha (mesmo y) para manter "1) ..." e "a) ..." em linhas separadas.
    let linha = [];
    let y = null;
    const linhas = [];
    for (const it of tc.items) {
      const yy = it.transform ? Math.round(it.transform[5]) : y;
      if (y !== null && yy !== null && Math.abs(yy - y) > 2) { linhas.push(linha.join('')); linha = []; }
      linha.push(it.str);
      if (it.hasEOL) { linhas.push(linha.join('')); linha = []; }
      y = yy;
    }
    if (linha.length) linhas.push(linha.join(''));
    paginas.push(linhas.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));
  }
  const total = doc.numPages;
  try { await (tarefa.destroy ? tarefa.destroy() : doc.cleanup && doc.cleanup()); } catch (e) { /* libera memória no melhor esforço */ }
  return { texto: paginas.join('\n\n'), paginas: total };
}

// DOCX é um zip: lê o diretório central e descompacta word/document.xml (sem dependência nova).
function lerZip(buf, alvo) {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw Object.assign(new Error('Arquivo DOCX inválido.'), { status: 400 });
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  for (let n = 0; n < total; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const lenNome = buf.readUInt16LE(p + 28);
    const lenExtra = buf.readUInt16LE(p + 30);
    const lenCom = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.slice(p + 46, p + 46 + lenNome).toString('utf8');
    if (nome === alvo) {
      const ln = buf.readUInt16LE(local + 26);
      const le = buf.readUInt16LE(local + 28);
      const ini = local + 30 + ln + le;
      const dados = buf.slice(ini, ini + comprimido);
      if (metodo === 0) return dados;
      if (metodo === 8) return zlib.inflateRawSync(dados, { maxOutputLength: 50 * 1024 * 1024 });
      throw Object.assign(new Error('Compressão do DOCX não suportada.'), { status: 415 });
    }
    p += 46 + lenNome + lenExtra + lenCom;
  }
  return null;
}

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
}

function textoDocx(buf) {
  const xml = lerZip(buf, 'word/document.xml');
  if (!xml) throw Object.assign(new Error('DOCX sem conteúdo de texto.'), { status: 400 });
  const s = xml.toString('utf8')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return { texto: decodeXml(s).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() };
}

function textoTxt(buf) {
  let s = buf.toString('utf8');
  // Sem UTF-8 válido (muitos U+FFFD): lê como Latin-1 (arquivos salvos no Windows).
  if ((s.match(/�/g) || []).length > 5) s = buf.toString('latin1');
  return { texto: s.replace(/^﻿/, '') };
}

// imagem: precisa de llm.transcreverImagem (provedor com visão). Sem ele, 415.
async function extrair(buf, nome, llm) {
  const tipo = tipoPorBytes(buf, nome);
  let r;
  if (tipo === 'pdf') r = await textoPdf(buf);
  else if (tipo === 'docx') r = textoDocx(buf);
  else if (tipo === 'txt') r = textoTxt(buf);
  else if (tipo === 'png' || tipo === 'jpeg' || tipo === 'webp') {
    if (!llm || !llm.visao) {
      throw Object.assign(new Error('Para ler imagens é preciso ligar um provedor de IA. Por enquanto, envie PDF, DOCX ou TXT.'), { status: 415 });
    }
    r = { texto: await llm.transcreverImagem(buf, `image/${tipo}`) };
  } else if (tipo === 'doc') {
    throw Object.assign(new Error('Arquivos .doc antigos não são lidos. Salve como .docx ou PDF e envie de novo.'), { status: 415 });
  } else {
    throw Object.assign(new Error('Formato não suportado. Envie PDF, DOCX ou TXT.'), { status: 415 });
  }
  const texto = String(r.texto || '').replace(/\u0000/g, '').trim();
  return { tipo, texto: texto.slice(0, LIMITE_TEXTO), cortado: texto.length > LIMITE_TEXTO, paginas: r.paginas || null };
}

module.exports = { extrair, tipoPorBytes, LIMITE_TEXTO };
