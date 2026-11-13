// Remisiones (ventas), abonos, cartera, gastos y cierre diario. El "punto" es una ruta ('R3') o el mostrador de una bodega ('B1').
import { Router } from 'express';
import { db, tx, ahora, HttpError, moverStock, getStock, getConfig, permiteSinStock } from '../db.js';
import { requierePermiso } from '../auth.js';
import { turnoAbierto } from './turnos.js';
import { remisionPdf, remisionTicket } from '../pdf.js';
import { wrap, n, num, r2, req_, entero, conPrefijo, coordenada } from '../util.js';
import { B, R, getRuta, resolverPunto, sqlAlcance, sqlPunto, exigir, can, puedeRuta, puedeBodega, puedeUb, parseUb } from '../scope.js';
import { puedeVerCliente } from './clientes.js';
import { presentacionDe, aBase, precioLista } from '../presentaciones.js';
import { auditar } from '../auditoria.js';
import { guardarSoporte, listarSoportes, MAX_POR_REMISION } from '../soportes.js';

const router = Router();
const METODOS = ['efectivo', 'transferencia'];
const metodoDe = (m) => { const x = String(m || 'efectivo').toLowerCase(); if (!METODOS.includes(x)) throw new HttpError(400, 'Método de pago inválido'); return x; };
export const ubDelPunto = (p) => (p.ruta_id ? R(p.ruta_id) : B(p.bodega_id));

// Comprueba que hay inventario para todas las líneas sin moverlo (las ventas pendientes de aprobación solo lo descuentan al aprobarse)
function verificarStock(items, ub) {
  if (permiteSinStock()) return; // mientras cargan el inventario se puede vender aunque aún no figure
  const necesario = new Map();
  for (const i of items) necesario.set(i.p.id, (necesario.get(i.p.id) ?? 0) + aBase(i.cantidad, i.pres));
  for (const [productoId, cant] of necesario) {
    const disponible = getStock(productoId, ub);
    if (disponible + 1e-9 < cant) throw new HttpError(409, `Inventario insuficiente de "${db.prepare('SELECT nombre FROM productos WHERE id=?').get(productoId).nombre}" (disponible ${disponible})`);
  }
}

// Ubicación enviada por el celular al vender (opcional: si el vendedor no da permiso, la venta sale igual)
const gpsDe = (b) => { const t = coordenada(b.lat, b.lng); return t ? [t.lat, t.lng, Number.isFinite(Number(b.gps_precision)) ? Math.round(Number(b.gps_precision)) : null] : [null, null, null]; };

