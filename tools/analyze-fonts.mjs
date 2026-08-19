// Lista os nomes reais (BaseFont) das fontes embutidas no template.
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFileSync } from 'node:fs';

const bytes = readFileSync(new URL('../public/assets/certificado-template.pdf', import.meta.url));
const doc = await PDFDocument.load(bytes);
const page = doc.getPage(0);
const resources = page.node.Resources();
const fontDict = resources.lookup(PDFName.of('Font'));

if (!fontDict) {
  console.log('Nenhuma fonte encontrada.');
} else {
  for (const [key, ref] of fontDict.entries()) {
    const font = doc.context.lookup(ref);
    const baseFont = font.lookup(PDFName.of('BaseFont'));
    const subtype = font.lookup(PDFName.of('Subtype'));
    console.log(`${key.toString()} -> BaseFont=${baseFont?.toString()} Subtype=${subtype?.toString()}`);
  }
}
