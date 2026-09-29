import { useState } from 'react';
import { get, post, put, enviar, uuid, money, useCarga, ir, numRem, telWhatsApp } from '../lib.js';
import { Header, Cargando, Vacio, Modal, Campo, toast, useAccion } from '../ui.jsx';
import { NuevoCliente } from './Vender.jsx';

export function Clientes() {
  const s = useCarga(() => get('/clientes'), []);
  const [q, setQ] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const lista = (s.data || []).filter((c) => `${c.nombre} ${c.negocio || ''} ${c.telefono || ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Header titulo="Clientes" />
      <main>
        <div className="row"><input className="q grow" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn" style={{ marginBottom: 10 }} onClick={() => setNuevo(true)}>+ Nuevo</button></div>
        {s.loading || s.error ? <Cargando s={s} /> : lista.length === 0 ? <Vacio>Sin clientes</Vacio> : (
          <div className="card list">{lista.map((c) => (
            <div key={c.id} className="item" onClick={() => ir(`/clientes/${c.id}`)}>
              <div className="grow"><div className="bold">{c.nombre}</div><div className="mut">{c.negocio}{c.ruta ? ` · ${c.ruta}` : ''}</div></div>
              {c.saldo > 0.5 && <span className="tag warn">{money(c.saldo)}</span>}
            </div>))}</div>
        )}
      </main>
      {nuevo && <NuevoCliente onClose={() => setNuevo(false)} onCreado={() => { setNuevo(false); s.recargar(); }} />}
    </>
  );
}

export function ClienteDetalle({ id, user, cfg }) {
  const s = useCarga(() => get(`/clientes/${id}`), [id]);
  const [abonar, setAbonar] = useState(false);
  const [editar, setEditar] = useState(false);
  const c = s.data;
  return (
    <>
      <Header titulo="Cliente" atras="/clientes" />
      <main>
        {s.loading || s.error ? <Cargando s={s} /> : (
          <>
            <div className="card">
              <h2 style={{ margin: 0 }}>{c.nombre}</h2>
              <div className="mut">{c.negocio} {c.direccion && `· ${c.direccion}`}</div>
              {c.telefono && <div><a href={`tel:${c.telefono}`}>{c.telefono}</a> · <a href={`https://wa.me/${telWhatsApp(c.telefono)}`} target="_blank" rel="noreferrer">WhatsApp</a></div>}
              <div className="row between" style={{ marginTop: 10 }}>
                <div><div className="mut">Saldo pendiente</div><div className={'big ' + (c.saldo > 0.5 ? 'warn' : 'ok')}>{money(c.saldo)}</div></div>
                <div className="row">{c.saldo > 0.5 && <button className="btn" onClick={() => setAbonar(true)}>Registrar abono</button>}<button className="btn sm gris" onClick={() => setEditar(true)}>Editar</button></div>
              </div>
            </div>
            <div className="card"><h3>Remisiones recientes</h3>
              {c.remisiones.length === 0 ? <div className="mut">Aún sin compras</div> : c.remisiones.map((r) => (
                <div key={r.id} className="item row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)', cursor: 'pointer' }} onClick={() => ir(`/remisiones/${r.id}`)}>
                  <div>{numRem(cfg, r.consecutivo)}<div className="mut">{r.fecha.slice(0, 10)}</div></div>
                  <div className="right"><b>{money(r.total)}</b>{r.anulada ? <div className="tag mal">Anulada</div> : r.total - r.pagado > 0.5 && <div className="mut warn">Debe {money(r.total - r.pagado)}</div>}</div>
                </div>))}
            </div>
            <div className="card"><h3>Pagos recientes</h3>
              {c.pagos.length === 0 ? <div className="mut">Sin pagos</div> : c.pagos.map((p) => <div key={p.id} className="row between mut" style={{ padding: '4px 0', textDecoration: p.anulado ? 'line-through' : 'none' }}><span>{p.fecha.slice(0, 16)}</span><span>{money(p.valor)}</span></div>)}
            </div>
          </>
        )}
      </main>
      {abonar && <Abono cliente={c} onClose={() => setAbonar(false)} onHecho={() => { setAbonar(false); s.recargar(); }} />}
      {editar && <EditarCliente cliente={c} user={user} onClose={() => setEditar(false)} onHecho={() => { setEditar(false); s.recargar(); }} />}
    </>
  );
}

