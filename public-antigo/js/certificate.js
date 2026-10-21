/*
 * Geração do certificado a partir do template oficial (PDF).
 *
 * Estratégia: remove do content stream as seções de texto variável do aluno
 * original (parágrafo da declaração e data de emissão) e redesenha os textos
 * com os novos dados usando Montserrat-Regular (mesma fonte do documento).
 * Assinatura, carimbo, logos e demais elementos gráficos permanecem intactos.
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

  // Coordenadas medidas do template oficial (página 842x596pt, origem no canto inferior esquerdo).
  var LAYOUT = {
    body: {
      x: 56.7,
      maxWidth: 728.3, // 56.7 até 785.0, como no original
      firstBaseline: 397,
      leading: 15,
      maxLines: 3,
      fontSize: 11,
      minFontSize: 8,
    },
    date: { centerX: 421, baseline: 322, fontSize: 11 },
  };

  // Seções variáveis do template, identificadas pelo translate Y do cm que posiciona
  // cada grupo de texto (origem top-left, escala 0.75): 3 linhas da declaração + data de emissão.
  var REMOVE_SECTION_Y = [188.6929, 203.6929, 218.6929, 263.6929];

  function bytesToLatin1(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function latin1ToBytes(str) {
    var bytes = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
    return bytes;
  }

  function getTemplateContent(doc, page) {
    var contents = page.node.Contents();
    if (!contents) throw new Error('Template do certificado inválido.');
    var refs = contents instanceof PDFLib.PDFArray ? contents.asArray() : [contents];
    var parts = [];
    for (var i = 0; i < refs.length; i++) {
      var stream = doc.context.lookup(refs[i]);
      parts.push(bytesToLatin1(PDFLib.decodePDFRawStream(stream).decode()));
    }
    return parts.join('\n');
  }

  // Remove os grupos "q ... cm /G3 gs BT...ET Q" das regiões variáveis.
  // Cada grupo é autocontido (q/Q), então a remoção não afeta o restante do documento.
  function removeVariableSections(content) {
    var removed = 0;
    var pattern = /q\s+\.75 0 0 \.75 56\.692917 (\d+\.?\d*) cm\s+\/G3 gs[\s\S]*?\nQ/g;
    var result = content.replace(pattern, function (match, ty) {
      var y = parseFloat(ty);
      for (var i = 0; i < REMOVE_SECTION_Y.length; i++) {
        if (Math.abs(y - REMOVE_SECTION_Y[i]) < 0.01) {
          removed++;
          return '';
        }
      }
      return match;
    });
    if (removed !== REMOVE_SECTION_Y.length) {
      throw new Error('Template do certificado não reconhecido.');
    }
    return result;
  }

  function replaceContentStream(doc, page, content) {
    // Envolve em q/Q para isolar o CTM invertido do template (origem top-left)
    // e não interferir nos desenhos feitos pelo pdf-lib em seguida.
    var wrapped = 'q\n' + content + '\nQ\n';
    var stream = doc.context.stream(latin1ToBytes(wrapped));
    var ref = doc.context.register(stream);
    page.node.set(PDFLib.PDFName.of('Contents'), ref);
  }

  function formatDataAula(isoDate) {
    var parts = String(isoDate).split('-');
    if (parts.length !== 3) throw new Error('Data da aula inaugural inválida.');
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  function formatEmissao(isoString) {
    var date = isoString ? new Date(isoString) : new Date();
    if (Number.isNaN(date.getTime())) date = new Date();
    var parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    var get = function (t) { return parts.find(function (p) { return p.type === t; }).value; };
    return get('day') + '/' + get('month') + '/' + get('year') + ' ' + get('hour') + ':' + get('minute') + ':' + get('second');
  }

  function buildDeclaration(data) {
    return 'Declaro, para fins de comprovação de realização de atividades complementares, que o aluno '
      + data.nome + ', RGM ' + data.rgm + ', participou do treinamento sobre introdução e utilização dos recursos '
      + 'de ensino a distância (aula inaugural) da Universidade Cruzeiro do Sul, promovido pela eduit. polo '
      + data.unidade + ', realizado em ' + data.dataAulaText + '.';
  }

  function wrapText(text, font, size, maxWidth) {
    var words = text.split(' ');
    var lines = [];
    var current = '';
    for (var i = 0; i < words.length; i++) {
      var candidate = current ? current + ' ' + words[i] : words[i];
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  // Reduz discretamente a fonte se o conteúdo não couber nas 3 linhas originais.
  function pickBodyLayout(text, font) {
    var size = LAYOUT.body.fontSize;
    var lines = null;
    while (size >= LAYOUT.body.minFontSize) {
      lines = wrapText(text, font, size, LAYOUT.body.maxWidth);
      if (lines.length <= LAYOUT.body.maxLines) return { lines: lines, size: size };
      size -= 0.5;
    }
    lines = wrapText(text, font, LAYOUT.body.minFontSize, LAYOUT.body.maxWidth);
    if (lines.length > LAYOUT.body.maxLines + 1) {
      throw new Error('Conteúdo excede o espaço disponível no certificado.');
    }
    return { lines: lines, size: LAYOUT.body.minFontSize };
  }

  /**
   * @param {object} data { nome, rgm, unidade, dataAulaISO, emissaoISO }
   * @param {object} assets { templateBytes: Uint8Array, fontBytes: Uint8Array }
   * @returns {Promise<Uint8Array>} bytes do PDF final
   */
  async function generateCertificate(data, assets) {
    if (!data || !data.nome || !data.rgm || !data.unidade || !data.dataAulaISO) {
      throw new Error('Dados insuficientes para gerar o certificado.');
    }

    var dataAulaText = formatDataAula(data.dataAulaISO);
    var emissaoText = 'São Paulo, ' + formatEmissao(data.emissaoISO);

    var doc = await PDFLib.PDFDocument.load(assets.templateBytes);
    doc.registerFontkit(fontkit);
    var font = await doc.embedFont(assets.fontBytes);
    var page = doc.getPage(0);

    // 1. Remove os dados variáveis do aluno original (nome, RGM, polo, datas).
    var content = getTemplateContent(doc, page);
    replaceContentStream(doc, page, removeVariableSections(content));

    // 2. Redesenha o parágrafo da declaração com os dados do novo aluno.
    var black = PDFLib.rgb(0, 0, 0);
    var declaration = buildDeclaration({
      nome: data.nome, rgm: data.rgm, unidade: data.unidade, dataAulaText: dataAulaText,
    });
    var layout = pickBodyLayout(declaration, font);
    for (var i = 0; i < layout.lines.length; i++) {
      page.drawText(layout.lines[i], {
        x: LAYOUT.body.x,
        y: LAYOUT.body.firstBaseline - i * LAYOUT.body.leading,
        size: layout.size,
        font: font,
        color: black,
      });
    }

    // 3. Redesenha a data/hora de emissão, centralizada como no original.
    var dateWidth = font.widthOfTextAtSize(emissaoText, LAYOUT.date.fontSize);
    page.drawText(emissaoText, {
      x: LAYOUT.date.centerX - dateWidth / 2,
      y: LAYOUT.date.baseline,
      size: LAYOUT.date.fontSize,
      font: font,
      color: black,
    });

    return doc.save();
  }

  return {
    LAYOUT: LAYOUT,
    formatDataAula: formatDataAula,
    formatEmissao: formatEmissao,
    buildDeclaration: buildDeclaration,
    generateCertificate: generateCertificate,
  };
});
