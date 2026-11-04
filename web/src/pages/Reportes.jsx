import { useState } from 'react';
import { get, money, qty, useCarga, hoyStr, useUbicaciones, esAdmin } from '../lib.js';
import { Header, Cargando, Campo, SelectorBodega } from '../ui.jsx';

export function Reportes({ user }) {
  const { bodegas } = useUbicaciones();
  const [bodega, setBodega] = useState('');
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
            <div className="card"><h3>Productos más vendidos</h3>
              <table className="t"><thead><tr><th>Producto</th><th className="n">Cant.</th><th className="n">Ventas</th><th className="n">Utilidad</th></tr></thead>
                <tbody>{d.top_productos.map((p) => <tr key={p.nombre}><td>{p.nombre}</td><td className="n">{qty(p.cantidad)}</td><td className="n">{money(p.ventas)}</td><td className="n ok">{money(p.utilidad)}</td></tr>)}</tbody></table></div>
            <div className="card"><h3>Ventas por día</h3>{d.por_dia.map((x) => { const max = Math.max(...d.por_dia.map((y) => y.ventas)); return <div key={x.dia} style={{ marginBottom: 6 }}><div className="row between mut"><span>{x.dia}</span><span>{money(x.ventas)}</span></div><div className="bar"><i style={{ width: `${(x.ventas / max) * 100}%` }} /></div></div>; })}</div>
          </>
        )}
      </main>
    </>
  );
}
const Kpi = ({ l, v, sub }) => <div className="kpi"><div className="l">{l}</div><div className="v">{v}</div>{sub && <div className="l">{sub}</div>}</div>;

