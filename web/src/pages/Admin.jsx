import { useState } from 'react';
import { get, post, put, money, qty, useCarga, descargar, ir } from '../lib.js';
import { Header, Cargando, Vacio, Modal, Campo, Stepper, toast, useAccion } from '../ui.jsx';

// ---------- Productos ----------
export function Productos() {
  const s = useCarga(() => get('/productos?todos=1'), []);
  const inv = useCarga(() => get('/inventario?ub=resumen'), []);
  const totales = Object.fromEntries((inv.data?.productos || []).map((p) => [p.id, p.total]));
  const [ed, setEd] = useState(null);
  const [q, setQ] = useState('');
  const [bloque, setBloque] = useState(false); // modo de edición en bloque
  const [sel, setSel] = useState(new Set());
  const [ocupado, run] = useAccion();
  const [soloInactivos, setSoloInactivos] = useState(false);
  const visibles = (s.data || []).filter((p) => p.nombre.toLowerCase().includes(q.toLowerCase()) && (!soloInactivos || !p.activo));
  const alterna = (id) => setSel((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const inactivos = (s.data || []).filter((p) => !p.activo).length;
  return (
    <>
      <Header titulo="Productos" atras="/mas" />
      <main>
        <div className="row"><input className="q grow" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn" style={{ marginBottom: 10 }} onClick={() => setEd({ nombre: '', unidad: 'und', precio: '', costo: '', stock_minimo: 0, minimo_carro: 0, presentaciones: [] })}>+ Nuevo</button></div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button className={'btn sm ' + (bloque ? '' : 'sec')} onClick={() => { setBloque(!bloque); setSel(new Set()); }}>{bloque ? '✓ Editando en bloque' : '☑ Editar varios a la vez'}</button>
          <button className="btn sm sec" disabled={ocupado} onClick={() => run(() => descargar('/informes/catalogo.xlsx', 'productos-para-editar.xlsx'), 'Descargado')}>⬇ Excel para editar</button>
          <button className="btn sm sec" onClick={() => ir('/importar')}>📤 Subir Excel editado</button>
          <button className="btn sm sec" disabled={ocupado} onClick={() => { if (window.confirm('Se desactivan los conceptos contables que estén como producto (cuentas por cobrar o pagar, gastos bancarios, anticipos, aportes, traslados entre bancos…). ¿Continuar?')) run(async () => { const r = await post('/productos/quitar-conceptos'); toast(r.desactivados ? `${r.desactivados} concepto(s) quitados de la lista` : 'No había conceptos contables'); s.recargar(); }); }}>🧹 Quitar conceptos contables</button>
          {inactivos > 0 && <button className={'btn sm ' + (soloInactivos ? '' : 'gris')} onClick={() => setSoloInactivos(!soloInactivos)}>{soloInactivos ? 'Ver todos' : `Ver ${inactivos} inactivo(s)`}</button>}
        </div>
        {bloque && <EdicionEnBloque sel={sel} visibles={visibles} setSel={setSel} onHecho={() => { setSel(new Set()); s.recargar(); }} />}
        {s.loading || s.error ? <Cargando s={s} /> : (
          <div className="card list">{visibles.map((p) => (
            <div key={p.id} className="item" onClick={() => (bloque ? alterna(p.id) : setEd(p))} style={{ opacity: p.activo ? 1 : 0.5 }}>
              {bloque && <input type="checkbox" readOnly checked={sel.has(p.id)} style={{ width: 'auto' }} />}
              <div className="grow"><div className="bold">{p.nombre}</div><div className="mut">Costo {money(p.costo)} · Venta {money(p.precio)}{p.precio > 0 && ` · margen ${Math.round(((p.precio - p.costo) / p.precio) * 100)}%`}{p.presentaciones?.length > 0 && ` · ${p.presentaciones.map((x) => `${x.nombre} ×${x.factor}`).join(', ')}`}</div></div>
              <div className="right mut">Total<br /><b>{qty(totales[p.id] || 0)}</b></div>
            </div>))}</div>
        )}
      </main>
      {ed && <EditarProducto p={ed} onClose={() => setEd(null)} onHecho={() => { setEd(null); s.recargar(); }} />}
    </>
  );
}
const ACCIONES_BLOQUE = [
  ['desactivar', 'Desactivar (ocultar de ventas)', false], ['activar', 'Activar', false],
  ['minimo_bodega', 'Fijar mínimo en bodega', true], ['minimo_carro', 'Fijar mínimo en cada carro', true],
  ['precio_porcentaje', 'Subir o bajar el precio en % (ej. 5 o -3)', true], ['precio_fijo', 'Fijar precio de venta', true], ['costo_fijo', 'Fijar costo', true],
];
function EdicionEnBloque({ sel, visibles, setSel, onHecho }) {
  const [accion, setAccion] = useState('minimo_bodega');
  const [valor, setValor] = useState('');
  const [ocupado, run] = useAccion();
  const necesita = ACCIONES_BLOQUE.find((a) => a[0] === accion)[2];
  const todosVisibles = visibles.length > 0 && visibles.every((p) => sel.has(p.id));
  return (
    <div className="card" style={{ background: '#f4f7fe' }}>
      <div className="row between"><b>{sel.size} seleccionado(s)</b>
        <button className="btn sm gris" onClick={() => setSel(todosVisibles ? new Set() : new Set(visibles.map((p) => p.id)))}>{todosVisibles ? 'Quitar selección' : `Elegir los ${visibles.length} de la lista`}</button></div>
      <p className="mut" style={{ margin: '6px 0' }}>Toca los productos para marcarlos (la búsqueda de arriba ayuda a filtrar) y elige qué hacer con todos a la vez.</p>
      <label className="f">Acción<select value={accion} onChange={(e) => { setAccion(e.target.value); setValor(''); }}>{ACCIONES_BLOQUE.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
      {necesita && <Campo label="Valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />}
      <button className="btn block" disabled={ocupado || !sel.size || (necesita && valor === '')}
        onClick={() => { if (window.confirm(`Aplicar a ${sel.size} producto(s)?`)) run(async () => { const r = await post('/productos/masivo', { ids: [...sel], accion, valor: necesita ? valor : undefined }); toast(`${r.cambiados} producto(s) actualizados`); onHecho(); }); }}>Aplicar a los seleccionados</button>
    </div>
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
      <div className="grid2">
        <Campo label={`Mínimo en bodega (${f.unidad || 'und'})`} inputMode="decimal" value={f.stock_minimo ?? 0} onChange={set('stock_minimo')} />
        <Campo label={`Mínimo en cada carro (${f.unidad || 'und'})`} inputMode="decimal" value={f.minimo_carro ?? 0} onChange={set('minimo_carro')} />
      </div>
      <p className="mut" style={{ marginTop: -6 }}>Cuando quede esa cantidad o menos, avisa en Inicio y en el resumen de WhatsApp. 0 = sin alerta.</p>
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

