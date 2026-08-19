// Inspeciona a estrutura do content stream do template (blocos de texto).
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { readFileSync } from 'node:fs';

const bytes = readFileSync(new URL('../public/assets/certificado-template.pdf', import.meta.url));
const doc = await PDFDocument.load(bytes);
const page = doc.getPage(0);

let contents = page.node.Contents();
if (!contents) {
  console.log('Sem contents');
  process.exit(0);
}
const streams = Array.isArray(contents) ? contents : (contents.asArray ? contents.asArray() : [contents]);
console.log('Content streams:', streams.length);

for (const ref of streams) {
  const stream = doc.context.lookup(ref);
  const raw = decodePDFRawStream(stream).decode();
  const text = Buffer.from(raw).toString('latin1');
  console.log('--- stream length:', text.length);

  // Mostra blocos BT...ET com as coordenadas de posicionamento
  const blocks = text.match(/BT[\s\S]*?ET/g) || [];
  console.log('Blocos BT...ET:', blocks.length);
  blocks.forEach((b, i) => {
    const pos = b.match(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+T[dm]/g) || [];
    const sizes = b.match(/(\d+\.?\d*)\s+Tf/g) || [];
    console.log(`\n[bloco ${i}] len=${b.length} pos=[${pos.slice(0, 4).join(' | ')}] fonts=[${sizes.join(',')}]`);
    console.log('  início:', b.slice(0, 160).replace(/\n/g, ' '));
  });
}
