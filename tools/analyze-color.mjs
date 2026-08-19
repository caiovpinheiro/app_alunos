// Verifica a cor de preenchimento ativa nos blocos de texto.
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = new URL('../public/assets/certificado-template.pdf', import.meta.url);
const doc = await getDocument({ url: pdfPath, useSystemFonts: true }).promise;
const page = await doc.getPage(1);
const ops = await page.getOperatorList();
const { fnArray, argsArray } = ops;

let fillColor = 'default(preto)';
for (let i = 0; i < fnArray.length; i++) {
  const fn = fnArray[i];
  const args = argsArray[i];
  if (fn === OPS.setFillRGBColor) fillColor = `rgb(${args.map((a) => Math.round(a * 255)).join(',')})`;
  else if (fn === OPS.setFillGray) fillColor = `gray(${args[0]})`;
  else if (fn === OPS.setFillCMYKColor) fillColor = `cmyk(${args.join(',')})`;
  else if (fn === OPS.showText || fn === OPS.showSpacedText) {
    const glyphs = args[0];
    let preview = '';
    for (const g of glyphs) {
      if (typeof g === 'object' && g.unicode) preview += g.unicode;
      else if (typeof g === 'string') preview += g;
      if (preview.length > 40) break;
    }
    console.log(`TEXT color=${fillColor} :: "${preview.slice(0, 50)}"`);
  }
}
