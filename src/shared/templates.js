'use strict';

// Dates in moment.js-style formats (the usual daily-note and template syntax) and the
// {{title}} / {{date}} / {{time}} template variables.

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const pad = (n, size = 2) => String(n).padStart(size, '0');

// ISO week number (Monday first).
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
}

const TOKENS = {
  YYYY: (d) => String(d.getFullYear()),
  YY: (d) => pad(d.getFullYear() % 100),
  MMMM: (d) => MONTHS[d.getMonth()],
  MMM: (d) => MONTHS[d.getMonth()].slice(0, 3),
  MM: (d) => pad(d.getMonth() + 1),
  M: (d) => String(d.getMonth() + 1),
  DD: (d) => pad(d.getDate()),
  D: (d) => String(d.getDate()),
  dddd: (d) => DAYS[d.getDay()],
  ddd: (d) => DAYS[d.getDay()].slice(0, 3),
  HH: (d) => pad(d.getHours()),
  H: (d) => String(d.getHours()),
  mm: (d) => pad(d.getMinutes()),
  m: (d) => String(d.getMinutes()),
  ss: (d) => pad(d.getSeconds()),
  s: (d) => String(d.getSeconds()),
  ww: (d) => pad(isoWeek(d)),
  w: (d) => String(isoWeek(d)),
  Q: (d) => String(Math.floor(d.getMonth() / 3) + 1),
};
const TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|m|ss|s|ww|w|Q/g;

function formatDate(date, format) {
  return format.replace(TOKEN_RE, (token, literal) => (literal !== undefined ? literal : TOKENS[token](date)));
}

function applyTemplate(text, { title, now = new Date(), dateFormat = 'YYYY-MM-DD', timeFormat = 'HH:mm' }) {
  return text.replace(/\{\{\s*(title|date|time)(?::([^}]*))?\s*\}\}/gi, (_m, name, format) => {
    const key = name.toLowerCase();
    if (key === 'title') return title;
    return formatDate(now, (format ?? (key === 'date' ? dateFormat : timeFormat)).trim());
  });
}

module.exports = { formatDate, applyTemplate };
