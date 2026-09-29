import PDFDocument from 'pdfkit';

const money = (v) => '$' + Math.round(v).toLocaleString('es-CO');
const qty = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

export function remisionPdf(r, cfg) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  const L = 40, W = 532;
  doc.font('Helvetica-Bold').fontSize(18).text(cfg.negocio, L, 40);
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  if (cfg.nit) doc.text(`NIT/CC: ${cfg.nit}`);
  if (cfg.direccion) doc.text(cfg.direccion);
  if (cfg.telefono) doc.text(`Tel: ${cfg.telefono}`);
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(15).text('REMISIÓN', L, 40, { width: W, align: 'right' });
  doc.fontSize(13).text(`No. ${cfg.prefijo || 'R'}-${String(r.consecutivo).padStart(6, '0')}`, L, 60, { width: W, align: 'right' });
  doc.font('Helvetica').fontSize(9).text(`Fecha: ${r.fecha.slice(0, 16)}`, L, 80, { width: W, align: 'right' });
  if (r.anulada) doc.font('Helvetica-Bold').fillColor('#c00').fontSize(14).text('ANULADA', L, 96, { width: W, align: 'right' }).fillColor('#000');

  let y = 120;
  doc.rect(L, y, W, 58).strokeColor('#bbb').stroke();
  doc.font('Helvetica-Bold').fontSize(9).text('Cliente:', L + 8, y + 8).font('Helvetica').text(`${r.cliente}${r.negocio ? ' - ' + r.negocio : ''}`, L + 60, y + 8);
  doc.font('Helvetica-Bold').text('Dirección:', L + 8, y + 22).font('Helvetica').text(r.cliente_direccion || '-', L + 60, y + 22);
  doc.font('Helvetica-Bold').text('Teléfono:', L + 8, y + 36).font('Helvetica').text(r.telefono || '-', L + 60, y + 36);
  doc.font('Helvetica-Bold').text('Vendedor:', L + 300, y + 8).font('Helvetica').text(r.vendedor, L + 355, y + 8);
  doc.font('Helvetica-Bold').text('Ruta:', L + 300, y + 22).font('Helvetica').text(r.ruta || 'Mostrador', L + 355, y + 22);
  doc.font('Helvetica-Bold').text('Pago:', L + 300, y + 36).font('Helvetica').text(r.tipo_pago === 'contado' ? 'Contado' : 'Crédito', L + 355, y + 36);

  y += 72;
  const cols = [L + 6, L + 60, L + 350, L + 430];
  const encabezado = () => {
    doc.rect(L, y, W, 18).fill('#eee').fillColor('#000');
    doc.font('Helvetica-Bold').fontSize(9)
      .text('Cant.', cols[0], y + 5).text('Descripción', cols[1], y + 5)
      .text('Precio', cols[2], y + 5, { width: 70, align: 'right' }).text('Total', cols[3], y + 5, { width: 90, align: 'right' });
    y += 22;
  };
  encabezado();
  doc.font('Helvetica').fontSize(9);
  for (const i of r.items) {
    // la descripción puede ocupar varias líneas: la fila crece en consecuencia
    const alto = Math.max(16, doc.heightOfString(i.descripcion, { width: 280 }) + 6);
    if (y + alto > 660) { doc.addPage(); y = 40; encabezado(); doc.font('Helvetica').fontSize(9); }
    doc.text(qty(i.cantidad), cols[0], y).text(i.descripcion, cols[1], y, { width: 280 })
      .text(money(i.precio), cols[2], y, { width: 70, align: 'right' }).text(money(i.cantidad * i.precio), cols[3], y, { width: 90, align: 'right' });
    y += alto;
    doc.moveTo(L, y - 3).lineTo(L + W, y - 3).strokeColor('#eee').stroke();
  }

  y += 8;
  const fila = (label, valor, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5)
      .text(label, L + 230, y, { width: 190, align: 'right' }).text(valor, L + 430, y, { width: 90, align: 'right' });
    y += bold ? 18 : 15;
  };
  fila('Subtotal:', money(r.subtotal));
  if (r.descuento > 0) fila('Descuento:', '-' + money(r.descuento));
  fila('TOTAL:', money(r.total), true);
  fila('Pagado:', money(r.pagado));
  if (r.saldo > 0) fila('Saldo de esta remisión:', money(r.saldo), true);
  if (r.saldo_cliente > 0) fila('Saldo total del cliente:', money(r.saldo_cliente));
  if (r.nota) { y += 6; doc.font('Helvetica-Oblique').fontSize(9).text(`Nota: ${r.nota}`, L, y, { width: 300 }); }

  y = Math.max(y + 40, 600);
  if (y > 700) { doc.addPage(); y = 100; }
  doc.moveTo(L, y).lineTo(L + 200, y).strokeColor('#000').stroke().moveTo(L + 300, y).lineTo(L + 500, y).stroke();
  doc.font('Helvetica').fontSize(8.5).text('Entregado por', L, y + 4, { width: 200, align: 'center' }).text('Recibido conforme (nombre y firma)', L + 300, y + 4, { width: 200, align: 'center' });
  doc.fontSize(8).fillColor('#666').text(cfg.pie_remision || '', L, y + 40, { width: W, align: 'center' });
  doc.end();
  return doc;
}

