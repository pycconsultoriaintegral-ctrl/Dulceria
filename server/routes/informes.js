// Informes en Excel (.xlsx) de vendedores, productos y clientes, comparados con el periodo anterior de igual duración.
// Los descargan el administrador (todo, o una bodega o punto) y el encargado de bodega (su bodega y sus carros).
import { Router } from 'express';
import { db, hoy, HttpError, getConfig } from '../db.js';
import { wrap, r2, conPrefijo } from '../util.js';
import { sqlAlcance, exigir, esAdminOBodeguero, parseUb, getRuta, getBodega } from '../scope.js';
import { libro, MIME_XLSX } from '../xlsx.js';
import { alertasInventario } from '../alertas.js';

const router = Router();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIA = 86400000;
const dia = (f) => Date.parse(`${f}T12:00:00Z`);
const corrido = (f, n) => new Date(dia(f) + n * DIA).toISOString().slice(0, 10);
const dmy = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
// variación contra el periodo anterior; en blanco si antes no hubo ventas (no hay base para comparar)
const variacion = (actual, antes) => (antes > 0 ? r2((actual - antes) / antes * 10000) / 10000 : null);
const PUNTO_SQL = "CASE WHEN ru.id IS NULL THEN 'Mostrador ' || b.nombre WHEN lower(ru.nombre) LIKE 'ruta%' THEN ru.nombre ELSE 'Ruta ' || ru.nombre END";

// Periodo pedido (por defecto, el mes en curso) y el anterior de la misma cantidad de días
export function periodos(q = {}) {
  const hasta = FECHA.test(q.hasta || '') ? q.hasta : hoy();
  const desde = FECHA.test(q.desde || '') ? q.desde : `${hasta.slice(0, 8)}01`;
  if (desde > hasta) throw new HttpError(400, 'La fecha inicial es posterior a la final');
  const dias = Math.round((dia(hasta) - dia(desde)) / DIA) + 1;
  if (dias > 400) throw new HttpError(400, 'El informe abarca máximo 400 días');
  return { desde, hasta, dias, antes: { desde: corrido(desde, -dias), hasta: corrido(desde, -1) } };
}

function contexto(req) {
  exigir(esAdminOBodeguero(req.user), 'Los informes los descargan el encargado de la bodega o el administrador');
  const q = req.query;
  const per = periodos(q);
  const alcance = (a) => sqlAlcance(req.user, a, { punto: q.punto, bodega_id: q.bodega_id });
  alcance('r'); // valida permisos del filtro antes de consultar
  let ambito = req.user.rol === 'bodeguero' ? conPrefijo('Bodega', getBodega(req.user.bodega_id)?.nombre) : 'Todas las bodegas';
  if (q.bodega_id) ambito = conPrefijo('Bodega', getBodega(Number(q.bodega_id))?.nombre);
  if (q.punto) { const p = parseUb(q.punto); ambito = p.tipo === 'R' ? conPrefijo('Ruta', getRuta(p.id)?.nombre) : `Mostrador ${getBodega(p.id)?.nombre}`; }
  const subtitulo = `${getConfig().negocio} · ${dmy(per.desde)} a ${dmy(per.hasta)} (${per.dias} días) · ${ambito} · comparado con ${dmy(per.antes.desde)} a ${dmy(per.antes.hasta)}`;
  return { u: req.user, q, per, alcance, subtitulo, ambito };
}
// solo las fechas: node:sqlite rechaza parámetros que la consulta no usa
const R = (p) => ({ desde: p.desde, hasta: p.hasta });
const rango = (a) => `substr(${a}.fecha,1,10) BETWEEN @desde AND @hasta`;

function enviar(res, nombre, per, hojas) {
  res.setHeader('Content-Type', MIME_XLSX);
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}-${per.desde}-a-${per.hasta}.xlsx"`);
  res.send(libro(hojas));
}
const sumaCol = (filas, i) => filas.reduce((a, f) => a + (Number(f[i]) || 0), 0);
const cociente = (a, b) => (b ? r2(a / b * 10000) / 10000 : null);

