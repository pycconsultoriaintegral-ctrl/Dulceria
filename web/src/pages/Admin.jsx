import { useState } from 'react';
import { get, post, put, money, qty, useCarga, hoyStr } from '../lib.js';
import { Header, Cargando, Vacio, Modal, Campo, Stepper, toast, useAccion } from '../ui.jsx';

// ---------- Productos ----------
export function Productos() {
  const s = useCarga(() => get('/productos?todos=1'), []);
  const [ed, setEd] = useState(null);
  const [q, setQ] = useState('');
  return (
    <>
      <Header titulo="Productos" atras="/mas" />
      <main>
        <div className="row"><input className="q grow" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn" style={{ marginBottom: 10 }} onClick={() => setEd({ nombre: '', unidad: 'und', precio: '', costo: '', stock_minimo: 0 })}>+ Nuevo</button></div>
        {s.loading || s.error ? <Cargando s={s} /> : (
          <div className="card list">{s.data.filter((p) => p.nombre.toLowerCase().includes(q.toLowerCase())).map((p) => (
            <div key={p.id} className="item" onClick={() => setEd(p)} style={{ opacity: p.activo ? 1 : 0.5 }}>
              <div className="grow"><div className="bold">{p.nombre}</div><div className="mut">Costo {money(p.costo)} · Venta {money(p.precio)}{p.precio > 0 && ` · margen ${Math.round(((p.precio - p.costo) / p.precio) * 100)}%`}</div></div>
              <div className="right mut">Bodega<br /><b>{qty(p.stock_bodega)}</b></div>
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
  return (
    <Modal titulo={p.id ? 'Editar producto' : 'Producto nuevo'} onClose={onClose}>
      <Campo label="Nombre *" value={f.nombre} onChange={set('nombre')} />
      <div className="grid2"><Campo label="Código" value={f.codigo || ''} onChange={set('codigo')} /><Campo label="Unidad" value={f.unidad} onChange={set('unidad')} /></div>
      <div className="grid2"><Campo label="Precio de venta" inputMode="decimal" value={f.precio} onChange={set('precio')} /><Campo label="Costo" inputMode="decimal" value={f.costo} onChange={set('costo')} /></div>
      <Campo label="Alerta de stock mínimo" inputMode="decimal" value={f.stock_minimo} onChange={set('stock_minimo')} />
      {p.id && <label className="f"><input type="checkbox" checked={!!f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked ? 1 : 0 })} style={{ display: 'inline', width: 'auto' }} /> Activo</label>}
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { p.id ? await put(`/productos/${p.id}`, f) : await post('/productos', f); onHecho(); }, 'Guardado')}>Guardar</button>
    </Modal>
  );
}

// ---------- Compras ----------
export function Compras() {
  const s = useCarga(() => get('/compras'), []);
  const prov = useCarga(() => get('/proveedores'), []);
  const [nueva, setNueva] = useState(false);
  const [det, setDet] = useState(null);
  const [nprov, setNprov] = useState(false);
  const [ocupado, run] = useAccion();
  return (
    <>
      <Header titulo="Compras" atras="/mas" />
      <main>
        <div className="row" style={{ marginBottom: 10 }}><button className="btn grow" onClick={() => setNueva(true)}>+ Registrar compra</button><button className="btn sec" onClick={() => setNprov(true)}>Proveedores</button></div>
        {prov.data?.some((p) => p.deuda > 0.5) && <div className="card"><b>Por pagar a proveedores</b>{prov.data.filter((p) => p.deuda > 0.5).map((p) => <div key={p.id} className="row between"><span>{p.nombre}</span><b className="warn">{money(p.deuda)}</b></div>)}</div>}
        {s.loading || s.error ? <Cargando s={s} /> : s.data.length === 0 ? <Vacio>Sin compras registradas</Vacio> : (
          <div className="card list">{s.data.map((c) => (
            <div key={c.id} className="item" onClick={async () => setDet(await get(`/compras/${c.id}`))}>
              <div className="grow"><div className="bold">{c.proveedor || 'Sin proveedor'}{c.factura ? ` · ${c.factura}` : ''}</div><div className="mut">{c.fecha.slice(0, 10)}</div></div>
              <div className="right"><b style={c.anulada ? { textDecoration: 'line-through' } : {}}>{money(c.total)}</b>{c.anulada ? <div className="tag mal">Anulada</div> : c.total - c.pagado > 0.5 && <div className="tag warn">Debe {money(c.total - c.pagado)}</div>}</div>
            </div>))}</div>
        )}
      </main>
      {nueva && <NuevaCompra proveedores={prov.data || []} onClose={() => setNueva(false)} onHecho={() => { setNueva(false); s.recargar(); prov.recargar(); }} />}
      {nprov && <Proveedores onClose={() => { setNprov(false); prov.recargar(); }} />}
      {det && <Modal titulo={`Compra #${det.id}`} onClose={() => setDet(null)}>
        <div className="mut">{det.fecha.slice(0, 16)} · {det.proveedor || 'Sin proveedor'}</div>
        <table className="t"><tbody>{det.items.map((i) => <tr key={i.id}><td>{i.nombre}</td><td className="n">{qty(i.cantidad)} × {money(i.costo)}</td></tr>)}</tbody></table>
        <div className="right big">{money(det.total)}</div><div className="right mut">Pagado {money(det.pagado)}</div>
        {!det.anulada && det.total - det.pagado > 0.5 && <button className="btn block" style={{ marginTop: 8 }} disabled={ocupado} onClick={() => { const v = window.prompt('Valor del pago al proveedor', Math.round(det.total - det.pagado)); if (v) run(async () => { await post(`/compras/${det.id}/pago`, { valor: Number(v) }); setDet(null); s.recargar(); prov.recargar(); }, 'Pago registrado'); }}>Registrar pago</button>}
        {!det.anulada && <button className="btn peligro block" style={{ marginTop: 8 }} disabled={ocupado} onClick={() => { if (window.confirm('¿Anular la compra? Se descuenta el inventario que entró.')) run(async () => { await post(`/compras/${det.id}/anular`); setDet(null); s.recargar(); }, 'Compra anulada'); }}>Anular compra</button>}
      </Modal>}
    </>
  );
}
function NuevaCompra({ proveedores, onClose, onHecho }) {
  const prods = useCarga(() => get('/productos?todos=1'), []);
  const [it, setIt] = useState({}); // id -> {cantidad, costo}
  const [prov, setProv] = useState('');
  const [factura, setFactura] = useState('');
  const [pagado, setPagado] = useState('');
  const [q, setQ] = useState('');
  const [ocupado, run] = useAccion();
  const lista = (prods.data || []).filter((p) => p.activo && p.nombre.toLowerCase().includes(q.toLowerCase()));
  const items = Object.entries(it).filter(([, v]) => v.cantidad > 0).map(([id, v]) => ({ producto_id: +id, cantidad: v.cantidad, costo: v.costo }));
  const total = items.reduce((a, i) => a + i.cantidad * i.costo, 0);
  return (
    <Modal titulo="Registrar compra" onClose={onClose}>
      <label className="f">Proveedor<select value={prov} onChange={(e) => setProv(e.target.value)}><option value="">Sin proveedor</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      <Campo label="No. factura del proveedor (opcional)" value={factura} onChange={(e) => setFactura(e.target.value)} />
      <input className="q" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
      {lista.map((p) => { const v = it[p.id]; return (
        <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)' }} className="row between">
          <div className="grow"><div className="bold">{p.nombre}</div>{v?.cantidad > 0 ? <div className="mut">Costo unit. <input style={{ width: 80, padding: 3 }} inputMode="decimal" value={v.costo} onChange={(e) => setIt({ ...it, [p.id]: { ...v, costo: Number(e.target.value) || 0 } })} /></div> : <div className="mut">último costo {money(p.costo)}</div>}</div>
          <Stepper value={v?.cantidad || 0} onChange={(c) => setIt({ ...it, [p.id]: { cantidad: c, costo: v?.costo ?? p.costo } })} />
        </div>); })}
      <Campo label={`Pagado ahora (vacío = pagó todo ${money(total)})`} inputMode="decimal" value={pagado} onChange={(e) => setPagado(e.target.value)} />
      <div className="row between"><b>Total</b><span className="big">{money(total)}</span></div>
      <button className="btn block" style={{ marginTop: 8 }} disabled={ocupado || !items.length} onClick={() => run(async () => { await post('/compras', { proveedor_id: prov || null, factura, pagado: pagado === '' ? undefined : Number(pagado), items }); onHecho(); }, 'Compra registrada · inventario actualizado')}>Guardar compra</button>
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

// ---------- Reportes ----------
export function Reportes() {
  const [desde, setDesde] = useState(hoyStr().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(hoyStr());
  const s = useCarga(() => get(`/reportes/resumen?desde=${desde}&hasta=${hasta}`), [desde, hasta]);
  const d = s.data;
  return (
    <>
      <Header titulo="Reportes" atras="/mas" />
      <main>
        <div className="grid2"><Campo type="date" label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} /><Campo type="date" label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        {s.loading || s.error ? <Cargando s={s} /> : (
          <>
            <div className="grid2" style={{ marginBottom: 12 }}>
              <Kpi l="Ventas" v={money(d.ventas)} sub={`${d.remisiones} remisiones`} />
              <Kpi l="Utilidad bruta" v={money(d.utilidad_bruta)} sub={d.ventas > 0 ? `${Math.round((d.utilidad_bruta / d.ventas) * 100)}% de margen` : ''} />
              <Kpi l="Gastos de ruta" v={money(d.gastos)} />
              <Kpi l="Utilidad neta" v={money(d.utilidad_neta)} />
              <Kpi l="Compras" v={money(d.compras)} />
              <Kpi l="Inventario (costo)" v={money(d.valor_inventario)} />
              <Kpi l="Por cobrar (cartera)" v={money(d.cartera)} />
              <Kpi l="Por pagar" v={money(d.por_pagar)} />
            </div>
            {d.stock_bajo.length > 0 && <div className="card"><h3 className="warn">⚠ Stock bajo</h3>{d.stock_bajo.map((p) => <div key={p.id} className="row between"><span>{p.nombre}</span><b>{qty(p.total)} / mín {qty(p.stock_minimo)}</b></div>)}</div>}
            <div className="card"><h3>Ventas por ruta</h3>{d.por_ruta.length === 0 ? <div className="mut">Sin ventas</div> : d.por_ruta.map((r) => <div key={r.ruta} className="row between"><span>{r.ruta} <span className="mut">({r.remisiones})</span></span><b>{money(r.ventas)}</b></div>)}</div>
            <div className="card"><h3>Productos más vendidos</h3>
              <table className="t"><thead><tr><th>Producto</th><th className="n">Cant.</th><th className="n">Ventas</th><th className="n">Utilidad</th></tr></thead>
                <tbody>{d.top_productos.map((p) => <tr key={p.nombre}><td>{p.nombre}</td><td className="n">{qty(p.cantidad)}</td><td className="n">{money(p.ventas)}</td><td className="n ok">{money(p.utilidad)}</td></tr>)}</tbody></table></div>
            <div className="card"><h3>Ventas por día</h3>{d.por_dia.map((x) => { const max = Math.max(...d.por_dia.map((y) => y.ventas)); return <div key={x.dia} style={{ marginBottom: 6 }}><div className="row between mut"><span>{x.dia}</span><span>{money(x.ventas)}</span></div><div className="bar"><i style={{ width: `${(x.ventas / max) * 100}%` }} /></div></div>; })}</div>
          </>
        )}
      </main>
    </>
  );
}
const Kpi = ({ l, v, sub }) => <div className="kpi"><div className="l">{l}</div><div className="v">{v}</div>{sub && <div className="l">{sub}</div>}</div>;

// ---------- Ajustes (negocio, rutas, usuarios) ----------
export function Ajustes({ cfgRefrescar }) {
  const cfg = useCarga(() => get('/config'), []);
  const rutas = useCarga(() => get('/rutas'), []);
  const usuarios = useCarga(() => get('/usuarios'), []);
  const [f, setF] = useState(null);
  const [ruta, setRuta] = useState('');
  const [u, setU] = useState(null);
  const [ocupado, run] = useAccion();
  const v = f || cfg.data;
  const set = (k) => (e) => setF({ ...v, [k]: e.target.value });
  return (
    <>
      <Header titulo="Ajustes del negocio" atras="/mas" />
      <main>
        {cfg.loading || !v ? <Cargando s={cfg} /> : (
          <div className="card"><h3>Datos que salen en la remisión</h3>
            <Campo label="Nombre del negocio" value={v.negocio} onChange={set('negocio')} />
            <div className="grid2"><Campo label="NIT / Cédula" value={v.nit} onChange={set('nit')} /><Campo label="Teléfono" value={v.telefono} onChange={set('telefono')} /></div>
            <Campo label="Dirección" value={v.direccion} onChange={set('direccion')} />
            <Campo label="Prefijo del consecutivo" value={v.prefijo} onChange={set('prefijo')} />
            <label className="f">Mensaje al pie<textarea rows={2} value={v.pie_remision} onChange={set('pie_remision')} /></label>
            <button className="btn block" disabled={ocupado} onClick={() => run(async () => { await put('/config', v); cfgRefrescar(); }, 'Guardado')}>Guardar</button>
          </div>
        )}
        <div className="card"><h3>Rutas</h3>
          {(rutas.data || []).map((r) => <div key={r.id} className="row between" style={{ padding: '4px 0' }}><span>{r.nombre}</span><span className={'tag ' + (r.activa ? 'ok' : 'mal')}>{r.activa ? 'Activa' : 'Inactiva'}</span></div>)}
          <div className="row" style={{ marginTop: 8 }}><input className="q grow" style={{ margin: 0 }} placeholder="Nueva ruta" value={ruta} onChange={(e) => setRuta(e.target.value)} /><button className="btn" disabled={ocupado} onClick={() => run(async () => { await post('/rutas', { nombre: ruta }); setRuta(''); rutas.recargar(); }, 'Ruta creada')}>Agregar</button></div>
        </div>
        <div className="card"><h3>Usuarios</h3>
          {(usuarios.data || []).map((x) => <div key={x.id} className="item row between" style={{ padding: '8px 0', cursor: 'pointer', opacity: x.activo ? 1 : 0.5 }} onClick={() => setU(x)}><div><b>{x.nombre}</b><div className="mut">@{x.usuario} · {x.rol}{x.ruta ? ` · ${x.ruta}` : ''}</div></div><span className="mut">Editar</span></div>)}
          <button className="btn sec block" style={{ marginTop: 8 }} onClick={() => setU({ nombre: '', usuario: '', rol: 'vendedor', ruta_id: '', activo: 1, nuevo: true })}>+ Nuevo usuario</button>
        </div>
      </main>
      {u && <EditarUsuario u={u} rutas={rutas.data || []} onClose={() => setU(null)} onHecho={() => { setU(null); usuarios.recargar(); }} />}
    </>
  );
}
function EditarUsuario({ u, rutas, onClose, onHecho }) {
  const [f, setF] = useState({ ...u, clave: '' });
  const [ocupado, run] = useAccion();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal titulo={u.nuevo ? 'Nuevo usuario' : 'Editar usuario'} onClose={onClose}>
      <Campo label="Nombre" value={f.nombre} onChange={set('nombre')} />
      {u.nuevo && <Campo label="Usuario (para iniciar sesión)" autoCapitalize="none" value={f.usuario} onChange={set('usuario')} />}
      <Campo label={u.nuevo ? 'Contraseña (mín. 6)' : 'Nueva contraseña (vacío = no cambiar)'} type="password" value={f.clave} onChange={set('clave')} />
      <label className="f">Rol<select value={f.rol} onChange={set('rol')}><option value="vendedor">Vendedor de ruta</option><option value="admin">Administrador</option></select></label>
      {f.rol === 'vendedor' && <label className="f">Ruta<select value={f.ruta_id ?? ''} onChange={set('ruta_id')}><option value="">— elegir —</option>{rutas.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></label>}
      {!u.nuevo && <label className="f"><input type="checkbox" checked={!!f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked ? 1 : 0 })} style={{ display: 'inline', width: 'auto' }} /> Activo</label>}
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { const b = { ...f, ruta_id: f.rol === 'vendedor' ? f.ruta_id || null : null }; if (!b.clave) delete b.clave; u.nuevo ? await post('/usuarios', b) : await put(`/usuarios/${u.id}`, b); onHecho(); }, 'Guardado')}>Guardar</button>
    </Modal>
  );
}
