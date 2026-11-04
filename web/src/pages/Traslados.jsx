import { useEffect, useState } from 'react';
import { get, post, qty, useCarga, useUbicaciones, ir, esAdmin, desglose, factorDe } from '../lib.js';
import { Header, Cargando, Vacio, Modal, Stepper, SelectorBodega, SelectorPresentacion, toast, useAccion } from '../ui.jsx';

const ESTADO = { enviado: ['En camino', 'warn'], recibido: ['Recibido', 'ok'], anulado: ['Anulado', 'mal'] };

export function Traslados({ user }) {
  const { bodegas } = useUbicaciones();
  const [estado, setEstado] = useState('enviado');
  const s = useCarga(() => get(`/traslados?estado=${estado}`), [estado]);
  const [nuevo, setNuevo] = useState(() => {
    const p = new URLSearchParams(location.hash.split('?')[1] || '').get('nuevo');
    return p ? { origen: p } : null;
  });
  const [det, setDet] = useState(null);
  const origenes = bodegas.filter((b) => esAdmin(user) || b.id === user.bodega_id);
  return (
    <>
      <Header titulo="Traslados entre bodegas" atras="/mas" />
      <main>
        <button className="btn block" style={{ marginBottom: 10 }} onClick={() => setNuevo({ origen: origenes[0] ? String(origenes[0].id) : '' })}>+ Enviar mercancía a otra bodega</button>
        <div className="row" style={{ marginBottom: 10 }}>
          {[['enviado', 'En camino'], ['recibido', 'Recibidos'], ['anulado', 'Anulados']].map(([v, t]) => <button key={v} className={'btn sm grow ' + (estado === v ? '' : 'gris')} onClick={() => setEstado(v)}>{t}</button>)}
        </div>
        {s.loading || s.error ? <Cargando s={s} /> : s.data.length === 0 ? <Vacio>Sin traslados</Vacio> : (
          <div className="card list">{s.data.map((t) => (
            <div key={t.id} className="item" onClick={async () => setDet(await get(`/traslados/${t.id}`))}>
              <div className="grow"><div className="bold">{t.origen} → {t.destino}</div><div className="mut">T-{t.id} · {t.fecha.slice(0, 10)} · {t.productos} producto(s)</div></div>
              <span className={'tag ' + ESTADO[t.estado][1]}>{ESTADO[t.estado][0]}</span>
            </div>))}</div>
        )}
      </main>
      {nuevo && <NuevoTraslado bodegas={bodegas} origenes={origenes} inicial={nuevo.origen} onClose={() => setNuevo(null)} onHecho={() => { setNuevo(null); s.recargar(); }} />}
      {det && <Detalle t={det} user={user} onClose={() => setDet(null)} onHecho={() => { setDet(null); s.recargar(); }} />}
    </>
  );
}

