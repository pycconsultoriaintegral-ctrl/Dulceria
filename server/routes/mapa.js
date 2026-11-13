// Mapas: dónde se hicieron las ventas del día (GPS del celular del vendedor) y dónde están las tiendas con ubicación guardada.
import { Router } from 'express';
import { db, ahora } from '../db.js';
import { wrap, r2 } from '../util.js';
import { sqlAlcance, exigir, can, puedeRuta } from '../scope.js';

const router = Router();

// Ventas del día con ubicación. Quien tiene informes ve las de su alcance; el vendedor, las suyas.
router.get('/ventas', wrap((req, res) => {
  const u = req.user;
  exigir(can(u, 'informes') || u.alcance === 'ruta', 'No tienes permiso para ver el mapa de ventas');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha)) ? req.query.fecha : ahora().slice(0, 10);
  const alcance = sqlAlcance(u, 'r', { punto: req.query.punto || undefined });
  const propias = can(u, 'informes') ? '1=1' : `r.usuario_id=${Number(u.id)}`;
  const filas = db.prepare(`SELECT r.id, r.consecutivo, r.fecha, r.total, r.tipo_pago, r.lat, r.lng, r.gps_precision, c.nombre AS cliente, us.id AS vendedor_id, us.nombre AS vendedor,
      CASE WHEN ru.id IS NULL THEN 'Mostrador' ELSE ru.nombre END AS punto
    FROM remisiones r JOIN clientes c ON c.id=r.cliente_id JOIN usuarios us ON us.id=r.usuario_id LEFT JOIN rutas ru ON ru.id=r.ruta_id
    WHERE r.anulada=0 AND r.lat IS NOT NULL AND substr(r.fecha,1,10)=? AND ${alcance} AND ${propias} ORDER BY r.fecha`).all(fecha);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM remisiones r WHERE r.anulada=0 AND substr(r.fecha,1,10)=? AND ${alcance} AND ${propias}`).get(fecha).n;
  res.json({ fecha, con_ubicacion: filas.length, total_ventas: total, ventas: filas.map((f) => ({ ...f, total: r2(f.total) })) });
}));

// Tiendas con ubicación guardada, dentro del alcance del usuario
router.get('/clientes', wrap((req, res) => {
  const u = req.user;
  const ruta = req.query.ruta_id ? Number(req.query.ruta_id) : null;
  if (ruta) exigir(puedeRuta(u, ruta), 'No tienes permiso sobre esa ruta');
  const cond = u.alcance === 'todo' ? '1=1'
    : u.alcance === 'ruta' ? `(c.ruta_id=${Number(u.ruta_id)} OR c.ruta_id IS NULL)`
    : `(c.ruta_id IS NULL OR c.ruta_id IN (SELECT id FROM rutas WHERE bodega_id=${Number(u.bodega_id)}))`;
  const filas = db.prepare(`SELECT c.id, c.nombre, c.negocio, c.telefono, c.direccion, c.lat, c.lng, ru.nombre AS ruta
    FROM clientes c LEFT JOIN rutas ru ON ru.id=c.ruta_id WHERE c.activo=1 AND c.lat IS NOT NULL AND ${cond} ${ruta ? `AND c.ruta_id=${ruta}` : ''} ORDER BY c.nombre`).all();
  const sin = db.prepare(`SELECT COUNT(*) AS n FROM clientes c WHERE c.activo=1 AND c.lat IS NULL AND ${cond}`).get().n;
  res.json({ con_ubicacion: filas.length, sin_ubicacion: sin, clientes: filas });
}));

export default router;
