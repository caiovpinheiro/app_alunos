// Análise profunda: fontes reais, imagens e retângulos de fundo.
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = new URL('../public/assets/certificado-template.pdf', import.meta.url);
const doc = await getDocument({ url: pdfPath, useSystemFonts: true }).promise;
const page = await doc.getPage(1);

// 1) Nomes reais das fontes
const content = await page.getTextContent();
const fontNames = [...new Set(content.items.map((i) => i.fontName))];
for (const fn of fontNames) {
  try {
    const obj = page.commonObjs.get(fn);
    console.log(`FONT ${fn}: name=${obj.name}`);
  } catch {
    console.log(`FONT ${fn}: (não resolvida)`);
  }
}

// 2) Operadores gráficos: imagens e fills com bbox aproximada
const ops = await page.getOperatorList();
const { fnArray, argsArray } = ops;

// Estado gráfico simplificado (CTM)
let ctm = [1, 0, 0, 1, 0, 0];
const stack = [];
const multiply = (m1, m2) => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

let fillColor = null;
let pathRect = null;

for (let i = 0; i < fnArray.length; i++) {
  const fn = fnArray[i];
  const args = argsArray[i];
  if (fn === OPS.save) stack.push([...ctm]);
  else if (fn === OPS.restore) ctm = stack.pop() || ctm;
  else if (fn === OPS.transform) ctm = multiply(ctm, args);
  else if (fn === OPS.setFillRGBColor) fillColor = `rgb(${args.map((a) => Math.round(a * 255)).join(',')})`;
  else if (fn === OPS.setFillGray) fillColor = `gray(${args[0]})`;
  else if (fn === OPS.setFillCMYKColor) fillColor = `cmyk(${args.join(',')})`;
  else if (fn === OPS.rectangle) {
    pathRect = { x: args[0], y: args[1], w: args[2], h: args[3] };
  } else if (fn === OPS.fill || fn === OPS.eoFill) {
    if (pathRect) {
      const [x0, y0] = apply(ctm, pathRect.x, pathRect.y);
      const [x1, y1] = apply(ctm, pathRect.x + pathRect.w, pathRect.y + pathRect.h);
      console.log(`FILL RECT color=${fillColor} bbox=[${x0.toFixed(1)},${y0.toFixed(1)} .. ${x1.toFixed(1)},${y1.toFixed(1)}]`);
    }
    pathRect = null;
  } else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintImageMaskXObject) {
    const [x0, y0] = apply(ctm, 0, 0);
    const [x1, y1] = apply(ctm, 1, 1);
    console.log(`IMAGE ${args[0]} bbox=[${Math.min(x0, x1).toFixed(1)},${Math.min(y0, y1).toFixed(1)} .. ${Math.max(x0, x1).toFixed(1)},${Math.max(y0, y1).toFixed(1)}]`);
  }
}