// ---------- Formato ticket (80 mm de ancho, una sola página de alto variable) ----------
// Se lee bien en el celular sin hacer zoom y sirve para impresoras térmicas.
const TW = 226.77; // 80 mm en puntos
const M = 10;
function dibujarTicket(doc, r, cfg) {
  const W = TW - M * 2;
  let y = M;
  const centro = (txt, font, size, color = '#000') => {
    doc.font(font).fontSize(size).fillColor(color).text(txt, M, y, { width: W, align: 'center' });
    y = doc.y + 2;
  };
  const linea = () => { y += 3; doc.moveTo(M, y).lineTo(M + W, y).dash(2, { space: 2 }).strokeColor('#000').stroke().undash(); y += 6; };
  const par = (a, b, bold = false, size = 9) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor('#000');
    doc.text(a, M, y, { width: W * 0.58 });
    const h1 = doc.y;
    doc.text(b, M + W * 0.58, y, { width: W * 0.42, align: 'right' });
    y = Math.max(h1, doc.y) + 2;
  };

  centro(cfg.negocio, 'Helvetica-Bold', 13);
  if (cfg.nit) centro(`NIT/CC: ${cfg.nit}`, 'Helvetica', 8, '#333');
  if (cfg.direccion) centro(cfg.direccion, 'Helvetica', 8, '#333');
  if (cfg.telefono) centro(`Tel: ${cfg.telefono}`, 'Helvetica', 8, '#333');
  linea();
  centro('REMISIÓN', 'Helvetica-Bold', 12);
  centro(`No. ${cfg.prefijo || 'R'}-${String(r.consecutivo).padStart(6, '0')}`, 'Helvetica-Bold', 11);
  if (r.anulada) centro('*** ANULADA ***', 'Helvetica-Bold', 12, '#c00');
  centro(r.fecha.slice(0, 16), 'Helvetica', 8.5);
  linea();
  const dato = (k, v) => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000').text(`${k}: `, M, y, { continued: true, width: W }).font('Helvetica').text(v || '-');
    y = doc.y + 1;
  };
  dato('Cliente', `${r.cliente}${r.negocio ? ' - ' + r.negocio : ''}`);
  if (r.cliente_direccion) dato('Dirección', r.cliente_direccion);
  if (r.telefono) dato('Teléfono', r.telefono);
  dato('Vendedor', r.vendedor);
  dato('Ruta', r.ruta || 'Mostrador');
  dato('Pago', r.tipo_pago === 'contado' ? 'Contado' : 'Crédito');
  linea();
  for (const i of r.items) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text(i.descripcion, M, y, { width: W });
    y = doc.y;
    par(`${qty(i.cantidad)} x ${money(i.precio)}`, money(i.cantidad * i.precio), false, 9);
    y += 2;
  }
  linea();
  par('Subtotal', money(r.subtotal));
  if (r.descuento > 0) par('Descuento', '-' + money(r.descuento));
  par('TOTAL', money(r.total), true, 12);
  par('Pagado', money(r.pagado));
  if (r.saldo > 0) par('Saldo remisión', money(r.saldo), true, 10);
  if (r.saldo_cliente > 0) par('Saldo total cliente', money(r.saldo_cliente));
  if (r.nota) { y += 4; doc.font('Helvetica-Oblique').fontSize(8.5).text(`Nota: ${r.nota}`, M, y, { width: W }); y = doc.y; }
  y += 28;
  doc.moveTo(M + 20, y).lineTo(M + W - 20, y).strokeColor('#000').stroke();
  y += 3;
  doc.font('Helvetica').fontSize(8).fillColor('#000').text('Recibido conforme (nombre y firma)', M, y, { width: W, align: 'center' });
  y = doc.y + 8;
  if (cfg.pie_remision) { doc.font('Helvetica').fontSize(7.5).fillColor('#555').text(cfg.pie_remision, M, y, { width: W, align: 'center' }); y = doc.y; }
  return y + M;
}

export function remisionTicket(r, cfg) {
  // 1.ª pasada: mide el alto en un documento desechable; 2.ª: documento real con ese alto
  const medidor = new PDFDocument({ size: [TW, 20000], margin: 0 });
  medidor.on('data', () => {});
  const alto = Math.ceil(dibujarTicket(medidor, r, cfg));
  medidor.end();
  const doc = new PDFDocument({ size: [TW, alto], margin: 0 });
  dibujarTicket(doc, r, cfg);
  doc.end();
  return doc;
}
