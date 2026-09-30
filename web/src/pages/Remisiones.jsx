import { useState } from 'react';
import { get, post, money, qty, useCarga, compartirRemision, abrirPdf, numRem, hoyStr, ir, useCola, descartarRechazada } from '../lib.js';
import { Header, Cargando, Vacio, toast, useAccion, Confirmar } from '../ui.jsx';

export function Remisiones({ user, cfg }) {
  const [fecha, setFecha] = useState(hoyStr());
  const s = useCarga(() => get(`/remisiones?desde=${fecha}&hasta=${fecha}`), [fecha]);
  const { pendientes, rechazadas } = useCola();
  const total = (s.data || []).filter((r) => !r.anulada).reduce((a, r) => a + r.total, 0);
  return (
    <>
      <Header titulo="Remisiones" />
      <main>
        {pendientes.length > 0 && <div className="card"><b>{pendientes.length} venta(s)/abono(s) por enviar</b><div className="mut">Se envían solas al volver la conexión.</div>{pendientes.map((p) => <div key={p.uuid} className="mut">• {p.etiqueta}</div>)}</div>}
        {rechazadas.map((p) => <div key={p.uuid} className="card" style={{ borderColor: 'var(--mal)' }}><b className="mal">No se pudo registrar: {p.etiqueta}</b><div>{p.error}</div><button className="btn sm gris" onClick={() => descartarRechazada(p.uuid)}>Entendido</button></div>)}
        <div className="row" style={{ marginBottom: 10 }}><input type="date" className="q grow" style={{ margin: 0 }} value={fecha} onChange={(e) => setFecha(e.target.value)} /><div className="right"><div className="mut">Vendido</div><b>{money(total)}</b></div></div>
        {s.loading || s.error ? <Cargando s={s} /> : s.data.length === 0 ? <Vacio>Sin remisiones este día</Vacio> : (
          <div className="card list">{s.data.map((r) => (
            <div key={r.id} className="item" onClick={() => ir(`/remisiones/${r.id}`)}>
              <div className="grow"><div className="bold">{numRem(cfg, r.consecutivo)} · {r.cliente}</div><div className="mut">{r.fecha.slice(11, 16)} · {r.vendedor}</div></div>
              <div className="right"><div className={'bold' + (r.anulada ? ' mal' : '')} style={r.anulada ? { textDecoration: 'line-through' } : {}}>{money(r.total)}</div>
                {r.anulada ? <span className="tag mal">Anulada</span> : r.total - r.pagado > 0.5 ? <span className="tag warn">Debe {money(r.total - r.pagado)}</span> : <span className="tag ok">Pagada</span>}</div>
            </div>))}</div>
        )}
      </main>
    </>
  );
}

export function RemisionDetalle({ id, user, cfg }) {
  const s = useCarga(() => get(`/remisiones/${id}`), [id]);
  const [ocupado, run] = useAccion();
  const r = s.data;
  return (
    <>
      <Header titulo="Remisión" atras="/remisiones" />
      <main>
        {s.loading || s.error ? <Cargando s={s} /> : (
          <>
            <div className="card">
              <div className="row between"><h2 style={{ margin: 0 }}>{numRem(cfg, r.consecutivo)}</h2>{r.anulada ? <span className="tag mal">Anulada</span> : null}</div>
              <div className="mut">{r.fecha.slice(0, 16)} · {r.ruta || 'Mostrador'} · {r.vendedor}</div>
              <div className="bold" style={{ marginTop: 6 }}>{r.cliente}{r.negocio ? ` · ${r.negocio}` : ''}</div>
              {r.anulada ? <div className="mal">Motivo: {r.motivo_anulacion}</div> : null}
            </div>
            <div className="card">
              <table className="t"><thead><tr><th>Producto</th><th className="n">Cant.</th><th className="n">Precio</th><th className="n">Total</th></tr></thead>
                <tbody>{r.items.map((i) => <tr key={i.id}><td>{i.descripcion}</td><td className="n">{qty(i.cantidad)}</td><td className="n">{money(i.precio)}</td><td className="n">{money(i.cantidad * i.precio)}</td></tr>)}</tbody></table>
              <div className="right" style={{ marginTop: 8 }}>
                {r.descuento > 0 && <div className="mut">Descuento -{money(r.descuento)}</div>}
                <div className="big">{money(r.total)}</div>
                {!r.anulada && <div className="mut">Pagado {money(r.pagado)} · Saldo {money(r.saldo)} · {r.tipo_pago}</div>}
              </div>
              {r.nota && <div className="mut">Nota: {r.nota}</div>}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <button className="btn" disabled={ocupado} onClick={() => run(() => compartirRemision(r, cfg))}>Compartir por WhatsApp</button>
              <button className="btn sec" disabled={ocupado} onClick={() => run(() => abrirPdf(r))}>Ver remisión (PDF)</button>
              {r.saldo > 0 && !r.anulada && <button className="btn sec" onClick={() => ir(`/clientes/${r.cliente_id}`)}>Registrar abono</button>}
              {!r.anulada && <button className="btn peligro" disabled={ocupado} onClick={() => {
                const motivo = window.prompt('Motivo de la anulación (el inventario vuelve a la ruta y los pagos se reversan):');
                if (motivo) run(async () => { await post(`/remisiones/${id}/anular`, { motivo }); s.recargar(); }, 'Remisión anulada');
              }}>Anular remisión</button>}
            </div>
          </>
        )}
      </main>
    </>
  );
}
