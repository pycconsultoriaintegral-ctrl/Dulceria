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

export const firmar = (u) => jwt.sign({ id: u.id }, secreto(), { expiresIn: '30d' });

export function requireAuth(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new HttpError(401, 'No autenticado');
    let payload;
    try { payload = jwt.verify(token, secreto()); } catch { throw new HttpError(401, 'Sesión inválida o vencida'); }
    const u = db.prepare('SELECT id, nombre, usuario, rol, ruta_id, activo FROM usuarios WHERE id=?').get(payload.id);
    if (!u || !u.activo) throw new HttpError(401, 'Usuario inactivo');
    req.user = u;
    next();
  } catch (e) { next(e); }
}

export const soloAdmin = (req, _res, next) =>
  req.user.rol === 'admin' ? next() : next(new HttpError(403, 'Solo el administrador puede hacer esto'));