// ---------- Vendedores ----------
router.get('/informes/vendedores.xlsx', wrap((req, res) => {
  const { per, alcance, subtitulo } = contexto(req);
  const base = (p) => db.prepare(`SELECT r.usuario_id AS id, COUNT(*) AS remisiones, COUNT(DISTINCT r.cliente_id) AS clientes, SUM(r.total) AS ventas,
      SUM(CASE WHEN r.tipo_pago='contado' THEN r.total ELSE 0 END) AS contado, SUM(CASE WHEN r.tipo_pago='credito' THEN r.total ELSE 0 END) AS credito, SUM(r.descuento) AS descuentos,
      GROUP_CONCAT(DISTINCT ${PUNTO_SQL}) AS puntos
    FROM remisiones r JOIN bodegas b ON b.id=r.bodega_id LEFT JOIN rutas ru ON ru.id=r.ruta_id WHERE r.anulada=0 AND ${rango('r')} AND ${alcance('r')} GROUP BY r.usuario_id`).all(R(p));
  const lineas = db.prepare(`SELECT r.usuario_id AS id, SUM(i.cantidad*i.costo) AS costo,
      SUM(CASE WHEN i.precio_lista IS NOT NULL AND i.precio < i.precio_lista - 0.005 THEN (i.precio_lista-i.precio)*i.cantidad ELSE 0 END) AS bajo_lista
    FROM remision_items i JOIN remisiones r ON r.id=i.remision_id WHERE r.anulada=0 AND ${rango('r')} AND ${alcance('r')} GROUP BY r.usuario_id`).all(R(per));
  const cierres = db.prepare(`SELECT c.usuario_id AS id, SUM(c.diferencia) AS diferencia, COUNT(*) AS n FROM cierres c WHERE c.fecha BETWEEN @desde AND @hasta AND ${alcance('c')} GROUP BY c.usuario_id`).all(R(per));
  const actual = new Map(base(per).map((x) => [x.id, x]));
  const antes = new Map(base(per.antes).map((x) => [x.id, x]));
  const lin = new Map(lineas.map((x) => [x.id, x]));
  const cie = new Map(cierres.map((x) => [x.id, x]));
  const ids = [...new Set([...actual.keys(), ...antes.keys()])];
  const usuarios = new Map(db.prepare('SELECT id, nombre, rol FROM usuarios').all().map((x) => [x.id, x]));
  const ROL = { admin: 'Administrador', bodeguero: 'Encargado', vendedor: 'Vendedor' };
  const filas = ids.map((id) => {
    const a = actual.get(id) || { remisiones: 0, clientes: 0, ventas: 0, contado: 0, credito: 0, descuentos: 0, puntos: '' };
    const l = lin.get(id) || { costo: 0, bajo_lista: 0 };
    const util = r2(a.ventas - l.costo);
    const prev = antes.get(id)?.ventas || 0;
    return [usuarios.get(id)?.nombre ?? `#${id}`, ROL[usuarios.get(id)?.rol] ?? '', a.puntos || '', a.remisiones, a.clientes, r2(a.ventas), a.remisiones ? r2(a.ventas / a.remisiones) : 0,
      r2(a.contado), r2(a.credito), r2(a.descuentos), r2(l.bajo_lista), r2(l.costo), util, cociente(util, a.ventas), cie.has(id) ? r2(cie.get(id).diferencia) : null, r2(prev), variacion(a.ventas, prev)];
  }).sort((x, y) => y[5] - x[5]);
  enviar(res, 'informe-vendedores', per, [{
    nombre: 'Vendedores', titulo: 'Informe de vendedores', subtitulo,
    columnas: [{ titulo: 'Vendedor', ancho: 22 }, { titulo: 'Rol', ancho: 12 }, { titulo: 'Punto(s)', ancho: 24 }, { titulo: 'Remisiones', tipo: 'entero', total: 'suma', ancho: 11 },
      { titulo: 'Clientes atendidos', tipo: 'entero', ancho: 11 }, { titulo: 'Ventas', tipo: 'moneda', total: 'suma' },
      { titulo: 'Venta promedio', tipo: 'moneda', total: (f) => (sumaCol(f, 3) ? r2(sumaCol(f, 5) / sumaCol(f, 3)) : 0) },
      { titulo: 'Contado', tipo: 'moneda', total: 'suma' }, { titulo: 'Crédito', tipo: 'moneda', total: 'suma' }, { titulo: 'Descuentos', tipo: 'moneda', total: 'suma' },
      { titulo: 'Vendido bajo precio de lista', tipo: 'moneda', total: 'suma' }, { titulo: 'Costo', tipo: 'moneda', total: 'suma' }, { titulo: 'Utilidad bruta', tipo: 'moneda', total: 'suma' },
      { titulo: 'Margen', tipo: 'porcentaje', ancho: 9, total: (f) => cociente(sumaCol(f, 12), sumaCol(f, 5)) },
      { titulo: 'Diferencia en cierres', tipo: 'moneda', total: 'suma' }, { titulo: 'Ventas periodo anterior', tipo: 'moneda', total: 'suma' },
      { titulo: 'Variación', tipo: 'porcentaje', ancho: 10, total: (f) => variacion(sumaCol(f, 5), sumaCol(f, 15)) }],
    filas,
  }]);
}));

