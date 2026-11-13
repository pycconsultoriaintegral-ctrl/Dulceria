import { HttpError } from './db.js';

// Envuelve un handler para que los errores (síncronos o async) lleguen al middleware de errores
export const wrap = (fn) => (req, res, next) => { try { Promise.resolve(fn(req, res)).catch(next); } catch (e) { next(e); } };
export const n = (v) => (v === undefined || v === '' ? null : v);
export const num = (v, campo = 'valor') => {
  const x = Number(v);
  if (!Number.isFinite(x)) throw new HttpError(400, `${campo} inválido`);
  return x;
};
export const req_ = (v, msg) => {
  if (v === undefined || v === null || String(v).trim() === '') throw new HttpError(400, msg);
  return typeof v === 'string' ? v.trim() : v;
};
export const r2 = (x) => Math.round(x * 100) / 100;
export const entero = (v, msg = 'Valor inválido') => {
  const x = Number(v);
  if (!Number.isInteger(x)) throw new HttpError(400, msg);
  return x;
};

// "Ruta" + "Norte" -> "Ruta Norte"; si el nombre ya empieza por el prefijo ("Ruta Norte") no se repite
export const conPrefijo = (prefijo, nombre) =>
  String(nombre ?? '').toLowerCase().startsWith(prefijo.toLowerCase()) ? String(nombre) : `${prefijo} ${nombre}`;

// Coordenadas válidas (o null): latitud -90..90 y longitud -180..180
export function coordenada(lat, lng) {
  if (lat === undefined || lat === null || lat === '' || lng === undefined || lng === null || lng === '') return null;
  const a = Number(lat), o = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90 || Math.abs(o) > 180) return null;
  return { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(o * 1e6) / 1e6 };
}
