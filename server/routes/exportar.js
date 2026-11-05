// Descargas en CSV para Excel. Respetan el alcance de cada usuario igual que las pantallas.
import { Router } from 'express';
import { db, HttpError } from '../db.js';
import { aCsv } from '../csvout.js';
import { wrap, r2 } from '../util.js';
import { soloAdmin } from '../auth.js';
import { B, R, parseUb, nombreUb, sqlAlcance, esAdminOBodeguero, exigir, puedeUb, getRuta } from '../scope.js';
import { saldoSQL } from './clientes.js';

const router = Router();
const csv = (res, nombre, encabezados, filas) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}.csv"`);
  res.send(aCsv(encabezados, filas));
};
const rango = (q) => ({ desde: q.desde || '0000-01-01', hasta: q.hasta || '9999-12-31' });

// Una fila por producto vendido en cada remisión
router.get('/ventas', wrap((req, res) => {
  const q = req.query;
  const alcance = sqlAlcance(req.user, 'r', { punto: q.punto, ruta_id: q.ruta_id, bodega_id: q.bodega_id });
  const costos = esAdminOBodeguero(req.user);
  const filas = db.prepare(`SELECT r.fecha, r.consecutivo, COALESCE(ru.nombre,'Mostrador') AS ruta, b.nombre AS bodega, us.nombre AS vendedor, c.nombre AS cliente,
      i.descripcion, i.presentacion, i.cantidad, i.precio, i.precio_lista, i.cantidad*i.precio AS total_linea, i.cantidad*i.costo AS costo_linea, r.tipo_pago, r.anulada
    FROM remision_items i JOIN remisiones r ON r.id=i.remision_id JOIN clientes c ON c.id=r.cliente_id JOIN usuarios us ON us.id=r.usuario_id
    JOIN bodegas b ON b.id=r.bodega_id LEFT JOIN rutas ru ON ru.id=r.ruta_id
    WHERE substr(r.fecha,1,10) BETWEEN @desde AND @hasta AND ${alcance} ORDER BY r.id, i.id`).all(rango(q));
  csv(res, 'ventas', ['Fecha', 'Remisión', 'Ruta', 'Bodega', 'Vendedor', 'Cliente', 'Producto', 'Presentación', 'Cantidad', 'Precio', 'Precio de lista', 'Total', ...(costos ? ['Costo'] : []), 'Pago', 'Estado'],
    filas.map((f) => [f.fecha, f.consecutivo, f.ruta, f.bodega, f.vendedor, f.cliente, f.descripcion, f.presentacion, f.cantidad, f.precio, f.precio_lista, r2(f.total_linea), ...(costos ? [r2(f.costo_linea)] : []), f.tipo_pago, f.anulada === 2 ? 'Pendiente de pago' : f.anulada ? 'Anulada' : 'Válida']));
}));

router.get('/cartera', wrap((req, res) => {
  const q = req.query;
  const alcance = sqlAlcance(req.user, 'r', { punto: q.punto, ruta_id: q.ruta_id, bodega_id: q.bodega_id });
  const filas = db.prepare(`SELECT c.nombre, c.negocio, c.telefono, SUM(r.total-r.pagado) AS saldo, MIN(r.fecha) AS mas_antigua
    FROM clientes c JOIN remisiones r ON r.cliente_id=c.id AND r.anulada=0 WHERE ${alcance} GROUP BY c.id HAVING saldo > 0.005 ORDER BY saldo DESC`).all();
  csv(res, 'cartera', ['Cliente', 'Negocio', 'Teléfono', 'Saldo', 'Deuda más antigua'], filas.map((f) => [f.nombre, f.negocio, f.telefono, r2(f.saldo), f.mas_antigua?.slice(0, 10)]));
}));

router.get('/clientes', wrap((req, res) => {
  const u = req.user;
  const cond = u.rol === 'admin' ? '1=1' : u.rol === 'vendedor' ? `(c.ruta_id=${Number(u.ruta_id)} OR c.ruta_id IS NULL)`
    : `(c.ruta_id IS NULL OR c.ruta_id IN (SELECT id FROM rutas WHERE bodega_id=${Number(u.bodega_id)}))`;
  const filas = db.prepare(`SELECT c.nombre, c.negocio, c.telefono, c.direccion, c.documento, ru.nombre AS ruta, ${saldoSQL(u)} AS saldo
    FROM clientes c LEFT JOIN rutas ru ON ru.id=c.ruta_id WHERE c.activo=1 AND ${cond} ORDER BY c.nombre`).all();
  // mismo formato que la plantilla de importación: se puede corregir en Excel y volver a importar
  csv(res, 'clientes', ['nombre', 'negocio', 'telefono', 'direccion', 'cedula', 'ruta', 'saldo'], filas.map((f) => [f.nombre, f.negocio, f.telefono, f.direccion, f.documento, f.ruta, r2(f.saldo)]));
}));

