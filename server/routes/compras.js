// Compras a proveedores: cada compra llega a una bodega
import { Router } from 'express';
import { db, tx, ahora, HttpError, moverStock } from '../db.js';
import { soloAdmin } from '../auth.js';
import { wrap, n, num, r2, entero } from '../util.js';
import { B, esAdmin, esAdminOBodeguero, puedeBodega, exigir, getBodega } from '../scope.js';

const router = Router();
router.use((req, _res, next) => (esAdminOBodeguero(req.user) ? next() : next(new HttpError(403, 'No tienes permiso para esto'))));

// Solo ve las compras de su alcance: todas (admin) o las de su bodega (encargado)
const alcance = (u) => (u.rol === 'admin' ? '1=1' : `c.bodega_id=${Number(u.bodega_id)}`);

router.get('/', (req, res) => {
  const filtroBodega = esAdmin(req.user) && req.query.bodega_id ? `AND c.bodega_id=${Number(req.query.bodega_id)}` : '';
  res.json(db.prepare(`SELECT c.*, pr.nombre AS proveedor, b.nombre AS bodega FROM compras c
    LEFT JOIN proveedores pr ON pr.id=c.proveedor_id JOIN bodegas b ON b.id=c.bodega_id
    WHERE substr(c.fecha,1,10) BETWEEN ? AND ? AND ${alcance(req.user)} ${filtroBodega} ORDER BY c.id DESC LIMIT 300`)
    .all(req.query.desde || '0000-01-01', req.query.hasta || '9999-12-31'));
});

router.get('/:id', wrap((req, res) => {
  const c = db.prepare(`SELECT c.*, pr.nombre AS proveedor, b.nombre AS bodega FROM compras c
    LEFT JOIN proveedores pr ON pr.id=c.proveedor_id JOIN bodegas b ON b.id=c.bodega_id WHERE c.id=? AND ${alcance(req.user)}`).get(entero(req.params.id));
  if (!c) throw new HttpError(404, 'Compra no encontrada');
  c.items = db.prepare('SELECT ci.*, p.nombre FROM compra_items ci JOIN productos p ON p.id=ci.producto_id WHERE compra_id=?').all(c.id);
  res.json(c);
}));

router.post('/', wrap((req, res) => {
  const b = req.body;
  if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'Agrega al menos un producto');
  // el encargado compra siempre para su bodega; el administrador elige
  const bodegaId = req.user.rol === 'bodeguero' ? req.user.bodega_id : entero(b.bodega_id, 'Elige la bodega que recibe la compra');
  exigir(puedeBodega(req.user, bodegaId));
  if (!getBodega(bodegaId)) throw new HttpError(400, 'La bodega no existe');
  const id = tx(() => {
    let total = 0;
    const items = b.items.map((i) => {
      const cantidad = num(i.cantidad, 'Cantidad'), costo = num(i.costo, 'Costo');
      if (cantidad <= 0 || costo < 0) throw new HttpError(400, 'Cantidad y costo deben ser válidos');
      total += cantidad * costo;
      return { producto_id: Number(i.producto_id), cantidad, costo };
    });
    total = r2(total);
    const pagado = b.pagado === undefined || b.pagado === '' ? total : num(b.pagado, 'Pagado');
    if (pagado < 0 || pagado > total + 0.001) throw new HttpError(400, 'El valor pagado no puede superar el total');
    const cid = Number(db.prepare('INSERT INTO compras (fecha,proveedor_id,factura,bodega_id,total,pagado,nota,usuario_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(ahora(), n(b.proveedor_id), n(b.factura), bodegaId, total, pagado, n(b.nota), req.user.id).lastInsertRowid);
    for (const i of items) {
      const p = db.prepare('SELECT id, costo FROM productos WHERE id=?').get(i.producto_id);
      if (!p) throw new HttpError(400, 'Producto no existe');
      // costo promedio ponderado con el stock total actual (todas las bodegas y rutas)
      const existente = db.prepare('SELECT COALESCE(SUM(cantidad),0) AS q FROM stock WHERE producto_id=?').get(p.id).q;
      const nuevoCosto = existente > 0 ? r2((existente * p.costo + i.cantidad * i.costo) / (existente + i.cantidad)) : i.costo;
      db.prepare('UPDATE productos SET costo=? WHERE id=?').run(nuevoCosto, p.id);
      db.prepare('INSERT INTO compra_items (compra_id,producto_id,cantidad,costo) VALUES (?,?,?,?)').run(cid, p.id, i.cantidad, i.costo);
      moverStock({ productoId: p.id, ubicacion: B(bodegaId), delta: i.cantidad, tipo: 'compra', costo: i.costo, referencia: `C-${cid}`, usuarioId: req.user.id });
    }
    return cid;
  });
  res.json({ id });
}));

router.post('/:id/anular', soloAdmin, wrap((req, res) => {
  tx(() => {
    const c = db.prepare('SELECT * FROM compras WHERE id=?').get(entero(req.params.id));
    if (!c) throw new HttpError(404, 'Compra no encontrada');
    if (c.anulada) throw new HttpError(409, 'La compra ya está anulada');
    for (const i of db.prepare('SELECT * FROM compra_items WHERE compra_id=?').all(c.id))
      moverStock({ productoId: i.producto_id, ubicacion: B(c.bodega_id), delta: -i.cantidad, tipo: 'anulacion_compra', costo: i.costo, referencia: `C-${c.id}`, usuarioId: req.user.id });
    db.prepare('UPDATE compras SET anulada=1 WHERE id=?').run(c.id);
  });
  res.json({ ok: true });
}));

router.post('/:id/pago', soloAdmin, wrap((req, res) => {
  const c = db.prepare('SELECT * FROM compras WHERE id=? AND anulada=0').get(entero(req.params.id));
  if (!c) throw new HttpError(404, 'Compra no encontrada');
  const v = num(req.body.valor);
  if (v <= 0 || v > c.total - c.pagado + 0.001) throw new HttpError(400, 'Valor inválido: excede la deuda');
  db.prepare('UPDATE compras SET pagado=pagado+? WHERE id=?').run(v, c.id);
  res.json({ ok: true });
}));

export default router;
