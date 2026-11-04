// Inventario por ubicación (bodegas y rutas), cargue/devolución de rutas, ajustes, kardex y traslados entre bodegas
import { Router } from 'express';
import { db, tx, ahora, HttpError, moverStock, getStock } from '../db.js';
import { wrap, n, num, entero } from '../util.js';
import { B, R, parseUb, getRuta, getBodega, nombreUb, exigir, esAdmin, esAdminOBodeguero, puedeBodega, puedeRuta, puedeUb } from '../scope.js';

const router = Router();

// ---------- Consulta ----------
// ?ub=B1|R3 -> existencias de una ubicación;  ?ub=resumen -> totales por bodega y en rutas (admin/encargado)
router.get('/inventario', wrap((req, res) => {
  const u = req.user;
  const ub = req.query.ub || (u.rol === 'vendedor' ? R(u.ruta_id) : u.rol === 'bodeguero' ? B(u.bodega_id) : 'resumen');
  const verCosto = esAdminOBodeguero(u);
  if (ub === 'resumen') {
    exigir(esAdminOBodeguero(u));
    const bodegas = db.prepare('SELECT id, nombre FROM bodegas WHERE activa=1 ORDER BY nombre').all().filter((b) => puedeBodega(u, b.id));
    const idsB = new Set(bodegas.map((b) => b.id));
    const rutaBodega = new Map(db.prepare('SELECT id, bodega_id FROM rutas').all().map((r) => [r.id, r.bodega_id]));
    const prods = db.prepare('SELECT id,codigo,nombre,unidad,costo,stock_minimo FROM productos WHERE activo=1 ORDER BY nombre').all();
    const filas = new Map(prods.map((p) => [p.id, { ...p, por_bodega: {}, en_rutas: 0, total: 0 }]));
    for (const s of db.prepare('SELECT producto_id, ubicacion, cantidad FROM stock WHERE cantidad<>0').all()) {
      const f = filas.get(s.producto_id);
      if (!f) continue;
      const { tipo, id } = parseUb(s.ubicacion);
      if (tipo === 'B' && idsB.has(id)) { f.por_bodega[id] = s.cantidad; f.total += s.cantidad; }
      else if (tipo === 'R' && idsB.has(rutaBodega.get(id))) { f.en_rutas += s.cantidad; f.total += s.cantidad; }
    }
    return res.json({ ub: 'resumen', bodegas, productos: [...filas.values()].map((f) => { if (u.rol !== 'admin') delete f.costo; return f; }) });
  }
  const p = parseUb(ub);
  exigir(puedeUb(u, ub), 'No tienes permiso sobre esa ubicación');
  const info = p.tipo === 'B' ? getBodega(p.id) : getRuta(p.id);
  if (!info) throw new HttpError(404, 'Ubicación no encontrada');
  const productos = db.prepare(`SELECT p.id,p.codigo,p.nombre,p.unidad,p.costo,p.stock_minimo, COALESCE(s.cantidad,0) AS cantidad
    FROM productos p LEFT JOIN stock s ON s.producto_id=p.id AND s.ubicacion=? WHERE p.activo=1 ORDER BY p.nombre`).all(ub);
  if (!verCosto) for (const x of productos) delete x.costo;
  res.json({ ub, tipo: p.tipo, nombre: nombreUb(ub), bodega_id: p.tipo === 'B' ? p.id : info.bodega_id, productos });
}));

// ---------- Cargue y devolución de una ruta ----------
// Cargue: de la bodega de la ruta -> ruta. Devolución: ruta -> su bodega.
router.post('/inventario/cargue', wrap((req, res) => {
  const { ruta_id, sentido, items } = req.body;
  exigir(esAdminOBodeguero(req.user));
  if (!['cargue', 'devolucion'].includes(sentido)) throw new HttpError(400, 'Sentido inválido');
  const ruta = getRuta(Number(ruta_id));
  if (!ruta) throw new HttpError(400, 'Ruta inválida');
  exigir(puedeRuta(req.user, ruta.id), 'Esa ruta pertenece a otra bodega');
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Agrega al menos un producto');
  tx(() => {
    const ref = `${sentido === 'cargue' ? 'CG' : 'DV'}-${ruta.id}-${ahora().slice(0, 10)}`;
    const desde = sentido === 'cargue' ? B(ruta.bodega_id) : R(ruta.id);
    const hacia = sentido === 'cargue' ? R(ruta.id) : B(ruta.bodega_id);
    for (const i of items) {
      const q = num(i.cantidad, 'Cantidad');
      if (q <= 0) continue;
      moverStock({ productoId: i.producto_id, ubicacion: desde, delta: -q, tipo: sentido, referencia: ref, usuarioId: req.user.id });
      moverStock({ productoId: i.producto_id, ubicacion: hacia, delta: q, tipo: sentido, referencia: ref, usuarioId: req.user.id });
    }
  });
  res.json({ ok: true });
}));

// ---------- Ajuste por conteo físico ----------
router.post('/inventario/ajuste', wrap((req, res) => {
  const { producto_id, ub, cantidad_real, nota } = req.body;
  exigir(esAdminOBodeguero(req.user));
  parseUb(ub);
  exigir(puedeUb(req.user, ub), 'No tienes permiso sobre esa ubicación');
  const real = num(cantidad_real, 'Cantidad real');
  if (real < 0) throw new HttpError(400, 'La cantidad no puede ser negativa');
  tx(() => {
    const delta = real - getStock(producto_id, ub);
    if (delta !== 0) moverStock({ productoId: producto_id, ubicacion: ub, delta, tipo: 'ajuste', referencia: 'AJ', usuarioId: req.user.id, nota: n(nota) });
  });
  res.json({ ok: true });
}));

// ---------- Kardex ----------
router.get('/inventario/kardex/:productoId', wrap((req, res) => {
  const u = req.user;
  exigir(esAdminOBodeguero(u));
  const pid = entero(req.params.productoId);
  let filtro = '';
  const params = [pid];
  if (req.query.ub) {
    parseUb(req.query.ub);
    exigir(puedeUb(u, req.query.ub), 'No tienes permiso sobre esa ubicación');
    filtro = 'AND m.ubicacion=?';
    params.push(req.query.ub);
  } else if (u.rol === 'bodeguero') {
    // el encargado ve solo los movimientos de su bodega y de las rutas de su bodega
    const ubs = [B(u.bodega_id), ...db.prepare('SELECT id FROM rutas WHERE bodega_id=?').all(u.bodega_id).map((r) => R(r.id))];
    filtro = `AND m.ubicacion IN (${ubs.map(() => '?').join(',')})`;
    params.push(...ubs);
  }
  const filas = db.prepare(`SELECT m.*, u.nombre AS usuario FROM movimientos m LEFT JOIN usuarios u ON u.id=m.usuario_id
    WHERE m.producto_id=? ${filtro} ORDER BY m.id DESC LIMIT 400`).all(...params);
  res.json(filas.map((m) => ({ ...m, ubicacion_nombre: nombreUb(m.ubicacion) })));
}));

export default router;
