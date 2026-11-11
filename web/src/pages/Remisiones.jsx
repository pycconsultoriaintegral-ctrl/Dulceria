import { useState } from 'react';
import { get, post, money, qty, useCarga, compartirRemision, abrirPdf, numRem, hoyStr, ir, useCola, descartarRechazada, useUbicaciones, conPrefijo, can } from '../lib.js';
import { Header, Cargando, Vacio, toast, useAccion, Confirmar, SelectorPunto } from '../ui.jsx';
import { Soportes } from '../soportes.jsx';
import { imprimirRemision, preferencias } from '../impresora.js';

// estado visible de una remisión en las listas
export const EtiquetaEstado = ({ r }) => (r.anulada === 2 ? <span className="tag warn">Por aprobar</span>
  : r.anulada === 1 ? <span className="tag mal">{r.requiere_aprobacion && r.aprobado_por ? 'Pago rechazado' : 'Anulada'}</span>
  : r.total - r.pagado > 0.5 ? <span className="tag warn">Debe {money(r.total - r.pagado)}</span> : <span className="tag ok">Pagada</span>);

export function Remisiones({ user, cfg }) {
  const [fecha, setFecha] = useState(hoyStr());
  const { bodegas } = useUbicaciones();
  const [punto, setPunto] = useState('');
  const s = useCarga(() => get(`/remisiones?desde=${fecha}&hasta=${fecha}${punto ? `&punto=${punto}` : ''}`), [fecha, punto]);
  const { pendientes, rechazadas } = useCola();
  const total = (s.data || []).filter((r) => !r.anulada).reduce((a, r) => a + r.total, 0);
  return (
    <>
      <Header titulo="Remisiones" />
      <main>
        {pendientes.length > 0 && <div className="card"><b>{pendientes.length} venta(s)/abono(s) por enviar</b><div className="mut">Se envían solas al volver la conexión.</div>{pendientes.map((p) => <div key={p.uuid} className="mut">• {p.etiqueta}</div>)}</div>}
        {rechazadas.map((p) => <div key={p.uuid} className="card" style={{ borderColor: 'var(--mal)' }}><b className="mal">No se pudo registrar: {p.etiqueta}</b><div>{p.error}</div><button className="btn sm gris" onClick={() => descartarRechazada(p.uuid)}>Entendido</button></div>)}
        {user.alcance !== 'ruta' && <SelectorPunto bodegas={bodegas} value={punto} onChange={setPunto} label="Punto" todos />}
        <div className="row" style={{ marginBottom: 10 }}><input type="date" className="q grow" style={{ margin: 0 }} value={fecha} onChange={(e) => setFecha(e.target.value)} /><div className="right"><div className="mut">Vendido</div><b>{money(total)}</b></div></div>
        {s.loading || s.error ? <Cargando s={s} /> : s.data.length === 0 ? <Vacio>Sin remisiones este día</Vacio> : (
          <div className="card list">{s.data.map((r) => (
            <div key={r.id} className="item" onClick={() => ir(`/remisiones/${r.id}`)}>
              <div className="grow"><div className="bold">{numRem(cfg, r.consecutivo)} · {r.cliente}</div><div className="mut">{r.fecha.slice(11, 16)} · {r.vendedor}{user.alcance !== 'ruta' ? ` · ${r.ruta ? conPrefijo('Ruta', r.ruta) : 'Mostrador ' + r.bodega}` : ''}</div></div>
              <div className="right"><div className={'bold' + (r.anulada === 1 ? ' mal' : '')} style={r.anulada === 1 ? { textDecoration: 'line-through' } : {}}>{money(r.total)}</div>
                <EtiquetaEstado r={r} /></div>
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
  // aprueba el administrador o el encargado de la bodega del punto de venta, y nunca su propia venta (el administrador sí puede)
  const aprueba = r && r.pendiente && can(user, 'aprobar_pagos') && (user.alcance === 'todo' || user.bodega_id === r.bodega_id) && (r.usuario_id !== user.id || user.rol === 'admin');
  const puedeCancelar = r && r.pendiente && !aprueba && r.usuario_id === user.id;
  return (
    <>
      <Header titulo="Remisión" atras="/remisiones" />
      <main>
        {s.loading || s.error ? <Cargando s={s} /> : (
          <>
            <div className="card">
              <div className="row between"><h2 style={{ margin: 0 }}>{numRem(cfg, r.consecutivo)}</h2>{r.pendiente ? <span className="tag warn">Por aprobar</span> : r.anulada ? <span className="tag mal">{r.rechazada ? 'Pago rechazado' : 'Anulada'}</span> : null}</div>
              <div className="mut">{r.pendiente ? `Solicitada ${(r.fecha_solicitud || r.fecha).slice(0, 16)}` : r.fecha.slice(0, 16)} · {r.punto} · {r.vendedor}</div>
              <div className="bold" style={{ marginTop: 6 }}>{r.cliente}{r.negocio ? ` · ${r.negocio}` : ''}</div>
              {r.anulada === 1 ? <div className="mal">Motivo: {r.motivo_anulacion}</div> : null}
            </div>
            {r.pendiente && (
              <div className="aviso pend"><b>⏳ Pendiente de pago: no entregues la mercancía.</b>{' '}
                {r.soportes.length ? 'Ya tiene soporte; falta que el encargado o el administrador lo aprueben. Mientras tanto no descuenta inventario ni cuenta como venta.' : 'Falta adjuntar la foto de la transferencia.'}</div>)}
            {r.requiere_aprobacion && r.anulada === 0 && <div className="aviso ok"><b>✅ Pago aprobado</b> por {r.aprobador} el {(r.fecha_aprobacion || '').slice(0, 16)}. Ya se puede entregar la mercancía.</div>}
            {r.rechazada && <div className="aviso mal"><b>Pago rechazado</b> por {r.aprobador}. No se entrega la mercancía.</div>}
            {(r.requiere_aprobacion || r.soportes.length > 0) && (
              <Soportes remision={r} esAprobador={can(user, 'aprobar_pagos')} puedeAdjuntar={r.anulada !== 1} onCambio={s.recargar} />)}
            {aprueba && (
              <div className="card">
                <h3>Revisar el pago</h3>
                <div className="mut" style={{ marginBottom: 8 }}>Confirma en la cuenta del negocio que entraron <b>{money(r.total)}</b> de {r.cliente} y que el comprobante corresponde. Al aprobar, sale el inventario y el pago queda como transferencia.</div>
                <div className="row">
                  <button className="btn grow" disabled={ocupado || !r.soportes.length} onClick={() => { if (Confirmar(`¿Confirmas que recibiste ${money(r.total)}? Se descuenta el inventario y la remisión pasa a válida.`)) run(async () => { await post(`/remisiones/${id}/aprobar`); s.recargar(); }, 'Pago aprobado: ya se puede entregar'); }}>✅ Aprobar pago</button>
                  <button className="btn peligro grow" disabled={ocupado} onClick={() => {
                    const motivo = window.prompt('¿Por qué se rechaza el pago? (queda anotado en la remisión)');
                    if (motivo) run(async () => { await post(`/remisiones/${id}/rechazar`, { motivo }); s.recargar(); }, 'Pago rechazado');
                  }}>Rechazar</button>
                </div>
                {!r.soportes.length && <div className="mut warn" style={{ marginTop: 6 }}>Falta la foto del comprobante: pídela al vendedor o adjúntala arriba.</div>}
              </div>)}
            <div className="card">
              <table className="t"><thead><tr><th>Producto</th><th className="n">Cant.</th><th className="n">Precio</th><th className="n">Total</th></tr></thead>
                <tbody>{r.items.map((i) => <tr key={i.id}><td>{i.descripcion}</td><td className="n">{qty(i.cantidad)}</td><td className="n">{money(i.precio)}</td><td className="n">{money(i.cantidad * i.precio)}</td></tr>)}</tbody></table>
              <div className="right" style={{ marginTop: 8 }}>
                {r.descuento > 0 && <div className="mut">Descuento -{money(r.descuento)}</div>}
                <div className="big">{money(r.total)}</div>
                {!r.anulada && <div className="mut">Pagado {money(r.pagado)} · Saldo {money(r.saldo)} · {r.tipo_pago}</div>}
                {r.pendiente && <div className="mut">Por cobrar con aprobación del pago · {r.tipo_pago}</div>}
              </div>
              {r.nota && <div className="mut">Nota: {r.nota}</div>}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <button className="btn" disabled={ocupado} onClick={() => run(() => compartirRemision(r, cfg))}>Compartir por WhatsApp</button>
              <button className="btn sec" disabled={ocupado} onClick={() => run(() => abrirPdf(r))}>Ver remisión (PDF)</button>
              {preferencias().metodo !== 'pdf' && <button className="btn sec" disabled={ocupado} onClick={() => run(() => imprimirRemision(r, cfg))}>🖨 Imprimir tirilla</button>}
              {r.saldo > 0 && !r.anulada && <button className="btn sec" onClick={() => ir(`/clientes/${r.cliente_id}`)}>Registrar abono</button>}
              {puedeCancelar && <button className="btn peligro" disabled={ocupado} onClick={() => {
                const motivo = window.prompt('Motivo para cancelar esta solicitud:');
                if (motivo) run(async () => { await post(`/remisiones/${id}/anular`, { motivo }); s.recargar(); }, 'Solicitud cancelada');
              }}>Cancelar solicitud</button>}
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
