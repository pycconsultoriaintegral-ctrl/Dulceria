// Cuadre semanal (los sábados) por punto de venta: ruta (carro) o mostrador de bodega.
//  - Efectivo: lo que debía entregarse cada día (efectivo cobrado − gastos) contra lo entregado en los cierres diarios.
//  - Transferencias: las registradas en la semana, que el encargado marca como verificadas en el banco.
//  - Cartera y gastos de la semana.
//  - Inventario: conteo físico contra el sistema, valorizado al costo; se puede ajustar el inventario al guardar.
// Solo el administrador y el encargado de la bodega (de su bodega y sus rutas).
import { Router } from 'express';
import { db, tx, ahora, hoy, HttpError, moverStock, getStock } from '../db.js';
import { wrap, n, num, r2, entero, conPrefijo } from '../util.js';
import { resolverPunto, sqlPunto, exigir, can, puedeBodega, ubicacionesPermitidas } from '../scope.js';
import { auditar } from '../auditoria.js';
import { calcularCierre, ubDelPunto } from './ventas.js';

const router = Router();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const sumarDias = (f, d) => { const x = new Date(`${f}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

// Semana por defecto: del lunes de esta semana hasta hoy (el sábado, de lunes a sábado)
export function semana(q = {}) {
  const hasta = FECHA.test(q.hasta || '') ? q.hasta : hoy();
  const dia = new Date(`${hasta}T12:00:00Z`).getUTCDay(); // 0 domingo … 6 sábado
  const desde = FECHA.test(q.desde || '') ? q.desde : sumarDias(hasta, -((dia + 6) % 7));
  if (desde > hasta) throw new HttpError(400, 'La fecha inicial es posterior a la final');
  if (sumarDias(desde, 31) < hasta) throw new HttpError(400, 'El cuadre abarca máximo 31 días');
  return { desde, hasta };
}
const dias = ({ desde, hasta }) => { const out = []; for (let f = desde; f <= hasta; f = sumarDias(f, 1)) out.push(f); return out; };

function puntoDeCuadre(u, codigo) {
  exigir(can(u, 'cuadre'), 'No tienes permiso para el cuadre semanal');
  const p = resolverPunto(u, codigo);
  exigir(puedeBodega(u, p.bodega_id), 'Ese punto pertenece a otra bodega');
  return p;
}
const nombrePunto = (p) => (p.ruta_id ? conPrefijo('Ruta', db.prepare('SELECT nombre FROM rutas WHERE id=?').get(p.ruta_id)?.nombre)
  : `Mostrador ${db.prepare('SELECT nombre FROM bodegas WHERE id=?').get(p.bodega_id)?.nombre}`);

// Números de la semana de un punto (sin el inventario)
export function resumenSemana(punto, rango) {
  const porDia = dias(rango).map((fecha) => {
    const c = calcularCierre(fecha, punto);
    return { fecha, remisiones: c.remisiones, ventas: c.ventas_total, contado: c.ventas_contado, credito: c.ventas_credito, efectivo: c.cobrado_efectivo,
      transferencias: c.transferencias, gastos: c.gastos, esperado: c.esperado, entregado: c.cierre?.entregado ?? null, diferencia: c.cierre?.diferencia ?? null };
  });
  const s = (k) => r2(porDia.reduce((a, d) => a + (d[k] ?? 0), 0));
  const conMovimiento = porDia.filter((d) => d.remisiones || d.efectivo || d.transferencias || d.gastos);
  const sinCierre = conMovimiento.filter((d) => d.entregado === null).map((d) => d.fecha);
  const cp = sqlPunto('p', punto);
  const transferencias = db.prepare(`SELECT p.id, p.fecha, p.valor, p.verificado, p.fecha_verificado, c.nombre AS cliente, r.consecutivo, u.nombre AS verificado_por
    FROM pagos p JOIN clientes c ON c.id=p.cliente_id LEFT JOIN remisiones r ON r.id=p.remision_id LEFT JOIN usuarios u ON u.id=p.verificado_por
    WHERE p.anulado=0 AND p.metodo<>'efectivo' AND ${cp} AND substr(p.fecha,1,10) BETWEEN ? AND ? ORDER BY p.fecha`).all(rango.desde, rango.hasta);
  const gastos = db.prepare(`SELECT g.fecha, g.concepto, g.valor FROM gastos g WHERE ${sqlPunto('g', punto)} AND substr(g.fecha,1,10) BETWEEN ? AND ? ORDER BY g.fecha`).all(rango.desde, rango.hasta);
  const cartera = db.prepare(`SELECT c.id, c.nombre, c.negocio, SUM(r.total-r.pagado) AS saldo, MIN(r.fecha) AS desde FROM remisiones r JOIN clientes c ON c.id=r.cliente_id
    WHERE r.anulada=0 AND ${sqlPunto('r', punto)} GROUP BY c.id HAVING saldo > 0.005 ORDER BY saldo DESC`).all();
  const entregado = s('entregado');
  const esperadoConCierre = r2(porDia.filter((d) => d.entregado !== null).reduce((a, d) => a + d.esperado, 0));
  const verificadas = r2(transferencias.filter((t) => t.verificado).reduce((a, t) => a + t.valor, 0));
  return {
    punto: punto.codigo, nombre: nombrePunto(punto), ...rango, dias: porDia,
    totales: {
      remisiones: porDia.reduce((a, d) => a + d.remisiones, 0), ventas: s('ventas'), contado: s('contado'), credito: s('credito'),
      efectivo: s('efectivo'), gastos: s('gastos'), esperado: s('esperado'), entregado,
      // la diferencia de efectivo solo se mide en los días que tienen cierre; los días sin cierre se avisan aparte
      diferencia_efectivo: r2(entregado - esperadoConCierre), dias_sin_cierre: sinCierre,
      transferencias: s('transferencias'), transferencias_verificadas: verificadas, transferencias_por_verificar: r2(s('transferencias') - verificadas),
      cartera: r2(cartera.reduce((a, c) => a + c.saldo, 0)),
    },
    transferencias, gastos, cartera,
  };
}

// Lista de puntos del alcance con sus números de la semana (pantalla principal del cuadre)
router.get('/cuadres/semana', wrap((req, res) => {
  exigir(can(req.user, 'cuadre'), 'No tienes permiso para el cuadre semanal');
  const rango = semana(req.query);
  const puntos = [];
  for (const b of ubicacionesPermitidas(req.user)) {
    if (!b.activa) continue;
    puntos.push({ codigo: `B${b.id}`, ruta_id: null, bodega_id: b.id });
    for (const r of b.rutas) if (r.activa) puntos.push({ codigo: `R${r.id}`, ruta_id: r.id, bodega_id: b.id });
  }
  const guardado = db.prepare('SELECT id, fecha, diferencia_efectivo, diferencia_inventario, productos_con_diferencia FROM cuadres WHERE punto=? AND desde=? AND hasta=?');
  const filas = puntos.map((p) => {
    const r = resumenSemana(p, rango);
    return { punto: p.codigo, nombre: r.nombre, bodega_id: p.bodega_id, totales: r.totales, cuadre: guardado.get(p.codigo, rango.desde, rango.hasta) ?? null };
  });
  // los puntos sin movimiento en la semana van al final
  filas.sort((a, b) => (b.totales.ventas > 0) - (a.totales.ventas > 0));
  const t = (k) => r2(filas.reduce((a, f) => a + f.totales[k], 0));
  res.json({ ...rango, puntos: filas, totales: { ventas: t('ventas'), efectivo: t('efectivo'), entregado: t('entregado'), diferencia_efectivo: t('diferencia_efectivo'),
    transferencias: t('transferencias'), transferencias_verificadas: t('transferencias_verificadas'), gastos: t('gastos'), cartera: t('cartera') } });
}));

// Detalle de un punto, con el inventario del sistema para el conteo físico
router.get('/cuadres/detalle', wrap((req, res) => {
  const punto = puntoDeCuadre(req.user, req.query.punto);
  const rango = semana(req.query);
  const r = resumenSemana(punto, rango);
  r.inventario = db.prepare(`SELECT p.id, p.nombre, p.unidad, p.costo, COALESCE(s.cantidad,0) AS sistema FROM productos p LEFT JOIN stock s ON s.producto_id=p.id AND s.ubicacion=?
    WHERE p.activo=1 OR COALESCE(s.cantidad,0)<>0 ORDER BY (COALESCE(s.cantidad,0)=0), p.nombre`).all(ubDelPunto(punto));
  const g = db.prepare('SELECT c.*, u.nombre AS usuario FROM cuadres c LEFT JOIN usuarios u ON u.id=c.usuario_id WHERE c.punto=? AND c.desde=? AND c.hasta=?').get(punto.codigo, rango.desde, rango.hasta);
  if (g) { g.datos = JSON.parse(g.datos || '{}'); }
  r.cuadre = g ?? null;
  res.json(r);
}));

// Marca (o desmarca) una transferencia como verificada en la cuenta del banco
router.post('/pagos/:id/verificar', wrap((req, res) => {
  exigir(can(req.user, 'cuadre'), 'No tienes permiso para verificar transferencias');
  const p = db.prepare('SELECT * FROM pagos WHERE id=?').get(entero(req.params.id));
  if (!p || p.anulado) throw new HttpError(404, 'Pago no encontrado');
  exigir(puedeBodega(req.user, p.bodega_id), 'Ese pago es de otra bodega');
  if (p.metodo === 'efectivo') throw new HttpError(400, 'Solo se verifican transferencias');
  const v = req.body.verificado === false ? 0 : 1;
  db.prepare('UPDATE pagos SET verificado=?, verificado_por=?, fecha_verificado=? WHERE id=?').run(v, v ? req.user.id : null, v ? ahora() : null, p.id);
  if (!v) auditar(req.user, 'desmarcar transferencia verificada', 'pago', p.id, `$${p.valor}`);
  res.json({ ok: true, verificado: v });
}));

// Guarda el cuadre de la semana: conteo físico (opcionalmente ajusta el inventario) y la foto de los números
router.post('/cuadres', wrap((req, res) => {
  const punto = puntoDeCuadre(req.user, req.body.punto);
  const rango = semana(req.body);
  const aplicar = !!req.body.aplicar_ajuste;
  const out = tx(() => {
    const ub = ubDelPunto(punto);
    const conteo = [];
    for (const c of Array.isArray(req.body.conteo) ? req.body.conteo : []) {
      if (c.contado === '' || c.contado === null || c.contado === undefined) continue; // no contado
      const p = db.prepare('SELECT id, nombre, costo FROM productos WHERE id=?').get(entero(c.producto_id));
      if (!p) throw new HttpError(400, 'Producto inválido en el conteo');
      const contado = num(c.contado, `Cantidad contada de ${p.nombre}`);
      if (contado < 0) throw new HttpError(400, `La cantidad contada de ${p.nombre} no puede ser negativa`);
      const sistema = getStock(p.id, ub);
      const diferencia = r2(contado - sistema);
      conteo.push({ producto_id: p.id, nombre: p.nombre, sistema, contado, diferencia, valor: r2(diferencia * p.costo) });
      if (aplicar && diferencia !== 0)
        moverStock({ productoId: p.id, ubicacion: ub, delta: diferencia, tipo: 'ajuste_cuadre', costo: p.costo, referencia: `CS-${punto.codigo}-${rango.hasta}`, usuarioId: req.user.id, nota: 'Cuadre semanal', permitirNegativo: true });
    }
    const r = resumenSemana(punto, rango);
    const conDif = conteo.filter((c) => c.diferencia !== 0);
    const difInv = r2(conDif.reduce((a, c) => a + c.valor, 0));
    const t = r.totales;
    db.prepare(`INSERT INTO cuadres (fecha,punto,ruta_id,bodega_id,desde,hasta,usuario_id,ventas,efectivo_esperado,efectivo_entregado,diferencia_efectivo,transferencias,transferencias_verificadas,
        gastos,cartera,diferencia_inventario,productos_con_diferencia,ajuste_aplicado,datos,nota) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(punto,desde,hasta) DO UPDATE SET fecha=excluded.fecha, usuario_id=excluded.usuario_id, ventas=excluded.ventas, efectivo_esperado=excluded.efectivo_esperado,
        efectivo_entregado=excluded.efectivo_entregado, diferencia_efectivo=excluded.diferencia_efectivo, transferencias=excluded.transferencias,
        transferencias_verificadas=excluded.transferencias_verificadas, gastos=excluded.gastos, cartera=excluded.cartera, diferencia_inventario=excluded.diferencia_inventario,
        productos_con_diferencia=excluded.productos_con_diferencia, ajuste_aplicado=MAX(cuadres.ajuste_aplicado, excluded.ajuste_aplicado), datos=excluded.datos, nota=excluded.nota`)
      .run(ahora(), punto.codigo, punto.ruta_id, punto.bodega_id, rango.desde, rango.hasta, req.user.id, t.ventas, t.esperado, t.entregado, t.diferencia_efectivo,
        t.transferencias, t.transferencias_verificadas, t.gastos, t.cartera, difInv, conDif.length, aplicar ? 1 : 0,
        JSON.stringify({ totales: t, conteo }), n(req.body.nota));
    auditar(req.user, 'cuadre semanal', 'cuadre', null, `${r.nombre} · ${rango.desde} a ${rango.hasta} · efectivo ${t.diferencia_efectivo >= 0 ? '+' : ''}$${t.diferencia_efectivo}`
      + ` · inventario ${conDif.length} producto(s), $${difInv}${aplicar ? ' (ajustado)' : ''}`);
    return { diferencia_inventario: difInv, productos_con_diferencia: conDif.length, conteo };
  });
  res.json({ ok: true, ...out });
}));

export default router;
