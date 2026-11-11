import { useState } from 'react';
import { get, money, qty, useCarga, descargar, hoyStr, can } from '../lib.js';
import { Header, Cargando, Vacio, useAccion } from '../ui.jsx';

// Alertas de inventario: lo que hay que reponer y lo que no se está moviendo, agrupado por bodega y carro
export function Alertas({ user }) {
  const s = useCarga(() => get('/alertas/inventario'), []);
  const [tab, setTab] = useState('minimo');
  const [ocupado, run] = useAccion();
  const d = s.data;
  const agrupar = (lista) => lista.reduce((m, x) => { (m[x.lugar] ||= []).push(x); return m; }, {});
  return (
    <>
      <Header titulo="Alertas de inventario" atras="/" />
      <main>
        {s.loading || s.error ? <Cargando s={s} /> : (
          <>
            <div className="grid2" style={{ marginBottom: 12 }}>
              <div className="kpi" onClick={() => setTab('minimo')} style={{ cursor: 'pointer' }}><div className="l">Bajo mínimo</div><div className={'v ' + (d.resumen.bajo_minimo ? 'warn' : 'ok')}>{d.resumen.bajo_minimo}</div>
                <div className="l">{d.resumen.agotados ? <span className="mal">{d.resumen.agotados} agotados</span> : 'ninguno agotado'}</div></div>
              <div className="kpi" onClick={() => setTab('quietos')} style={{ cursor: 'pointer' }}><div className="l">Sin movimiento ({d.dias}+ días)</div><div className={'v ' + (d.resumen.sin_movimiento ? 'warn' : 'ok')}>{d.resumen.sin_movimiento}</div>
                {d.resumen.valor_sin_movimiento !== undefined && <div className="l">{money(d.resumen.valor_sin_movimiento)} al costo</div>}</div>
            </div>
            <div className="pestanas">
              <button className={tab === 'minimo' ? 'on' : ''} onClick={() => setTab('minimo')}>⚠ Por reponer</button>
              <button className={tab === 'quietos' ? 'on' : ''} onClick={() => setTab('quietos')}>💤 Sin movimiento</button>
            </div>
            {tab === 'minimo' && (d.bajo_minimo.length === 0 ? <Vacio>✅ Todo está por encima del mínimo</Vacio> : Object.entries(agrupar(d.bajo_minimo)).map(([lugar, xs]) => (
              <div key={lugar} className="card"><h3>{lugar}</h3>
                {xs.map((x) => (
                  <div key={x.producto_id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--bd)' }}>
                    <span>{x.producto}<div className="mut">mínimo {qty(x.minimo)} {x.unidad}{x.faltan > 0 ? ` · faltan ${qty(x.faltan)}` : ''}</div></span>
                    {x.agotado ? <span className="tag mal">Agotado</span> : <b className="warn">{qty(x.cantidad)}</b>}
                  </div>))}
              </div>)))}
            {tab === 'quietos' && (d.sin_movimiento.length === 0 ? <Vacio>✅ Todo se está moviendo</Vacio> : Object.entries(agrupar(d.sin_movimiento)).map(([lugar, xs]) => (
              <div key={lugar} className="card"><h3>{lugar}</h3>
                {xs.map((x) => (
                  <div key={x.producto_id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--bd)' }}>
                    <span>{x.producto}<div className="mut">{qty(x.cantidad)} {x.unidad}{x.valor !== undefined ? ` · ${money(x.valor)}` : ''}</div></span>
                    <span className={'tag ' + (x.dias >= d.dias * 2 ? 'mal' : 'warn')}>{x.dias} días</span>
                  </div>))}
              </div>)))}
            <div className="mut" style={{ margin: '4px 0 12px' }}>
              Los mínimos se ponen en cada producto (mínimo en bodega y mínimo en cada carro). Los días sin movimiento se cambian en Ajustes.
            </div>
            {can(user, 'informes') && <button className="btn sec block" disabled={ocupado} onClick={() => run(() => descargar(`/informes/productos.xlsx?desde=${hoyStr().slice(0, 8)}01&hasta=${hoyStr()}`, `inventario-y-alertas-${hoyStr()}.xlsx`), 'Descargado')}>⬇ Descargar en Excel</button>}
          </>
        )}
      </main>
    </>
  );
}
