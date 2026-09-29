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
  doc.rect(L, y, W, 18).fill('#eee').fillColor('#000');
  doc.font('Helvetica-Bold').fontSize(9)
    .text('Cant.', cols[0], y + 5).text('Descripción', cols[1], y + 5)
    .text('Precio', cols[2], y + 5, { width: 70, align: 'right' }).text('Total', cols[3], y + 5, { width: 90, align: 'right' });
  y += 22;
  doc.font('Helvetica').fontSize(9);
  for (const i of r.items) {
    if (y > 660) { doc.addPage(); y = 40; }
    doc.text(qty(i.cantidad), cols[0], y).text(i.descripcion, cols[1], y, { width: 285 })
      .text(money(i.precio), cols[2], y, { width: 70, align: 'right' }).text(money(i.cantidad * i.precio), cols[3], y, { width: 90, align: 'right' });
    y += 16;
    doc.moveTo(L, y - 3).lineTo(L + W, y - 3).strokeColor('#eee').stroke();
  }

  y += 8;
  const fila = (label, valor, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5)
      .text(label, L + 330, y, { width: 100, align: 'right' }).text(valor, L + 430, y, { width: 90, align: 'right' });
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
