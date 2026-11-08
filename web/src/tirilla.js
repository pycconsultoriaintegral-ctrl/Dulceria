// Tirilla para impresora térmica (ESC/POS), 58 mm (32 columnas) u 80 mm (48 columnas).
// Se arma en el propio celular a partir de la remisión, así que también sirve sin señal.
// No usa nada del navegador: se puede probar en Node.

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

// Página de códigos PC850 (ESC t 2): la que traen casi todas las impresoras térmicas chinas y que imprime tildes y eñes
const CP850 = {
  'á': 0xa0, 'é': 0x82, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ü': 0x81, 'Ü': 0x9a,
  'Á': 0xb5, 'É': 0x90, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9, '¿': 0xa8, '¡': 0xad, '°': 0xf8, '·': 0xfa,
};
const SIN_TILDE = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ñ': 'n', 'Ñ': 'N', 'ü': 'u', 'Ü': 'U', 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', '¿': '?', '¡': '!', '°': 'o', '·': '-' };

export const columnas = (papel) => (String(papel) === '80' ? 48 : 32);
export const pesos = (v) => '$' + Math.round(Number(v) || 0).toLocaleString('es-CO').replace(/,/g, '.');
const cant = (v) => (Number.isInteger(+v) ? String(+v) : (+v).toFixed(2).replace('.', ','));

// Texto a bytes en PC850 (o sin tildes si la impresora no la soporta); lo desconocido sale como '?'
export function codificar(texto, { tildes = true } = {}) {
  const out = [];
  for (const ch of String(texto ?? '').normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c < 0x7f) out.push(c);
    else if (ch === '\n') out.push(LF);
    else if (tildes && CP850[ch] !== undefined) out.push(CP850[ch]);
    else if (SIN_TILDE[ch]) out.push(SIN_TILDE[ch].charCodeAt(0));
    else if (ch === ' ' || ch === ' ') out.push(0x20);
    else out.push(0x3f);
  }
  return out;
}

// Parte un texto en renglones de "ancho" columnas sin cortar palabras (salvo las que no caben)
export function partir(texto, ancho) {
  const lineas = [];
  for (const parrafo of String(texto ?? '').split('\n')) {
    let actual = '';
    for (let palabra of parrafo.split(/\s+/).filter(Boolean)) {
      while (palabra.length > ancho) { if (actual) { lineas.push(actual); actual = ''; } lineas.push(palabra.slice(0, ancho)); palabra = palabra.slice(ancho); }
      if (!palabra) continue;
      if (!actual) actual = palabra;
      else if (actual.length + 1 + palabra.length <= ancho) actual += ' ' + palabra;
      else { lineas.push(actual); actual = palabra; }
    }
    lineas.push(actual);
  }
  return lineas;
}

// "Subtotal:" a la izquierda y "$53.500" a la derecha en el mismo renglón
export const par = (izq, der, ancho) => {
  const d = String(der);
  const i = String(izq).slice(0, Math.max(0, ancho - d.length - 1));
  return i + ' '.repeat(Math.max(1, ancho - i.length - d.length)) + d;
};

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
// "2026-11-08 10:42:05" -> "08/Nov/2026 10:42"
export const fechaCorta = (f) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(f || ''));
  return m ? `${m[3]}/${MESES[Number(m[2]) - 1]}/${m[1]} ${m[4]}:${m[5]}` : String(f || '');
};

const METODO = { efectivo: 'Efectivo', transferencia: 'Transferencia' };

