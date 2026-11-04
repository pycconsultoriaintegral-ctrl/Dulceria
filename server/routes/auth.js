import { Router } from 'express';
import { db, HttpError } from '../db.js';
import { firmar, hashClave, verificarClave, cargarUsuario } from '../auth.js';
import { wrap } from '../util.js';
import { porUsuario, porIp } from '../limitador.js';
import { auditar } from '../auditoria.js';

export const publico = Router();
export const privado = Router();

publico.post('/auth/login', wrap((req, res) => {
  const ingresado = String(req.body.usuario || '').trim().toLowerCase();
  const claveU = `u:${ingresado}`, claveIp = `ip:${req.ip}`;
  const espera = Math.max(porUsuario.espera(claveU), porIp.espera(claveIp));
  if (espera > 0) {
    res.setHeader('Retry-After', Math.ceil(espera / 1000));
    throw new HttpError(429, `Demasiados intentos fallidos. Espera ${Math.ceil(espera / 60000)} minuto(s) e inténtalo de nuevo.`);
  }
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario=? AND activo=1').get(ingresado);
  if (!u || !verificarClave(String(req.body.clave || ''), u.clave_hash)) {
    porUsuario.fallo(claveU); porIp.fallo(claveIp);
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }
  porUsuario.exito(claveU);
  const { id, nombre, usuario, rol, ruta_id, bodega_id } = cargarUsuario(u.id);
  res.json({ token: firmar(u), user: { id, nombre, usuario, rol, ruta_id, bodega_id } });
}));
// Para el monitoreo: responde solo si la base de datos contesta
publico.get('/health', (_req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});

privado.get('/auth/me', (req, res) => res.json(req.user));
privado.post('/auth/clave', wrap((req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id=?').get(req.user.id);
  if (!verificarClave(String(req.body.actual || ''), u.clave_hash)) throw new HttpError(400, 'La contraseña actual no coincide');
  const nueva = String(req.body.nueva || '');
  if (nueva.length < 6) throw new HttpError(400, 'La nueva contraseña debe tener al menos 6 caracteres');
  const nuevoHash = hashClave(nueva);
  db.prepare('UPDATE usuarios SET clave_hash=? WHERE id=?').run(nuevoHash, u.id);
  auditar(req.user, 'cambio de contraseña', 'usuario', u.id, u.usuario);
  // las demás sesiones (otros celulares) quedan cerradas; esta recibe un token nuevo
  res.json({ ok: true, token: firmar({ id: u.id, clave_hash: nuevoHash }) });
}));
