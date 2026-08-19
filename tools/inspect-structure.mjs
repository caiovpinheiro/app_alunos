// Mostra os operadores ENTRE os blocos BT...ET para avaliar remoção segura.
import { PDFDocument, decodePDFRawStream } from 'pdf-lib';
import { readFileSync } from 'node:fs';

const bytes = readFileSync(new URL('../public/assets/certificado-template.pdf', import.meta.url));
const doc = await PDFDocument.load(bytes);
const page = doc.getPage(0);
const stream = doc.context.lookup(page.node.Contents());
const text = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');

// Substitui blocos BT...ET por marcadores numerados
let i = 0;
const marked = text.replace(/BT[\s\S]*?ET/g, () => `\n<<<BLOCO_${i++}>>>\n`);
console.log(marked);
