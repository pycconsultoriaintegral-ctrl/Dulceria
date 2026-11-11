// Traslados entre bodegas: al enviar sale de la origen; al recibir entra a la destino.
// Entre ambos pasos la mercancía queda "en tránsito" y la diferencia al recibir queda registrada.
import { Router } from 'express';
import { db, tx, ahora, HttpError, moverStock } from '../db.js';
import { wrap, n, num, entero } from '../util.js';
import { presentacionDe, aBase, presentacionesDe } from '../presentaciones.js';
import { auditar } from '../auditoria.js';
import { B, getBodega, exigir, can, puedeBodega } from '../scope.js';

const router = Router();
router.use((req, _res, next) => (can(req.user, 'inventario') ? next() : next(new HttpError(403, 'No tienes permiso para esto'))));

const SEL = `SELECT t.*, bo.nombre AS origen, bd.nombre AS destino, ue.nombre AS envia, ur.nombre AS recibe,
  (SELECT COUNT(*) FROM traslado_items i WHERE i.traslado_id=t.id) AS productos
  FROM traslados t JOIN bodegas bo ON bo.id=t.origen_id JOIN bodegas bd ON bd.id=t.destino_id
  LEFT JOIN usuarios ue ON ue.id=t.usuario_envia LEFT JOIN usuarios ur ON ur.id=t.usuario_recibe`;
const involucra = (u) => (u.alcance === 'todo' ? '1=1' : `(t.origen_id=${Number(u.bodega_id)} OR t.destino_id=${Number(u.bodega_id)})`);

function cargar(req, id) {
  const t = db.prepare(`${SEL} WHERE t.id=? AND ${involucra(req.user)}`).get(id);
  if (!t) throw new HttpError(404, 'Traslado no encontrado');
  t.items = db.prepare(`SELECT i.*, p.nombre, p.unidad FROM traslado_items i JOIN productos p ON p.id=i.producto_id WHERE i.traslado_id=? ORDER BY p.nombre`).all(id);
  const pres = presentacionesDe(t.items.map((i) => i.producto_id));
  for (const i of t.items) i.presentaciones = pres.get(i.producto_id) ?? [];
  return t;
}

router.get('/', (req, res) => {
  const estado = ['enviado', 'recibido', 'anulado'].includes(req.query.estado) ? `AND t.estado='${req.query.estado}'` : '';
  res.json(db.prepare(`${SEL} WHERE ${involucra(req.user)} ${estado} ORDER BY t.id DESC LIMIT 200`).all());
});
router.get('/:id', wrap((req, res) => res.json(cargar(req, entero(req.params.id)))));

router.post('/', wrap((req, res) => {
  const { origen_id, destino_id, items, nota } = req.body;
  const o = entero(origen_id, 'Elige la bodega de origen'), d = entero(destino_id, 'Elige la bodega de destino');
  if (o === d) throw new HttpError(400, 'La bodega de origen y la de destino deben ser distintas');
  if (!getBodega(o) || !getBodega(d)) throw new HttpError(400, 'Bodega inválida');
  exigir(puedeBodega(req.user, o), 'Solo puedes enviar desde tu bodega');
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Agrega al menos un producto');
  const id = tx(() => {
    const tid = Number(db.prepare('INSERT INTO traslados (fecha,origen_id,destino_id,usuario_envia,nota) VALUES (?,?,?,?,?)')
      .run(ahora(), o, d, req.user.id, n(nota)).lastInsertRowid);
    let hay = false;
    for (const i of items) {
      const q = aBase(num(i.cantidad, 'Cantidad'), presentacionDe(Number(i.producto_id), i.presentacion_id)); // se guarda en unidades base
      if (q <= 0) continue;
      hay = true;
      db.prepare('INSERT INTO traslado_items (traslado_id,producto_id,cantidad) VALUES (?,?,?)').run(tid, Number(i.producto_id), q);
      moverStock({ productoId: Number(i.producto_id), ubicacion: B(o), delta: -q, tipo: 'traslado_salida', referencia: `T-${tid}`, usuarioId: req.user.id });
    }
    if (!hay) throw new HttpError(400, 'Las cantidades deben ser mayores a cero');
    return tid;
  });
  res.json({ id });
}));

// Recibir: opcionalmente con las cantidades realmente recibidas (por defecto, todo lo enviado)
router.post('/:id/recibir', wrap((req, res) => {
  const id = entero(req.params.id);
  tx(() => {
    const t = cargar(req, id);
    exigir(puedeBodega(req.user, t.destino_id), 'Solo la bodega de destino puede recibir');
    if (t.estado !== 'enviado') throw new HttpError(409, `El traslado ya está ${t.estado}`);
    const recibidas = new Map((req.body.items || []).map((i) => [Number(i.producto_id), num(i.cantidad_recibida, 'Cantidad recibida')]));
    for (const i of t.items) {
      const rec = recibidas.has(i.producto_id) ? recibidas.get(i.producto_id) : i.cantidad;
      if (rec < 0 || rec > i.cantidad + 1e-9) throw new HttpError(400, `No puedes recibir más de lo enviado de "${i.nombre}" (${i.cantidad})`);
      db.prepare('UPDATE traslado_items SET cantidad_recibida=? WHERE id=?').run(rec, i.id);
      if (rec > 0) moverStock({ productoId: i.producto_id, ubicacion: B(t.destino_id), delta: rec, tipo: 'traslado_entrada', referencia: `T-${id}`, usuarioId: req.user.id });
    }
    db.prepare("UPDATE traslados SET estado='recibido', usuario_recibe=?, fecha_recibo=? WHERE id=?").run(req.user.id, ahora(), id);
    const faltantes = t.items.filter((i) => (recibidas.has(i.producto_id) ? recibidas.get(i.producto_id) : i.cantidad) < i.cantidad)
      .map((i) => `${i.nombre}: faltan ${i.cantidad - (recibidas.get(i.producto_id) ?? i.cantidad)}`);
    if (faltantes.length) auditar(req.user, 'traslado con faltante', 'traslado', id, `${t.origen} → ${t.destino} · ${faltantes.join(', ')}`);
  });
  res.json(cargar(req, id));
}));

// Anular un traslado aún no recibido: la mercancía vuelve a la bodega de origen
router.post('/:id/anular', wrap((req, res) => {
  const id = entero(req.params.id);
  tx(() => {
    const t = cargar(req, id);
    exigir(puedeBodega(req.user, t.origen_id), 'Solo la bodega de origen puede anular el envío');
    if (t.estado !== 'enviado') throw new HttpError(409, `El traslado ya está ${t.estado}`);
    for (const i of t.items) moverStock({ productoId: i.producto_id, ubicacion: B(t.origen_id), delta: i.cantidad, tipo: 'anulacion_traslado', referencia: `T-${id}`, usuarioId: req.user.id });
    db.prepare("UPDATE traslados SET estado='anulado' WHERE id=?").run(id);
    auditar(req.user, 'anular', 'traslado', id, `${t.origen} → ${t.destino}`);
  });
  res.json({ ok: true });
}));

export default router;
