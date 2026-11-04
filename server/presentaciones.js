// Presentaciones de un producto (unidad, caja, estiba…). El inventario se lleva siempre en la unidad base;
// cada presentación indica cuántas unidades base trae (factor) y puede tener su propio precio.
import { db, HttpError } from './db.js';

const redondear = (x) => Math.round(x * 1e6) / 1e6;

export const BASE = { id: null, nombre: null, factor: 1, precio: null };

// Presentación elegida en una línea (sin elegir = la unidad base)
export function presentacionDe(productoId, presentacionId) {
  if (presentacionId === undefined || presentacionId === null || presentacionId === '' || Number(presentacionId) === 0) return BASE;
  const x = db.prepare('SELECT * FROM presentaciones WHERE id=? AND producto_id=? AND activo=1').get(Number(presentacionId), productoId);
  if (!x) throw new HttpError(400, 'Esa presentación no existe para el producto');
  return x;
}
export const aBase = (cantidad, pres) => redondear(cantidad * pres.factor);

// Precio de lista de una presentación: el suyo, o el de la unidad base por el factor
export const precioLista = (producto, pres) => (pres.id ? (pres.precio ?? Math.round(producto.precio * pres.factor * 100) / 100) : producto.precio);

export function presentacionesDe(productoIds) {
  const rows = productoIds.length
    ? db.prepare(`SELECT id, producto_id, nombre, factor, precio FROM presentaciones WHERE activo=1 AND producto_id IN (${productoIds.map(() => '?').join(',')}) ORDER BY factor`).all(...productoIds)
    : [];
  const mapa = new Map();
  for (const r of rows) { if (!mapa.has(r.producto_id)) mapa.set(r.producto_id, []); mapa.get(r.producto_id).push({ id: r.id, nombre: r.nombre, factor: r.factor, precio: r.precio }); }
  return mapa;
}

// Reemplaza las presentaciones de un producto por la lista dada. Las que ya no vienen se desactivan
// (no se borran: pueden estar en compras y remisiones anteriores).
export function guardarPresentaciones(productoId, lista) {
  if (!Array.isArray(lista)) return;
  const nombres = new Set();
  const conservar = [];
  for (const p of lista) {
    const nombre = String(p.nombre ?? '').trim();
    const factor = Number(p.factor);
    if (!nombre) throw new HttpError(400, 'Cada presentación necesita un nombre (caja, estiba…)');
    if (!(factor > 0) || factor === 1) throw new HttpError(400, `La equivalencia de "${nombre}" debe ser mayor a cero y distinta de 1 (cuántas unidades trae)`);
    const precio = p.precio === undefined || p.precio === null || p.precio === '' ? null : Number(p.precio);
    if (precio !== null && !(precio >= 0)) throw new HttpError(400, `El precio de "${nombre}" es inválido`);
    if (nombres.has(nombre.toLowerCase())) throw new HttpError(400, `La presentación "${nombre}" está repetida`);
    nombres.add(nombre.toLowerCase());
    const ya = db.prepare('SELECT id FROM presentaciones WHERE producto_id=? AND lower(nombre)=lower(?)').get(productoId, nombre)
      ?? (p.id ? db.prepare('SELECT id FROM presentaciones WHERE id=? AND producto_id=?').get(Number(p.id), productoId) : null);
    if (ya) { db.prepare('UPDATE presentaciones SET nombre=?, factor=?, precio=?, activo=1 WHERE id=?').run(nombre, factor, precio, ya.id); conservar.push(ya.id); }
    else conservar.push(Number(db.prepare('INSERT INTO presentaciones (producto_id,nombre,factor,precio) VALUES (?,?,?,?)').run(productoId, nombre, factor, precio).lastInsertRowid));
  }
  const sobran = db.prepare('SELECT id FROM presentaciones WHERE producto_id=? AND activo=1').all(productoId).map((x) => x.id).filter((id) => !conservar.includes(id));
  for (const id of sobran) db.prepare('UPDATE presentaciones SET activo=0 WHERE id=?').run(id);
}