function NuevoTraslado({ bodegas, origenes, inicial, onClose, onHecho }) {
  const [origen, setOrigen] = useState(String(inicial || ''));
  const [destino, setDestino] = useState('');
  const [nota, setNota] = useState('');
  const [q, setQ] = useState({});
  const [filtro, setFiltro] = useState('');
  const inv = useCarga(() => (origen ? get(`/inventario?ub=B${origen}`) : { productos: [] }), [origen]);
  const [ocupado, run] = useAccion();
  const [pr, setPr] = useState({});
  const items = Object.entries(q).filter(([, c]) => c > 0).map(([producto_id, cantidad]) => ({ producto_id: +producto_id, cantidad, presentacion_id: pr[producto_id] || undefined }));
  const productos = (inv.data?.productos || []).filter((p) => p.cantidad > 0 && p.nombre.toLowerCase().includes(filtro.toLowerCase()));
  return (
    <Modal titulo="Enviar a otra bodega" onClose={onClose}>
      <SelectorBodega bodegas={origenes} value={origen} onChange={(v) => { setOrigen(v); setQ({}); }} label="Desde" />
      <SelectorBodega bodegas={bodegas.filter((b) => String(b.id) !== origen)} value={destino} onChange={setDestino} label="Hacia" />
      <input className="q" placeholder="Buscar producto…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
      {inv.loading ? <Cargando s={inv} /> : productos.map((p) => (
        <div key={p.id} className="item row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)' }}>
          <div><div className="bold">{p.nombre}</div><div className="mut">disp. {qty(p.cantidad)}{desglose(p.cantidad, p.presentaciones, p.unidad) ? ` (${desglose(p.cantidad, p.presentaciones, p.unidad)})` : ''}</div></div>
          <div className="row" style={{ gap: 6 }}>
            <SelectorPresentacion producto={p} value={pr[p.id]} onChange={(v) => { setPr({ ...pr, [p.id]: v }); setQ({ ...q, [p.id]: 0 }); }} />
            <Stepper value={q[p.id] || 0} max={Math.floor(p.cantidad / factorDe(p, pr[p.id]))} onChange={(c) => setQ({ ...q, [p.id]: c })} />
          </div>
        </div>
      ))}
      <label className="f" style={{ marginTop: 10 }}>Nota (opcional)<input value={nota} onChange={(e) => setNota(e.target.value)} /></label>
      <p className="mut">Al enviar, la mercancía sale de tu bodega y queda “en camino” hasta que la otra bodega la reciba.</p>
      <button className="btn block" disabled={ocupado || !items.length || !destino}
        onClick={() => run(async () => { await post('/traslados', { origen_id: Number(origen), destino_id: Number(destino), items, nota }); onHecho(); }, 'Traslado enviado')}>Enviar {items.length} producto(s)</button>
    </Modal>
  );
}

function Detalle({ t, user, onClose, onHecho }) {
  const [rec, setRec] = useState(() => Object.fromEntries(t.items.map((i) => [i.producto_id, i.cantidad])));
  const [ocupado, run] = useAccion();
  const puedeRecibir = t.estado === 'enviado' && (esAdmin(user) || user.bodega_id === t.destino_id);
  const puedeAnular = t.estado === 'enviado' && (esAdmin(user) || user.bodega_id === t.origen_id);
  return (
    <Modal titulo={`Traslado T-${t.id}`} onClose={onClose}>
      <div className="mut">{t.origen} → {t.destino} · {t.fecha.slice(0, 16)} · envió {t.envia}</div>
      {t.nota && <div className="mut">Nota: {t.nota}</div>}
      <span className={'tag ' + ESTADO[t.estado][1]}>{ESTADO[t.estado][0]}</span>
      <div style={{ marginTop: 10 }}>
        {t.items.map((i) => {
          const falta = t.estado === 'recibido' && i.cantidad_recibida < i.cantidad;
          return (
            <div key={i.id} className="item row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)' }}>
              <div><div className="bold">{i.nombre}</div><div className="mut">Enviado {qty(i.cantidad)} {i.unidad}{desglose(i.cantidad, i.presentaciones, i.unidad) ? ` (${desglose(i.cantidad, i.presentaciones, i.unidad)})` : ''}{t.estado === 'recibido' && <> · recibido {qty(i.cantidad_recibida)}</>}</div>
                {falta && <div className="tag mal">Faltante {qty(i.cantidad - i.cantidad_recibida)}</div>}</div>
              {puedeRecibir && <Stepper value={rec[i.producto_id]} max={i.cantidad} onChange={(c) => setRec({ ...rec, [i.producto_id]: c })} />}
            </div>
          );
        })}
      </div>
      {puedeRecibir && (
        <>
          <p className="mut">Cuenta lo que llegó. Si falta algo, baja la cantidad: el faltante queda registrado.</p>
          <button className="btn block" disabled={ocupado} onClick={() => run(async () => {
            await post(`/traslados/${t.id}/recibir`, { items: t.items.map((i) => ({ producto_id: i.producto_id, cantidad_recibida: rec[i.producto_id] })) });
            onHecho();
          }, 'Traslado recibido')}>Confirmar recepción</button>
        </>
      )}
      {puedeAnular && <button className="btn peligro block" style={{ marginTop: 8 }} disabled={ocupado} onClick={() => { if (window.confirm('¿Anular el envío? La mercancía vuelve a tu bodega.')) run(async () => { await post(`/traslados/${t.id}/anular`); onHecho(); }, 'Traslado anulado'); }}>Anular envío</button>}
    </Modal>
  );
}
