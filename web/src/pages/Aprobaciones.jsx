import { get, money, useCarga, ir, numRem, conPrefijo } from '../lib.js';
import { Header, Cargando, Vacio } from '../ui.jsx';

// Remisiones de clientes que pagan antes y esperan que se apruebe el soporte de pago
export function Aprobaciones({ user, cfg }) {
  const s = useCarga(() => get('/aprobaciones'), []);
  const aprueba = user.rol !== 'vendedor';
  return (
    <>
      <Header titulo={aprueba ? 'Pagos por aprobar' : 'Mis pendientes de pago'} atras="/" />
      <main>
        <p className="mut" style={{ marginTop: 0 }}>
          {aprueba ? 'Revisa el comprobante, confirma que el dinero entró y aprueba. Solo entonces se entrega la mercancía.' : 'No entregues la mercancía hasta que el encargado o el administrador aprueben el pago.'}
        </p>
        {s.loading || s.error ? <Cargando s={s} /> : s.data.length === 0 ? <Vacio>🎉 No hay pagos pendientes</Vacio> : (
          <div className="card list">{s.data.map((r) => (
            <div key={r.id} className="item" onClick={() => ir(`/remisiones/${r.id}`)}>
              <div className="grow">
                <div className="bold">{numRem(cfg, r.consecutivo)} · {r.cliente}</div>
                <div className="mut">{r.fecha.slice(0, 16)} · {r.vendedor} · {r.ruta ? conPrefijo('Ruta', r.ruta) : `Mostrador ${r.bodega}`}</div>
              </div>
              <div className="right"><div className="bold">{money(r.total)}</div>
                {r.soportes ? <span className="tag ok">📎 {r.soportes}</span> : <span className="tag mal">Sin soporte</span>}</div>
            </div>))}</div>
        )}
        <button className="btn gris block" onClick={s.recargar}>Actualizar</button>
      </main>
    </>
  );
}
