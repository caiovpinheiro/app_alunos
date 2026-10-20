/*
 * Geração do certificado da Aula Inaugural sobre o modelo "Certificado de participação"
 * (Cruzeiro do Sul Virtual, faixas azul e dourada).
 *
 * O fundo é a imagem do modelo sem os valores de exemplo (public/assets/certificado-modelo.jpg,
 * 1600x1131 px): os rótulos fixos ("CERTIFICAMOS ÀS PARTES INTERESSADAS QUE", "PARTICIPOU DO",
 * "REALIZADO NO DIA", "COM CARGA HORÁRIA DE"), as linhas e a marca já estão na imagem.
 * Aqui só entram os dados do aluno, nas posições medidas no modelo, em Montserrat.
 *
 * Formato UMD: funciona no navegador (PDFLib/fontkit globais) e em Node (testes).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('pdf-lib'), require('@pdf-lib/fontkit'));
  } else {
    root.CertificateGenerator = factory(root.PDFLib, root.fontkit);
  }
})(typeof self !== 'undefined' ? self : this, function (PDFLib, fontkit) {
  'use strict';

  // Imagem do modelo: 1600x1131 px. Página A4 deitada: 842 pt de largura.
  var IMG_W = 1600;
  var IMG_H = 1131;
  var ESCALA = 842 / IMG_W;
  var PAGE_W = 842;
  var PAGE_H = IMG_H * ESCALA;

  // px do modelo (origem no canto superior esquerdo) -> pt do PDF (origem no canto inferior esquerdo)
  function px(v) { return v * ESCALA; }
  function yPdf(baselinePx) { return PAGE_H - baselinePx * ESCALA; }

  var AZUL = PDFLib.rgb(8 / 255, 63 / 255, 207 / 255);
  var MARINHO = PDFLib.rgb(22 / 255, 36 / 255, 75 / 255);
  var CINZA = PDFLib.rgb(110 / 255, 118 / 255, 135 / 255);

  // Posições medidas no modelo (px). Coluna da direita: x de 912 a 1490.
  var LAYOUT = {
    coluna: { x: 913, largura: 577 },
    nome: { baseline: 578, size: 17.3, min: 11, duasLinhas: [562, 592], sizeDuas: 11.5, minDuas: 8.5, tracking: 0.35 },
    rgm: { baseline: 634, size: 7.6, tracking: 1.1 },
    evento: { baseline: 764, size: 15, min: 10, tracking: 0.5 },
    data: { x: 1105, baseline: 832, size: 8.3, tracking: 0.9 },
    horas: { x: 1164, baseline: 866, size: 8.3, tracking: 0.9 },
    polo: { baseline: 1015, size: 9.5, min: 7, tracking: 0.1 },
    emissao: { x: 80, baseline: 1080, size: 6 },
  };

  function formatDataAula(isoDate) {
    var parts = String(isoDate).split('-');
    if (parts.length !== 3) throw new Error('Data da aula inaugural inválida.');
    return parts[2].slice(0, 2) + '/' + parts[1] + '/' + parts[0];
  }

  function formatEmissao(isoString) {
    var date = isoString ? new Date(isoString) : new Date();
    if (Number.isNaN(date.getTime())) date = new Date();
    var parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    var get = function (t) { return parts.find(function (p) { return p.type === t; }).value; };
    return get('day') + '/' + get('month') + '/' + get('year') + ' às ' + get('hour') + ':' + get('minute');
  }

  function textoPolo(unidade) {
    var u = String(unidade || '').replace(/\s+/g, ' ').trim();
    if (!u) return '';
    return /^polo\b/i.test(u) ? u : 'Polo ' + u;
  }

  function larguraComEspaco(texto, font, size, tracking) {
    return font.widthOfTextAtSize(texto, size) + tracking * Math.max(0, texto.length - 1);
  }

  // Espaçamento entre letras do modelo pelo próprio PDF (Tc), com o texto inteiro num só trecho:
  // assim copiar/pesquisar o texto do certificado funciona ("RGM 123456", não "R G M 1 2 3").
  // negrito: usa a Montserrat Bold (fonts.bold); sem ela, um contorno fino da mesma cor imita o peso.
  function desenhar(page, texto, x, baselinePx, size, fonts, cor, tracking, negrito) {
    var font = negrito && fonts.bold ? fonts.bold : fonts.regular;
    var ops = [PDFLib.setCharacterSpacing(tracking || 0)];
    if (negrito && !fonts.bold) {
      ops.push(
        PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.FillAndOutline),
        PDFLib.setLineWidth(size * (size >= 12 ? 0.055 : 0.032)),
        PDFLib.setStrokingColor(cor)
      );
    }
    page.pushOperators.apply(page, ops);
    page.drawText(texto, { x: x, y: yPdf(baselinePx), size: size, font: font, color: cor });
    page.pushOperators(PDFLib.setCharacterSpacing(0), PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.Fill));
  }

  // Maior tamanho (até cfg.size, não menor que cfg.min) que cabe na coluna.
  function tamanhoQueCabe(texto, font, cfg, largura) {
    var size = cfg.size;
    while (size > cfg.min && larguraComEspaco(texto, font, size, cfg.tracking) > largura) size -= 0.25;
    return size;
  }

  function quebrarEmDuas(texto, font, size, tracking, largura) {
    var palavras = texto.split(' ');
    var melhor = null;
    for (var i = 1; i < palavras.length; i++) {
      var a = palavras.slice(0, i).join(' ');
      var b = palavras.slice(i).join(' ');
      var maior = Math.max(larguraComEspaco(a, font, size, tracking), larguraComEspaco(b, font, size, tracking));
      if (!melhor || maior < melhor.maior) melhor = { linhas: [a, b], maior: maior };
    }
    return melhor && melhor.maior <= largura ? melhor.linhas : null;
  }

  /**
   * @param {object} data { nome, rgm, unidade, dataAulaISO, emissaoISO, horas?, evento? }
   * @param {object} assets { backgroundBytes: Uint8Array (JPG do modelo), fontBytes: Uint8Array (Montserrat Regular),
   *                          boldBytes?: Uint8Array (Montserrat Bold, para o nome e os valores) }
   * @returns {Promise<Uint8Array>} bytes do PDF final
   */
  async function generateCertificate(data, assets) {
    if (!data || !data.nome || !data.rgm || !data.unidade || !data.dataAulaISO) {
      throw new Error('Dados insuficientes para gerar o certificado.');
    }
    var bg = assets && (assets.backgroundBytes || assets.templateBytes);
    if (!bg || !assets.fontBytes) throw new Error('Modelo do certificado indisponível.');

    var doc = await PDFLib.PDFDocument.create();
    doc.registerFontkit(fontkit);
    doc.setTitle('Certificado de participação - Aula Inaugural');
    var font = await doc.embedFont(assets.fontBytes, { subset: true });
    var bold = assets.boldBytes ? await doc.embedFont(assets.boldBytes, { subset: true }) : null;
    var fonts = { regular: font, bold: bold };
    var fontB = bold || font; // medidas do texto em negrito
    var fundo = await doc.embedJpg(bg);
    var page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawImage(fundo, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });

    var x = px(LAYOUT.coluna.x);
    var largura = px(LAYOUT.coluna.largura);

    // Nome do participante: uma linha (encolhe até o mínimo); se não couber, duas linhas.
    var nome = String(data.nome).replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');
    var cfgNome = LAYOUT.nome;
    var sizeNome = tamanhoQueCabe(nome, fontB, cfgNome, largura);
    if (larguraComEspaco(nome, fontB, sizeNome, cfgNome.tracking) <= largura) {
      desenhar(page, nome, x, cfgNome.baseline, sizeNome, fonts, AZUL, cfgNome.tracking, true);
    } else {
      var size2 = cfgNome.sizeDuas;
      var linhas = null;
      while (size2 >= cfgNome.minDuas && !(linhas = quebrarEmDuas(nome, fontB, size2, cfgNome.tracking, largura))) size2 -= 0.25;
      if (!linhas) throw new Error('Nome longo demais para o certificado.');
      desenhar(page, linhas[0], x, cfgNome.duasLinhas[0], size2, fonts, AZUL, cfgNome.tracking, true);
      desenhar(page, linhas[1], x, cfgNome.duasLinhas[1], size2, fonts, AZUL, cfgNome.tracking, true);
    }

    // RGM, pequeno, logo abaixo da linha do nome (no estilo dos rótulos do modelo).
    desenhar(page, 'RGM ' + String(data.rgm).trim(), x, LAYOUT.rgm.baseline, LAYOUT.rgm.size, fonts, MARINHO, LAYOUT.rgm.tracking, false);

    // Nome do evento.
    var evento = String(data.evento || 'Aula Inaugural').toLocaleUpperCase('pt-BR');
    var sizeEvento = tamanhoQueCabe(evento, fontB, LAYOUT.evento, largura);
    desenhar(page, evento, x, LAYOUT.evento.baseline, sizeEvento, fonts, MARINHO, LAYOUT.evento.tracking, true);

    // Data e carga horária, logo depois dos rótulos fixos do modelo.
    desenhar(page, formatDataAula(data.dataAulaISO), px(LAYOUT.data.x), LAYOUT.data.baseline, LAYOUT.data.size, fonts, MARINHO, LAYOUT.data.tracking, true);
    var horas = Number(data.horas) || 4;
    desenhar(page, (horas < 10 ? '0' : '') + horas + ' HORAS', px(LAYOUT.horas.x), LAYOUT.horas.baseline, LAYOUT.horas.size, fonts, MARINHO, LAYOUT.horas.tracking, true);

    // Polo, sobre a linha de baixo.
    var polo = textoPolo(data.unidade);
    var sizePolo = tamanhoQueCabe(polo, fontB, LAYOUT.polo, largura);
    desenhar(page, polo, x, LAYOUT.polo.baseline, sizePolo, fonts, MARINHO, LAYOUT.polo.tracking, true);

    // Data de emissão, discreta, no canto de baixo à esquerda.
    desenhar(page, 'Emitido em ' + formatEmissao(data.emissaoISO), px(LAYOUT.emissao.x), LAYOUT.emissao.baseline, LAYOUT.emissao.size, fonts, CINZA, 0.2, false);

    return doc.save();
  }

  return {
    LAYOUT: LAYOUT,
    formatDataAula: formatDataAula,
    formatEmissao: formatEmissao,
    textoPolo: textoPolo,
    generateCertificate: generateCertificate,
  };
});
