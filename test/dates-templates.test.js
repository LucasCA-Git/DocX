'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDate, applyTemplate } = require('../src/shared/templates');

const d = new Date(2026, 9, 6, 9, 5, 7); // terça, 6 de outubro de 2026, 09:05:07

test('formatDate understands the usual moment.js tokens, in Portuguese', () => {
  assert.equal(formatDate(d, 'YYYY-MM-DD'), '2026-10-06');
  assert.equal(formatDate(d, 'DD/MM/YY HH:mm:ss'), '06/10/26 09:05:07');
  assert.equal(formatDate(d, 'D [de] MMMM [de] YYYY'), '6 de outubro de 2026');
  assert.equal(formatDate(d, 'ddd, MMM'), 'ter, out');
  assert.equal(formatDate(d, 'dddd'), 'terça-feira');
  assert.equal(formatDate(d, 'YYYY/[W]ww'), '2026/W41');
  assert.equal(formatDate(d, 'H:m'), '9:5');
});

test('applyTemplate fills title, date and time, with optional formats', () => {
  const text = '# {{title}}\nCriado {{date}} {{time}}\n{{date:dddd}} {{time:HH[h]mm}} {{ title }}';
  assert.equal(applyTemplate(text, { title: 'Reunião', now: d, dateFormat: 'DD/MM/YYYY', timeFormat: 'HH:mm' }),
    '# Reunião\nCriado 06/10/2026 09:05\nterça-feira 09h05 Reunião');
  assert.equal(applyTemplate('{{desconhecido}}', { title: 'x', now: d }), '{{desconhecido}}');
});
