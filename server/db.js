import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DB_FILE || path.resolve('data/dulceria.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// ubicacion 0 = bodega central; ubicacion N = inventario en la ruta N
db.exec(`
CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS rutas (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, activa INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, usuario TEXT NOT NULL UNIQUE, clave_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin','vendedor')), ruta_id INTEGER REFERENCES rutas(id), activo INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY, codigo TEXT, nombre TEXT NOT NULL, unidad TEXT DEFAULT 'und',
  precio REAL NOT NULL DEFAULT 0, costo REAL NOT NULL DEFAULT 0, stock_minimo REAL DEFAULT 0, activo INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS stock (
  producto_id INTEGER NOT NULL REFERENCES productos(id), ubicacion INTEGER NOT NULL, cantidad REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (producto_id, ubicacion));
CREATE TABLE IF NOT EXISTS movimientos (
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, producto_id INTEGER NOT NULL REFERENCES productos(id),
  ubicacion INTEGER NOT NULL, tipo TEXT NOT NULL, cantidad REAL NOT NULL, costo REAL DEFAULT 0,
  referencia TEXT, usuario_id INTEGER, nota TEXT);
CREATE INDEX IF NOT EXISTS ix_mov_prod ON movimientos(producto_id, fecha);
CREATE TABLE IF NOT EXISTS proveedores (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, telefono TEXT, nota TEXT, activo INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, proveedor_id INTEGER REFERENCES proveedores(id), factura TEXT,
  total REAL NOT NULL, pagado REAL NOT NULL DEFAULT 0, nota TEXT, usuario_id INTEGER, anulada INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS compra_items (
  id INTEGER PRIMARY KEY, compra_id INTEGER NOT NULL REFERENCES compras(id), producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad REAL NOT NULL, costo REAL NOT NULL);
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, negocio TEXT, telefono TEXT, direccion TEXT, documento TEXT,
  ruta_id INTEGER REFERENCES rutas(id), activo INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS remisiones (
  id INTEGER PRIMARY KEY, uuid TEXT UNIQUE, consecutivo INTEGER NOT NULL UNIQUE, fecha TEXT NOT NULL,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id), ruta_id INTEGER NOT NULL, usuario_id INTEGER NOT NULL,
  tipo_pago TEXT NOT NULL CHECK (tipo_pago IN ('contado','credito')), subtotal REAL NOT NULL, descuento REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL, pagado REAL NOT NULL DEFAULT 0, nota TEXT, anulada INTEGER DEFAULT 0, motivo_anulacion TEXT);
CREATE TABLE IF NOT EXISTS remision_items (
  id INTEGER PRIMARY KEY, remision_id INTEGER NOT NULL REFERENCES remisiones(id), producto_id INTEGER NOT NULL REFERENCES productos(id),
  descripcion TEXT NOT NULL, cantidad REAL NOT NULL, precio REAL NOT NULL, costo REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY, uuid TEXT UNIQUE, fecha TEXT NOT NULL, cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  remision_id INTEGER REFERENCES remisiones(id), ruta_id INTEGER, usuario_id INTEGER, valor REAL NOT NULL, metodo TEXT DEFAULT 'efectivo',
  nota TEXT, anulado INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS gastos (
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, ruta_id INTEGER, usuario_id INTEGER, concepto TEXT NOT NULL, valor REAL NOT NULL);
CREATE TABLE IF NOT EXISTS cierres (
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, ruta_id INTEGER NOT NULL, usuario_id INTEGER,
  ventas_contado REAL, abonos REAL, gastos REAL, esperado REAL, entregado REAL, diferencia REAL, nota TEXT,
  UNIQUE (fecha, ruta_id));
`);

export const now = () => new Date().toISOString();
// Fecha local del negocio (Colombia por defecto) en formato YYYY-MM-DD
export const hoy = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ_NEGOCIO || 'America/Bogota' }).format(d);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function getStock(productoId, ubicacion) {
  return db.prepare('SELECT cantidad FROM stock WHERE producto_id=? AND ubicacion=?').get(productoId, ubicacion)?.cantidad ?? 0;
}

// Mueve inventario y deja rastro en el kardex. delta > 0 entra, < 0 sale.
export function moverStock({ productoId, ubicacion, delta, tipo, costo = 0, referencia = null, usuarioId = null, nota = null, permitirNegativo = false }) {
  const actual = getStock(productoId, ubicacion);
  if (!permitirNegativo && actual + delta < -1e-9) {
    const p = db.prepare('SELECT nombre FROM productos WHERE id=?').get(productoId);
    throw new HttpError(409, `Inventario insuficiente de "${p?.nombre}" (disponible ${actual})`);
  }
  db.prepare(`INSERT INTO stock (producto_id, ubicacion, cantidad) VALUES (?,?,?)
    ON CONFLICT(producto_id, ubicacion) DO UPDATE SET cantidad = cantidad + excluded.cantidad`).run(productoId, ubicacion, delta);
  db.prepare(`INSERT INTO movimientos (fecha, producto_id, ubicacion, tipo, cantidad, costo, referencia, usuario_id, nota)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(now(), productoId, ubicacion, tipo, delta, costo, referencia, usuarioId, nota);
}

export function getConfig() {
  const o = { negocio: 'Mi Dulcería', nit: '', telefono: '', direccion: '', pie_remision: 'Gracias por su compra. Documento sin validez tributaria (remisión).', prefijo: 'R' };
  for (const r of db.prepare('SELECT clave, valor FROM config').all()) o[r.clave] = r.valor;
  return o;
}

// Fecha y hora local del negocio: "YYYY-MM-DD HH:MM:SS" (los primeros 10 caracteres son el día)
export const ahora = (d = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: process.env.TZ_NEGOCIO || 'America/Bogota', dateStyle: 'short', timeStyle: 'medium' }).format(d);
