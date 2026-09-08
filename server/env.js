'use strict';

function envValue(key, fallback = '') {
  let value = process.env[key];
  if (value == null || value === '') value = fallback;
  value = String(value ?? '').trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }
  return value;
}

module.exports = { envValue };
