/* Validações do formulário de emissão (espelhadas no backend). */
window.Validation = (function () {
  'use strict';

  var UNIDADES = [
    'Barra Funda',
    'Taboão da Serra - Jd. Mituzi',
    'Taboão da Serra - Centro',
    'Campinas - Jd. Cristina',
    'Itapira',
    'Capivari',
    'Sapopemba (Vila Ema)',
    'Freguesia do Ó',
    'Morumbi',
    'Vila Prudente',
    'Ibirapuera',
    'Santana',
  ];

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function normalizeSpaces(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function todayInSaoPaulo() {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    var get = function (t) { return parts.find(function (p) { return p.type === t; }).value; };
    return get('year') + '-' + get('month') + '-' + get('day');
  }

  function validateCertificateForm(raw) {
    var errors = {};
    var sanitized = {
      email: normalizeSpaces(raw.email),
      nome: normalizeSpaces(raw.nome),
      rgm: normalizeSpaces(raw.rgm),
      data_aula_inaugural: normalizeSpaces(raw.data_aula_inaugural),
      curso: normalizeSpaces(raw.curso),
      unidade: normalizeSpaces(raw.unidade),
    };

    if (!sanitized.email) {
      errors.email = 'O e-mail é obrigatório.';
    } else if (!EMAIL_RE.test(sanitized.email)) {
      errors.email = 'Insira um e-mail válido.';
    }

    if (!sanitized.nome) errors.nome = 'O nome completo é obrigatório.';
    if (!sanitized.rgm) errors.rgm = 'O RGM é obrigatório.';

    if (!sanitized.data_aula_inaugural) {
      errors.data_aula_inaugural = 'A data da aula inaugural é obrigatória.';
    } else if (sanitized.data_aula_inaugural > todayInSaoPaulo()) {
      errors.data_aula_inaugural = 'A data não pode ser futura.';
    }

    if (!sanitized.curso) errors.curso = 'Selecione um curso da lista.';

    if (!sanitized.unidade) {
      errors.unidade = 'Selecione uma unidade.';
    } else if (UNIDADES.indexOf(sanitized.unidade) === -1) {
      errors.unidade = 'Unidade inválida.';
    }

    return { valid: Object.keys(errors).length === 0, errors: errors, sanitized: sanitized };
  }

  return {
    UNIDADES: UNIDADES,
    normalizeSpaces: normalizeSpaces,
    validateCertificateForm: validateCertificateForm,
  };
})();
