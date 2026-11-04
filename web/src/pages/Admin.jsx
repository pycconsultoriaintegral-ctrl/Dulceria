import { useState } from 'react';
import { get, post, put, money, qty, useCarga } from '../lib.js';
import { Header, Cargando, Vacio, Modal, Campo, Stepper, toast, useAccion } from '../ui.jsx';

// ---------- Productos ----------
export function Productos() {
  const s = useCarga(() => get('/productos?todos=1'), []);
  const inv = useCarga(() => get('/inventario?ub=resumen'), []);
  const totales = Object.fromEntries((inv.data?.productos || []).map((p) => [p.id, p.total]));
  const [ed, setEd] = useState(null);
  const [q, setQ] = useState('');
  return (
    <>
      <Header titulo="Productos" atras="/mas" />
      <main>
        <div className="row"><input className="q grow" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn" style={{ marginBottom: 10 }} onClick={() => setEd({ nombre: '', unidad: 'und', precio: '', costo: '', stock_minimo: 0, presentaciones: [] })}>+ Nuevo</button></div>
        {s.loading || s.error ? <Cargando s={s} /> : (
          <div className="card list">{s.data.filter((p) => p.nombre.toLowerCase().includes(q.toLowerCase())).map((p) => (
            <div key={p.id} className="item" onClick={() => setEd(p)} style={{ opacity: p.activo ? 1 : 0.5 }}>
              <div className="grow"><div className="bold">{p.nombre}</div><div className="mut">Costo {money(p.costo)} · Venta {money(p.precio)}{p.precio > 0 && ` · margen ${Math.round(((p.precio - p.costo) / p.precio) * 100)}%`}{p.presentaciones?.length > 0 && ` · ${p.presentaciones.map((x) => `${x.nombre} ×${x.factor}`).join(', ')}`}</div></div>
              <div className="right mut">Total<br /><b>{qty(totales[p.id] || 0)}</b></div>
            </div>))}</div>
        )}
      </main>
      {ed && <EditarProducto p={ed} onClose={() => setEd(null)} onHecho={() => { setEd(null); s.recargar(); }} />}
    </>
  );
}
function EditarProducto({ p, onClose, onHecho }) {
  const [f, setF] = useState({ ...p });
  const [ocupado, run] = useAccion();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cambiarPres = (i, cambio) => setF({ ...f, presentaciones: f.presentaciones.map((x, k) => (k === i ? { ...x, ...cambio } : x)) });
  return (
    <Modal titulo={p.id ? 'Editar producto' : 'Producto nuevo'} onClose={onClose}>
      <Campo label="Nombre *" value={f.nombre} onChange={set('nombre')} />
      <div className="grid2"><Campo label="Código" value={f.codigo || ''} onChange={set('codigo')} /><Campo label="Unidad" value={f.unidad} onChange={set('unidad')} /></div>
      <div className="grid2"><Campo label="Precio de venta" inputMode="decimal" value={f.precio} onChange={set('precio')} /><Campo label="Costo" inputMode="decimal" value={f.costo} onChange={set('costo')} /></div>
      <Campo label="Alerta de stock mínimo (en unidades)" inputMode="decimal" value={f.stock_minimo} onChange={set('stock_minimo')} />
      <div className="card" style={{ background: '#f4f7fe' }}>
        <h3>Presentaciones</h3>
        <p className="mut" style={{ marginTop: 0 }}>El inventario se lleva en <b>{f.unidad || 'und'}</b>. Agrega cómo se compra o vende por mayor y cuántas {f.unidad || 'unidades'} trae cada una.</p>
        {(f.presentaciones || []).map((x, i) => (
          <div key={i} className="row" style={{ marginBottom: 8, alignItems: 'flex-end' }}>
            <label className="f grow" style={{ margin: 0 }}>Nombre<input value={x.nombre} placeholder="caja, estiba…" onChange={(e) => cambiarPres(i, { nombre: e.target.value })} /></label>
            <label className="f" style={{ margin: 0, width: 82 }}>Trae<input inputMode="decimal" value={x.factor} placeholder="20" onChange={(e) => cambiarPres(i, { factor: e.target.value })} /></label>
            <label className="f" style={{ margin: 0, width: 104 }}>Precio<input inputMode="decimal" value={x.precio ?? ''} placeholder={f.precio && x.factor ? String(Math.round(f.precio * x.factor)) : 'auto'} onChange={(e) => cambiarPres(i, { precio: e.target.value })} /></label>
            <button className="btn sm gris" onClick={() => setF({ ...f, presentaciones: f.presentaciones.filter((_, k) => k !== i) })} aria-label="Quitar">✕</button>
          </div>
        ))}
        <button className="btn sm sec" onClick={() => setF({ ...f, presentaciones: [...(f.presentaciones || []), { nombre: '', factor: '', precio: '' }] })}>+ Agregar presentación</button>
        <p className="mut" style={{ marginBottom: 0 }}>Si dejas el precio vacío, se usa el precio de la unidad × lo que trae.</p>
      </div>
      {p.id && <label className="f"><input type="checkbox" checked={!!f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked ? 1 : 0 })} style={{ display: 'inline', width: 'auto' }} /> Activo</label>}
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { p.id ? await put(`/productos/${p.id}`, f) : await post('/productos', f); onHecho(); }, 'Guardado')}>Guardar</button>
    </Modal>
  );
}

