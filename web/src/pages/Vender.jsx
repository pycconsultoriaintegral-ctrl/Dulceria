import { useMemo, useState } from 'react';
import { get, post, enviar, uuid, money, qty, useCarga, ir, compartirRemision, abrirPdf, numRem } from '../lib.js';
import { Header, Cargando, Stepper, Modal, Campo, toast, useAccion } from '../ui.jsx';

export default function Vender({ user, cfg }) {
  const esAdmin = user.rol === 'admin';
  const [rutaAdmin, setRutaAdmin] = useState(0);
  const rutas = useCarga(() => (esAdmin ? get('/rutas') : []), []);
  const prods = useCarga(() => get(`/productos?ruta_id=${esAdmin ? rutaAdmin : user.ruta_id}`), [rutaAdmin]);
  const clientes = useCarga(() => get('/clientes'), []);
  const [cliente, setCliente] = useState(null);
  const [buscaCli, setBuscaCli] = useState('');
  const [buscaProd, setBuscaProd] = useState('');
  const [items, setItems] = useState({}); // id -> {cantidad, precio}
  const [tipo, setTipo] = useState('contado');
  const [abono, setAbono] = useState('');
  const [desc, setDesc] = useState('');
  const [nota, setNota] = useState('');
  const [nuevoCli, setNuevoCli] = useState(false);
  const [hecho, setHecho] = useState(null);
  const [ocupado, run] = useAccion();
  const [uid, setUid] = useState(uuid()); // identifica esta venta para no duplicarla si se reintenta

  const lista = prods.data || [];
  const sel = lista.filter((p) => items[p.id]?.cantidad > 0);
  const subtotal = sel.reduce((a, p) => a + items[p.id].cantidad * items[p.id].precio, 0);
  const total = Math.max(0, subtotal - (Number(desc) || 0));
  const filtrados = useMemo(() => lista.filter((p) => p.nombre.toLowerCase().includes(buscaProd.toLowerCase())), [lista, buscaProd]);

  const setCant = (p, c) => setItems((it) => ({ ...it, [p.id]: { precio: it[p.id]?.precio ?? p.precio, cantidad: c } }));
  const setPrecio = (p, v) => setItems((it) => ({ ...it, [p.id]: { cantidad: it[p.id]?.cantidad ?? 0, precio: Number(v) || 0 } }));

  const confirmar = () => run(async () => {
    if (!cliente) throw new Error('Elige el cliente');
    if (!sel.length) throw new Error('Agrega al menos un producto');
    const sinStock = sel.find((p) => items[p.id].cantidad > p.stock_ruta);
    if (sinStock) throw new Error(`Solo hay ${qty(sinStock.stock_ruta)} de "${sinStock.nombre}" en la ruta`);
    if (tipo === 'credito' && (Number(abono) || 0) > total) throw new Error('El abono no puede superar el total');
    const payload = {
      uuid: uid, cliente_id: cliente.id, tipo_pago: tipo, abono: tipo === 'credito' ? Number(abono) || 0 : 0,
      descuento: Number(desc) || 0, nota, ruta_id: esAdmin ? rutaAdmin : undefined,
      items: sel.map((p) => ({ producto_id: p.id, cantidad: items[p.id].cantidad, precio: items[p.id].precio })),
    };
    const r = await enviar('venta', payload, `${cliente.nombre} · ${money(total)}`);
    if (r.pendiente) setHecho({ pendiente: true, total });
    else setHecho({ id: r.data.id, consecutivo: r.data.consecutivo, total });
  });

  if (hecho) return <Listo hecho={hecho} cliente={cliente} cfg={cfg} onNueva={() => { setHecho(null); setItems({}); setCliente(null); setAbono(''); setDesc(''); setNota(''); setUid(uuid()); prods.recargar(); }} />;

  return (
    <>
      <Header titulo="Nueva venta" />
      <main>
        {esAdmin && (
          <label className="f">Vender desde
            <select value={rutaAdmin} onChange={(e) => { setRutaAdmin(+e.target.value); setItems({}); }}>
              <option value={0}>Bodega / mostrador</option>
              {(rutas.data || []).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </select>
          </label>
        )}
        <div className="card">
          <h3>Cliente</h3>
          {cliente ? (
            <div className="row between"><div><div className="bold">{cliente.nombre}</div><div className="mut">{cliente.negocio}{cliente.saldo > 0 && <span className="warn"> · debe {money(cliente.saldo)}</span>}</div></div>
              <button className="btn sm gris" onClick={() => setCliente(null)}>Cambiar</button></div>
          ) : (
            <>
              <input className="q" placeholder="Buscar cliente…" value={buscaCli} onChange={(e) => setBuscaCli(e.target.value)} />
              {clientes.loading ? <Cargando s={clientes} /> : (
                <div className="list" style={{ maxHeight: 220, overflow: 'auto' }}>
                  {(clientes.data || []).filter((c) => `${c.nombre} ${c.negocio || ''}`.toLowerCase().includes(buscaCli.toLowerCase())).slice(0, 30).map((c) => (
                    <div key={c.id} className="item" onClick={() => setCliente(c)}><div className="grow"><div className="bold">{c.nombre}</div><div className="mut">{c.negocio}</div></div>{c.saldo > 0 && <span className="tag warn">{money(c.saldo)}</span>}</div>
                  ))}
                </div>
              )}
              <button className="btn sec block" onClick={() => setNuevoCli(true)}>+ Cliente nuevo</button>
            </>
          )}
        </div>

        <div className="card">
          <h3>Productos</h3>
          <input className="q" placeholder="Buscar producto…" value={buscaProd} onChange={(e) => setBuscaProd(e.target.value)} />
          {prods.loading ? <Cargando s={prods} /> : filtrados.length === 0 ? <div className="mut">Sin productos</div> : (
            <div className="list">
              {filtrados.map((p) => {
                const it = items[p.id];
                const agotado = p.stock_ruta <= 0;
                return (
                  <div key={p.id} className="item" style={{ cursor: 'default', opacity: agotado ? 0.5 : 1 }}>
                    <div className="grow">
                      <div className="bold">{p.nombre}</div>
                      <div className="mut">
                        {it?.cantidad > 0 ? <>Precio <input style={{ width: 80, padding: 3 }} inputMode="decimal" value={it.precio} onChange={(e) => setPrecio(p, e.target.value)} /></> : money(p.precio)}
                        {' · '}disp. {qty(p.stock_ruta)}
                      </div>
                    </div>
                    {agotado ? <span className="tag mal">Agotado</span> : <Stepper value={it?.cantidad || 0} max={p.stock_ruta} onChange={(c) => setCant(p, c)} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {sel.length > 0 && (
          <div className="card">
            <h3>Pago</h3>
            <div className="row" style={{ marginBottom: 10 }}>
              <button className={'btn grow ' + (tipo === 'contado' ? '' : 'gris')} onClick={() => setTipo('contado')}>Contado</button>
              <button className={'btn grow ' + (tipo === 'credito' ? '' : 'gris')} onClick={() => setTipo('credito')}>Crédito</button>
            </div>
            {tipo === 'credito' && <Campo label="Abono inicial (opcional)" inputMode="decimal" value={abono} onChange={(e) => setAbono(e.target.value)} />}
            <Campo label="Descuento ($)" inputMode="decimal" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <Campo label="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
        )}

        <div className="total-bar">
          <div className="row between"><span className="mut">{sel.length} producto(s)</span><span className="big">{money(total)}</span></div>
          <button className="btn block" style={{ marginTop: 8 }} disabled={ocupado || !sel.length || !cliente} onClick={confirmar}>{ocupado ? 'Guardando…' : 'Generar remisión'}</button>
        </div>
      </main>
      {nuevoCli && <NuevoCliente onClose={() => setNuevoCli(false)} onCreado={async (id) => { setNuevoCli(false); const lst = await get('/clientes'); clientes.recargar(); setCliente(lst.find((c) => c.id === id)); }} />}
    </>
  );
}

function Listo({ hecho, cliente, cfg, onNueva }) {
  const [ocupado, run] = useAccion();
  if (hecho.pendiente) return (
    <><Header titulo="Venta guardada" /><main><div className="card center"><div style={{ fontSize: 48 }}>📡</div><h2>Sin señal</h2>
      <p>La venta de <b>{money(hecho.total)}</b> quedó guardada en tu celular y se enviará sola cuando vuelva la conexión. La remisión se podrá compartir después desde “Remisiones”.</p>
      <button className="btn block" onClick={onNueva}>Nueva venta</button></div></main></>
  );
  const r = { id: hecho.id, consecutivo: hecho.consecutivo, total: hecho.total, telefono: cliente?.telefono, saldo: 0 };
  return (
    <><Header titulo="Remisión creada" /><main><div className="card center">
      <div style={{ fontSize: 48 }}>✅</div><h2>{numRem(cfg, hecho.consecutivo)}</h2><div className="big">{money(hecho.total)}</div>
      <p className="mut">{cliente?.nombre}</p>
      <div style={{ display: 'grid', gap: 10 }}>
        <button className="btn" disabled={ocupado} onClick={() => run(async () => compartirRemision((await get(`/remisiones/${hecho.id}`)), cfg))}>Compartir por WhatsApp</button>
        <button className="btn sec" disabled={ocupado} onClick={() => run(() => abrirPdf(r))}>Ver / descargar PDF</button>
        <button className="btn gris" onClick={onNueva}>Nueva venta</button>
        <button className="btn gris" onClick={() => ir('/remisiones')}>Ver remisiones</button>
      </div></div></main></>
  );
}

export function NuevoCliente({ onClose, onCreado }) {
  const [f, setF] = useState({ nombre: '', negocio: '', telefono: '', direccion: '' });
  const [ocupado, run] = useAccion();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal titulo="Cliente nuevo" onClose={onClose}>
      <Campo label="Nombre *" value={f.nombre} onChange={set('nombre')} />
      <Campo label="Negocio" value={f.negocio} onChange={set('negocio')} />
      <Campo label="Teléfono / WhatsApp" inputMode="tel" value={f.telefono} onChange={set('telefono')} />
      <Campo label="Dirección" value={f.direccion} onChange={set('direccion')} />
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { const r = await post('/clientes', f); toast('Cliente creado'); onCreado(r.id); })}>Guardar</button>
    </Modal>
  );
}
