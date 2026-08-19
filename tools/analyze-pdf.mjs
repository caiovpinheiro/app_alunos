// Ferramenta de análise do template oficial do certificado.
// Uso: node tools/analyze-pdf.mjs
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = new URL('../public/assets/certificado-template.pdf', import.meta.url);

const doc = await getDocument({ url: pdfPath, useSystemFonts: true }).promise;
const page = await doc.getPage(1);
const viewport = page.getViewport({ scale: 1 });

console.log(`PAGES: ${doc.numPages}`);
console.log(`PAGE SIZE (pdf points): width=${viewport.width} height=${viewport.height}`);

const content = await page.getTextContent();
const items = content.items.map((it) => ({
  str: it.str,
  x: Math.round(it.transform[4] * 100) / 100,
  y: Math.round(it.transform[5] * 100) / 100,
  w: Math.round(it.width * 100) / 100,
  h: Math.round(it.height * 100) / 100,
  font: it.fontName,
  size: Math.round(Math.hypot(it.transform[2], it.transform[3]) * 100) / 100,
}));

// Agrupa por linha (mesmo y aproximado)
const lines = new Map();
for (const it of items) {
  const key = Math.round(it.y);
  if (!lines.has(key)) lines.set(key, []);
  lines.get(key).push(it);
}

const sortedKeys = [...lines.keys()].sort((a, b) => b - a);
for (const key of sortedKeys) {
  const lineItems = lines.get(key).sort((a, b) => a.x - b.x);
  const text = lineItems.map((i) => i.str).join('');
  const x0 = Math.min(...lineItems.map((i) => i.x));
  const x1 = Math.max(...lineItems.map((i) => i.x + i.w));
  const fonts = [...new Set(lineItems.map((i) => `${i.font}@${i.size}`))].join(',');
  console.log(`y=${key} x=[${x0.toFixed(1)}..${x1.toFixed(1)}] fonts=[${fonts}]`);
  console.log(`   "${text}"`);
}

// Operadores gráficos (retângulos/linhas) para localizar a linha de assinatura
const ops = await page.getOperatorList();
console.log(`\nTOTAL OPS: ${ops.fnArray.length}`);
