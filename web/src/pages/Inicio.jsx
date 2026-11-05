import { get, money, qty, useCarga, ir, hoyStr, puedeGestionar } from '../lib.js';
import { Header, Cargando } from '../ui.jsx';

export function Inicio({ user, cfg }) {
  const admin = puedeGestionar(user); // administrador y encargado de bodega ven el resumen de su alcance
  const s = useCarga(() => (admin ? get(`/reportes/resumen?desde=${hoyStr()}&hasta=${hoyStr()}`) : get(`/cierre?fecha=${hoyStr()}`)), []);
  const d = s.data;
  // remisiones de clientes que pagan antes y esperan aprobación (si no hay señal, simplemente no se muestra)
  const pend = useCarga(() => get('/aprobaciones').catch(() => []), []);
  const nPend = pend.data?.length || 0;
  return (
    <>
      <Header titulo={cfg?.negocio || 'Dulcería Ruta'} />
      <main>
        <p className="mut" style={{ marginTop: 0 }}>Hola, <b>{user.nombre}</b> · {hoyStr()}</p>
        <button className="btn block" style={{ fontSize: 18, padding: 16, marginBottom: 12 }} onClick={() => ir('/vender')}>🛒 Nueva venta</button>
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
