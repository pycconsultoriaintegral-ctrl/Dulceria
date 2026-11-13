import { useState } from 'react';
import { get, post, money, qty, useCarga, useUbicaciones, can, ir, conPrefijo, desglose, factorDe } from '../lib.js';
import { Header, Cargando, Vacio, Modal, Campo, Stepper, toast, useAccion, SelectorPresentacion } from '../ui.jsx';

export function Inventario({ user }) {
  const gestiona = can(user, 'inventario');
  const { bodegas } = useUbicaciones();
  // vendedor: su ruta; encargado: su bodega; administrador: resumen general
  const [ub, setUb] = useState(user.alcance === 'ruta' ? `R${user.ruta_id}` : user.alcance === 'bodega' ? `B${user.bodega_id}` : 'resumen');
  const [q, setQ] = useState('');
  const s = useCarga(() => get(`/inventario?ub=${ub}`), [ub]);
  const pend = useCarga(() => (gestiona ? get('/traslados?estado=enviado') : []), []);
  const [movimiento, setMovimiento] = useState(null); // { sentido }
  const [ajuste, setAjuste] = useState(null);
  const [kardex, setKardex] = useState(null);
  const d = s.data;
  const filtrados = (d?.productos || []).filter((p) => p.nombre.toLowerCase().includes(q.toLowerCase()));
  const porRecibir = (pend.data || []).filter((t) => (user.alcance === 'todo' || t.destino_id === user.bodega_id));

  return (
    <>
      <Header titulo="Inventario" />
      <main>
        {gestiona && (
          <label className="f">Ver inventario de
            <select value={ub} onChange={(e) => { setUb(e.target.value); setQ(''); }}>
              <option value="resumen">📊 Resumen general</option>
              {bodegas.filter((b) => b.activa).map((b) => (
                <optgroup key={b.id} label={b.nombre}>
                  <option value={`B${b.id}`}>{conPrefijo('Bodega', b.nombre)}</option>
                  {b.rutas.filter((r) => r.activa).map((r) => <option key={r.id} value={`R${r.id}`}>{conPrefijo('Ruta', r.nombre)}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {gestiona && (
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            {(can(user, 'compras') || can(user, 'pagar_proveedores')) && <button className="btn grow" onClick={() => ir('/compras?nueva=1')}>📥 Ingresar factura</button>}
            <button className="btn sec grow" onClick={() => ir(`/kardex${ub !== 'resumen' ? `?ub=${ub}` : ''}`)}>📒 Kardex general</button>
          </div>)}
        {gestiona && porRecibir.length > 0 && (
          <div className="card" style={{ borderColor: 'var(--oro)', cursor: 'pointer' }} onClick={() => ir('/traslados')}>
            <b>📦 {porRecibir.length} traslado(s) en camino</b><div className="mut">Toca para ver y recibir</div>
          </div>
        )}
        {s.loading || s.error ? <Cargando s={s} /> : (
          <>
            {d.ub !== 'resumen' && gestiona && (
              <div className="row wrap" style={{ marginBottom: 10 }}>
                {d.tipo === 'R' ? (
                  <>
                    <button className="btn grow" onClick={() => setMovimiento({ sentido: 'cargue' })}>⬆ Cargar ruta</button>
                    <button className="btn sec grow" onClick={() => setMovimiento({ sentido: 'devolucion' })}>⬇ Recibir devolución</button>
                  </>
                ) : <button className="btn sec grow" onClick={() => ir(`/traslados?nuevo=${d.bodega_id}`)}>↔ Enviar a otra bodega</button>}
              </div>
            )}
            <input className="q" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
            {filtrados.length === 0 ? <Vacio>Sin productos</Vacio> : d.ub === 'resumen' ? (
              <div className="card list">
                {filtrados.map((p) => (
                  <div key={p.id} className="item" style={{ cursor: 'default' }}>
                    <div className="grow">
                      <div className="bold">{p.nombre}</div>
                      <div className="mut">{d.bodegas.map((b) => `${b.nombre} ${qty(p.por_bodega[b.id] || 0)}`).join(' · ')} · Rutas {qty(p.en_rutas)}</div>
                    </div>
                    <div className="right"><b className={p.total <= 0 ? 'mal' : ''}>{qty(p.total)}</b> <span className="mut">{p.unidad}</span>
                      {desglose(p.total, p.presentaciones, p.unidad) && <div className="mut">{desglose(p.total, p.presentaciones, p.unidad)}</div>}
                      {p.costo !== undefined && <div className="mut">{money(p.total * p.costo)}</div>}
                      {gestiona && <button className="btn sm gris" onClick={() => ir(`/kardex?q=${encodeURIComponent(p.nombre)}`)}>📒 Kardex</button>}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="card list">
                {filtrados.map((p) => {
                  const c = p.cantidad;
                  const bajo = d.tipo === 'B' && p.stock_minimo > 0 && c <= p.stock_minimo;
                  return (
                    <div key={p.id} className="item" onClick={() => gestiona && setAjuste({ p, ub: d.ub, actual: c })}>
                      <div className="grow"><div className="bold">{p.nombre}</div>{p.costo !== undefined && <div className="mut">Costo {money(p.costo)} · valor {money(c * p.costo)}</div>}</div>
                      <div className="right"><b className={c <= 0 ? 'mal' : bajo ? 'warn' : ''}>{qty(c)}</b> <span className="mut">{p.unidad}</span>{desglose(c, p.presentaciones, p.unidad) && <div className="mut">{desglose(c, p.presentaciones, p.unidad)}</div>}{bajo && <div className="tag warn">Reponer</div>}</div>
                      {gestiona && <button className="btn sm sec" onClick={(e) => { e.stopPropagation(); setKardex({ p, ub: d.ub }); }}>📒 Kardex</button>}
                    </div>
                  );
                })}
              </div>
            )}
            {gestiona && d.ub !== 'resumen' && <p className="mut">Toca un producto para ajustar el conteo físico.</p>}
          </>
        )}
      </main>
      {movimiento && <MovimientoRuta ruta={d} sentido={movimiento.sentido} onClose={() => setMovimiento(null)} onHecho={() => { setMovimiento(null); s.recargar(); }} />}
      {ajuste && <Ajuste a={ajuste} onClose={() => setAjuste(null)} onHecho={() => { setAjuste(null); s.recargar(); }} />}
      {kardex && <Kardex k={kardex} onClose={() => setKardex(null)} />}
    </>
  );
}

// Cargue (bodega de la ruta -> ruta) o devolución (ruta -> su bodega)
function MovimientoRuta({ ruta, sentido, onClose, onHecho }) {
  const cargue = sentido === 'cargue';
  const origen = useCarga(() => (cargue ? get(`/inventario?ub=B${ruta.bodega_id}`) : ruta), [ruta.ub]);
  const [q, setQ] = useState({});
  const [filtro, setFiltro] = useState('');
  const [ocupado, run] = useAccion();
  const productos = (origen.data?.productos || []).filter((p) => p.cantidad > 0 && p.nombre.toLowerCase().includes(filtro.toLowerCase()));
  const [pr, setPr] = useState({}); // producto -> presentación elegida
  const items = Object.entries(q).filter(([, c]) => c > 0).map(([producto_id, cantidad]) => ({ producto_id: +producto_id, cantidad, presentacion_id: pr[producto_id] || undefined }));
  return (
    <Modal titulo={`${cargue ? 'Cargar' : 'Devolución de'} ${ruta.nombre}`} onClose={onClose}>
      <p className="mut">{cargue ? 'Sale de la bodega de la ruta y queda en la ruta.' : 'Sale de la ruta y regresa a su bodega (lo que sobró al final del día).'}</p>
      <input className="q" placeholder="Buscar producto…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
      {origen.loading ? <Cargando s={origen} /> : productos.length === 0 ? <Vacio>No hay productos disponibles</Vacio> : productos.map((p) => (
        <div key={p.id} className="item row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)' }}>
          <div><div className="bold">{p.nombre}</div><div className="mut">disp. {qty(p.cantidad)}{desglose(p.cantidad, p.presentaciones, p.unidad) ? ` (${desglose(p.cantidad, p.presentaciones, p.unidad)})` : ''}</div></div>
          <div className="row" style={{ gap: 6 }}>
            <SelectorPresentacion producto={p} value={pr[p.id]} onChange={(v) => { setPr({ ...pr, [p.id]: v }); setQ({ ...q, [p.id]: 0 }); }} />
            <Stepper value={q[p.id] || 0} max={Math.floor(p.cantidad / factorDe(p, pr[p.id]))} onChange={(c) => setQ({ ...q, [p.id]: c })} />
          </div>
        </div>
      ))}
      <button className="btn block" style={{ marginTop: 12 }} disabled={ocupado || !items.length}
        onClick={() => run(async () => { await post('/inventario/cargue', { ruta_id: Number(ruta.ub.slice(1)), sentido, items }); onHecho(); }, 'Movimiento registrado')}>Confirmar {items.length} producto(s)</button>
    </Modal>
  );
}

function Ajuste({ a, onClose, onHecho }) {
  const [pres, setPres] = useState(null);
  const factor = factorDe(a.p, pres);
  const [real, setReal] = useState(String(a.actual));
  const [nota, setNota] = useState('');
  const [ocupado, run] = useAccion();
  return (
    <Modal titulo={`Ajustar ${a.p.nombre}`} onClose={onClose}>
      <p className="mut">Sistema: {qty(a.actual)} {a.p.unidad}{desglose(a.actual, a.p.presentaciones, a.p.unidad) ? ` (${desglose(a.actual, a.p.presentaciones, a.p.unidad)})` : ''}. Escribe lo que contaste físicamente.</p>
      {a.p.presentaciones?.length > 0 && (
        <div className="row" style={{ marginBottom: 8 }}><span className="mut">Contado en</span><SelectorPresentacion producto={a.p} value={pres} onChange={(v) => { setPres(v); setReal(String(Math.round((a.actual / factorDe(a.p, v)) * 1e6) / 1e6)); }} /></div>
      )}
      <Campo label={`Cantidad real${pres ? ` (en ${a.p.presentaciones.find((x) => x.id === pres)?.nombre})` : ''}`} inputMode="decimal" value={real} onChange={(e) => setReal(e.target.value)} />
      <Campo label="Motivo (merma, vencido, conteo…)" value={nota} onChange={(e) => setNota(e.target.value)} />
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { await post('/inventario/ajuste', { producto_id: a.p.id, ub: a.ub, cantidad_real: Number(real), presentacion_id: pres || undefined, nota }); onHecho(); }, 'Ajuste guardado')}>Guardar ajuste</button>
    </Modal>
  );
}

function Kardex({ k, onClose }) {
  const s = useCarga(() => get(`/inventario/kardex/${k.p.id}?ub=${k.ub}`), []);
  return (
    <Modal titulo={`Kardex · ${k.p.nombre}`} onClose={onClose}>
      {s.loading || s.error ? <Cargando s={s} /> : (
        <table className="t"><thead><tr><th>Fecha</th><th>Movimiento</th><th className="n">Cant.</th></tr></thead>
          <tbody>{s.data.map((m) => <tr key={m.id}><td>{m.fecha.slice(5, 10)}<div className="mut">{m.referencia}</div></td><td>{m.tipo.replaceAll('_', ' ')}<div className="mut">{m.nota || m.usuario}</div></td><td className={'n ' + (m.cantidad < 0 ? 'mal' : 'ok')}>{m.cantidad > 0 ? '+' : ''}{qty(m.cantidad)}</td></tr>)}</tbody></table>
      )}
    </Modal>
  );
}
