// Compras a proveedores: cada compra llega a una bodega
import { Router } from 'express';
import { db, tx, ahora, HttpError, moverStock } from '../db.js';
import { requierePermiso } from '../auth.js';
import { wrap, n, num, r2, entero } from '../util.js';
import { presentacionDe, aBase } from '../presentaciones.js';
import { auditar } from '../auditoria.js';
import { leerImagen } from '../soportes.js';
import { B, can, puedeBodega, exigir, getBodega } from '../scope.js';

const router = Router();
router.use((req, _res, next) => (can(req.user, 'compras') || can(req.user, 'pagar_proveedores') ? next() : next(new HttpError(403, 'No tienes permiso para esto'))));

// Solo ve las compras de su alcance: todas (admin) o las de su bodega (encargado)
const alcance = (u) => (u.alcance === 'todo' ? '1=1' : `c.bodega_id=${Number(u.bodega_id)}`);

router.get('/', (req, res) => {
  const filtroBodega = req.user.alcance === 'todo' && req.query.bodega_id ? `AND c.bodega_id=${Number(req.query.bodega_id)}` : '';
  res.json(db.prepare(`SELECT c.*, pr.nombre AS proveedor, b.nombre AS bodega FROM compras c
    LEFT JOIN proveedores pr ON pr.id=c.proveedor_id JOIN bodegas b ON b.id=c.bodega_id
    WHERE substr(c.fecha,1,10) BETWEEN ? AND ? AND ${alcance(req.user)} ${filtroBodega} ORDER BY c.id DESC LIMIT 300`)
    .all(req.query.desde || '0000-01-01', req.query.hasta || '9999-12-31'));
});

// Foto de la factura del proveedor
const MAX_FOTOS_COMPRA = 5;
function guardarFotoCompra(compraId, dataUrl, user) {
  const { mime, datos } = leerImagen(dataUrl);
  if (db.prepare('SELECT COUNT(*) AS n FROM compra_fotos WHERE compra_id=?').get(compraId).n >= MAX_FOTOS_COMPRA) throw new HttpError(409, `Una compra admite máximo ${MAX_FOTOS_COMPRA} fotos`);
  return Number(db.prepare('INSERT INTO compra_fotos (compra_id,fecha,usuario_id,mime,bytes,datos) VALUES (?,?,?,?,?,?)').run(compraId, ahora(), user.id, mime, datos.length, datos).lastInsertRowid);
}
router.post('/:id/foto', wrap((req, res) => {
  const id = entero(req.params.id);
  if (!db.prepare(`SELECT 1 FROM compras c WHERE c.id=? AND ${alcance(req.user)}`).get(id)) throw new HttpError(404, 'Compra no encontrada');
  res.json({ id: guardarFotoCompra(id, req.body.imagen, req.user) });
}));
router.get('/:id/foto/:fid', wrap((req, res) => {
  const f = db.prepare(`SELECT f.mime, f.datos FROM compra_fotos f JOIN compras c ON c.id=f.compra_id WHERE f.id=? AND f.compra_id=? AND ${alcance(req.user)}`).get(entero(req.params.fid), entero(req.params.id));
  if (!f) throw new HttpError(404, 'Foto no encontrada');
  res.setHeader('Content-Type', f.mime); res.setHeader('Cache-Control', 'private, max-age=3600'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(f.datos));
}));

router.get('/:id', wrap((req, res) => {
  const c = db.prepare(`SELECT c.*, pr.nombre AS proveedor, b.nombre AS bodega FROM compras c
    LEFT JOIN proveedores pr ON pr.id=c.proveedor_id JOIN bodegas b ON b.id=c.bodega_id WHERE c.id=? AND ${alcance(req.user)}`).get(entero(req.params.id));
  if (!c) throw new HttpError(404, 'Compra no encontrada');
  c.items = db.prepare('SELECT ci.*, p.nombre FROM compra_items ci JOIN productos p ON p.id=ci.producto_id WHERE compra_id=?').all(c.id);
  c.fotos = db.prepare('SELECT id, fecha, bytes FROM compra_fotos WHERE compra_id=? ORDER BY id').all(c.id);
  res.json(c);
}));

