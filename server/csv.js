// Lectura de tablas pegadas desde Excel o de archivos CSV: detecta el separador, comillas y formatos de número colombianos.

const sinAcentos = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
// "Código de barras " -> "codigo de barras"
export const normalizar = (s) => sinAcentos(s).replace(/\s+/g, ' ').trim().toLowerCase();

function detectarSeparador(primeraLinea) {
  const cuenta = (c) => (primeraLinea.match(new RegExp(c === '\t' ? '\t' : `\\${c}`, 'g')) || []).length;
  const opciones = [['\t', cuenta('\t')], [';', cuenta(';')], [',', cuenta(',')]];
  return opciones.sort((a, b) => b[1] - a[1])[0][1] > 0 ? opciones[0][0] : ',';
}

// Devuelve filas de celdas. Respeta comillas dobles ("a;b", "dice ""hola""") y saltos de línea dentro de comillas.
export function leerTabla(texto) {
  const t = String(texto ?? '').replace(/^﻿/, '');
  const sep = detectarSeparador(t.split(/\r?\n/).find((l) => l.trim()) || '');
  const filas = [];
  let fila = [], celda = '', comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"') { if (t[i + 1] === '"') { celda += '"'; i++; } else comillas = false; }
      else celda += c;
    } else if (c === '"' && celda === '') comillas = true;
    else if (c === sep) { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda); celda = '';
      if (fila.some((x) => x.trim() !== '')) filas.push(fila);
      fila = [];
    } else celda += c;
  }
  fila.push(celda);
  if (fila.some((x) => x.trim() !== '')) filas.push(fila);
  return filas.map((f) => f.map((x) => x.trim()));
}

// Convierte "$ 1.200", "1.200,50", "1,200.50", "1200" o "12,5" en número; devuelve null si no es un número.
export function leerNumero(valor) {
  let s = String(valor ?? '').replace(/[$\s]/g, '').replace(/^\+/, '');
  if (s === '') return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const puntos = (s.match(/\./g) || []).length, comas = (s.match(/,/g) || []).length;
  if (puntos && comas) {
    // el último separador es el decimal
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    s = dec === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (comas) {
    s = comas === 1 && !/^-?\d{1,3},\d{3}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, ''); // 1,200 = mil doscientos; 12,5 = 12.5
  } else if (puntos) {
    // 1.200 y 1.200.000 son miles (formato colombiano); 12.5 es decimal
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

// Arma objetos a partir de la primera fila (encabezados), usando alias por columna.
// alias: { campo: ['nombre', 'producto', ...] } con los nombres ya normalizados.
export function leerObjetos(texto, alias) {
  const filas = leerTabla(texto);
  if (filas.length < 1) return { encabezados: [], filas: [], faltan: Object.keys(alias) };
  const enc = filas[0].map(normalizar);
  const indice = {};
  for (const [campo, nombres] of Object.entries(alias)) {
    const i = enc.findIndex((h) => nombres.includes(h));
    if (i >= 0) indice[campo] = i;
  }
  const objetos = filas.slice(1).map((f, k) => {
    const o = { _linea: k + 2 };
    for (const [campo, i] of Object.entries(indice)) o[campo] = (f[i] ?? '').trim();
    return o;
  });
  return { encabezados: enc, filas: objetos, indice };
}
