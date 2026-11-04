import { useState } from 'react';
import { get, useCarga, descargarCsv } from '../lib.js';
import { Header, Cargando, Vacio, toast } from '../ui.jsx';

const ENTIDADES = [['', 'Todo'], ['producto', 'Productos'], ['usuario', 'Usuarios'], ['remision', 'Remisiones'], ['compra', 'Compras'], ['traslado', 'Traslados'], ['cierre', 'Cierres'], ['importar', 'Importaciones']];

// Registro de actividad (solo administrador): quién cambió qué y cuándo
export function Actividad() {
  const [entidad, setEntidad] = useState('');
  const [q, setQ] = useState('');
  const s = useCarga(() => get(`/auditoria?${new URLSearchParams({ ...(entidad ? { entidad } : {}), ...(q ? { q } : {}) })}`), [entidad, q]);
  return (
    <>
      <Header titulo="Registro de actividad" atras="/mas" />
      <main>
        <div className="row wrap" style={{ marginBottom: 10 }}>
          {ENTIDADES.map(([v, t]) => <button key={v} className={'btn sm ' + (entidad === v ? '' : 'gris')} onClick={() => setEntidad(v)}>{t}</button>)}
        </div>
        <div className="row"><input className="q grow" placeholder="Buscar por usuario, producto, motivo…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn sm sec" style={{ marginBottom: 10 }} onClick={() => descargarCsv('/exportar/actividad', 'actividad').catch((e) => toast(e.message, true))}>⬇ Excel</button></div>
        {s.loading || s.error ? <Cargando s={s} /> : s.data.length === 0 ? <Vacio>Sin actividad registrada</Vacio> : (
          <div className="card list">
            {s.data.map((x) => (
              <div key={x.id} className="item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="bold" style={{ textTransform: 'capitalize' }}>{x.accion} · {x.entidad}{x.entidad_id ? ` #${x.entidad_id}` : ''}</div>
                  {x.detalle && <div className="mut" style={{ wordBreak: 'break-word' }}>{x.detalle}</div>}
                  <div className="mut">{x.usuario || 'Sistema'} · {x.fecha.slice(0, 16)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
