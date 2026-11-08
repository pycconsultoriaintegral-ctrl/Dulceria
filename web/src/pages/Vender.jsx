import { useMemo, useState } from 'react';
import { get, post, enviar, uuid, money, qty, useCarga, ir, compartirRemision, abrirPdf, numRem, useUbicaciones, factorDe, listaDe, desglose, puntosDe } from '../lib.js';
import { Header, Cargando, Stepper, Modal, Campo, toast, useAccion, SelectorPunto, SelectorPresentacion } from '../ui.jsx';
import { BotonFoto, FotosPendientes } from '../soportes.jsx';
import { imprimirRemision, preferencias } from '../impresora.js';
import { ahoraLocal } from '../tirilla.js';

export default function Vender({ user, cfg }) {
  const elige = user.rol !== 'vendedor'; // el vendedor siempre vende de su ruta; los demás eligen el punto de venta
  const { bodegas } = useUbicaciones();
  const [punto, setPunto] = useState(user.rol === 'bodeguero' ? `B${user.bodega_id}` : '');
  const prods = useCarga(() => (elige && !punto ? [] : get(`/productos?punto=${punto}`)), [punto]);
  const clientes = useCarga(() => get('/clientes'), []);
  const [cliente, setCliente] = useState(null);
  const [buscaCli, setBuscaCli] = useState('');
  const [buscaProd, setBuscaProd] = useState('');
  const [items, setItems] = useState({}); // id -> {cantidad, precio}
  const [tipo, setTipo] = useState('contado');
  const [abono, setAbono] = useState('');
  const [metodo, setMetodo] = useState('efectivo');
  const [desc, setDesc] = useState('');
  const [nota, setNota] = useState('');
  const [fotos, setFotos] = useState([]); // comprobantes de transferencia (data URL ya comprimidos)
  const [nuevoCli, setNuevoCli] = useState(false);
  const [hecho, setHecho] = useState(null);
  const [ocupado, run] = useAccion();
  const [uid, setUid] = useState(uuid()); // identifica esta venta para no duplicarla si se reintenta

  const lista = prods.data || [];
  const sel = lista.filter((p) => items[p.id]?.cantidad > 0);
  const subtotal = sel.reduce((a, p) => a + items[p.id].cantidad * items[p.id].precio, 0);
  const total = Math.max(0, subtotal - (Number(desc) || 0));
  const anticipado = !!cliente?.paga_antes; // este cliente debe pagar antes de recibir: la remisión queda pendiente de aprobación
  const codigoPunto = elige ? punto : `R${user.ruta_id}`;
  const nombrePunto = puntosDe(bodegas).find((x) => x.codigo === codigoPunto)?.nombre || '';
  const filtrados = useMemo(() => lista.filter((p) => p.nombre.toLowerCase().includes(buscaProd.toLowerCase())), [lista, buscaProd]);

  // cada línea lleva su presentación (unidad, caja, estiba…), la cantidad y el precio en esa presentación
  const setCant = (p, c) => setItems((it) => ({ ...it, [p.id]: { pres: it[p.id]?.pres ?? null, precio: it[p.id]?.precio ?? listaDe(p, it[p.id]?.pres), cantidad: c } }));
  const setPrecio = (p, v) => setItems((it) => ({ ...it, [p.id]: { pres: it[p.id]?.pres ?? null, cantidad: it[p.id]?.cantidad ?? 0, precio: Number(v) || 0 } }));
  const setPres = (p, pres) => setItems((it) => ({ ...it, [p.id]: { pres, precio: listaDe(p, pres), cantidad: Math.min(it[p.id]?.cantidad ?? 0, Math.floor(p.stock_punto / factorDe(p, pres))) } }));

  const confirmar = () => run(async () => {
    if (elige && !punto) throw new Error('Elige el punto de venta');
    if (!cliente) throw new Error('Elige el cliente');
    if (!sel.length) throw new Error('Agrega al menos un producto');
    const sinStock = sel.find((p) => items[p.id].cantidad * factorDe(p, items[p.id].pres) > p.stock_punto);
    if (sinStock) throw new Error(`Solo hay ${qty(sinStock.stock_ruta)} de "${sinStock.nombre}" en la ruta`);
    if (!anticipado && tipo === 'credito' && (Number(abono) || 0) > total) throw new Error('El abono no puede superar el total');
    const payload = {
      uuid: uid, cliente_id: cliente.id, tipo_pago: anticipado ? 'contado' : tipo, metodo: anticipado ? 'transferencia' : metodo, abono: !anticipado && tipo === 'credito' ? Number(abono) || 0 : 0,
      descuento: Number(desc) || 0, nota, punto: elige ? punto : undefined, soportes: fotos.length ? fotos : undefined,
      items: sel.map((p) => ({ producto_id: p.id, presentacion_id: items[p.id].pres || undefined, cantidad: items[p.id].cantidad, precio: items[p.id].precio })),
    };
    const r = await enviar('venta', payload, `${cliente.nombre} · ${money(total)}`);
    // copia local de la venta para imprimir la tirilla aunque no haya señal
    const pagado = anticipado ? 0 : tipo === 'contado' ? total : Number(abono) || 0;
    const local = {
      provisional: uid.slice(0, 8).toUpperCase(), fecha: ahoraLocal(), vendedor: user.nombre, punto: nombrePunto, cliente: cliente.nombre, negocio: cliente.negocio,
      cliente_documento: cliente.documento, telefono: cliente.telefono, cliente_direccion: cliente.direccion, tipo_pago: anticipado ? 'contado' : tipo, metodo,
      subtotal, descuento: Number(desc) || 0, total, pagado, saldo: Math.max(0, total - pagado), pendiente: anticipado, nota,
      pagos: pagado > 0 ? [{ metodo: anticipado ? 'transferencia' : metodo, valor: pagado }] : [],
      items: sel.map((p) => { const pres = p.presentaciones?.find((x) => x.id === Number(items[p.id].pres)); return { descripcion: pres ? `${p.nombre} (${pres.nombre})` : p.nombre, cantidad: items[p.id].cantidad, precio: items[p.id].precio }; }),
    };
    if (r.pendiente) setHecho({ sinSenal: true, total, anticipado, fotos: fotos.length, local });
    else setHecho({ id: r.data.id, consecutivo: r.data.consecutivo, total, anticipado: !!r.data.pendiente, fotos: fotos.length });
  });

  if (hecho) return <Listo hecho={hecho} cliente={cliente} cfg={cfg} onNueva={() => { setHecho(null); setItems({}); setCliente(null); setAbono(''); setMetodo('efectivo'); setDesc(''); setNota(''); setFotos([]); setUid(uuid()); prods.recargar(); }} />;

  return (
    <>
      <Header titulo="Nueva venta" />
      <main>
        {elige && <SelectorPunto bodegas={bodegas} value={punto} onChange={(v) => { setPunto(v); setItems({}); }} label="Vender desde" />}
        <div className="card">
          <h3>Cliente</h3>
          {cliente ? (
            <div className="row between"><div><div className="bold">{cliente.nombre}{cliente.paga_antes ? <span className="tag warn" style={{ marginLeft: 6 }}>Paga antes</span> : null}</div><div className="mut">{cliente.negocio}{cliente.saldo > 0 && <span className="warn"> · debe {money(cliente.saldo)}</span>}</div></div>
              <button className="btn sm gris" onClick={() => setCliente(null)}>Cambiar</button></div>
          ) : (
            <>
              <input className="q" placeholder="Buscar cliente…" value={buscaCli} onChange={(e) => setBuscaCli(e.target.value)} />
              {clientes.loading ? <Cargando s={clientes} /> : (
                <div className="list" style={{ maxHeight: 220, overflow: 'auto' }}>
                  {(clientes.data || []).filter((c) => `${c.nombre} ${c.negocio || ''}`.toLowerCase().includes(buscaCli.toLowerCase())).slice(0, 30).map((c) => (
                    <div key={c.id} className="item" onClick={() => setCliente(c)}><div className="grow"><div className="bold">{c.nombre}</div><div className="mut">{c.negocio}</div></div>{c.paga_antes ? <span className="tag">Paga antes</span> : null}{c.saldo > 0 && <span className="tag warn">{money(c.saldo)}</span>}</div>
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
                const pres = it?.pres ?? null;
                const factor = factorDe(p, pres);
                const max = Math.floor(p.stock_punto / factor);
                const agotado = p.stock_punto <= 0;
                return (
                  <div key={p.id} className="item" style={{ cursor: 'default', opacity: agotado ? 0.5 : 1, flexWrap: 'wrap' }}>
                    <div className="grow" style={p.presentaciones?.length ? { flexBasis: '100%' } : undefined}>
                      <div className="bold">{p.nombre}</div>
                      <div className="mut">
                        {it?.cantidad > 0 ? <>Precio <input style={{ width: 90, padding: 3 }} inputMode="decimal" value={it.precio} onChange={(e) => setPrecio(p, e.target.value)} />{it.precio < listaDe(p, pres) && <span className="warn"> bajo la lista ({money(listaDe(p, pres))})</span>}</> : money(listaDe(p, pres))}
                        {' · '}disp. {qty(p.stock_punto)}{p.presentaciones?.length > 0 && desglose(p.stock_punto, p.presentaciones, p.unidad) ? ` (${desglose(p.stock_punto, p.presentaciones, p.unidad)})` : ''}
                      </div>
                    </div>
                    {agotado ? <span className="tag mal">Agotado</span> : (
                      <div className="row" style={{ gap: 6, ...(p.presentaciones?.length ? { width: '100%', justifyContent: 'space-between' } : {}) }}>
                        <SelectorPresentacion producto={p} value={pres} onChange={(v) => setPres(p, v)} />
                        <Stepper value={it?.cantidad || 0} max={max} onChange={(c) => setCant(p, c)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {sel.length > 0 && anticipado && (
          <div className="card">
            <h3>Pago anticipado</h3>
            <div className="aviso pend">Este cliente <b>paga antes de recibir</b>. La remisión quedará <b>pendiente</b>: el encargado o el administrador la aprueban al ver el comprobante, y solo entonces se entrega la mercancía.</div>
            <FotosPendientes fotos={fotos} onQuitar={(i) => setFotos(fotos.filter((_, k) => k !== i))} />
            {fotos.length < 5 && <BotonFoto texto={fotos.length ? '📷 Agregar otra foto' : '📷 Adjuntar foto de la transferencia'} onFoto={(f) => setFotos((x) => [...x, f])} />}
            <div className="mut" style={{ marginTop: 6 }}>Puedes adjuntarla ahora o después, desde la remisión.</div>
            <Campo label="Descuento ($)" inputMode="decimal" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <Campo label="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
        )}
        {sel.length > 0 && !anticipado && (
          <div className="card">
            <h3>Pago</h3>
            <div className="row" style={{ marginBottom: 10 }}>
              <button className={'btn grow ' + (tipo === 'contado' ? '' : 'gris')} onClick={() => setTipo('contado')}>Contado</button>
              <button className={'btn grow ' + (tipo === 'credito' ? '' : 'gris')} onClick={() => setTipo('credito')}>Crédito</button>
            </div>
            {tipo === 'credito' && <Campo label="Abono inicial (opcional)" inputMode="decimal" value={abono} onChange={(e) => setAbono(e.target.value)} />}
            {(tipo === 'contado' || Number(abono) > 0) && (
              <div className="row" style={{ marginBottom: 12 }}>
                <button className={'btn sm grow ' + (metodo === 'efectivo' ? '' : 'gris')} onClick={() => setMetodo('efectivo')}>💵 Efectivo</button>
                <button className={'btn sm grow ' + (metodo === 'transferencia' ? '' : 'gris')} onClick={() => setMetodo('transferencia')}>📲 Transferencia</button>
              </div>
            )}
            {metodo === 'transferencia' && (tipo === 'contado' || Number(abono) > 0) && (
              <div style={{ marginBottom: 12 }}>
                <FotosPendientes fotos={fotos} onQuitar={(i) => setFotos(fotos.filter((_, k) => k !== i))} />
                {fotos.length < 5 && <BotonFoto texto={fotos.length ? '📷 Agregar otra foto' : '📷 Adjuntar comprobante (opcional)'} onFoto={(f) => setFotos((x) => [...x, f])} />}
              </div>
            )}
            <Campo label="Descuento ($)" inputMode="decimal" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <Campo label="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
        )}

        <div className="total-bar">
          <div className="row between"><span className="mut">{sel.length} producto(s)</span><span className="big">{money(total)}</span></div>
          <button className="btn block" style={{ marginTop: 8 }} disabled={ocupado || !sel.length || !cliente} onClick={confirmar}>{ocupado ? 'Guardando…' : anticipado ? 'Generar remisión (pendiente de pago)' : 'Generar remisión'}</button>
        </div>
      </main>
      {nuevoCli && <NuevoCliente onClose={() => setNuevoCli(false)} onCreado={async (id) => { setNuevoCli(false); const lst = await get('/clientes'); clientes.recargar(); setCliente(lst.find((c) => c.id === id)); }} user={user} bodegas={bodegas} />}
    </>
  );
}

function Listo({ hecho, cliente, cfg, onNueva }) {
  const [ocupado, run] = useAccion();
  const [fotos, setFotos] = useState(hecho.fotos || 0);
  if (hecho.sinSenal) return (
    <><Header titulo="Venta guardada" /><main><div className="card center"><div style={{ fontSize: 48 }}>📡</div><h2>Sin señal</h2>
      <p>La venta de <b>{money(hecho.total)}</b> quedó guardada en tu celular y se enviará sola cuando vuelva la conexión. La remisión se podrá compartir después desde “Remisiones”.</p>
      {hecho.anticipado && <div className="aviso pend" style={{ textAlign: 'left' }}>Este cliente paga antes: al enviarse, la remisión quedará <b>pendiente de aprobación</b>. No entregues la mercancía hasta que se apruebe.</div>}
      <div style={{ display: 'grid', gap: 10 }}>
        {preferencias().metodo !== 'pdf' && <button className="btn sec" disabled={ocupado} onClick={() => run(() => imprimirRemision(hecho.local, cfg))}>🖨 Imprimir tirilla provisional</button>}
        <button className="btn" onClick={onNueva}>Nueva venta</button>
      </div></div></main></>
  );
  const r = { id: hecho.id, consecutivo: hecho.consecutivo, total: hecho.total, telefono: cliente?.telefono, saldo: 0 };
  return (
    <><Header titulo={hecho.anticipado ? 'Pendiente de pago' : 'Remisión creada'} /><main><div className="card center">
      <div style={{ fontSize: 48 }}>{hecho.anticipado ? '⏳' : '✅'}</div><h2>{numRem(cfg, hecho.consecutivo)}</h2><div className="big">{money(hecho.total)}</div>
      <p className="mut">{cliente?.nombre}</p>
      {hecho.anticipado && (
        <div className="aviso pend" style={{ textAlign: 'left' }}>
          <b>No entregues la mercancía todavía.</b> {fotos ? 'El encargado o el administrador deben aprobar el pago; la remisión pasará a válida y descontará el inventario.' : 'Adjunta la foto de la transferencia para que puedan aprobar el pago.'}
        </div>)}
      <div style={{ display: 'grid', gap: 10 }}>
        {hecho.anticipado && (
          <BotonFoto disabled={ocupado} texto={fotos ? '📷 Agregar otra foto' : '📷 Adjuntar foto de la transferencia'}
            onFoto={(imagen) => run(async () => { await post(`/remisiones/${hecho.id}/soportes`, { imagen }); setFotos((n) => n + 1); }, 'Soporte adjuntado')} />
        )}
        {preferencias().metodo !== 'pdf' && <button className={hecho.anticipado ? 'btn sec' : 'btn'} disabled={ocupado} onClick={() => run(() => imprimirRemision(() => get(`/remisiones/${hecho.id}`), cfg))}>🖨 Imprimir tirilla</button>}
        <button className={hecho.anticipado || preferencias().metodo !== 'pdf' ? 'btn sec' : 'btn'} disabled={ocupado} onClick={() => run(async () => compartirRemision((await get(`/remisiones/${hecho.id}`)), cfg))}>Compartir por WhatsApp</button>
        <button className="btn sec" disabled={ocupado} onClick={() => run(() => abrirPdf(r))}>Ver remisión (PDF)</button>
        <button className="btn gris" onClick={onNueva}>Nueva venta</button>
        <button className="btn gris" onClick={() => ir('/remisiones')}>Ver remisiones</button>
      </div></div></main></>
  );
}

export function NuevoCliente({ onClose, onCreado, user, bodegas = [] }) {
  const [f, setF] = useState({ nombre: '', negocio: '', telefono: '', direccion: '', ruta_id: '', paga_antes: false });
  const [ocupado, run] = useAccion();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal titulo="Cliente nuevo" onClose={onClose}>
      <Campo label="Nombre *" value={f.nombre} onChange={set('nombre')} />
      <Campo label="Negocio" value={f.negocio} onChange={set('negocio')} />
      <Campo label="Teléfono / WhatsApp" inputMode="tel" value={f.telefono} onChange={set('telefono')} />
      <Campo label="Dirección" value={f.direccion} onChange={set('direccion')} />
      {user?.rol !== 'vendedor' && <SelectorPunto bodegas={bodegas} value={f.ruta_id ? `R${f.ruta_id}` : ''} onChange={(v) => setF({ ...f, ruta_id: v.startsWith('R') ? v.slice(1) : '' })} label="Ruta del cliente (opcional)" mostrador={false} vacio="Sin ruta" />}
      {user?.rol !== 'vendedor' && <label className="row" style={{ gap: 8, margin: '4px 0 12px' }}><input type="checkbox" checked={f.paga_antes} onChange={(e) => setF({ ...f, paga_antes: e.target.checked })} /><span>Paga antes de recibir (exige soporte de pago aprobado)</span></label>}
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { const r = await post('/clientes', f); toast('Cliente creado'); onCreado(r.id); })}>Guardar</button>
    </Modal>
  );
}
