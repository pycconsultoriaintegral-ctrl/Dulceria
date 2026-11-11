import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, HttpError, TODOS_LOS_PERMISOS } from './db.js';

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
// Además lleva lo que su rol le permite: alcance (todo / su bodega / su ruta) y la lista de permisos
export function cargarUsuario(id) {
  const u = db.prepare(`SELECT u.id, u.nombre, u.usuario, u.rol, u.ruta_id, u.activo,
    COALESCE(u.bodega_id, r.bodega_id) AS bodega_id FROM usuarios u LEFT JOIN rutas r ON r.id=u.ruta_id WHERE u.id=?`).get(id);
  return u && { ...u, ...datosDeRol(u.rol) };
}
export function datosDeRol(clave) {
  const r = db.prepare('SELECT nombre, alcance, permisos FROM roles WHERE clave=?').get(clave);
  if (!r) return { rol_nombre: clave, alcance: 'ruta', permisos: [] }; // rol desconocido: sin permisos
  // el administrador siempre tiene todo (no se puede dejar la app sin quien la administre)
  return { rol_nombre: r.nombre, alcance: r.alcance, permisos: clave === 'admin' ? TODOS_LOS_PERMISOS : JSON.parse(r.permisos) };
}
// Usuario interno (resumen automático, tareas programadas): todo el alcance y todos los permisos
export const usuarioSistema = () => ({ id: null, rol: 'admin', alcance: 'todo', permisos: TODOS_LOS_PERMISOS });

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

// Exige un permiso del rol del usuario (ver PERMISOS en db.js)
export const requierePermiso = (permiso, msg) => (req, _res, next) =>
  req.user.permisos?.includes(permiso) ? next() : next(new HttpError(403, msg || 'No tienes permiso para esto'));
export const soloAdmin = requierePermiso('administrar', 'Solo quien administra la app puede hacer esto');
