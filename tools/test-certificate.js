/*
 * Teste de geração do certificado: gera PDFs de exemplo reutilizando o módulo
 * do frontend (UMD) e valida conteúdo, posições e elementos fixos via pdf.js.
 * Uso: npm run test:certificate
 */
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const CertificateGenerator = require('../public/js/certificate.js');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'output');

const CASES = [
  {
    label: 'nome_curto',
    nome: 'João da Silva',
    rgm: '123456',
    unidade: 'Barra Funda',
    dataAulaISO: '2026-08-19',
    emissaoISO: '2026-08-19T12:37:00-03:00',
  },
  {
    label: 'nome_longo_unidade_longa',
    nome: 'Alexandre Konstantinos Wojciechowski dos Santos Pereira',
    rgm: '334455667788',
    unidade: 'Taboão da Serra - Jd. Mituzi',
    dataAulaISO: '2026-08-01',
    emissaoISO: '2026-08-19T12:37:00-03:00',
  },
  {
    label: 'unidade_parenteses',
    nome: 'Maria Fernanda de Souza',
    rgm: '987654',
    unidade: 'Sapopemba (Vila Ema)',
    dataAulaISO: '2025-12-15',
    emissaoISO: '2026-08-19T12:37:00-03:00',
  },
];

const DADOS_ANTIGOS = ['Caio Vinicius Pinheiro', '20002000', 'Capivari', '03/05/2022', '16/05/2022'];

async function extract(pdfjs, bytes) {
  // Cópia: o pdf.js "neutra" (detach) o buffer recebido.
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const lines = new Map();
  for (const it of content.items) {
    const key = Math.round(it.transform[5]);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ x: it.transform[4], str: it.str });
  }
  const textLines = [...lines.keys()].sort((a, b) => b - a).map((y) => ({
    y,
    x0: Math.min(...lines.get(y).map((i) => i.x)),
    text: lines.get(y).sort((a, b) => a.x - b.x).map((i) => i.str).join(''),
  }));

  // Imagens com bbox
  const OPS = pdfjs.OPS;
  const ops = await page.getOperatorList();
  const images = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const mul = (m1, m2) => [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push([...ctm]);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
      images.push([
        Math.round((ctm[4]) * 10) / 10,
        Math.round((ctm[5]) * 10) / 10,
        Math.round((ctm[0]) * 10) / 10,
        Math.round((ctm[3]) * 10) / 10,
      ].join(','));
    }
  }
  return { width: viewport.width, height: viewport.height, textLines, images };
}

function check(label, condition, detail) {
  if (condition) {
    console.log(`  OK   ${label}`);
  } else {
    console.log(`  FALHOU ${label}${detail ? ' :: ' + detail : ''}`);
    process.exitCode = 1;
  }
}

async function main() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  mkdirSync(OUT_DIR, { recursive: true });

  const assets = {
    templateBytes: new Uint8Array(readFileSync(path.join(ROOT, 'public/assets/certificado-template.pdf'))),
    fontBytes: new Uint8Array(readFileSync(path.join(ROOT, 'public/assets/fonts/Montserrat-Regular.ttf'))),
  };

  const original = await extract(pdfjs, assets.templateBytes);
  console.log(`Template original: ${original.width}x${original.height}, imagens=${original.images.length}`);

  for (const c of CASES) {
    console.log(`\n=== Caso: ${c.label} ===`);
    const pdfBytes = await CertificateGenerator.generateCertificate(c, assets);
    const outFile = path.join(OUT_DIR, `certificado_${c.label}.pdf`);
    writeFileSync(outFile, pdfBytes);
    console.log(`  gerado: ${outFile} (${pdfBytes.length} bytes)`);

    const got = await extract(pdfjs, pdfBytes);
    // Texto normalizado em linha única (a quebra de linha do parágrafo vira espaço).
    const fullText = got.textLines.map((l) => l.text).join(' ').replace(/\s+/g, ' ');

    check('página mantém dimensões', got.width === original.width && got.height === original.height, `${got.width}x${got.height}`);
    check('título CERTIFICADO preservado', fullText.includes('CERTIFICADO'));
    check('linha de assinatura preservada', fullText.includes('_____'));
    check('5 imagens preservadas', got.images.length === 5, got.images.join(' | '));
    check('imagens nas mesmas posições', JSON.stringify(got.images.sort()) === JSON.stringify(original.images.sort()),
      `orig=${original.images.sort().join('|')} got=${got.images.sort().join('|')}`);

    check('nome presente', fullText.includes(c.nome));
    check('RGM presente', fullText.includes(`RGM ${c.rgm}`));
    check('unidade presente', fullText.includes(`polo ${c.unidade},`));
    const dataAulaBR = CertificateGenerator.formatDataAula(c.dataAulaISO);
    check('data da aula presente', fullText.includes(`realizado em ${dataAulaBR}.`));
    check('data de emissão presente', fullText.includes('São Paulo, 19/08/2026 12:37:00'));

    for (const antigo of DADOS_ANTIGOS) {
      check(`dado antigo removido: "${antigo}"`, !fullText.includes(antigo));
    }

    const bodyLines = got.textLines.filter((l) => l.y <= 397 && l.y >= 340 && l.text.length > 10 && !l.text.includes('São Paulo'));
    check('corpo em até 4 linhas', bodyLines.length >= 3 && bodyLines.length <= 4, `${bodyLines.length} linhas`);
    for (const l of bodyLines) {
      check(`linha y=${l.y} começa em x≈56.7`, Math.abs(l.x0 - 56.7) < 1.5, `x0=${l.x0.toFixed(1)}`);
    }

    const dateLine = got.textLines.find((l) => l.text.includes('São Paulo'));
    check('data de emissão na baseline y=322', dateLine && dateLine.y === 322, dateLine && `y=${dateLine.y}`);
  }

  console.log(process.exitCode ? '\n*** HOUVE FALHAS ***' : '\nTodos os testes passaram.');
}

main().catch((err) => {
  console.error('Erro no teste:', err);
  process.exitCode = 1;
});
