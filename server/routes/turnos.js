// Turnos de vendedor: abre con una base de efectivo y cierra contando lo que entrega.
// El esperado del turno = base + efectivo cobrado − gastos, todo desde que abrió (en su punto y a su nombre).
import { Router } from 'express';
import { db, ahora, HttpError, getConfig } from '../db.js';
import { wrap, num, n, r2, conPrefijo } from '../util.js';
import { requierePermiso } from '../auth.js';
import { resolverPunto, sqlAlcance, sqlPunto, can, getRuta, getBodega } from '../scope.js';
import { auditar } from '../auditoria.js';

const router = Router();

export const turnoAbierto = (usuarioId) => db.prepare('SELECT * FROM turnos WHERE usuario_id=? AND cerrado_en IS NULL ORDER BY id DESC LIMIT 1').get(usuarioId);

// Lo ocurrido en el turno (hasta ahora o hasta que cerró)
function resumen(t) {
  const hasta = t.cerrado_en ?? '9999';
  const punto = { ruta_id: t.ruta_id, bodega_id: t.bodega_id };
  const cp = (a) => sqlPunto(a, punto);
  const v = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM remisiones r WHERE r.anulada=0 AND r.usuario_id=? AND ${cp('r')} AND r.fecha>=? AND r.fecha<=?`).get(t.usuario_id, t.abierto_en, hasta);
  const c = db.prepare(`SELECT COALESCE(SUM(CASE WHEN metodo='efectivo' THEN valor END),0) AS efectivo, COALESCE(SUM(CASE WHEN metodo<>'efectivo' THEN valor END),0) AS transferencias
    FROM pagos p WHERE p.anulado=0 AND p.usuario_id=? AND ${cp('p')} AND p.fecha>=? AND p.fecha<=?`).get(t.usuario_id, t.abierto_en, hasta);
  const g = db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM gastos g WHERE g.usuario_id=? AND ${cp('g')} AND g.fecha>=? AND g.fecha<=?`).get(t.usuario_id, t.abierto_en, hasta).v;
  return { remisiones: v.n, ventas: r2(v.total), efectivo: r2(c.efectivo), transferencias: r2(c.transferencias), gastos: r2(g), esperado: r2(t.base + c.efectivo - g) };
}
const nombrePunto = (t) => (t.ruta_id ? conPrefijo('Ruta', getRuta(t.ruta_id)?.nombre ?? t.ruta_id) : `Mostrador ${getBodega(t.bodega_id)?.nombre ?? t.bodega_id}`);

router.get('/actual', wrap((req, res) => {
  const t = turnoAbierto(req.user.id);
  res.json({ exigir: getConfig().exigir_turno === '1', turno: t ? { ...t, punto_nombre: nombrePunto(t), ...resumen(t) } : null });
}));

router.post('/abrir', requierePermiso('vender'), wrap((req, res) => {
  if (turnoAbierto(req.user.id)) throw new HttpError(409, 'Ya tienes un turno abierto: ciérralo antes de abrir otro');
  const punto = resolverPunto(req.user, req.body.punto);
  const base = req.body.base === undefined || req.body.base === '' ? 0 : num(req.body.base, 'Base de efectivo');
  if (base < 0) throw new HttpError(400, 'La base no puede ser negativa');
  const id = Number(db.prepare('INSERT INTO turnos (usuario_id,punto,ruta_id,bodega_id,abierto_en,base) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, punto.codigo, punto.ruta_id, punto.bodega_id, ahora(), base).lastInsertRowid);
  auditar(req.user, 'abrir turno', 'turno', id, `${punto.codigo} · base $${base}`);
  res.json({ id });
}));

router.post('/cerrar', wrap((req, res) => {
  const t = turnoAbierto(req.user.id);
  if (!t) throw new HttpError(409, 'No tienes un turno abierto');
  const r = resumen(t);
  const entregado = num(req.body.entregado, 'Efectivo que entregas');
  if (entregado < 0) throw new HttpError(400, 'El efectivo no puede ser negativo');
  const diferencia = r2(entregado - r.esperado);
  db.prepare('UPDATE turnos SET cerrado_en=?, ventas_efectivo=?, abonos_efectivo=?, transferencias=?, gastos=?, esperado=?, entregado=?, diferencia=?, nota=? WHERE id=?')
    .run(ahora(), r.efectivo, 0, r.transferencias, r.gastos, r.esperado, entregado, diferencia, n(req.body.nota), t.id);
  if (diferencia !== 0) auditar(req.user, 'turno con diferencia', 'turno', t.id, `${t.punto} · esperado $${r.esperado} · entregado $${entregado} · diferencia $${diferencia}`);
  res.json({ ...r, entregado, diferencia });
}));

// Turnos de un día: quien tiene informes ve los de su alcance; los demás, solo los suyos
router.get('/', wrap((req, res) => {
  const fecha = req.query.fecha || ahora().slice(0, 10);
  const alcance = sqlAlcance(req.user, 't');
  const propios = can(req.user, 'informes') ? '1=1' : `t.usuario_id=${Number(req.user.id)}`;
  const filas = db.prepare(`SELECT t.*, us.nombre AS vendedor FROM turnos t JOIN usuarios us ON us.id=t.usuario_id
    WHERE ${alcance} AND ${propios} AND (substr(t.abierto_en,1,10)=? OR t.cerrado_en IS NULL) ORDER BY t.id DESC LIMIT 200`).all(fecha);
  res.json(filas.map((t) => ({ ...t, punto_nombre: nombrePunto(t), ...(t.cerrado_en ? {} : resumen(t)) })));
}));

export default router;
