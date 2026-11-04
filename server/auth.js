import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, HttpError } from './db.js';

export function hashClave(clave) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(clave, salt, 64).toString('hex')}`;
}
export function verificarClave(clave, hash) {
  const [salt, h] = hash.split(':');
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(clave, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function secreto() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  let r = db.prepare("SELECT valor FROM config WHERE clave='jwt_secret'").get();
  if (!r) {
    const v = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT INTO config (clave, valor) VALUES ('jwt_secret', ?)").run(v);
    return v;
  }
  return r.valor;
}

// Usuario con su bodega efectiva: la propia (encargado) o la de su ruta (vendedor)
export function cargarUsuario(id) {
  return db.prepare(`SELECT u.id, u.nombre, u.usuario, u.rol, u.ruta_id, u.activo,
    COALESCE(u.bodega_id, r.bodega_id) AS bodega_id FROM usuarios u LEFT JOIN rutas r ON r.id=u.ruta_id WHERE u.id=?`).get(id);
}

// El token lleva una huella de la contraseña: al cambiarla (o restablecerla) las sesiones anteriores dejan de valer
const huella = (claveHash) => crypto.createHash('sha256').update(claveHash).digest('hex').slice(0, 16);
export const firmar = (u) => jwt.sign({ id: u.id, v: huella(u.clave_hash) }, secreto(), { expiresIn: '30d' });

export function requireAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new HttpError(401, 'No autenticado');
    let payload;
    try { payload = jwt.verify(token, secreto()); } catch { throw new HttpError(401, 'Sesión inválida o vencida'); }
    const u = cargarUsuario(payload.id);
    if (!u || !u.activo) throw new HttpError(401, 'Usuario inactivo');
    const actual = db.prepare('SELECT clave_hash FROM usuarios WHERE id=?').get(payload.id)?.clave_hash;
    if (!payload.v || !actual || payload.v !== huella(actual)) throw new HttpError(401, 'Tu sesión terminó (cambió la contraseña). Ingresa de nuevo.');
    req.user = u;
    next();
  } catch (e) { next(e); }
}

export const soloAdmin = (req, _res, next) =>
  req.user.rol === 'admin' ? next() : next(new HttpError(403, 'Solo el administrador puede hacer esto'));