// ---------- Productos ----------
router.get('/informes/productos.xlsx', wrap((req, res) => {
  const { u, q, per, alcance, subtitulo } = contexto(req);
  const ventas = (p) => new Map(db.prepare(`SELECT i.producto_id AS id, SUM(i.cantidad*i.factor) AS unidades, SUM(i.cantidad*i.precio) AS ventas, SUM(i.cantidad*i.costo) AS costo,
      COUNT(DISTINCT r.id) AS remisiones, COUNT(DISTINCT r.cliente_id) AS clientes
    FROM remision_items i JOIN remisiones r ON r.id=i.remision_id WHERE r.anulada=0 AND ${rango('r')} AND ${alcance('r')} GROUP BY i.producto_id`).all(R(p)).map((x) => [x.id, x]));
  const act = ventas(per), ant = ventas(per.antes);
  // inventario actual en las ubicaciones del filtro
  const al = alertasInventario(u, {});
  let ubs = null;
  if (q.punto) ubs = [q.punto];
  else if (q.bodega_id) ubs = [`B${Number(q.bodega_id)}`, ...db.prepare('SELECT id FROM rutas WHERE bodega_id=?').all(Number(q.bodega_id)).map((x) => `R${x.id}`)];
  else if (u.rol === 'bodeguero') ubs = [`B${u.bodega_id}`, ...db.prepare('SELECT id FROM rutas WHERE bodega_id=?').all(u.bodega_id).map((x) => `R${x.id}`)];
  const stock = new Map(db.prepare(`SELECT producto_id AS id, SUM(cantidad) AS q FROM stock ${ubs ? `WHERE ubicacion IN (${ubs.map(() => '?').join(',')})` : ''} GROUP BY producto_id`).all(...(ubs || [])).map((x) => [x.id, x.q]));
  const prods = db.prepare('SELECT id, codigo, nombre, unidad, activo FROM productos ORDER BY nombre').all().filter((p) => p.activo || act.has(p.id) || ant.has(p.id));
  const filas = prods.map((p) => {
    const a = act.get(p.id) || { unidades: 0, ventas: 0, costo: 0, remisiones: 0, clientes: 0 };
    const b = ant.get(p.id) || { unidades: 0, ventas: 0 };
    const util = r2(a.ventas - a.costo);
    return [p.codigo || '', p.nombre, p.unidad, r2(a.unidades), r2(a.ventas), r2(a.costo), util, cociente(util, a.ventas), a.remisiones, a.clientes, r2(b.unidades), r2(b.ventas), variacion(a.ventas, b.ventas), r2(stock.get(p.id) || 0)];
  }).sort((x, y) => y[4] - x[4]);
  const enFiltro = (x) => !ubs || ubs.includes(x.ub);
  enviar(res, 'informe-productos', per, [
    { nombre: 'Productos', titulo: 'Informe de productos (de más a menos vendido)', subtitulo,
      columnas: [{ titulo: 'Código', ancho: 10 }, { titulo: 'Producto', ancho: 28 }, { titulo: 'Unidad', ancho: 8 }, { titulo: 'Unidades vendidas', tipo: 'numero', total: 'suma' },
        { titulo: 'Ventas', tipo: 'moneda', total: 'suma' }, { titulo: 'Costo', tipo: 'moneda', total: 'suma' }, { titulo: 'Utilidad bruta', tipo: 'moneda', total: 'suma' },
        { titulo: 'Margen', tipo: 'porcentaje', ancho: 9, total: (f) => cociente(sumaCol(f, 6), sumaCol(f, 4)) }, { titulo: 'Remisiones', tipo: 'entero', ancho: 11 }, { titulo: 'Clientes', tipo: 'entero', ancho: 10 },
        { titulo: 'Unidades periodo anterior', tipo: 'numero', total: 'suma' }, { titulo: 'Ventas periodo anterior', tipo: 'moneda', total: 'suma' },
        { titulo: 'Variación ventas', tipo: 'porcentaje', ancho: 10, total: (f) => variacion(sumaCol(f, 4), sumaCol(f, 11)) }, { titulo: 'Inventario actual', tipo: 'numero', total: 'suma' }],
      filas },
    { nombre: 'Bajo mínimo', titulo: 'Productos en o por debajo del mínimo', subtitulo: `Mínimo en bodega y mínimo en cada carro, según la ficha del producto · ${dmy(hoy())}`,
      columnas: [{ titulo: 'Lugar', ancho: 24 }, { titulo: 'Producto', ancho: 28 }, { titulo: 'Unidad', ancho: 8 }, { titulo: 'Hay', tipo: 'numero' }, { titulo: 'Mínimo', tipo: 'numero' }, { titulo: 'Faltan para el mínimo', tipo: 'numero' }, { titulo: 'Estado', ancho: 12 }],
      vacio: '✓ Ningún producto está en o por debajo del mínimo.',
      filas: al.bajo_minimo.filter(enFiltro).map((x) => [x.lugar, x.producto, x.unidad, x.cantidad, x.minimo, x.faltan, x.agotado ? 'AGOTADO' : 'Bajo']) },
    { nombre: 'Sin movimiento', titulo: `Productos sin salidas en ${al.dias} días o más`, subtitulo: `Riesgo de vencimiento · ${dmy(hoy())}`,
      columnas: [{ titulo: 'Lugar', ancho: 24 }, { titulo: 'Producto', ancho: 28 }, { titulo: 'Unidad', ancho: 8 }, { titulo: 'Cantidad', tipo: 'numero' }, { titulo: 'Valor al costo', tipo: 'moneda', total: 'suma' },
        { titulo: 'Días sin salida', tipo: 'entero' }, { titulo: 'Última salida', tipo: 'fecha', ancho: 12 }],
      vacio: '✓ Todos los productos con existencias han tenido salidas recientes.',
      filas: al.sin_movimiento.filter(enFiltro).map((x) => [x.lugar, x.producto, x.unidad, x.cantidad, x.valor, x.dias, x.ultima_salida ? x.ultima_salida.slice(0, 10) : null]) },
  ]);
}));

