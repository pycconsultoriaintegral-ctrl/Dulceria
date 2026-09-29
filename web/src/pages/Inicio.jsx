import { get, money, qty, useCarga, ir, hoyStr, useCola } from '../lib.js';
import { Header, Cargando } from '../ui.jsx';

export function Inicio({ user, cfg }) {
  const admin = user.rol === 'admin';
  const s = useCarga(() => (admin ? get(`/reportes/resumen?desde=${hoyStr()}&hasta=${hoyStr()}`) : get(`/cierre?fecha=${hoyStr()}`)), []);
  const d = s.data;
  return (
    <>
      <Header titulo={cfg?.negocio || 'Dulcería Ruta'} />
      <main>
        <p className="mut" style={{ marginTop: 0 }}>Hola, <b>{user.nombre}</b> · {hoyStr()}</p>
        <button className="btn block" style={{ fontSize: 18, padding: 16, marginBottom: 12 }} onClick={() => ir('/vender')}>🛒 Nueva venta</button>
        {s.loading || s.error ? <Cargando s={s} /> : admin ? (
          <>
            <div className="grid2">
              <div className="kpi"><div className="l">Vendido hoy</div><div className="v">{money(d.ventas)}</div><div className="l">{d.remisiones} remisiones</div></div>
              <div className="kpi"><div className="l">Utilidad bruta hoy</div><div className="v">{money(d.utilidad_bruta)}</div></div>
              <div className="kpi" onClick={() => ir('/cartera')} style={{ cursor: 'pointer' }}><div className="l">Por cobrar</div><div className="v warn">{money(d.cartera)}</div></div>
              <div className="kpi"><div className="l">Inventario a costo</div><div className="v">{money(d.valor_inventario)}</div></div>
            </div>
            {d.stock_bajo.length > 0 && <div className="card" style={{ marginTop: 12 }}><h3 className="warn">⚠ Por reponer</h3>{d.stock_bajo.map((p) => <div key={p.id} className="row between"><span>{p.nombre}</span><b>{qty(p.total)}</b></div>)}</div>}
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
