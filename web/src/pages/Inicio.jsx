import { get, money, qty, useCarga, ir, hoyStr, can } from '../lib.js';
import { Header, Cargando } from '../ui.jsx';

export function Inicio({ user, cfg }) {
  const admin = can(user, 'informes'); // quien tiene informes ve el resumen de su alcance
  const s = useCarga(() => (admin ? get(`/reportes/resumen?desde=${hoyStr()}&hasta=${hoyStr()}`) : get(`/cierre?fecha=${hoyStr()}`)), []);
  const d = s.data;
  // remisiones de clientes que pagan antes y esperan aprobación (si no hay señal, simplemente no se muestra)
  const pend = useCarga(() => get('/aprobaciones').catch(() => []), []);
  const nPend = pend.data?.length || 0;
  const alertas = useCarga(() => get('/alertas/inventario').catch(() => null), []);
  const al = alertas.data?.resumen;
  const turno = useCarga(() => (can(user, 'vender') ? get('/turnos/actual').catch(() => null) : null), []);
  return (
    <>
      <Header titulo={'Mi Pan POS'} />
      <main>
        <p className="mut" style={{ marginTop: 0 }}>Hola, <b>{user.nombre}</b> · {hoyStr()}</p>
        <button className="btn block" style={{ fontSize: 18, padding: 16, marginBottom: 12 }} onClick={() => ir('/vender')}>🛒 Nueva venta</button>
        {turno.data && (turno.data.turno
          ? <div className="aviso ok" style={{ cursor: 'pointer' }} onClick={() => ir('/turno')}><b>⏱️ Turno abierto</b> desde {turno.data.turno.abierto_en.slice(11, 16)} · toca para ver o cerrarlo</div>
          : turno.data.exigir && <div className="aviso pend" style={{ cursor: 'pointer' }} onClick={() => ir('/turno')}><b>⏱️ Abre tu turno</b> para poder vender. Toca aquí.</div>)}
        {al && (al.bajo_minimo > 0 || al.sin_movimiento > 0) && (
          <div className={'aviso ' + (al.agotados ? 'mal' : 'pend')} style={{ cursor: 'pointer' }} onClick={() => ir('/alertas')}>
            <b>📦 Inventario:</b> {al.bajo_minimo > 0 && <>{al.bajo_minimo} bajo mínimo{al.agotados ? ` (${al.agotados} agotados)` : ''}</>}
            {al.bajo_minimo > 0 && al.sin_movimiento > 0 && ' · '}{al.sin_movimiento > 0 && <>{al.sin_movimiento} sin movimiento</>}
            <div>Toca para ver qué reponer.</div>
          </div>)}
        {nPend > 0 && (
          <div className="aviso pend" style={{ cursor: 'pointer' }} onClick={() => ir('/aprobaciones')}>
            <b>⏳ {nPend} {nPend === 1 ? 'remisión' : 'remisiones'} {admin ? 'por aprobar' : 'pendiente(s) de pago'}</b>
            <div>{admin ? 'Revisa los comprobantes para poder despachar.' : 'No entregues la mercancía hasta que se apruebe el pago.'} Toca para ver.</div>
          </div>)}
        {s.loading || s.error ? <Cargando s={s} /> : admin ? (
          <>
            <div className="grid2">
              <div className="kpi"><div className="l">Vendido hoy</div><div className="v">{money(d.ventas)}</div><div className="l">{d.remisiones} remisiones</div></div>
              <div className="kpi"><div className="l">Utilidad bruta hoy</div><div className="v">{money(d.utilidad_bruta)}</div></div>
              <div className="kpi" onClick={() => ir('/cartera')} style={{ cursor: 'pointer' }}><div className="l">Por cobrar</div><div className="v warn">{money(d.cartera)}</div></div>
              <div className="kpi"><div className="l">Inventario a costo</div><div className="v">{money(d.valor_inventario)}</div></div>
            </div>
            {d.stock_bajo.length > 0 && <div className="card" style={{ marginTop: 12 }}><h3 className="warn">⚠ Por reponer</h3>{d.stock_bajo.slice(0, 12).map((p) => <div key={`${p.bodega_id}-${p.id}`} className="row between"><span>{p.nombre}<div className="mut">{p.bodega}</div></span><b>{qty(p.total)}</b></div>)}</div>}
          </>
        ) : (
          <div className="grid2">
            <div className="kpi"><div className="l">Vendido hoy</div><div className="v">{money(d.ventas_total)}</div><div className="l">{d.remisiones} remisiones</div></div>
            <div className="kpi"><div className="l">Efectivo en mano</div><div className="v">{money(d.esperado)}</div></div>
          </div>
        )}
      </main>
    </>
  );
}