router.post('/', wrap((req, res) => {
  const b = req.body;
  if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'Agrega al menos un producto');
  // el encargado compra siempre para su bodega; el administrador elige
  const bodegaId = req.user.alcance === 'bodega' ? req.user.bodega_id : entero(b.bodega_id, 'Elige la bodega que recibe la compra');
  exigir(puedeBodega(req.user, bodegaId));
  if (!getBodega(bodegaId)) throw new HttpError(400, 'La bodega no existe');
  const id = tx(() => {
    let total = 0;
    // cantidad y costo vienen en la presentación comprada (2 estibas a $200.000); el inventario sube en unidades base
    const items = b.items.map((i) => {
      const cantidad = num(i.cantidad, 'Cantidad'), costo = num(i.costo, 'Costo');
      if (cantidad <= 0 || costo < 0) throw new HttpError(400, 'Cantidad y costo deben ser válidos');
      const producto_id = Number(i.producto_id);
      const pres = presentacionDe(producto_id, i.presentacion_id);
      total += cantidad * costo;
      return { producto_id, cantidad, costo, pres };
    });
    total = r2(total);
    const pagado = b.pagado === undefined || b.pagado === '' ? total : num(b.pagado, 'Pagado');
    if (pagado < 0 || pagado > total + 0.001) throw new HttpError(400, 'El valor pagado no puede superar el total');
    const cid = Number(db.prepare('INSERT INTO compras (fecha,proveedor_id,factura,bodega_id,total,pagado,nota,usuario_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(ahora(), n(b.proveedor_id), n(b.factura), bodegaId, total, pagado, n(b.nota), req.user.id).lastInsertRowid);
    for (const i of items) {
      const p = db.prepare('SELECT id, costo FROM productos WHERE id=?').get(i.producto_id);
      if (!p) throw new HttpError(400, 'Producto no existe');
      // costo promedio ponderado por unidad base, con el stock total actual (todas las bodegas y rutas)
      const cantBase = aBase(i.cantidad, i.pres), costoBase = i.costo / i.pres.factor;
      const existente = db.prepare('SELECT COALESCE(SUM(cantidad),0) AS q FROM stock WHERE producto_id=?').get(p.id).q;
      const nuevoCosto = existente > 0 ? r2((existente * p.costo + cantBase * costoBase) / (existente + cantBase)) : r2(costoBase);
      db.prepare('UPDATE productos SET costo=? WHERE id=?').run(nuevoCosto, p.id);
      db.prepare('INSERT INTO compra_items (compra_id,producto_id,cantidad,costo,factor,presentacion) VALUES (?,?,?,?,?,?)').run(cid, p.id, i.cantidad, i.costo, i.pres.factor, i.pres.nombre);
      moverStock({ productoId: p.id, ubicacion: B(bodegaId), delta: cantBase, tipo: 'compra', costo: costoBase, referencia: `C-${cid}`, usuarioId: req.user.id });
    }
    for (const f of (Array.isArray(b.fotos) ? b.fotos : []).slice(0, MAX_FOTOS_COMPRA)) guardarFotoCompra(cid, f, req.user);
    return cid;
  });
  res.json({ id });
}));

router.post('/:id/anular', requierePermiso('pagar_proveedores'), wrap((req, res) => {
  tx(() => {
    const c = db.prepare('SELECT * FROM compras WHERE id=?').get(entero(req.params.id));
    if (!c) throw new HttpError(404, 'Compra no encontrada');
    if (c.anulada) throw new HttpError(409, 'La compra ya está anulada');
    for (const i of db.prepare('SELECT * FROM compra_items WHERE compra_id=?').all(c.id))
      moverStock({ productoId: i.producto_id, ubicacion: B(c.bodega_id), delta: -aBase(i.cantidad, { factor: i.factor }), tipo: 'anulacion_compra', costo: i.costo / i.factor, referencia: `C-${c.id}`, usuarioId: req.user.id });
    db.prepare('UPDATE compras SET anulada=1 WHERE id=?').run(c.id);
    auditar(req.user, 'anular', 'compra', c.id, `$${c.total} · bodega ${c.bodega_id}`);
  });
  res.json({ ok: true });
}));

router.post('/:id/pago', requierePermiso('pagar_proveedores'), wrap((req, res) => {
  const c = db.prepare('SELECT * FROM compras WHERE id=? AND anulada=0').get(entero(req.params.id));
  if (!c) throw new HttpError(404, 'Compra no encontrada');
  const v = num(req.body.valor);
  if (v <= 0 || v > c.total - c.pagado + 0.001) throw new HttpError(400, 'Valor inválido: excede la deuda');
  db.prepare('UPDATE compras SET pagado=pagado+? WHERE id=?').run(v, c.id);
  auditar(req.user, 'pago a proveedor', 'compra', c.id, `$${v}`);
  res.json({ ok: true });
}));

export default router;