// Existencias por producto: una columna por bodega, más lo que está en rutas (admin y encargado)
router.get('/inventario', wrap((req, res) => {
  const u = req.user;
  exigir(esAdminOBodeguero(u));
  const bodegas = db.prepare('SELECT id, nombre FROM bodegas WHERE activa=1 ORDER BY nombre').all().filter((b) => u.rol === 'admin' || b.id === u.bodega_id);
  const ids = new Set(bodegas.map((b) => b.id));
  const rutaBodega = new Map(db.prepare('SELECT id, bodega_id FROM rutas').all().map((r) => [r.id, r.bodega_id]));
  const productos = db.prepare('SELECT id, codigo, nombre, unidad, costo FROM productos WHERE activo=1 ORDER BY nombre').all();
  const filas = new Map(productos.map((p) => [p.id, { p, por: {}, rutas: 0 }]));
  for (const s of db.prepare('SELECT producto_id, ubicacion, cantidad FROM stock WHERE cantidad<>0').all()) {
    const f = filas.get(s.producto_id);
    if (!f) continue;
    const { tipo, id } = parseUb(s.ubicacion);
    if (tipo === 'B' && ids.has(id)) f.por[id] = s.cantidad;
    else if (tipo === 'R' && ids.has(rutaBodega.get(id))) f.rutas += s.cantidad;
  }
  const verValor = u.rol === 'admin' || u.rol === 'bodeguero';
  csv(res, 'inventario', ['Código', 'Producto', 'Unidad', ...bodegas.map((b) => b.nombre), 'En rutas', 'Total', ...(verValor ? ['Costo unitario', 'Valor'] : [])],
    [...filas.values()].map(({ p, por, rutas }) => {
      const total = Object.values(por).reduce((a, x) => a + x, 0) + rutas;
      return [p.codigo, p.nombre, p.unidad, ...bodegas.map((b) => por[b.id] ?? 0), rutas, total, ...(verValor ? [p.costo, r2(total * p.costo)] : [])];
    }));
}));

router.get('/movimientos', wrap((req, res) => {
  const u = req.user;
  exigir(esAdminOBodeguero(u));
  const q = req.query;
  let filtro = '';
  const params = rango(q);
  if (q.ub) { parseUb(q.ub); exigir(puedeUb(u, q.ub)); filtro = 'AND m.ubicacion=@ub'; params.ub = q.ub; }
  else if (u.rol === 'bodeguero') {
    const ubs = [B(u.bodega_id), ...db.prepare('SELECT id FROM rutas WHERE bodega_id=?').all(u.bodega_id).map((r) => R(r.id))];
    filtro = `AND m.ubicacion IN (${ubs.map((x) => `'${x}'`).join(',')})`;
  }
  const filas = db.prepare(`SELECT m.fecha, p.nombre AS producto, m.ubicacion, m.tipo, m.cantidad, m.referencia, m.nota, us.nombre AS usuario
    FROM movimientos m JOIN productos p ON p.id=m.producto_id LEFT JOIN usuarios us ON us.id=m.usuario_id
    WHERE substr(m.fecha,1,10) BETWEEN @desde AND @hasta ${filtro} ORDER BY m.id DESC LIMIT 50000`).all(params);
  csv(res, 'movimientos-inventario', ['Fecha', 'Producto', 'Ubicación', 'Movimiento', 'Cantidad', 'Referencia', 'Nota', 'Usuario'],
    filas.map((f) => [f.fecha.replace('T', ' ').slice(0, 19), f.producto, nombreUb(f.ubicacion), f.tipo.replaceAll('_', ' '), f.cantidad, f.referencia, f.nota, f.usuario]));
}));

router.get('/cierres', wrap((req, res) => {
  const q = req.query;
  const alcance = sqlAlcance(req.user, 'c', { bodega_id: q.bodega_id });
  const filas = db.prepare(`SELECT c.fecha, c.punto, b.nombre AS bodega, c.ventas_contado, c.abonos, c.transferencias, c.gastos, c.esperado, c.entregado, c.diferencia, c.nota, us.nombre AS usuario
    FROM cierres c JOIN bodegas b ON b.id=c.bodega_id LEFT JOIN usuarios us ON us.id=c.usuario_id
    WHERE c.fecha BETWEEN @desde AND @hasta AND ${alcance} ORDER BY c.fecha DESC, c.id DESC`).all(rango(q));
  csv(res, 'cierres', ['Fecha', 'Punto', 'Bodega', 'Ventas de contado', 'Abonos', 'Transferencias', 'Gastos', 'Efectivo esperado', 'Entregado', 'Diferencia', 'Nota', 'Cerró'],
    filas.map((f) => [f.fecha, nombreUb(f.punto), f.bodega, f.ventas_contado, f.abonos, f.transferencias, f.gastos, f.esperado, f.entregado, f.diferencia, f.nota, f.usuario]));
}));

router.get('/actividad', soloAdmin, wrap((req, res) => {
  const filas = db.prepare('SELECT fecha, usuario, accion, entidad, entidad_id, detalle FROM auditoria WHERE substr(fecha,1,10) BETWEEN @desde AND @hasta ORDER BY id DESC LIMIT 50000').all(rango(req.query));
  csv(res, 'actividad', ['Fecha', 'Usuario', 'Acción', 'Sobre', 'Número', 'Detalle'], filas.map((f) => [f.fecha, f.usuario, f.accion, f.entidad, f.entidad_id, f.detalle]));
}));

export default router;
