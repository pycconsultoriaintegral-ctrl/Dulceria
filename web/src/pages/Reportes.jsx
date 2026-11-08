import { useState } from 'react';
import { get, money, qty, useCarga, hoyStr, useUbicaciones, esAdmin, descargarCsv, descargar, ir } from '../lib.js';
import { Header, Cargando, Campo, SelectorBodega, useAccion } from '../ui.jsx';

export function Reportes({ user }) {
  const { bodegas } = useUbicaciones();
  const [bodega, setBodega] = useState('');
  const [ocupado, run] = useAccion();
  const [desde, setDesde] = useState(hoyStr().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(hoyStr());
  const s = useCarga(() => get(`/reportes/resumen?desde=${desde}&hasta=${hasta}${bodega ? `&bodega_id=${bodega}` : ''}`), [desde, hasta, bodega]);
  const d = s.data;
  return (
    <>
      <Header titulo="Reportes" atras="/mas" />
      <main>
        {esAdmin(user) && bodegas.length > 1 && <SelectorBodega bodegas={bodegas} value={bodega} onChange={setBodega} label="Bodega" todos />}
        <div className="grid2"><Campo type="date" label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} /><Campo type="date" label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        {s.loading || s.error ? <Cargando s={s} /> : (
          <>
            <div className="grid2" style={{ marginBottom: 12 }}>
              <Kpi l="Ventas" v={money(d.ventas)} sub={`${d.remisiones} remisiones`} />
              <Kpi l="Utilidad bruta" v={money(d.utilidad_bruta)} sub={d.ventas > 0 ? `${Math.round((d.utilidad_bruta / d.ventas) * 100)}% de margen` : ''} />
              <Kpi l="Gastos de ruta" v={money(d.gastos)} />
              <Kpi l="Utilidad neta" v={money(d.utilidad_neta)} />
              <Kpi l="Compras" v={money(d.compras)} />
              <Kpi l="Inventario (costo)" v={money(d.valor_inventario)} />
              <Kpi l="Cobrado en efectivo" v={money(d.cobrado_efectivo)} />
              <Kpi l="Cobrado por transferencia" v={money(d.cobrado_transferencia)} />
              <Kpi l="Por cobrar (cartera)" v={money(d.cartera)} />
              <Kpi l="Por pagar" v={money(d.por_pagar)} />
            </div>
            {d.stock_bajo.length > 0 && <div className="card"><h3 className="warn">⚠ Por reponer</h3>{d.stock_bajo.map((p) => <div key={`${p.bodega_id}-${p.id}`} className="row between"><span>{p.nombre}<div className="mut">{p.bodega}</div></span><b>{qty(p.total)} / mín {qty(p.stock_minimo)}</b></div>)}</div>}
            {d.por_bodega.length > 1 && <div className="card"><h3>Ventas por bodega</h3>{d.por_bodega.map((b) => <div key={b.id} className="row between"><span>{b.bodega} <span className="mut">({b.remisiones})</span></span><b>{money(b.ventas)}</b></div>)}</div>}
            <div className="card"><h3>Ventas por ruta y mostrador</h3>{d.por_ruta.length === 0 ? <div className="mut">Sin ventas</div> : d.por_ruta.map((r) => <div key={r.punto} className="row between"><span>{r.punto} <span className="mut">{r.punto.includes(r.bodega) ? '' : `· ${r.bodega} `}({r.remisiones})</span></span><b>{money(r.ventas)}</b></div>)}</div>
            <div className="card"><h3>Control de precios</h3>
              <div className="row between"><span>Descuentos dados en las remisiones</span><b>{money(d.descuentos)}</b></div>
              <div className="row between"><span>Vendido por debajo del precio de lista</span><b className={d.precios_bajos.valor > 0 ? 'warn' : ''}>{money(d.precios_bajos.valor)}</b></div>
              {d.precios_bajos.por_vendedor.length === 0 ? <div className="mut">Todas las ventas salieron al precio de lista.</div> : d.precios_bajos.por_vendedor.map((x) => (
                <div key={x.vendedor} className="row between mut"><span>· {x.vendedor} ({x.lineas} línea{x.lineas === 1 ? '' : 's'})</span><span>{money(x.valor)}</span></div>
              ))}
            </div>
            <div className="card"><h3>Productos más vendidos</h3>
              <table className="t"><thead><tr><th>Producto</th><th className="n">Cant.</th><th className="n">Ventas</th><th className="n">Utilidad</th></tr></thead>
                <tbody>{d.top_productos.map((p) => <tr key={p.nombre}><td>{p.nombre}</td><td className="n">{qty(p.cantidad)} <span className="mut">{p.unidad}</span></td><td className="n">{money(p.ventas)}</td><td className="n ok">{money(p.utilidad)}</td></tr>)}</tbody></table></div>
            <div className="card"><h3>📊 Informes en Excel</h3>
              <p className="mut" style={{ marginTop: 0 }}>Del {desde} al {hasta}{esAdmin(user) && bodega ? ', de la bodega elegida' : ''}, comparados con el periodo anterior de los mismos días. Con totales, filtros y formato de pesos.</p>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {periodosRapidos().map(([t, a, b]) => <button key={t} className={'btn sm ' + (desde === a && hasta === b ? '' : 'gris')} onClick={() => { setDesde(a); setHasta(b); }}>{t}</button>)}
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {[['vendedores', '👤 Vendedores', 'ventas, clientes, descuentos, utilidad, cierres'], ['productos', '🥖 Productos', 'más y menos vendidos, margen, inventario, bajo mínimo, sin movimiento'],
                  ['clientes', '🧾 Clientes', 'compras, última compra, frecuencia, deuda, quiénes dejaron de comprar']].map(([k, t, sub]) => (
                  <button key={k} className="btn block" style={{ textAlign: 'left' }} disabled={ocupado}
                    onClick={() => run(() => descargar(`/informes/${k}.xlsx?desde=${desde}&hasta=${hasta}${bodega ? `&bodega_id=${bodega}` : ''}`, `informe-${k}-${desde}-a-${hasta}.xlsx`), 'Informe descargado')}>
                    {t}<div style={{ fontWeight: 400, fontSize: 12, opacity: 0.85 }}>{sub}</div></button>))}
              </div>
            </div>
            <div className="card" style={{ cursor: 'pointer' }} onClick={() => ir('/alertas')}><div className="row between"><b>📦 Alertas de inventario</b><span className="mut">Ver ›</span></div></div>
            <div className="card"><h3>Datos sueltos (CSV)</h3>
              <p className="mut" style={{ marginTop: 0 }}>Usan las fechas{esAdmin(user) && bodega ? ' y la bodega' : ''} de arriba.</p>
              <div className="grid2">
                {[['ventas', 'Ventas (por producto)', `desde=${desde}&hasta=${hasta}${bodega ? `&bodega_id=${bodega}` : ''}`], ['cierres', 'Cierres del día', `desde=${desde}&hasta=${hasta}${bodega ? `&bodega_id=${bodega}` : ''}`],
                  ['inventario', 'Inventario actual', ''], ['movimientos', 'Movimientos de inventario', `desde=${desde}&hasta=${hasta}`],
                  ['cartera', 'Cartera (por cobrar)', bodega ? `bodega_id=${bodega}` : ''], ['clientes', 'Clientes', '']].map(([k, t, q]) => (
                  <button key={k} className="btn sm sec" disabled={ocupado} onClick={() => run(() => descargarCsv(`/exportar/${k}${q ? `?${q}` : ''}`, k), 'Descarga lista')}>⬇ {t}</button>
                ))}
              </div>
            </div>
            <div className="card"><h3>Ventas por día</h3>{d.por_dia.map((x) => { const max = Math.max(...d.por_dia.map((y) => y.ventas)); return <div key={x.dia} style={{ marginBottom: 6 }}><div className="row between mut"><span>{x.dia}</span><span>{money(x.ventas)}</span></div><div className="bar"><i style={{ width: `${(x.ventas / max) * 100}%` }} /></div></div>; })}</div>
          </>
        )}
      </main>
    </>
  );
}
// Atajos de periodo: [texto, desde, hasta]
function periodosRapidos() {
  const h = hoyStr();
  const f = (d) => new Date(`${d}T12:00:00Z`);
  const iso = (d) => d.toISOString().slice(0, 10);
  const lunes = new Date(f(h)); lunes.setUTCDate(lunes.getUTCDate() - ((lunes.getUTCDay() + 6) % 7));
  const mesAnt = new Date(f(h)); mesAnt.setUTCDate(1); mesAnt.setUTCMonth(mesAnt.getUTCMonth() - 1);
  const finMesAnt = new Date(f(h)); finMesAnt.setUTCDate(0);
  const hace30 = new Date(f(h)); hace30.setUTCDate(hace30.getUTCDate() - 29);
  return [['Esta semana', iso(lunes), h], ['Este mes', h.slice(0, 8) + '01', h], ['Mes anterior', iso(mesAnt), iso(finMesAnt)], ['Últimos 30 días', iso(hace30), h]];
}
const Kpi = ({ l, v, sub }) => <div className="kpi"><div className="l">{l}</div><div className="v">{v}</div>{sub && <div className="l">{sub}</div>}</div>;