// Renglones de la tirilla: [{ t: texto, a: 'c'|'i'|'d', b: negrita, g: grande }]
export function renglones(r, cfg = {}, opciones = {}) {
  const W = columnas(opciones.papel ?? cfg.papel);
  const out = [];
  const add = (t, x = {}) => out.push({ t, ...x });
  const linea = () => add('-'.repeat(W));
  const centrado = (t, x = {}) => partir(t, x.g ? Math.floor(W / 2) : W).forEach((l) => add(l, { a: 'c', ...x }));

  centrado(cfg.negocio || 'Remisión', { b: true, g: true });
  if (cfg.nit) centrado(`NIT: ${cfg.nit}`);
  if (cfg.direccion) centrado(cfg.direccion);
  if (cfg.telefono) centrado(`Tel: ${cfg.telefono}`);
  linea();
  centrado('REMISIÓN', { b: true });
  if (r.consecutivo) centrado(`No. ${cfg.prefijo || 'R'}-${String(r.consecutivo).padStart(6, '0')}`, { b: true });
  else centrado(`Provisional ${r.provisional || ''}`, { b: true });
  if (r.anulada === 1) centrado('*** ANULADA ***', { b: true, g: true });
  if (r.pendiente) { centrado('*** PENDIENTE DE PAGO ***', { b: true }); centrado('NO VÁLIDA - No entregar hasta aprobar el pago'); }
  if (!r.consecutivo) centrado('Sin señal: el número definitivo se asigna al sincronizar');
  add(`Fecha: ${fechaCorta(r.fecha)}`);
  if (r.vendedor) partir(`Vendedor: ${r.vendedor}`, W).forEach((l) => add(l));
  if (r.punto) partir(r.punto, W).forEach((l) => add(l));
  partir(`Cliente: ${r.cliente}${r.negocio ? ' - ' + r.negocio : ''}`, W).forEach((l) => add(l));
  if (r.cliente_documento) add(`Nit/Cc: ${r.cliente_documento}`);
  if (r.telefono) add(`Tel: ${r.telefono}`);
  if (r.cliente_direccion) partir(`Dir: ${r.cliente_direccion}`, W).forEach((l) => add(l));
  linea();

  // columnas: precio | cant | subtotal, con la descripción en su propio renglón
  const wc = W >= 48 ? 8 : 5, wp = W >= 48 ? 14 : 11, ws = W - wc - wp;
  add(`${'Precio'.padStart(wp)}${'Cant'.padStart(wc)}${'Subtotal'.padStart(ws)}`, { b: true });
  linea();
  for (const i of r.items || []) {
    partir(i.descripcion, W).forEach((l) => add(l));
    add(`${pesos(i.precio).padStart(wp)}${cant(i.cantidad).padStart(wc)}${pesos(i.cantidad * i.precio).padStart(ws)}`);
  }
  linea();
  add(par('Subtotal:', pesos(r.subtotal), W));
  if (r.descuento > 0) add(par('Descuento:', '-' + pesos(r.descuento), W));
  add(par('TOTAL', pesos(r.total), Math.floor(W / 2)), { b: true, g: true });
  linea();

  if (!r.anulada && !r.pendiente) {
    add('Forma de pago', { b: true });
    const pagos = (r.pagos || []).filter((p) => p.valor > 0);
    if (r.tipo_pago === 'credito') add(par('Crédito', pesos(r.total), W));
    for (const p of pagos) add(par(METODO[p.metodo] || p.metodo, pesos(p.valor), W));
    if (!pagos.length && r.tipo_pago === 'contado') add(par(METODO[r.metodo] || 'Contado', pesos(r.total), W));
    add(par('Total pagado:', pesos(r.pagado), W));
    if (r.saldo > 0.5) add(par('Saldo remisión:', pesos(r.saldo), W), { b: true });
    if (r.saldo_cliente > 0.5) add(par('Saldo total cliente:', pesos(r.saldo_cliente), W));
  } else if (r.pendiente) {
    add('Pago anticipado por transferencia', { b: true });
    add('Pendiente de aprobación');
  }
  if (r.nota) { add(''); partir(`Nota: ${r.nota}`, W).forEach((l) => add(l)); }
  if (r.pendiente) { add(''); centrado('*** NO VÁLIDA HASTA APROBAR EL PAGO ***', { b: true }); }
  add('');
  add('');
  add('Recibido: ' + '_'.repeat(Math.max(4, W - 10)));
  if (cfg.pie_remision) { add(''); centrado(cfg.pie_remision); }
  return { ancho: W, renglones: out };
}

// Comandos ESC/POS listos para enviar a la impresora
export function escpos(r, cfg = {}, opciones = {}) {
  const tildes = opciones.tildes !== false;
  const { renglones: rs } = renglones(r, cfg, opciones);
  const b = [ESC, 0x40]; // reiniciar
  if (tildes) b.push(ESC, 0x74, 2); // página de códigos PC850
  let alin = -1, negrita = -1, grande = -1;
  for (const x of rs) {
    const a = x.a === 'c' ? 1 : x.a === 'd' ? 2 : 0;
    if (a !== alin) { b.push(ESC, 0x61, a); alin = a; }
    const n = x.b ? 1 : 0;
    if (n !== negrita) { b.push(ESC, 0x45, n); negrita = n; }
    const g = x.g ? 0x11 : 0x00; // doble alto y doble ancho
    if (g !== grande) { b.push(GS, 0x21, g); grande = g; }
    b.push(...codificar(x.t, { tildes }), LF);
  }
  b.push(ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0);
  b.push(ESC, 0x64, 4); // avanzar papel para poder cortar a mano
  b.push(GS, 0x56, 0x42, 0); // corte (las impresoras sin cuchilla lo ignoran)
  return Uint8Array.from(b);
}

// Vista previa en texto plano (la misma tirilla, para mostrarla en pantalla)
export function textoPlano(r, cfg = {}, opciones = {}) {
  const { ancho, renglones: rs } = renglones(r, cfg, opciones);
  return rs.map((x) => {
    if (x.a !== 'c') return x.t;
    const w = x.g ? Math.floor(ancho / 2) : ancho;
    return ' '.repeat(Math.max(0, Math.floor((w - x.t.length) / 2))) + x.t;
  }).join('\n');
}

// Base64 de los bytes (para RawBT en Android)
export function aBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64');
}

// Remisión de prueba (botón "Imprimir prueba")
export const ahoraLocal = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'medium' }).format(d);
export const remisionDePrueba = (usuario = 'Vendedor') => ({
  consecutivo: 1, fecha: ahoraLocal(), vendedor: usuario, punto: 'Prueba de impresión',
  cliente: 'Cliente de prueba', cliente_documento: '222222222', tipo_pago: 'contado', subtotal: 53500, descuento: 0, total: 53500, pagado: 53500, saldo: 0,
  pagos: [{ metodo: 'efectivo', valor: 53500 }],
  items: [{ descripcion: 'MANTECADAS X 14', cantidad: 1, precio: 16000 }, { descripcion: 'Relleno x 20', cantidad: 2, precio: 13000 }, { descripcion: 'ROLLO X 10', cantidad: 1, precio: 11500 }],
  nota: 'Prueba de tildes: Ñandú, acción, ¿sí? ¡Listo!',
});
