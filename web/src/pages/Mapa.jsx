import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { get, money, useCarga, useUbicaciones, hoyStr, can, urlMapa } from '../lib.js';
import { Header, Cargando, Campo, SelectorPunto } from '../ui.jsx';

const COLORES = ['#1d4ed8', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#4d7c0f'];

// Mapa con puntos. Cada punto: { lat, lng, color, titulo, detalle }. Los textos se arman como texto (nunca como HTML).
function Mapa({ puntos }) {
  const div = useRef(null);
  const mapa = useRef(null);
  const capa = useRef(null);
  useEffect(() => {
    mapa.current = L.map(div.current, { zoomControl: true }).setView([7.88, -76.63], 11); // Urabá
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa.current);
    capa.current = L.layerGroup().addTo(mapa.current);
    return () => { mapa.current.remove(); mapa.current = null; };
  }, []);
  useEffect(() => {
    if (!mapa.current) return;
    capa.current.clearLayers();
    for (const p of puntos) {
      const m = L.circleMarker([p.lat, p.lng], { radius: 9, color: '#fff', weight: 2, fillColor: p.color, fillOpacity: 0.95 }).addTo(capa.current);
      const box = document.createElement('div');
      const t = document.createElement('b'); t.textContent = p.titulo; box.appendChild(t);
      for (const linea of p.detalle) { const l = document.createElement('div'); l.textContent = linea; box.appendChild(l); }
      const a = document.createElement('a'); a.href = urlMapa(p.lat, p.lng); a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = 'Abrir en Google Maps'; box.appendChild(a);
      m.bindPopup(box);
    }
    if (puntos.length) mapa.current.fitBounds(L.latLngBounds(puntos.map((p) => [p.lat, p.lng])), { padding: [30, 30], maxZoom: 16 });
  }, [puntos]);
  return <div ref={div} style={{ height: '58vh', minHeight: 320, borderRadius: 14, border: '1px solid var(--bd)', marginBottom: 10 }} />;
}

function Ventas({ user }) {
  const { bodegas } = useUbicaciones();
  const [fecha, setFecha] = useState(hoyStr());
  const [punto, setPunto] = useState('');
  const s = useCarga(() => get(`/mapa/ventas?fecha=${fecha}${punto ? `&punto=${punto}` : ''}`), [fecha, punto]);
  const d = s.data;
  const vendedores = [...new Set((d?.ventas || []).map((v) => v.vendedor))];
  const color = (v) => COLORES[vendedores.indexOf(v) % COLORES.length];
  const puntos = (d?.ventas || []).map((v) => ({ lat: v.lat, lng: v.lng, color: v.pendiente ? '#9ca3af' : color(v.vendedor), titulo: `${v.cliente} · ${money(v.total)}`,
    detalle: [`${v.fecha.slice(11, 16)} · ${v.vendedor} · ${v.punto}${v.pendiente ? ' · POR APROBAR (pago anticipado)' : ''}`, `Remisión ${v.consecutivo}${v.gps_precision ? ` · precisión ±${v.gps_precision} m` : ''}`] }));
  return (
    <>
      <div className="grid2">
        <Campo type="date" label="Fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        {user.alcance !== 'ruta' && <SelectorPunto bodegas={bodegas} value={punto} onChange={setPunto} label="Punto" todos mostrador />}
      </div>
      {s.loading || s.error ? <Cargando s={s} /> : (
        <>
          <Mapa puntos={puntos} />
          <div className="mut">📍 {d.con_ubicacion} de {d.total_ventas} venta(s) con ubicación{d.total_ventas > d.con_ubicacion ? ' (las demás se hicieron sin GPS o sin permiso de ubicación)' : ''}.</div>
          {d.ventas.some((v) => v.pendiente) && <div className="mut">⚪ Gris: venta pendiente de aprobación del pago.</div>}
          {vendedores.length > 0 && <div className="row" style={{ flexWrap: 'wrap', gap: 10, margin: '8px 0' }}>{vendedores.map((v) => <span key={v}><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 6, background: color(v), marginRight: 4 }} />{v}</span>)}</div>}
          {d.ventas.length > 0 && (
            <div className="card list">
              {d.ventas.map((v) => (
                <div key={v.id} className="item" style={{ cursor: 'default' }}>
                  <div className="grow"><div className="bold">{v.cliente}{v.pendiente && <span className="tag warn" style={{ marginLeft: 6 }}>Por aprobar</span>}</div><div className="mut">{v.fecha.slice(11, 16)} · {v.vendedor} · {v.punto}</div></div>
                  <div className="right"><b>{money(v.total)}</b><div><a href={urlMapa(v.lat, v.lng)} target="_blank" rel="noreferrer">📍 mapa</a></div></div>
                </div>))}
            </div>)}
        </>
      )}
    </>
  );
}

function Tiendas() {
  const s = useCarga(() => get('/mapa/clientes'), []);
  const d = s.data;
  const puntos = (d?.clientes || []).map((c) => ({ lat: c.lat, lng: c.lng, color: '#1d4ed8', titulo: c.nombre, detalle: [c.negocio, c.direccion, c.telefono, c.ruta && `Ruta ${c.ruta}`].filter(Boolean) }));
  return s.loading || s.error ? <Cargando s={s} /> : (
    <>
      <Mapa puntos={puntos} />
      <div className="mut">📍 {d.con_ubicacion} tienda(s) con ubicación guardada · {d.sin_ubicacion} sin ubicación.</div>
      {d.con_ubicacion === 0 && <div className="aviso pend" style={{ marginTop: 8 }}>Todavía no hay tiendas con ubicación. El vendedor la guarda estando en la puerta de la tienda: <b>Clientes → el cliente → «Guardar ubicación aquí»</b>.</div>}
    </>
  );
}

export function MapaPage({ user }) {
  const [tab, setTab] = useState(can(user, 'informes') || user.alcance === 'ruta' ? 'ventas' : 'tiendas');
  const verVentas = can(user, 'informes') || user.alcance === 'ruta';
  return (
    <>
      <Header titulo="Mapa" atras="/mas" />
      <main>
        <div className="tabs2" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {verVentas && <button className={'btn grow ' + (tab === 'ventas' ? '' : 'sec')} onClick={() => setTab('ventas')}>🛒 Ventas del día</button>}
          <button className={'btn grow ' + (tab === 'tiendas' ? '' : 'sec')} onClick={() => setTab('tiendas')}>🏪 Tiendas</button>
        </div>
        {tab === 'ventas' && verVentas ? <Ventas user={user} /> : <Tiendas />}
        <p className="mut">El mapa necesita conexión a internet.</p>
      </main>
    </>
  );
}
