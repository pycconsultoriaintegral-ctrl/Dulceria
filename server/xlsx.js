// Generador mínimo de libros de Excel (.xlsx) sin dependencias: varias hojas, título, encabezado fijo con filtro,
// formatos de moneda, enteros, decimales y porcentaje, y fila de totales con fórmulas.
// Un .xlsx es un ZIP de archivos XML (Office Open XML); el ZIP se arma aquí con zlib.
import zlib from 'node:zlib';

// ---------- ZIP ----------
const TABLA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function zip(archivos) {
  const locales = [], centrales = [];
  let offset = 0;
  for (const { nombre, datos } of archivos) {
    const nom = Buffer.from(nombre, 'utf8');
    const crudo = Buffer.isBuffer(datos) ? datos : Buffer.from(datos, 'utf8');
    const comp = zlib.deflateRawSync(crudo);
    const crc = crc32(crudo);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x0800, 6); l.writeUInt16LE(8, 8);
    l.writeUInt16LE(0, 10); l.writeUInt16LE(0x21, 12); // hora/fecha fijas (1980-01-01)
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(crudo.length, 22); l.writeUInt16LE(nom.length, 26); l.writeUInt16LE(0, 28);
    locales.push(l, nom, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(crudo.length, 24);
    c.writeUInt16LE(nom.length, 28); c.writeUInt32LE(offset, 42);
    centrales.push(c, nom);
    offset += 30 + nom.length + comp.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, dir, fin]);
}

// ---------- Hojas ----------
// Estilos (índices en cellXfs de styles.xml)
const E = { texto: 0, encabezado: 1, moneda: 2, entero: 3, numero: 4, porcentaje: 5, titulo: 6, subtitulo: 7, totalTexto: 8, totalMoneda: 9, totalEntero: 10, totalNumero: 11, totalPorcentaje: 12, fecha: 13 };
const TOTAL = { moneda: E.totalMoneda, entero: E.totalEntero, numero: E.totalNumero, porcentaje: E.totalPorcentaje };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="&quot;$&quot;\\ #,##0"/><numFmt numFmtId="165" formatCode="#,##0.00"/><numFmt numFmtId="166" formatCode="0.0%"/><numFmt numFmtId="167" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FF0B1F4D"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF5B6B8A"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0B1F4D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9EEF8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF0B1F4D"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="4" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="4" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="4" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// Texto seguro para XML (sin caracteres de control que Excel rechaza)
const xml = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const columna = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
// Fecha "YYYY-MM-DD" -> número de serie de Excel
const serie = (f) => (Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;

function celda(ref, valor, tipo, estilo) {
  if (valor === null || valor === undefined || valor === '') return `<c r="${ref}" s="${estilo}"/>`;
  if (tipo === 'fecha' && /^\d{4}-\d{2}-\d{2}/.test(String(valor))) return `<c r="${ref}" s="${estilo}"><v>${serie(String(valor))}</v></c>`;
  if (tipo !== 'texto' && tipo !== 'fecha' && typeof valor === 'number' && Number.isFinite(valor)) return `<c r="${ref}" s="${estilo}"><v>${valor}</v></c>`;
  return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${xml(valor)}</t></is></c>`;
}

// fila del encabezado: después del título y el subtítulo, con una fila en blanco
const filaEncabezado = (h) => (h.titulo || h.subtitulo ? (h.titulo ? 1 : 0) + (h.subtitulo ? 1 : 0) + 2 : 1);

// hoja: { nombre, titulo, subtitulo, columnas: [{ titulo, tipo, ancho, total }], filas: [[...]] }
// total de una columna: 'suma' (fórmula SUM) o una función (filas) => valor (ej. un porcentaje ponderado)
function hojaXml(h) {
  const cols = h.columnas;
  const filas = [];
  let r = 1;
  if (h.titulo) filas.push(`<row r="${r}" ht="22" customHeight="1">${celda(`A${r++}`, h.titulo, 'texto', E.titulo)}</row>`);
  if (h.subtitulo) filas.push(`<row r="${r}">${celda(`A${r++}`, h.subtitulo, 'texto', E.subtitulo)}</row>`);
  if (h.titulo || h.subtitulo) r++;
  const filaEnc = filaEncabezado(h);
  filas.push(`<row r="${r}" ht="30" customHeight="1">${cols.map((c, i) => celda(`${columna(i)}${r}`, c.titulo, 'texto', E.encabezado)).join('')}</row>`);
  r++;
  const primera = r;
  for (const f of h.filas) {
    filas.push(`<row r="${r}">${cols.map((c, i) => celda(`${columna(i)}${r}`, f[i], c.tipo || 'texto', E[c.tipo] ?? E.texto)).join('')}</row>`);
    r++;
  }
  if (!h.filas.length && h.vacio) { filas.push(`<row r="${r}">${celda(`A${r}`, h.vacio, 'texto', E.subtitulo)}</row>`); r++; }
  const ultima = h.filas.length ? r - 1 : filaEnc;
  if (h.filas.length && cols.some((c) => c.total)) {
    filas.push(`<row r="${r}">${cols.map((c, i) => {
      const ref = `${columna(i)}${r}`;
      if (i === 0) return celda(ref, 'TOTAL', 'texto', E.totalTexto);
      const est = TOTAL[c.tipo] ?? E.totalTexto;
      if (c.total === 'suma') {
        const v = h.filas.reduce((a, f) => a + (Number(f[i]) || 0), 0);
        return `<c r="${ref}" s="${est}"><f>SUM(${columna(i)}${primera}:${columna(i)}${ultima})</f><v>${Math.round(v * 100) / 100}</v></c>`;
      }
      if (typeof c.total === 'function') { const v = c.total(h.filas); return celda(ref, v, c.tipo, est); }
      return `<c r="${ref}" s="${E.totalTexto}"/>`;
    }).join('')}</row>`);
  }
  const anchos = cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho || 14}" customWidth="1"/>`).join('');
  const fin = columna(cols.length - 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${filaEnc}" topLeftCell="A${filaEnc + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/><cols>${anchos}</cols>
<sheetData>${filas.join('')}</sheetData>
${h.filas.length ? `<autoFilter ref="A${filaEnc}:${fin}${ultima}"/>` : ''}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

// Nombre de hoja válido: máx. 31 caracteres, sin : \ / ? * [ ] y sin repetir
function nombresDeHoja(hojas) {
  const usados = new Set();
  return hojas.map((h, i) => {
    let n = String(h.nombre || `Hoja ${i + 1}`).replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || `Hoja ${i + 1}`;
    let k = 2;
    while (usados.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${k++}`;
    usados.add(n.toLowerCase());
    return n;
  });
}

export function libro(hojas) {
  const nombres = nombresDeHoja(hojas);
  const archivos = [
    { nombre: '[Content_Types].xml', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { nombre: '_rels/.rels', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nombre: 'xl/workbook.xml', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
${nombres.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames>${hojas.map((h, i) => (h.filas.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(nombres[i]).replace(/'/g, "''")}'!$A$${filaEncabezado(h)}:$${columna(h.columnas.length - 1)}$${filaEncabezado(h) + h.filas.length}</definedName>` : '')).join('')}</definedNames></workbook>` },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nombre: 'xl/styles.xml', datos: STYLES },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, datos: hojaXml(h) })),
  ];
  return zip(archivos);
}

export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
