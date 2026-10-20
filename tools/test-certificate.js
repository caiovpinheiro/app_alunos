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

  // Modelo "Certificado de participação": fundo JPG (sem os valores de exemplo) + Montserrat.
  const assets = {
    backgroundBytes: new Uint8Array(readFileSync(path.join(ROOT, 'public/assets/certificado-modelo.jpg'))),
    fontBytes: new Uint8Array(readFileSync(path.join(ROOT, 'public/assets/fonts/Montserrat-Regular.ttf'))),
    boldBytes: new Uint8Array(readFileSync(path.join(ROOT, 'public/assets/fonts/Montserrat-Bold.ttf'))),
  };
  const colunaX = CertificateGenerator.LAYOUT.coluna.x * 842 / 1600;

  for (const c of CASES) {
    console.log(`\n=== Caso: ${c.label} ===`);
    const pdfBytes = await CertificateGenerator.generateCertificate(c, assets);
    const outFile = path.join(OUT_DIR, `certificado_${c.label}.pdf`);
    writeFileSync(outFile, pdfBytes);
    console.log(`  gerado: ${outFile} (${pdfBytes.length} bytes)`);

    const got = await extract(pdfjs, pdfBytes);
    const fullText = got.textLines.map((l) => l.text).join(' ').replace(/\s+/g, ' ');
    // Texto com espaçamento entre letras: o pdf.js devolve "R G M 1 2 3"; compara sem espaços.
    const compacto = fullText.replace(/\s+/g, '');
    const tem = (t) => compacto.includes(String(t).replace(/\s+/g, ''));

    check('página A4 deitada (842 x ~595 pt)', Math.round(got.width) === 842 && Math.abs(got.height - 595.2) < 1, `${got.width}x${got.height}`);
    check('fundo do modelo (1 imagem cobrindo a página)', got.images.length === 1 && got.images[0].startsWith('0,0,842,'), got.images.join(' | '));

    const nome = c.nome.toLocaleUpperCase('pt-BR');
    check('nome presente (em maiúsculas)', fullText.includes(nome) || nome.split(' ').every((p) => fullText.includes(p)));
    check('RGM presente', tem(`RGM ${c.rgm}`));
    check('evento presente', fullText.includes('AULA INAUGURAL'));
    check('data presente', tem(CertificateGenerator.formatDataAula(c.dataAulaISO)));
    check('carga horária presente', tem('04 HORAS'));
    check('polo presente', fullText.includes(CertificateGenerator.textoPolo(c.unidade)));
    check('data de emissão presente', fullText.includes('Emitido em 19/08/2026 às 12:37'));

    for (const antigo of DADOS_ANTIGOS) {
      check(`dado antigo ausente: "${antigo}"`, !fullText.includes(antigo));
    }
    const linhasNome = got.textLines.filter((l) => nome.split(' ').some((p) => p.length > 3 && l.text.includes(p)));
    check('nome em 1 ou 2 linhas, na coluna da direita', linhasNome.length >= 1 && linhasNome.length <= 2 && linhasNome.every((l) => Math.abs(l.x0 - colunaX) < 1.5),
      linhasNome.map((l) => `x0=${l.x0.toFixed(1)}`).join(' '));
  }

  console.log(process.exitCode ? '\n*** HOUVE FALHAS ***' : '\nTodos os testes passaram.');
}

main().catch((err) => {
  console.error('Erro no teste:', err);
  process.exitCode = 1;
});
