// Alcance (hasta dónde ve cada usuario, según su rol) y permisos (qué funciones puede usar):
//  - alcance 'todo': todas las bodegas y rutas.
//  - alcance 'bodega': su bodega y las rutas que pertenecen a ella.
//  - alcance 'ruta': solo su ruta.
import { db, HttpError } from './db.js';
import { conPrefijo } from './util.js';

export const B = (id) => `B${id}`;
export const R = (id) => `R${id}`;

export function parseUb(codigo) {
  const m = /^([BR])(\d+)$/.exec(String(codigo ?? ''));
  if (!m) throw new HttpError(400, 'Ubicación inválida');
  return { tipo: m[1], id: Number(m[2]) };
}

export const getRuta = (id) => db.prepare('SELECT * FROM rutas WHERE id=?').get(id);
export const getBodega = (id) => db.prepare('SELECT * FROM bodegas WHERE id=?').get(id);

export function nombreUb(codigo) {
  const { tipo, id } = parseUb(codigo);
  if (tipo === 'B') return conPrefijo('Bodega', getBodega(id)?.nombre ?? id);
  return conPrefijo('Ruta', getRuta(id)?.nombre ?? id);
}

export const exigir = (cond, msg = 'No tienes permiso para esto') => { if (!cond) throw new HttpError(403, msg); };
export const can = (u, permiso) => !!u.permisos?.includes(permiso);
export const exigirPermiso = (u, permiso, msg) => exigir(can(u, permiso), msg);

export function puedeBodega(u, bodegaId) {
  if (u.alcance === 'todo') return true;
  return u.alcance === 'bodega' && u.bodega_id === Number(bodegaId);
}
export function puedeRuta(u, rutaId) {
  if (u.alcance === 'todo') return true;
  if (u.alcance === 'ruta') return u.ruta_id === Number(rutaId);
  return getRuta(rutaId)?.bodega_id === u.bodega_id;
}
export function puedeUb(u, codigo) {
  const p = parseUb(codigo);
  return p.tipo === 'B' ? puedeBodega(u, p.id) : puedeRuta(u, p.id);
}

// Punto de venta/cobro: una ruta o el mostrador de una bodega.
// El vendedor siempre usa su ruta; los demás eligen (código 'R3' o 'B1').
export function resolverPunto(u, codigo) {
  if (u.alcance === 'ruta') {
    if (!u.ruta_id) throw new HttpError(400, 'Tu usuario no tiene ruta asignada. Pide al administrador que la asigne.');
    const r = getRuta(u.ruta_id);
    return { codigo: R(r.id), ruta_id: r.id, bodega_id: r.bodega_id };
  }
  if (!codigo) {
    if (u.alcance === 'bodega') return { codigo: B(u.bodega_id), ruta_id: null, bodega_id: u.bodega_id };
    throw new HttpError(400, 'Elige el punto de venta (una ruta o el mostrador de una bodega)');
  }
  const p = parseUb(codigo);
  exigir(puedeUb(u, codigo), 'No tienes permiso sobre ese punto de venta');
  if (p.tipo === 'R') {
    const r = getRuta(p.id);
    if (!r) throw new HttpError(400, 'La ruta no existe');
    return { codigo: R(r.id), ruta_id: r.id, bodega_id: r.bodega_id };
  }
  if (!getBodega(p.id)) throw new HttpError(400, 'La bodega no existe');
  return { codigo: B(p.id), ruta_id: null, bodega_id: p.id };
}

// Condición SQL para "este punto" sobre una tabla con ruta_id y bodega_id (los valores son enteros ya validados)
export function sqlPunto(alias, punto) {
  return punto.ruta_id
    ? `${alias}.ruta_id=${Number(punto.ruta_id)}`
    : `${alias}.ruta_id IS NULL AND ${alias}.bodega_id=${Number(punto.bodega_id)}`;
}

// Condición SQL que limita lo que cada rol puede ver en tablas con ruta_id y bodega_id,
// más filtros opcionales (punto, ruta_id, bodega_id) que se validan contra el alcance del usuario.
export function sqlAlcance(u, alias, { punto, ruta_id, bodega_id } = {}) {
  const c = [];
  if (u.alcance === 'ruta') {
    if (!u.ruta_id) throw new HttpError(400, 'Tu usuario no tiene ruta asignada');
    c.push(`${alias}.ruta_id=${Number(u.ruta_id)}`);
  } else if (u.alcance === 'bodega') {
    c.push(`${alias}.bodega_id=${Number(u.bodega_id)}`);
  }
  if (punto) {
    const p = parseUb(punto);
    exigir(puedeUb(u, punto));
    c.push(sqlPunto(alias, p.tipo === 'R' ? { ruta_id: p.id } : { ruta_id: null, bodega_id: p.id }));
  }
  if (ruta_id) { exigir(puedeRuta(u, ruta_id)); c.push(`${alias}.ruta_id=${Number(ruta_id)}`); }
  if (bodega_id) { exigir(puedeBodega(u, bodega_id)); c.push(`${alias}.bodega_id=${Number(bodega_id)}`); }
  return c.length ? c.join(' AND ') : '1=1';
}

// Ubicaciones (bodegas con sus rutas) que el usuario puede ver, para selectores
export function ubicacionesPermitidas(u) {
  const bodegas = db.prepare('SELECT id, nombre, direccion, activa FROM bodegas ORDER BY nombre').all();
  const rutas = db.prepare('SELECT id, nombre, bodega_id, activa FROM rutas ORDER BY nombre').all();
  const out = [];
  for (const b of bodegas) {
    let rs = rutas.filter((r) => r.bodega_id === b.id);
    if (u.alcance === 'bodega' && b.id !== u.bodega_id) continue;
    if (u.alcance === 'ruta') { rs = rs.filter((r) => r.id === u.ruta_id); if (!rs.length) continue; }
    out.push({ ...b, rutas: rs, puede_mostrador: u.alcance !== 'ruta' });
  }
  return out;
}
