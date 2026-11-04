// Salida a CSV para abrir en Excel en español: separador ";", BOM UTF-8 (para las tildes) y decimales con coma.
const PELIGROSAS = /^[=+\-@\t\r]/;

export function celda(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6).replace('.', ',');
  let s = String(v);
  // Evita la inyección de fórmulas: un texto que empieza por = + - @ se abriría como fórmula en Excel
  if (PELIGROSAS.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function aCsv(encabezados, filas) {
  return '﻿' + [encabezados, ...filas].map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n';
}