// ---------- Clientes ----------
router.get('/informes/clientes.xlsx', wrap((req, res) => {
  const { per, alcance, subtitulo } = contexto(req);
  const ventas = (p) => new Map(db.prepare(`SELECT r.cliente_id AS id, COUNT(*) AS remisiones, SUM(r.total) AS ventas FROM remisiones r
    WHERE r.anulada=0 AND ${rango('r')} AND ${alcance('r')} GROUP BY r.cliente_id`).all(R(p)).map((x) => [x.id, x]));
  const act = ventas(per), ant = ventas(per.antes);
  // historia completa dentro del alcance: primera y última compra, días con compra, saldo
  const hist = new Map(db.prepare(`SELECT r.cliente_id AS id, MIN(substr(r.fecha,1,10)) AS primera, MAX(substr(r.fecha,1,10)) AS ultima, COUNT(DISTINCT substr(r.fecha,1,10)) AS dias_compra,
      SUM(r.total-r.pagado) AS saldo FROM remisiones r WHERE r.anulada=0 AND ${alcance('r')} GROUP BY r.cliente_id`).all().map((x) => [x.id, x]));
  const clientes = db.prepare(`SELECT c.id, c.nombre, c.negocio, c.telefono, ru.nombre AS ruta FROM clientes c LEFT JOIN rutas ru ON ru.id=c.ruta_id`).all();
  const hoyF = hoy();
  const filas = [], dejaron = [];
  for (const c of clientes) {
    const a = act.get(c.id), b = ant.get(c.id), h = hist.get(c.id);
    if (!a && !b && !(h?.saldo > 0.5)) continue;
    const sinComprar = h ? Math.round((dia(hoyF) - dia(h.ultima)) / DIA) : null;
    const frecuencia = h && h.dias_compra > 1 ? r2((dia(h.ultima) - dia(h.primera)) / DIA / (h.dias_compra - 1)) : null;
    const ruta = c.ruta ? conPrefijo('Ruta', c.ruta) : '';
    filas.push([c.nombre, c.negocio || '', ruta, c.telefono || '', a?.remisiones || 0, r2(a?.ventas || 0), a ? r2(a.ventas / a.remisiones) : 0, r2(b?.ventas || 0), variacion(a?.ventas || 0, b?.ventas || 0),
      h?.ultima ?? null, sinComprar, frecuencia, r2(Math.max(0, h?.saldo || 0))]);
    // dejaron de comprar: compraron antes y ahora no, o llevan más del doble de su frecuencia (mínimo 7 días) sin comprar
    const motivo = b && !a ? 'Compró el periodo anterior y este no' : frecuencia && sinComprar > Math.max(7, 2 * frecuencia) ? `Suele comprar cada ${Math.round(frecuencia)} días` : null;
    if (motivo) dejaron.push([c.nombre, c.negocio || '', ruta, c.telefono || '', h?.ultima ?? null, sinComprar, frecuencia, r2(b?.ventas || 0), r2(Math.max(0, h?.saldo || 0)), motivo]);
  }
  filas.sort((x, y) => y[5] - x[5]);
  dejaron.sort((x, y) => (y[5] ?? 0) - (x[5] ?? 0));
  enviar(res, 'informe-clientes', per, [
    { nombre: 'Clientes', titulo: 'Informe de clientes (de más a menos compra)', subtitulo,
      columnas: [{ titulo: 'Cliente', ancho: 24 }, { titulo: 'Negocio', ancho: 20 }, { titulo: 'Ruta', ancho: 16 }, { titulo: 'Teléfono', ancho: 13 }, { titulo: 'Remisiones', tipo: 'entero', total: 'suma', ancho: 11 },
        { titulo: 'Compras', tipo: 'moneda', total: 'suma' }, { titulo: 'Compra promedio', tipo: 'moneda', total: (f) => (sumaCol(f, 4) ? r2(sumaCol(f, 5) / sumaCol(f, 4)) : 0) },
        { titulo: 'Compras periodo anterior', tipo: 'moneda', total: 'suma' }, { titulo: 'Variación', tipo: 'porcentaje', ancho: 10, total: (f) => variacion(sumaCol(f, 5), sumaCol(f, 7)) },
        { titulo: 'Última compra', tipo: 'fecha', ancho: 12 }, { titulo: 'Días sin comprar', tipo: 'entero', ancho: 10 }, { titulo: 'Compra cada (días)', tipo: 'numero', ancho: 10 },
        { titulo: 'Saldo por cobrar', tipo: 'moneda', total: 'suma' }],
      filas },
    { nombre: 'Dejaron de comprar', titulo: 'Clientes para visitar o llamar', subtitulo: `Compraron el periodo anterior y este no, o llevan más del doble de su frecuencia sin comprar · ${dmy(hoyF)}`,
      columnas: [{ titulo: 'Cliente', ancho: 24 }, { titulo: 'Negocio', ancho: 20 }, { titulo: 'Ruta', ancho: 16 }, { titulo: 'Teléfono', ancho: 13 }, { titulo: 'Última compra', tipo: 'fecha', ancho: 12 },
        { titulo: 'Días sin comprar', tipo: 'entero', ancho: 10 }, { titulo: 'Compra cada (días)', tipo: 'numero', ancho: 10 }, { titulo: 'Compras periodo anterior', tipo: 'moneda', total: 'suma' },
        { titulo: 'Saldo por cobrar', tipo: 'moneda', total: 'suma' }, { titulo: 'Motivo', ancho: 34 }],
      vacio: '✓ Ningún cliente dejó de comprar.',
      filas: dejaron },
  ]);
}));

export default router;
