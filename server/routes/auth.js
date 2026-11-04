import { Router } from 'express';
import { db, HttpError } from '../db.js';
import { firmar, hashClave, verificarClave, cargarUsuario } from '../auth.js';
import { wrap } from '../util.js';

export const publico = Router();
export const privado = Router();

publico.post('/auth/login', wrap((req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario=? AND activo=1').get(String(req.body.usuario || '').trim().toLowerCase());
  if (!u || !verificarClave(String(req.body.clave || ''), u.clave_hash)) throw new HttpError(401, 'Usuario o contraseña incorrectos');
  const { id, nombre, usuario, rol, ruta_id, bodega_id } = cargarUsuario(u.id);
  res.json({ token: firmar(u), user: { id, nombre, usuario, rol, ruta_id, bodega_id } });
}));
publico.get('/health', (_req, res) => res.json({ ok: true }));

privado.get('/auth/me', (req, res) => res.json(req.user));
privado.post('/auth/clave', wrap((req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id=?').get(req.user.id);
  if (!verificarClave(String(req.body.actual || ''), u.clave_hash)) throw new HttpError(400, 'La contraseña actual no coincide');
  const nueva = String(req.body.nueva || '');
  if (nueva.length < 6) throw new HttpError(400, 'La nueva contraseña debe tener al menos 6 caracteres');
  db.prepare('UPDATE usuarios SET clave_hash=? WHERE id=?').run(hashClave(nueva), u.id);
  res.json({ ok: true });
}));
