// Alertas de inventario dentro del alcance de cada usuario:
//  - Bajo mínimo: en cada bodega (mínimo del producto) y en cada carro (mínimo en carro del producto).
//  - Sin movimiento: hay existencias pero no ha salido nada en N días (en panadería, riesgo de vencimiento).
import { db, getConfig } from './db.js';
import { conPrefijo, r2 } from './util.js';
import { ubicacionesPermitidas, can } from './scope.js';

const DIA = 86400000;
export const diasSinMovimiento = (cfg = getConfig()) => Math.max(1, Math.min(365, Number(cfg.dias_sin_movimiento) || 3));

export function alertasInventario(u, { dias = diasSinMovimiento(), ahora = Date.now() } = {}) {
  const lugares = [];
  for (const b of ubicacionesPermitidas(u)) {
    if (!b.activa) continue;
    if (u.alcance !== 'ruta') lugares.push({ ub: `B${b.id}`, lugar: conPrefijo('Bodega', b.nombre), tipo: 'bodega', bodega: b.nombre });
    for (const r of b.rutas) if (r.activa) lugares.push({ ub: `R${r.id}`, lugar: conPrefijo('Ruta', r.nombre), tipo: 'carro', bodega: b.nombre });
  }
  const out = { dias, bajo_minimo: [], sin_movimiento: [], resumen: { bajo_minimo: 0, agotados: 0, sin_movimiento: 0, valor_sin_movimiento: 0 } };
  if (!lugares.length) return out;
  const ubs = lugares.map((l) => l.ub);
  const marcas = ubs.map(() => '?').join(',');
  const productos = db.prepare('SELECT id, nombre, unidad, costo, stock_minimo, minimo_carro FROM productos WHERE activo=1 ORDER BY nombre').all();
  const stock = new Map(db.prepare(`SELECT producto_id, ubicacion, cantidad FROM stock WHERE ubicacion IN (${marcas})`).all(...ubs).map((s) => [`${s.ubicacion}:${s.producto_id}`, s.cantidad]));
  // última salida (venta, cargue, traslado, devolución…) y primer movimiento de cada producto en cada lugar
  const mov = new Map(db.prepare(`SELECT producto_id, ubicacion, MAX(CASE WHEN cantidad<0 THEN fecha END) AS ultima_salida, MIN(fecha) AS primero
    FROM movimientos WHERE ubicacion IN (${marcas}) GROUP BY producto_id, ubicacion`).all(...ubs).map((m) => [`${m.ubicacion}:${m.producto_id}`, m]));
  const verCosto = can(u, 'ver_costos');
  for (const l of lugares) {
    for (const p of productos) {
      const q = stock.get(`${l.ub}:${p.id}`) ?? 0;
      const minimo = l.tipo === 'bodega' ? p.stock_minimo : p.minimo_carro;
      // solo alerta de productos que ese lugar maneja (hay existencias o alguna vez tuvo movimiento): una bodega nueva no sale "agotada" de todo
      if (minimo > 0 && q <= minimo && (q > 0 || mov.has(`${l.ub}:${p.id}`))) out.bajo_minimo.push({ ub: l.ub, lugar: l.lugar, tipo: l.tipo, bodega: l.bodega, producto_id: p.id, producto: p.nombre, unidad: p.unidad, cantidad: q, minimo, agotado: q <= 0, faltan: r2(minimo - q) });
      if (q > 0) {
        const m = mov.get(`${l.ub}:${p.id}`);
        const desde = m?.ultima_salida || m?.primero;
        const d = desde ? Math.floor((ahora - Date.parse(desde)) / DIA) : null;
        if (d !== null && d >= dias) {
          out.sin_movimiento.push({ ub: l.ub, lugar: l.lugar, tipo: l.tipo, bodega: l.bodega, producto_id: p.id, producto: p.nombre, unidad: p.unidad, cantidad: q,
            dias: d, ultima_salida: m?.ultima_salida ?? null, ...(verCosto ? { valor: r2(q * p.costo) } : {}) });
        }
      }
    }
  }
  // lo más urgente primero: agotados, luego lo que más falta; sin movimiento, lo más viejo primero
  out.bajo_minimo.sort((a, b) => (b.agotado - a.agotado) || (b.faltan - a.faltan));
  out.sin_movimiento.sort((a, b) => b.dias - a.dias);
  out.resumen = { bajo_minimo: out.bajo_minimo.length, agotados: out.bajo_minimo.filter((x) => x.agotado).length, sin_movimiento: out.sin_movimiento.length,
    ...(verCosto ? { valor_sin_movimiento: r2(out.sin_movimiento.reduce((a, x) => a + x.valor, 0)) } : {}) };
  return out;
}

// Una línea para el resumen de WhatsApp (sin saltos de línea): "3 bajo mínimo (Pan tajado, Mogolla y 1 más), 2 sin movimiento"
export function textoAlertas(a) {
  if (!a.bajo_minimo.length && !a.sin_movimiento.length) return 'sin alertas';
  const nombres = [...new Set(a.bajo_minimo.map((x) => x.producto))];
  const partes = [];
  if (a.bajo_minimo.length) partes.push(`${a.bajo_minimo.length} bajo mínimo${a.resumen.agotados ? ` (${a.resumen.agotados} agotados)` : ''}: ${nombres.slice(0, 3).join(', ')}${nombres.length > 3 ? ` y ${nombres.length - 3} más` : ''}`);
  if (a.sin_movimiento.length) partes.push(`${a.sin_movimiento.length} sin movimiento hace ${a.dias}+ días`);
  return partes.join('; ');
}
