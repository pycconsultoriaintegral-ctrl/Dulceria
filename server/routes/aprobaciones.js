// Pago anticipado: soportes (foto del comprobante) y aprobación de las remisiones pendientes.
//  - Quien vende crea la remisión y adjunta el soporte; no puede aprobarla.
//  - Aprueban el encargado de la bodega a la que pertenece el punto de venta y el administrador.
//  - Al aprobar: el inventario sale, el pago queda registrado como transferencia y la remisión pasa a ser válida.
import { Router } from 'express';
import { db, tx, ahora, HttpError, moverStock, permiteSinStock } from '../db.js';
import { wrap, n, req_, entero } from '../util.js';
import { sqlAlcance, exigir, puedeBodega, can } from '../scope.js';
import { aBase } from '../presentaciones.js';
import { auditar } from '../auditoria.js';
import { guardarSoporte, listarSoportes } from '../soportes.js';
import { cargarRemision, ubDelPunto } from './ventas.js';

const router = Router();
const aprueba = (u, r) => can(u, 'aprobar_pagos') && puedeBodega(u, r.bodega_id);

// Remisiones pendientes de aprobación dentro del alcance del usuario (el vendedor ve solo las de su ruta)
router.get('/aprobaciones', wrap((req, res) => {
  const filas = db.prepare(`SELECT r.id, r.consecutivo, r.fecha_solicitud AS fecha, r.total, c.nombre AS cliente, c.negocio, u.nombre AS vendedor, ru.nombre AS ruta, b.nombre AS bodega,
      (SELECT COUNT(*) FROM soportes s WHERE s.remision_id=r.id) AS soportes
    FROM remisiones r JOIN clientes c ON c.id=r.cliente_id JOIN usuarios u ON u.id=r.usuario_id JOIN bodegas b ON b.id=r.bodega_id LEFT JOIN rutas ru ON ru.id=r.ruta_id
    WHERE r.anulada=2 AND ${sqlAlcance(req.user, 'r')} ORDER BY r.id`).all();
  res.json(filas);
}));

router.get('/remisiones/:id/soportes', wrap((req, res) => {
  const r = cargarRemision(req.user, entero(req.params.id));
  res.json(r.soportes);
}));

router.post('/remisiones/:id/soportes', wrap((req, res) => {
  const r = cargarRemision(req.user, entero(req.params.id));
  if (r.anulada === 1) throw new HttpError(409, 'La remisión está anulada: no admite soportes');
  const id = tx(() => guardarSoporte(r.id, req.body.imagen, req.user, n(req.body.nota)));
  auditar(req.user, 'adjuntar soporte', 'remision', r.id, `R-${r.consecutivo}`);
  res.json({ id, soportes: listarSoportes(r.id) });
}));

// La imagen se sirve solo a quien tiene alcance sobre la remisión
router.get('/soportes/:id', wrap((req, res) => {
  const s = db.prepare('SELECT remision_id, mime, datos FROM soportes WHERE id=?').get(entero(req.params.id));
  if (!s) throw new HttpError(404, 'Soporte no encontrado');
  cargarRemision(req.user, s.remision_id);
  res.setHeader('Content-Type', s.mime);
  res.setHeader('Content-Disposition', 'inline');
  res.send(Buffer.from(s.datos));
}));

router.post('/remisiones/:id/aprobar', wrap((req, res) => {
  const out = tx(() => {
    const r = cargarRemision(req.user, entero(req.params.id));
    exigir(aprueba(req.user, r), 'No tienes permiso para aprobar pagos de esa bodega');
    exigir(r.usuario_id !== req.user.id || req.user.rol === 'admin', 'No puedes aprobar tu propia venta: pide a otro encargado o al administrador');
    if (!r.pendiente) throw new HttpError(409, r.anulada ? 'La remisión ya está anulada o rechazada' : 'La remisión no está pendiente de aprobación');
    if (!r.soportes.length) throw new HttpError(409, 'Falta el soporte de pago: adjunta la foto de la transferencia antes de aprobar');
    const ub = ubDelPunto(r);
    // el inventario se descuenta ahora; si entre tanto se agotó, falla con el nombre del producto
    for (const i of r.items) moverStock({ productoId: i.producto_id, ubicacion: ub, delta: -aBase(i.cantidad, { factor: i.factor }), tipo: 'venta', costo: i.costo / i.factor, referencia: `R-${r.consecutivo}`, usuarioId: req.user.id, permitirNegativo: permiteSinStock() });
    const fecha = ahora();
    // la venta cuenta desde que se aprueba (no desde que se pidió): así el cierre del día y los reportes cuadran con el dinero recibido
    db.prepare('UPDATE remisiones SET anulada=0, fecha=?, pagado=total, aprobado_por=?, fecha_aprobacion=? WHERE id=?').run(fecha, req.user.id, fecha, r.id);
    db.prepare('INSERT INTO pagos (fecha,cliente_id,remision_id,ruta_id,bodega_id,usuario_id,valor,metodo,nota) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(fecha, r.cliente_id, r.id, r.ruta_id, r.bodega_id, req.user.id, r.total, 'transferencia', n(req.body.nota) ?? 'Pago anticipado aprobado');
    auditar(req.user, 'aprobar pago', 'remision', r.id, `R-${r.consecutivo} · ${r.cliente} · $${r.total} · ${r.soportes.length} soporte(s)`);
    return { consecutivo: r.consecutivo };
  });
  res.json({ ok: true, ...out });
}));

router.post('/remisiones/:id/rechazar', wrap((req, res) => {
  tx(() => {
    const r = cargarRemision(req.user, entero(req.params.id));
    exigir(aprueba(req.user, r), 'No tienes permiso para rechazar pagos de esa bodega');
    if (!r.pendiente) throw new HttpError(409, 'La remisión no está pendiente de aprobación');
    const motivo = req_(req.body.motivo, 'Indica por qué se rechaza el pago');
    db.prepare('UPDATE remisiones SET anulada=1, motivo_anulacion=?, aprobado_por=?, fecha_aprobacion=? WHERE id=?')
      .run(`Pago rechazado: ${motivo}`, req.user.id, ahora(), r.id);
    auditar(req.user, 'rechazar pago', 'remision', r.id, `R-${r.consecutivo} · ${r.cliente} · $${r.total} · ${motivo}`);
  });
  res.json({ ok: true });
}));

export default router;