// ---------- Remisiones ----------
router.post('/remisiones', requierePermiso('vender'), wrap((req, res) => {
  const b = req.body;
  if (b.uuid) {
    const ya = db.prepare('SELECT id, consecutivo FROM remisiones WHERE uuid=?').get(b.uuid);
    if (ya) return res.json({ ...ya, repetida: true });
  }
  if (getConfig().exigir_turno === '1' && !turnoAbierto(req.user.id)) throw new HttpError(409, 'Abre tu turno antes de vender (Más → Turno)');
  if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'Agrega al menos un producto');
  const punto = resolverPunto(req.user, b.punto);
  const metodo = metodoDe(b.metodo);
  const out = tx(() => {
    const cli = db.prepare('SELECT * FROM clientes WHERE id=? AND activo=1').get(b.cliente_id);
    puedeVerCliente(req.user, cli);
    let subtotal = 0;
    const items = b.items.map((i) => {
      const p = db.prepare('SELECT * FROM productos WHERE id=? AND activo=1').get(i.producto_id);
      if (!p) throw new HttpError(400, 'Producto no disponible');
      const cantidad = num(i.cantidad, 'Cantidad');
      if (cantidad <= 0) throw new HttpError(400, 'La cantidad debe ser mayor a cero');
      const pres = presentacionDe(p.id, i.presentacion_id);
      // el vendedor puede negociar el precio; queda registrado en la remisión junto al precio de lista para poder auditarlo
      const lista = precioLista(p, pres);
      const precio = i.precio === undefined ? lista : num(i.precio, 'Precio');
      if (precio < 0) throw new HttpError(400, 'Precio inválido');
      subtotal += cantidad * precio;
      return { p, pres, cantidad, precio, lista };
    });
    subtotal = r2(subtotal);
    const descuento = r2(num(b.descuento ?? 0, 'Descuento'));
    if (descuento < 0 || descuento > subtotal) throw new HttpError(400, 'Descuento inválido');
    const total = r2(subtotal - descuento);
    // Cliente que paga antes: la remisión queda pendiente hasta que el encargado o el administrador aprueben el soporte de pago.
    // Mientras tanto no mueve inventario ni cuenta como venta, y siempre es de contado.
    const exige = !!cli.paga_antes;
    const tipoPago = exige ? 'contado' : b.tipo_pago;
    if (!['contado', 'credito'].includes(tipoPago)) throw new HttpError(400, 'Tipo de pago inválido');
    const pagado = tipoPago === 'contado' ? total : r2(num(b.abono ?? 0, 'Abono'));
    if (pagado < 0 || pagado > total + 0.001) throw new HttpError(400, 'El abono no puede superar el total');
    if (exige && total <= 0) throw new HttpError(400, 'Una venta con pago anticipado debe tener un total mayor a cero');
    if (exige) verificarStock(items, ubDelPunto(punto));
    const cons = (db.prepare('SELECT MAX(consecutivo) AS m FROM remisiones').get().m ?? 0) + 1;
    const fecha = ahora();
    const id = Number(db.prepare(`INSERT INTO remisiones (uuid,consecutivo,fecha,cliente_id,ruta_id,bodega_id,usuario_id,tipo_pago,subtotal,descuento,total,pagado,nota,anulada,requiere_aprobacion,fecha_solicitud,lat,lng,gps_precision)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(n(b.uuid), cons, fecha, cli.id, punto.ruta_id, punto.bodega_id, req.user.id, tipoPago, subtotal, descuento, total, exige ? 0 : pagado, n(b.nota),
      exige ? 2 : 0, exige ? 1 : 0, exige ? fecha : null, ...gpsDe(b)).lastInsertRowid);
    for (const i of items) {
      // la línea se guarda tal como se vendió (2 cajas a $30.000); el inventario se descuenta en unidades base
      db.prepare('INSERT INTO remision_items (remision_id,producto_id,descripcion,cantidad,precio,costo,factor,presentacion,precio_lista) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, i.p.id, i.pres.id ? `${i.p.nombre} (${i.pres.nombre})` : i.p.nombre, i.cantidad, i.precio, i.p.costo * i.pres.factor, i.pres.factor, i.pres.nombre, i.lista);
      if (!exige) moverStock({ productoId: i.p.id, ubicacion: ubDelPunto(punto), delta: -aBase(i.cantidad, i.pres), tipo: 'venta', costo: i.p.costo, referencia: `R-${cons}`, usuarioId: req.user.id, permitirNegativo: permiteSinStock() });
    }
    if (!exige && pagado > 0) db.prepare('INSERT INTO pagos (fecha,cliente_id,remision_id,ruta_id,bodega_id,usuario_id,valor,metodo) VALUES (?,?,?,?,?,?,?,?)')
      .run(fecha, cli.id, id, punto.ruta_id, punto.bodega_id, req.user.id, pagado, metodo);
    // fotos del comprobante enviadas junto con la venta (también sirven en ventas normales por transferencia)
    for (const foto of (Array.isArray(b.soportes) ? b.soportes : []).slice(0, MAX_POR_REMISION)) guardarSoporte(id, foto, req.user);
    if (exige) auditar(req.user, 'venta con pago anticipado', 'remision', id, `R-${cons} · ${cli.nombre} · $${total} · pendiente de aprobación`);
    return { id, consecutivo: cons, total, pendiente: exige };
  });
  res.json(out);
}));

router.get('/remisiones', wrap((req, res) => {
  const q = req.query;
  const cond = ['substr(r.fecha,1,10) BETWEEN @desde AND @hasta', sqlAlcance(req.user, 'r', { punto: q.punto, ruta_id: q.ruta_id, bodega_id: q.bodega_id })];
  const p = { desde: q.desde || '0000-01-01', hasta: q.hasta || '9999-12-31' };
  if (q.cliente_id) { cond.push('r.cliente_id=@cli'); p.cli = Number(q.cliente_id); }
  res.json(db.prepare(`SELECT r.*, c.nombre AS cliente, c.negocio, u.nombre AS vendedor, ru.nombre AS ruta, b.nombre AS bodega FROM remisiones r
    JOIN clientes c ON c.id=r.cliente_id JOIN usuarios u ON u.id=r.usuario_id JOIN bodegas b ON b.id=r.bodega_id LEFT JOIN rutas ru ON ru.id=r.ruta_id
    WHERE ${cond.join(' AND ')} ORDER BY r.id DESC LIMIT 300`).all(p));
}));

export function cargarRemision(u, id) {
  const r = db.prepare(`SELECT r.*, c.nombre AS cliente, c.negocio, c.telefono, c.direccion AS cliente_direccion, c.documento AS cliente_documento,
    us.nombre AS vendedor, ru.nombre AS ruta, b.nombre AS bodega, (SELECT nombre FROM usuarios WHERE id=r.aprobado_por) AS aprobador FROM remisiones r JOIN clientes c ON c.id=r.cliente_id JOIN usuarios us ON us.id=r.usuario_id
    JOIN bodegas b ON b.id=r.bodega_id LEFT JOIN rutas ru ON ru.id=r.ruta_id WHERE r.id=?`).get(id);
  if (!r) throw new HttpError(404, 'Remisión no encontrada');
  if (u.alcance === 'ruta' && r.ruta_id !== u.ruta_id) throw new HttpError(403, 'No puedes ver remisiones de otra ruta');
  if (u.alcance === 'bodega' && r.bodega_id !== u.bodega_id) throw new HttpError(403, 'No puedes ver remisiones de otra bodega');
  r.punto = r.ruta ? conPrefijo('Ruta', r.ruta) : `Mostrador ${r.bodega}`;
  r.items = db.prepare('SELECT * FROM remision_items WHERE remision_id=?').all(id);
  r.pendiente = r.anulada === 2;
  r.pagos = db.prepare('SELECT metodo, SUM(valor) AS valor FROM pagos WHERE remision_id=? AND anulado=0 GROUP BY metodo ORDER BY metodo').all(id);
  r.rechazada = r.anulada === 1 && !!r.requiere_aprobacion && !!r.aprobado_por;
  r.soportes = listarSoportes(id);
  if (u.alcance === 'ruta') for (const s of r.soportes) s.repetido_en = [];
  r.saldo = r.anulada ? 0 : r2(r.total - r.pagado);
  r.saldo_cliente = db.prepare('SELECT COALESCE(SUM(total-pagado),0) AS s FROM remisiones WHERE cliente_id=? AND anulada=0').get(r.cliente_id).s;
  if (!can(u, 'ver_costos')) for (const i of r.items) delete i.costo;
  return r;
}
router.get('/remisiones/:id', wrap((req, res) => res.json(cargarRemision(req.user, entero(req.params.id)))));
router.get('/remisiones/:id/pdf', wrap((req, res) => {
  const r = cargarRemision(req.user, entero(req.params.id));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="remision-${r.consecutivo}.pdf"`);
  // ?formato=carta para hoja completa; por defecto ticket angosto de 80 mm (?papel=58 para rollos de 58 mm)
  (req.query.formato === 'carta' ? remisionPdf(r, getConfig()) : remisionTicket(r, getConfig(), { papel: req.query.papel })).pipe(res);
}));
router.post('/remisiones/:id/anular', wrap((req, res) => {
  tx(() => {
    const r = cargarRemision(req.user, entero(req.params.id));
    if (r.anulada === 1) throw new HttpError(409, 'La remisión ya está anulada');
    if (!can(req.user, 'anular_remisiones') && (r.usuario_id !== req.user.id || r.fecha.slice(0, 10) !== ahora().slice(0, 10)))
      throw new HttpError(403, 'Solo puedes anular tus remisiones del día. Pide ayuda al encargado de tu bodega o al administrador.');
    const motivo = req_(req.body.motivo, 'Indica el motivo de la anulación');
    // una remisión pendiente de aprobación nunca movió inventario ni recibió pagos: no hay nada que devolver
    if (!r.pendiente) for (const i of db.prepare('SELECT * FROM remision_items WHERE remision_id=?').all(r.id))
      moverStock({ productoId: i.producto_id, ubicacion: ubDelPunto(r), delta: aBase(i.cantidad, { factor: i.factor }), tipo: 'anulacion_venta', costo: i.costo / i.factor, referencia: `R-${r.consecutivo}`, usuarioId: req.user.id, permitirNegativo: true });
    db.prepare('UPDATE remisiones SET anulada=1, motivo_anulacion=? WHERE id=?').run(motivo, r.id);
    db.prepare('UPDATE pagos SET anulado=1 WHERE remision_id=?').run(r.id);
    auditar(req.user, 'anular', 'remision', r.id, `R-${r.consecutivo} · ${r.cliente} · $${r.total} · ${motivo}`);
  });
  res.json({ ok: true });
}));

// ---------- Cartera y abonos ----------
router.get('/cartera', wrap((req, res) => {
  const q = req.query;
  const alcance = sqlAlcance(req.user, 'r', { punto: q.punto, ruta_id: q.ruta_id, bodega_id: q.bodega_id });
  const rows = db.prepare(`SELECT c.id, c.nombre, c.negocio, c.telefono, c.ruta_id, SUM(r.total-r.pagado) AS saldo, MIN(r.fecha) AS mas_antigua
    FROM clientes c JOIN remisiones r ON r.cliente_id=c.id AND r.anulada=0 WHERE ${alcance}
    GROUP BY c.id HAVING saldo > 0.005 ORDER BY saldo DESC`).all();
  res.json({ total: r2(rows.reduce((a, x) => a + x.saldo, 0)), clientes: rows });
}));

// Abono a cliente: se aplica a las remisiones a crédito más antiguas (dentro del alcance del usuario)
router.post('/pagos', requierePermiso('vender'), wrap((req, res) => {
  const b = req.body;
  if (b.uuid) {
    const ya = db.prepare('SELECT 1 FROM pagos WHERE uuid=? OR uuid LIKE ?').get(b.uuid, `${b.uuid}:%`);
    if (ya) return res.json({ ok: true, repetido: true });
  }
  const valor = num(b.valor);
  if (valor <= 0) throw new HttpError(400, 'El valor debe ser mayor a cero');
  const punto = resolverPunto(req.user, b.punto);
  const metodo = metodoDe(b.metodo);
  const aplicado = tx(() => {
    const cli = db.prepare('SELECT * FROM clientes WHERE id=?').get(b.cliente_id);
    puedeVerCliente(req.user, cli);
    const alcance = sqlAlcance(req.user, 'r');
    const pend = db.prepare(`SELECT r.id, r.total-r.pagado AS deuda FROM remisiones r WHERE r.cliente_id=? AND r.anulada=0 AND r.total-r.pagado>0.005 AND ${alcance} ORDER BY r.id`).all(cli.id);
    const deudaTotal = pend.reduce((a, x) => a + x.deuda, 0);
    if (valor > deudaTotal + 0.005) throw new HttpError(400, `El abono ($${valor}) supera la deuda del cliente ($${r2(deudaTotal)})`);
    let resto = valor, k = 0;
    const fecha = ahora();
    for (const r of pend) {
      if (resto <= 0.005) break;
      const parte = r2(Math.min(resto, r.deuda));
      db.prepare('UPDATE remisiones SET pagado=pagado+? WHERE id=?').run(parte, r.id);
      db.prepare('INSERT INTO pagos (uuid,fecha,cliente_id,remision_id,ruta_id,bodega_id,usuario_id,valor,metodo,nota) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(b.uuid ? `${b.uuid}:${k++}` : null, fecha, cli.id, r.id, punto.ruta_id, punto.bodega_id, req.user.id, parte, metodo, n(b.nota));
      resto = r2(resto - parte);
    }
    return valor;
  });
  res.json({ ok: true, aplicado });
}));

// ---------- Gastos ----------
router.post('/gastos', requierePermiso('vender'), wrap((req, res) => {
  const punto = resolverPunto(req.user, req.body.punto);
  const valor = num(req.body.valor);
  if (valor <= 0) throw new HttpError(400, 'El valor debe ser mayor a cero');
  const id = db.prepare('INSERT INTO gastos (fecha,ruta_id,bodega_id,usuario_id,concepto,valor) VALUES (?,?,?,?,?,?)')
    .run(ahora(), punto.ruta_id, punto.bodega_id, req.user.id, req_(req.body.concepto, 'Indica el concepto'), valor).lastInsertRowid;
  res.json({ id: Number(id) });
}));

// ---------- Cierre diario por punto (ruta o mostrador de bodega) ----------
export function calcularCierre(fecha, punto) {
  const cp = (a) => sqlPunto(a, punto);
  const ventas = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total, COALESCE(SUM(CASE WHEN tipo_pago='contado' THEN total ELSE 0 END),0) AS contado,
    COALESCE(SUM(CASE WHEN tipo_pago='credito' THEN total ELSE 0 END),0) AS credito
    FROM remisiones r WHERE r.anulada=0 AND ${cp('r')} AND substr(r.fecha,1,10)=?`).get(fecha);
  // Dinero recibido ese día (ventas de contado + abonos + abonos iniciales), separado por método de pago.
  // Solo el efectivo se entrega en el cierre; las transferencias ya están en la cuenta del negocio.
  const cobro = db.prepare(`SELECT COALESCE(SUM(CASE WHEN metodo='efectivo' THEN valor END),0) AS efectivo,
    COALESCE(SUM(CASE WHEN metodo<>'efectivo' THEN valor END),0) AS transferencias FROM pagos p
    WHERE p.anulado=0 AND ${cp('p')} AND substr(p.fecha,1,10)=?`).get(fecha);
  const abonos = db.prepare(`SELECT COALESCE(SUM(p.valor),0) AS v FROM pagos p JOIN remisiones r ON r.id=p.remision_id
    WHERE p.anulado=0 AND ${cp('p')} AND substr(p.fecha,1,10)=? AND substr(r.fecha,1,10)<>?`).get(fecha, fecha).v;
  const gastos = db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM gastos g WHERE ${cp('g')} AND substr(g.fecha,1,10)=?`).get(fecha).v;
  const lista_gastos = db.prepare(`SELECT id, concepto, valor FROM gastos g WHERE ${cp('g')} AND substr(g.fecha,1,10)=?`).all(fecha);
  const inventario = db.prepare(`SELECT p.nombre, s.cantidad FROM stock s JOIN productos p ON p.id=s.producto_id WHERE s.ubicacion=? AND s.cantidad<>0 ORDER BY p.nombre`).all(ubDelPunto(punto));
  const guardado = db.prepare('SELECT * FROM cierres WHERE fecha=? AND punto=?').get(fecha, punto.codigo);
  return {
    fecha, punto: punto.codigo, ruta_id: punto.ruta_id, bodega_id: punto.bodega_id, remisiones: ventas.n, ventas_total: r2(ventas.total),
    ventas_contado: r2(ventas.contado), ventas_credito: r2(ventas.credito), cobrado: r2(cobro.efectivo + cobro.transferencias),
    cobrado_efectivo: r2(cobro.efectivo), transferencias: r2(cobro.transferencias), abonos: r2(abonos), gastos: r2(gastos), lista_gastos,
    esperado: r2(cobro.efectivo - gastos), inventario, cierre: guardado ?? null,
  };
}
router.get('/cierre', requierePermiso('vender'), wrap((req, res) => res.json(calcularCierre(req.query.fecha || ahora().slice(0, 10), resolverPunto(req.user, req.query.punto)))));
router.post('/cierre', requierePermiso('vender'), wrap((req, res) => {
  const punto = resolverPunto(req.user, req.body.punto);
  const fecha = req.body.fecha || ahora().slice(0, 10);
  const c = calcularCierre(fecha, punto);
  const entregado = num(req.body.entregado, 'Efectivo entregado');
  db.prepare(`INSERT INTO cierres (fecha,punto,ruta_id,bodega_id,usuario_id,ventas_contado,abonos,transferencias,gastos,esperado,entregado,diferencia,nota) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(fecha,punto) DO UPDATE SET usuario_id=excluded.usuario_id, ventas_contado=excluded.ventas_contado, abonos=excluded.abonos, transferencias=excluded.transferencias,
    gastos=excluded.gastos, esperado=excluded.esperado, entregado=excluded.entregado, diferencia=excluded.diferencia, nota=excluded.nota`)
    .run(fecha, punto.codigo, punto.ruta_id, punto.bodega_id, req.user.id, c.ventas_contado, c.abonos, c.transferencias, c.gastos, c.esperado, entregado, r2(entregado - c.esperado), n(req.body.nota));
  const diferencia = r2(entregado - c.esperado);
  if (diferencia !== 0) auditar(req.user, 'cierre con diferencia', 'cierre', null, `${punto.codigo} · ${fecha} · esperado $${c.esperado} · entregado $${entregado} · diferencia $${diferencia}`);
  res.json(calcularCierre(fecha, punto));
}));

export default router;
