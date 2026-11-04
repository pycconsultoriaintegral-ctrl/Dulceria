import { Router } from 'express';
import { db } from '../db.js';
import { soloAdmin } from '../auth.js';
import { wrap } from '../util.js';

const router = Router();

// Registro de actividad: solo el administrador. Filtros: accion, entidad, usuario_id, desde, hasta, q (texto)
router.get('/', soloAdmin, wrap((req, res) => {
  const q = req.query;
  const cond = ['substr(fecha,1,10) BETWEEN @desde AND @hasta'];
  const p = { desde: q.desde || '0000-01-01', hasta: q.hasta || '9999-12-31' };
  if (q.accion) { cond.push('accion=@accion'); p.accion = String(q.accion); }
  if (q.entidad) { cond.push('entidad=@entidad'); p.entidad = String(q.entidad); }
  if (q.usuario_id) { cond.push('usuario_id=@usuario_id'); p.usuario_id = Number(q.usuario_id); }
  if (q.q) { cond.push("(detalle LIKE @q OR usuario LIKE @q OR accion LIKE @q)"); p.q = `%${String(q.q).replace(/[%_]/g, '')}%`; }
  const limite = Math.min(Number(q.limite) || 200, 1000);
  res.json(db.prepare(`SELECT * FROM auditoria WHERE ${cond.join(' AND ')} ORDER BY id DESC LIMIT ${limite}`).all(p));
}));

export default router;
