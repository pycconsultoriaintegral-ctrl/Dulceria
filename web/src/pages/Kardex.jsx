import { useState } from 'react';
import { get, qty, money, useCarga, useUbicaciones, descargar, hoyStr, conPrefijo } from '../lib.js';
import { Header, Cargando, Vacio, Campo, useAccion } from '../ui.jsx';

const hace = (dias) => { const d = new Date(`${hoyStr()}T12:00:00`); d.setDate(d.getDate() - dias); return new Intl.DateTimeFormat('en-CA').format(d); };
const TIPO = { compra: 'Compra', venta: 'Venta', cargue: 'Cargue a ruta', devolucion: 'Devolución de ruta', ajuste: 'Ajuste de conteo', traslado_salida: 'Traslado enviado', traslado_entrada: 'Traslado recibido',
  anulacion_venta: 'Venta anulada', anulacion_compra: 'Compra anulada', traslado_anulado: 'Traslado anulado', traslado_faltante: 'Faltante de traslado' };
const nombreTipo = (t) => TIPO[t] || t.replaceAll('_', ' ');

// Kardex general: todos los movimientos de inventario con su saldo (compras, ventas, cargues, ajustes…)
export function Kardex() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const { bodegas } = useUbicaciones();
  const [desde, setDesde] = useState(params.get('desde') || hace(30));
  const [hasta, setHasta] = useState(params.get('hasta') || hoyStr());
  const [ub, setUb] = useState(params.get('ub') || '');
  const [q, setQ] = useState(params.get('q') || '');
  const [tipo, setTipo] = useState('');
  const [ocupado, run] = useAccion();
  const qs = new URLSearchParams({ desde, hasta, ...(ub ? { ub } : {}), ...(q.trim() ? { q: q.trim() } : {}), ...(tipo ? { tipo } : {}) }).toString();
  const s = useCarga(() => get(`/inventario/movimientos?${qs}`), [qs]);
  const d = s.data;
  const entradas = (d?.filas || []).reduce((a, m) => a + (m.cantidad > 0 ? m.cantidad : 0), 0);
  const salidas = (d?.filas || []).reduce((a, m) => a + (m.cantidad < 0 ? -m.cantidad : 0), 0);
  return (
    <>
      <Header titulo="Kardex" atras="/inventario" />
      <main>
        <div className="grid2"><Campo type="date" label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} /><Campo type="date" label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        <label className="f">Lugar
          <select value={ub} onChange={(e) => setUb(e.target.value)}>
            <option value="">Todos los lugares</option>
            {bodegas.filter((b) => b.activa).map((b) => (
              <optgroup key={b.id} label={b.nombre}>
                <option value={`B${b.id}`}>{conPrefijo('Bodega', b.nombre)}</option>
                {b.rutas.filter((r) => r.activa).map((r) => <option key={r.id} value={`R${r.id}`}>{conPrefijo('Ruta', r.nombre)}</option>)}
              </optgroup>))}
          </select>
        </label>
        <div className="grid2">
          <Campo label="Producto" placeholder="Buscar por nombre…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="f">Movimiento
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              {(d?.tipos || []).map((t) => <option key={t} value={t}>{nombreTipo(t)}</option>)}
            </select>
          </label>
        </div>
        <button className="btn sec block" style={{ marginBottom: 10 }} disabled={ocupado} onClick={() => run(() => descargar(`/informes/kardex.xlsx?${qs}`, `kardex-${desde}-a-${hasta}.xlsx`), 'Descargado')}>⬇ Descargar en Excel</button>
        {s.loading || s.error ? <Cargando s={s} /> : d.filas.length === 0 ? <Vacio>Sin movimientos con esos filtros</Vacio> : (
          <>
            <div className="mut" style={{ marginBottom: 6 }}>{d.filas.length} movimiento(s) · entradas <b className="ok">+{qty(entradas)}</b> · salidas <b className="mal">−{qty(salidas)}</b></div>
            {d.truncado && <div className="aviso pend">Hay más de 1.000 movimientos: se muestran los más recientes. Acota las fechas o descarga el Excel.</div>}
            <div className="card list">
              {d.filas.map((m) => (
                <div key={m.id} className="item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div className="bold">{m.producto}</div>
                    <div className="mut">{m.fecha.slice(5, 16)} · {m.lugar}</div>
                    <div className="mut">{nombreTipo(m.tipo)}{m.referencia ? ` · ${m.referencia}` : ''}{m.nota ? ` · ${m.nota}` : ''}{m.usuario ? ` · ${m.usuario}` : ''}</div>
                  </div>
                  <div className="right"><b className={m.cantidad < 0 ? 'mal' : 'ok'}>{m.cantidad > 0 ? '+' : ''}{qty(m.cantidad)}</b><div className="mut">saldo {qty(m.saldo)}</div>{m.cantidad > 0 && m.costo > 0 && <div className="mut">{money(m.costo)}</div>}</div>
                </div>))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