export function Abono({ cliente, onClose, onHecho }) {
  const [valor, setValor] = useState(String(Math.round(cliente.saldo)));
  const [uid] = useState(uuid());
  const [ocupado, run] = useAccion();
  return (
    <Modal titulo={`Abono de ${cliente.nombre}`} onClose={onClose}>
      <p className="mut">Deuda actual: <b>{money(cliente.saldo)}</b>. El abono se aplica a las remisiones más antiguas primero.</p>
      <Campo label="Valor recibido" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus />
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => {
        const r = await enviar('abono', { uuid: uid, cliente_id: cliente.id, valor: Number(valor) }, `Abono ${cliente.nombre} · ${money(valor)}`);
        toast(r.pendiente ? 'Sin señal: el abono se enviará después' : 'Abono registrado');
        onHecho();
      })}>Registrar abono</button>
    </Modal>
  );
}

function EditarCliente({ cliente, user, onClose, onHecho }) {
  const [f, setF] = useState({ ...cliente });
  const rutas = useCarga(() => (user.rol === 'admin' ? get('/rutas') : []), []);
  const [ocupado, run] = useAccion();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal titulo="Editar cliente" onClose={onClose}>
      <Campo label="Nombre" value={f.nombre} onChange={set('nombre')} />
      <Campo label="Negocio" value={f.negocio || ''} onChange={set('negocio')} />
      <Campo label="Teléfono" inputMode="tel" value={f.telefono || ''} onChange={set('telefono')} />
      <Campo label="Dirección" value={f.direccion || ''} onChange={set('direccion')} />
      <Campo label="Documento (CC/NIT)" value={f.documento || ''} onChange={set('documento')} />
      {user.rol === 'admin' && <label className="f">Ruta<select value={f.ruta_id ?? ''} onChange={(e) => setF({ ...f, ruta_id: e.target.value || null })}><option value="">Sin ruta</option>{(rutas.data || []).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></label>}
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { await put(`/clientes/${cliente.id}`, f); onHecho(); }, 'Guardado')}>Guardar</button>
    </Modal>
  );
}

export function Cartera({ user }) {
  const s = useCarga(() => get('/cartera'), []);
  const [sel, setSel] = useState(null);
  return (
    <>
      <Header titulo="Cartera" />
      <main>
        {s.loading || s.error ? <Cargando s={s} /> : (
          <>
            <div className="card"><div className="mut">Total por cobrar</div><div className="big warn">{money(s.data.total)}</div></div>
            {s.data.clientes.length === 0 ? <Vacio>🎉 Nadie te debe</Vacio> : (
              <div className="card list">{s.data.clientes.map((c) => (
                <div key={c.id} className="item">
                  <div className="grow" onClick={() => ir(`/clientes/${c.id}`)}><div className="bold">{c.nombre}</div><div className="mut">{c.negocio} · desde {c.mas_antigua.slice(0, 10)}</div></div>
                  <div className="right"><b>{money(c.saldo)}</b><div className="row" style={{ marginTop: 4 }}><button className="btn sm" onClick={() => setSel(c)}>Abonar</button>
                    {c.telefono && <a className="btn sm sec" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }} target="_blank" rel="noreferrer"
                      href={`https://wa.me/${telWhatsApp(c.telefono)}?text=${encodeURIComponent(`Hola ${c.nombre}, le recordamos su saldo pendiente de ${money(c.saldo)}. ¡Gracias!`)}`}>💬</a>}</div></div>
                </div>))}</div>
            )}
          </>
        )}
      </main>
      {sel && <Abono cliente={sel} onClose={() => setSel(null)} onHecho={() => { setSel(null); s.recargar(); }} />}
    </>
  );
}
