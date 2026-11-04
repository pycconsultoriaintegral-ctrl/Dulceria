import { Router } from 'express';
import { db, HttpError, ahora } from '../db.js';
import { wrap, r2, entero } from '../util.js';
import { B, R, parseUb, exigir, esAdminOBodeguero, puedeBodega } from '../scope.js';

const router = Router();

// Resumen del negocio entre fechas. El administrador puede filtrar por bodega; el encargado ve siempre la suya.
router.get('/resumen', wrap((req, res) => {
  const u = req.user;
  exigir(esAdminOBodeguero(u));
  const pedida = req.query.bodega_id ? entero(req.query.bodega_id) : null;
  if (pedida) exigir(puedeBodega(u, pedida), 'No tienes permiso sobre esa bodega');
  const bodegaId = u.rol === 'bodeguero' ? u.bodega_id : pedida;
  const filtro = (a) => (bodegaId ? `${a}.bodega_id=${Number(bodegaId)}` : '1=1');
  const p = { desde: req.query.desde || ahora().slice(0, 8) + '01', hasta: req.query.hasta || ahora().slice(0, 10) };
  const rango = (a) => `substr(${a}.fecha,1,10) BETWEEN @desde AND @hasta`;

  const ventas = db.prepare(`SELECT COUNT(*) AS remisiones, COALESCE(SUM(total),0) AS ventas FROM remisiones r WHERE r.anulada=0 AND ${rango('r')} AND ${filtro('r')}`).get(p);
  const costo = db.prepare(`SELECT COALESCE(SUM(i.cantidad*i.costo),0) AS v FROM remision_items i JOIN remisiones r ON r.id=i.remision_id
    WHERE r.anulada=0 AND ${rango('r')} AND ${filtro('r')}`).get(p).v;
  const descuentos = db.prepare(`SELECT COALESCE(SUM(descuento),0) AS v FROM remisiones r WHERE r.anulada=0 AND ${rango('r')} AND ${filtro('r')}`).get(p).v;
  const gastos = db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM gastos g WHERE ${rango('g')} AND ${filtro('g')}`).get(p).v;
  const compras = db.prepare(`SELECT COALESCE(SUM(total),0) AS v FROM compras c WHERE c.anulada=0 AND ${rango('c')} AND ${filtro('c')}`).get(p).v;
  const cobros = db.prepare(`SELECT COALESCE(SUM(CASE WHEN metodo='efectivo' THEN valor END),0) AS efectivo, COALESCE(SUM(CASE WHEN metodo<>'efectivo' THEN valor END),0) AS transferencias
    FROM pagos p WHERE p.anulado=0 AND ${rango('p')} AND ${filtro('p')}`).get(p);
  const porRuta = db.prepare(`SELECT CASE WHEN ru.id IS NULL THEN 'Mostrador ' || b.nombre WHEN lower(ru.nombre) LIKE 'ruta%' THEN ru.nombre ELSE 'Ruta ' || ru.nombre END AS punto, b.nombre AS bodega, COUNT(*) AS remisiones, SUM(r.total) AS ventas
    FROM remisiones r JOIN bodegas b ON b.id=r.bodega_id LEFT JOIN rutas ru ON ru.id=r.ruta_id
    WHERE r.anulada=0 AND ${rango('r')} AND ${filtro('r')} GROUP BY r.ruta_id, r.bodega_id ORDER BY ventas DESC`).all(p);
  const porBodega = db.prepare(`SELECT b.id, b.nombre AS bodega, COUNT(*) AS remisiones, SUM(r.total) AS ventas FROM remisiones r JOIN bodegas b ON b.id=r.bodega_id
    WHERE r.anulada=0 AND ${rango('r')} AND ${filtro('r')} GROUP BY b.id ORDER BY ventas DESC`).all(p);
  // cantidades en la unidad base del producto, sin importar si se vendió por unidad, caja o estiba
  const topProductos = db.prepare(`SELECT p.nombre, p.unidad, SUM(i.cantidad*i.factor) AS cantidad, SUM(i.cantidad*i.precio) AS ventas, SUM(i.cantidad*(i.precio-i.costo)) AS utilidad
    FROM remision_items i JOIN remisiones r ON r.id=i.remision_id JOIN productos p ON p.id=i.producto_id WHERE r.anulada=0 AND ${rango('r')} AND ${filtro('r')}
    GROUP BY i.producto_id ORDER BY ventas DESC LIMIT 10`).all(p);
  // Control de precios: líneas vendidas por debajo del precio de lista (el vendedor puede negociar, pero queda a la vista)
  const bajos_ = db.prepare(`SELECT us.nombre AS vendedor, COUNT(*) AS lineas, SUM((i.precio_lista-i.precio)*i.cantidad) AS valor
    FROM remision_items i JOIN remisiones r ON r.id=i.remision_id JOIN usuarios us ON us.id=r.usuario_id
    WHERE r.anulada=0 AND i.precio_lista IS NOT NULL AND i.precio < i.precio_lista - 0.005 AND ${rango('r')} AND ${filtro('r')}
    GROUP BY r.usuario_id ORDER BY valor DESC`).all(p);
  const preciosBajos = { lineas: bajos_.reduce((a, x) => a + x.lineas, 0), valor: r2(bajos_.reduce((a, x) => a + x.valor, 0)), por_vendedor: bajos_.map((x) => ({ ...x, valor: r2(x.valor) })) };
  const porDia = db.prepare(`SELECT substr(r.fecha,1,10) AS dia, SUM(total) AS ventas FROM remisiones r WHERE r.anulada=0 AND ${rango('r')} AND ${filtro('r')} GROUP BY dia ORDER BY dia`).all(p);
  const cartera = db.prepare(`SELECT COALESCE(SUM(total-pagado),0) AS v FROM remisiones r WHERE r.anulada=0 AND ${filtro('r')}`).get().v;
  const porPagar = db.prepare(`SELECT COALESCE(SUM(total-pagado),0) AS v FROM compras c WHERE c.anulada=0 AND ${filtro('c')}`).get().v;

  // Inventario del alcance: la(s) bodega(s) y las rutas que les pertenecen
  const bodegas = db.prepare('SELECT id, nombre FROM bodegas WHERE activa=1 ORDER BY nombre').all().filter((b) => !bodegaId || b.id === bodegaId);
  const ids = new Set(bodegas.map((b) => b.id));
  const rutaBodega = new Map(db.prepare('SELECT id, bodega_id FROM rutas').all().map((r) => [r.id, r.bodega_id]));
  const prods = new Map(db.prepare('SELECT id, nombre, costo, stock_minimo FROM productos WHERE activo=1').all().map((x) => [x.id, x]));
  let valorInv = 0;
  const enBodega = new Map(); // `${bodega}:${producto}` -> cantidad
  for (const s of db.prepare('SELECT producto_id, ubicacion, cantidad FROM stock WHERE cantidad<>0').all()) {
    const { tipo, id } = parseUb(s.ubicacion);
    const dueno = tipo === 'B' ? id : rutaBodega.get(id);
    if (!ids.has(dueno)) continue;
    valorInv += s.cantidad * (prods.get(s.producto_id)?.costo ?? 0);
    if (tipo === 'B') enBodega.set(`${id}:${s.producto_id}`, s.cantidad);
  }
  // Alerta de stock bajo: el mínimo del producto aplica a cada bodega
  const bajos = [];
  for (const b of bodegas) for (const [pid, pr] of prods) {
    if (pr.stock_minimo > 0) {
      const q = enBodega.get(`${b.id}:${pid}`) ?? 0;
      if (q <= pr.stock_minimo) bajos.push({ id: pid, nombre: pr.nombre, bodega: b.nombre, bodega_id: b.id, stock_minimo: pr.stock_minimo, total: q });
    }
  }
  bajos.sort((a, b) => a.total - b.total);

  const utilBruta = r2(ventas.ventas - costo);
  res.json({ ...p, bodega_id: bodegaId, ...ventas, costo: r2(costo), descuentos: r2(descuentos), utilidad_bruta: utilBruta, gastos: r2(gastos), utilidad_neta: r2(utilBruta - gastos),
    compras: r2(compras), cobrado_efectivo: r2(cobros.efectivo), cobrado_transferencia: r2(cobros.transferencias), cartera: r2(cartera), por_pagar: r2(porPagar), valor_inventario: r2(valorInv), por_ruta: porRuta, por_bodega: porBodega,
    top_productos: topProductos, precios_bajos: preciosBajos, por_dia: porDia, stock_bajo: bajos });
}));

export default router;
