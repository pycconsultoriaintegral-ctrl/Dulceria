import { useState } from 'react';
import { get, post, money, qty, useCarga } from '../lib.js';
import { Header, Cargando, Vacio, Modal, Campo, Stepper, toast, useAccion } from '../ui.jsx';

export function Inventario({ user }) {
  const admin = user.rol === 'admin';
  const s = useCarga(() => get('/inventario'), []);
  const [vista, setVista] = useState('bodega'); // 'bodega' | id de ruta
  const [traslado, setTraslado] = useState(null);
  const [ajuste, setAjuste] = useState(null);
  const [kardex, setKardex] = useState(null);
  const d = s.data;
  const ruta = admin ? (vista === 'bodega' ? 0 : Number(vista)) : user.ruta_id;
  const cant = (p) => (ruta === 0 ? p.bodega : p.rutas[ruta] ?? 0);
  return (
    <>
      <Header titulo="Inventario" />
      <main>
        {s.loading || s.error ? <Cargando s={s} /> : (
          <>
            {admin && (
              <div className="row wrap" style={{ marginBottom: 10 }}>
                {[{ id: 'bodega', nombre: 'Bodega' }, ...d.rutas].map((r) => <button key={r.id} className={'btn sm ' + (String(vista) === String(r.id) ? '' : 'gris')} onClick={() => setVista(String(r.id))}>{r.nombre}</button>)}
              </div>
            )}
            {admin && (
              <div className="row" style={{ marginBottom: 10 }}>
                {ruta !== 0 ? (
                  <>
                    <button className="btn grow" onClick={() => setTraslado({ ruta, sentido: 'cargue' })}>⬆ Cargar ruta</button>
                    <button className="btn sec grow" onClick={() => setTraslado({ ruta, sentido: 'devolucion' })}>⬇ Recibir devolución</button>
                  </>
                ) : <div className="mut">Para cargar mercancía a una ruta elige la ruta arriba.</div>}
              </div>
            )}
            <div className="card list">
              {d.productos.length === 0 ? <Vacio>Aún no hay productos</Vacio> : d.productos.map((p) => {
                const c = cant(p);
                return (
                  <div key={p.id} className="item" onClick={() => admin && setAjuste({ p, ubicacion: ruta, actual: c })}>
                    <div className="grow"><div className="bold">{p.nombre}</div>{admin && <div className="mut">Costo {money(p.costo)} · valor {money(c * p.costo)}</div>}</div>
                    <div className="right"><b className={c <= 0 ? 'mal' : c <= p.stock_minimo ? 'warn' : ''}>{qty(c)}</b> <span className="mut">{p.unidad}</span></div>
                    {admin && <button className="btn sm gris" onClick={(e) => { e.stopPropagation(); setKardex(p); }}>Kardex</button>}
                  </div>
                );
              })}
            </div>
            {admin && <p className="mut">Toca un producto para ajustar el conteo físico.</p>}
          </>
        )}
      </main>
      {traslado && <Traslado t={traslado} productos={d.productos} nombreRuta={d.rutas.find((r) => r.id === traslado.ruta)?.nombre} onClose={() => setTraslado(null)} onHecho={() => { setTraslado(null); s.recargar(); }} />}
      {ajuste && <Ajuste a={ajuste} onClose={() => setAjuste(null)} onHecho={() => { setAjuste(null); s.recargar(); }} />}
      {kardex && <Kardex p={kardex} onClose={() => setKardex(null)} />}
    </>
  );
}

function Traslado({ t, productos, nombreRuta, onClose, onHecho }) {
  const [q, setQ] = useState({});
  const [ocupado, run] = useAccion();
  const items = Object.entries(q).filter(([, c]) => c > 0).map(([producto_id, cantidad]) => ({ producto_id: +producto_id, cantidad }));
  const cargue = t.sentido === 'cargue';
  return (
    <Modal titulo={`${cargue ? 'Cargar' : 'Devolución de'} ${nombreRuta}`} onClose={onClose}>
      <p className="mut">{cargue ? 'Sale de la bodega y queda en la ruta.' : 'Sale de la ruta y regresa a la bodega (lo que sobró al final del día).'}</p>
      {productos.map((p) => {
        const disp = cargue ? p.bodega : p.rutas[t.ruta] ?? 0;
        if (disp <= 0) return null;
        return <div key={p.id} className="item row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)' }}><div><div className="bold">{p.nombre}</div><div className="mut">disp. {qty(disp)}</div></div>
          <Stepper value={q[p.id] || 0} max={disp} onChange={(c) => setQ({ ...q, [p.id]: c })} /></div>;
      })}
      <button className="btn block" style={{ marginTop: 12 }} disabled={ocupado || !items.length} onClick={() => run(async () => { await post('/inventario/traslado', { ruta_id: t.ruta, sentido: t.sentido, items }); onHecho(); }, 'Movimiento registrado')}>Confirmar {items.length} producto(s)</button>
    </Modal>
  );
}

function Ajuste({ a, onClose, onHecho }) {
  const [real, setReal] = useState(String(a.actual));
  const [nota, setNota] = useState('');
  const [ocupado, run] = useAccion();
  return (
    <Modal titulo={`Ajustar ${a.p.nombre}`} onClose={onClose}>
      <p className="mut">Sistema: {qty(a.actual)}. Escribe lo que contaste físicamente.</p>
      <Campo label="Cantidad real" inputMode="decimal" value={real} onChange={(e) => setReal(e.target.value)} />
      <Campo label="Motivo (merma, vencido, conteo…)" value={nota} onChange={(e) => setNota(e.target.value)} />
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { await post('/inventario/ajuste', { producto_id: a.p.id, ubicacion: a.ubicacion, cantidad_real: Number(real), nota }); onHecho(); }, 'Ajuste guardado')}>Guardar ajuste</button>
    </Modal>
  );
}

function Kardex({ p, onClose }) {
  const s = useCarga(() => get(`/inventario/kardex/${p.id}`), []);
  return (
    <Modal titulo={`Kardex · ${p.nombre}`} onClose={onClose}>
      {s.loading || s.error ? <Cargando s={s} /> : (
        <table className="t"><thead><tr><th>Fecha</th><th>Tipo</th><th className="n">Cant.</th></tr></thead>
          <tbody>{s.data.map((m) => <tr key={m.id}><td>{m.fecha.slice(5, 10)}<div className="mut">{m.referencia}</div></td><td>{m.tipo}<div className="mut">{m.ubicacion === 0 ? 'Bodega' : `Ruta ${m.ubicacion}`}</div></td><td className={'n ' + (m.cantidad < 0 ? 'mal' : 'ok')}>{m.cantidad > 0 ? '+' : ''}{qty(m.cantidad)}</td></tr>)}</tbody></table>
      )}
    </Modal>
  );
}
