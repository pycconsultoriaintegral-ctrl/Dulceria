import { useState } from 'react';
import { get, post, money, qty, useCarga, useUbicaciones, esAdmin, can, nombreBodega, factorDe } from '../lib.js';
import { Header, Cargando, Vacio, Modal, Campo, Stepper, useAccion, SelectorBodega, SelectorPresentacion } from '../ui.jsx';
import { BotonFoto, FotosPendientes, Imagen } from '../soportes.jsx';

export function Compras({ user }) {
  const { bodegas } = useUbicaciones();
  const [bodegaF, setBodegaF] = useState('');
  const s = useCarga(() => get(`/compras${bodegaF ? `?bodega_id=${bodegaF}` : ''}`), [bodegaF]);
  const prov = useCarga(() => get('/proveedores'), []);
  const [nueva, setNueva] = useState(() => location.hash.includes('nueva=1')); // «Ingresar factura» desde Inventario
  const [det, setDet] = useState(null);
  const [nprov, setNprov] = useState(false);
  const [ocupado, run] = useAccion();
  return (
    <>
      <Header titulo="Compras" atras="/mas" />
      <main>
        {esAdmin(user) && bodegas.length > 1 && <SelectorBodega bodegas={bodegas} value={bodegaF} onChange={setBodegaF} label="Bodega" todos />}
        <div className="row" style={{ marginBottom: 10 }}><button className="btn grow" onClick={() => setNueva(true)}>+ Registrar compra</button><button className="btn sec" onClick={() => setNprov(true)}>Proveedores</button></div>
        {can(user, 'pagar_proveedores') && prov.data?.some((p) => p.deuda > 0.5) && <div className="card"><b>Por pagar a proveedores</b>{prov.data.filter((p) => p.deuda > 0.5).map((p) => <div key={p.id} className="row between"><span>{p.nombre}</span><b className="warn">{money(p.deuda)}</b></div>)}</div>}
        {s.loading || s.error ? <Cargando s={s} /> : s.data.length === 0 ? <Vacio>Sin compras registradas</Vacio> : (
          <div className="card list">{s.data.map((c) => (
            <div key={c.id} className="item" onClick={async () => setDet(await get(`/compras/${c.id}`))}>
              <div className="grow"><div className="bold">{c.proveedor || 'Sin proveedor'}{c.factura ? ` · ${c.factura}` : ''}</div><div className="mut">{c.fecha.slice(0, 10)} · {c.bodega}</div></div>
              <div className="right"><b style={c.anulada ? { textDecoration: 'line-through' } : {}}>{money(c.total)}</b>{c.anulada ? <div className="tag mal">Anulada</div> : c.total - c.pagado > 0.5 && <div className="tag warn">Debe {money(c.total - c.pagado)}</div>}</div>
            </div>))}</div>
        )}
      </main>
      {nueva && <NuevaCompra user={user} bodegas={bodegas} proveedores={prov.data || []} onClose={() => setNueva(false)} onHecho={() => { setNueva(false); s.recargar(); prov.recargar(); }} />}
      {nprov && <Proveedores onClose={() => { setNprov(false); prov.recargar(); }} />}
      {det && <Modal titulo={`Compra #${det.id}`} onClose={() => setDet(null)}>
        <div className="mut">{det.fecha.slice(0, 16)} · {det.proveedor || 'Sin proveedor'} · Bodega {det.bodega}</div>
        <table className="t"><tbody>{det.items.map((i) => <tr key={i.id}><td>{i.nombre}{i.presentacion ? ` (${i.presentacion})` : ''}</td><td className="n">{qty(i.cantidad)} × {money(i.costo)}</td></tr>)}</tbody></table>
        <div className="right big">{money(det.total)}</div><div className="right mut">Pagado {money(det.pagado)}</div>
        <h3 style={{ marginBottom: 6 }}>Foto de la factura</h3>
        {det.fotos?.length > 0 ? <div className="fotos">{det.fotos.map((f) => <Imagen key={f.id} url={`/compras/${det.id}/foto/${f.id}`} alt="Factura" />)}</div> : <div className="mut">Sin foto adjunta</div>}
        {(det.fotos?.length || 0) < 5 && <div style={{ marginTop: 8 }}><BotonFoto texto="📷 Agregar foto de la factura" onFoto={async (img) => { await post(`/compras/${det.id}/foto`, { imagen: img }); setDet(await get(`/compras/${det.id}`)); }} /></div>}
        {can(user, 'pagar_proveedores') && !det.anulada && det.total - det.pagado > 0.5 && <button className="btn block" style={{ marginTop: 8 }} disabled={ocupado} onClick={() => { const v = window.prompt('Valor del pago al proveedor', Math.round(det.total - det.pagado)); if (v) run(async () => { await post(`/compras/${det.id}/pago`, { valor: Number(v) }); setDet(null); s.recargar(); prov.recargar(); }, 'Pago registrado'); }}>Registrar pago</button>}
        {can(user, 'pagar_proveedores') && !det.anulada && <button className="btn peligro block" style={{ marginTop: 8 }} disabled={ocupado} onClick={() => { if (window.confirm('¿Anular la compra? Se descuenta el inventario que entró.')) run(async () => { await post(`/compras/${det.id}/anular`); setDet(null); s.recargar(); }, 'Compra anulada'); }}>Anular compra</button>}
      </Modal>}
    </>
  );
}
function NuevaCompra({ user, bodegas, proveedores, onClose, onHecho }) {
  const [bodega, setBodega] = useState(user.alcance === 'bodega' ? String(user.bodega_id) : bodegas.length === 1 ? String(bodegas[0].id) : '');
  const prods = useCarga(() => get('/productos?todos=1'), []);
  const [it, setIt] = useState({}); // id -> {cantidad, costo}
  const [prov, setProv] = useState('');
  const [factura, setFactura] = useState('');
  const [pagado, setPagado] = useState('');
  const [fotos, setFotos] = useState([]);
  const [q, setQ] = useState('');
  const [ocupado, run] = useAccion();
  const lista = (prods.data || []).filter((p) => p.activo && p.nombre.toLowerCase().includes(q.toLowerCase()));
  const items = Object.entries(it).filter(([, v]) => v.cantidad > 0).map(([id, v]) => ({ producto_id: +id, presentacion_id: v.pres || undefined, cantidad: v.cantidad, costo: v.costo }));
  const total = items.reduce((a, i) => a + i.cantidad * i.costo, 0);
  return (
    <Modal titulo="Registrar compra" onClose={onClose}>
      {user.alcance === 'todo' ? <SelectorBodega bodegas={bodegas} value={bodega} onChange={setBodega} label="Bodega que recibe la compra" />
        : <div className="mut" style={{ marginBottom: 10 }}>Llega a tu bodega: <b>{nombreBodega(bodegas, user.bodega_id)}</b></div>}
      <label className="f">Proveedor<select value={prov} onChange={(e) => setProv(e.target.value)}><option value="">Sin proveedor</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      <Campo label="No. factura del proveedor (opcional)" value={factura} onChange={(e) => setFactura(e.target.value)} />
      <div style={{ marginBottom: 10 }}>
        <FotosPendientes fotos={fotos} onQuitar={(i) => setFotos(fotos.filter((_, k) => k !== i))} />
        {fotos.length < 5 && <BotonFoto texto="📷 Foto de la factura (opcional)" onFoto={(img) => setFotos([...fotos, img])} />}
      </div>
      <input className="q" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
      {lista.map((p) => {
        const v = it[p.id];
        const pres = v?.pres ?? null;
        const costoLista = Math.round(p.costo * factorDe(p, pres) * 100) / 100; // último costo por unidad x lo que trae la presentación
        return (
          <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)' }} className="row between">
            <div className="grow"><div className="bold">{p.nombre}</div>{v?.cantidad > 0 ? <div className="mut">Costo por {pres ? p.presentaciones.find((x) => x.id === pres)?.nombre : p.unidad} <input style={{ width: 90, padding: 3 }} inputMode="decimal" value={v.costo} onChange={(e) => setIt({ ...it, [p.id]: { ...v, costo: Number(e.target.value) || 0 } })} /></div> : <div className="mut">último costo {money(costoLista)}</div>}</div>
            <div className="row" style={{ gap: 6 }}>
              <SelectorPresentacion producto={p} value={pres} onChange={(x) => setIt({ ...it, [p.id]: { cantidad: v?.cantidad ?? 0, pres: x, costo: Math.round(p.costo * factorDe(p, x) * 100) / 100 } })} />
              <Stepper value={v?.cantidad || 0} onChange={(c) => setIt({ ...it, [p.id]: { cantidad: c, pres, costo: v?.costo ?? costoLista } })} />
            </div>
          </div>
        );
      })}
      <Campo label={`Pagado ahora (vacío = pagó todo ${money(total)})`} inputMode="decimal" value={pagado} onChange={(e) => setPagado(e.target.value)} />
      <div className="row between"><b>Total</b><span className="big">{money(total)}</span></div>
      <button className="btn block" style={{ marginTop: 8 }} disabled={ocupado || !items.length || !bodega} onClick={() => run(async () => { await post('/compras', { bodega_id: Number(bodega), proveedor_id: prov || null, factura, pagado: pagado === '' ? undefined : Number(pagado), fotos: fotos.length ? fotos : undefined, items }); onHecho(); }, 'Compra registrada · inventario actualizado')}>Guardar compra</button>
    </Modal>
  );
}
function Proveedores({ onClose }) {
  const s = useCarga(() => get('/proveedores'), []);
  const [nombre, setNombre] = useState('');
  const [tel, setTel] = useState('');
  const [ocupado, run] = useAccion();
  return (
    <Modal titulo="Proveedores" onClose={onClose}>
      {(s.data || []).map((p) => <div key={p.id} className="row between" style={{ padding: '6px 0' }}><span>{p.nombre}<div className="mut">{p.telefono}</div></span>{p.deuda > 0.5 && <b className="warn">{money(p.deuda)}</b>}</div>)}
      <hr />
      <Campo label="Nuevo proveedor" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <Campo label="Teléfono" value={tel} onChange={(e) => setTel(e.target.value)} />
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { await post('/proveedores', { nombre, telefono: tel }); setNombre(''); setTel(''); s.recargar(); }, 'Proveedor agregado')}>Agregar</button>
    </Modal>
  );
}

