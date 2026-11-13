import { useState } from 'react';
import { get, post, money, useCarga, hoyStr, can, useUbicaciones } from '../lib.js';
import { Header, Cargando, Campo, useAccion, SelectorPunto } from '../ui.jsx';

// Turno del vendedor: abre con la base de efectivo y cierra contando lo que entrega
export function Turno({ user, cfg }) {
  const act = useCarga(() => get('/turnos/actual'), []);
  const lista = useCarga(() => get(`/turnos?fecha=${hoyStr()}`).catch(() => []), []);
  const { bodegas } = useUbicaciones();
  const elige = user.alcance !== 'ruta';
  const [punto, setPunto] = useState(user.alcance === 'bodega' ? `B${user.bodega_id}` : '');
  const [base, setBase] = useState('');
  const [entregado, setEntregado] = useState('');
  const [nota, setNota] = useState('');
  const [cerrado, setCerrado] = useState(null);
  const [ocupado, run] = useAccion();
  const t = act.data?.turno;
  const recargar = () => { act.recargar(); lista.recargar(); };
  return (
    <>
      <Header titulo="Turno" atras="/mas" />
      <main>
        {act.loading || act.error ? <Cargando s={act} /> : t ? (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Turno abierto</h3>
            <div className="mut">{t.punto_nombre} · desde {t.abierto_en.slice(0, 16)}</div>
            <div className="grid2" style={{ marginTop: 10 }}>
              <div><div className="mut">Ventas</div><b>{money(t.ventas)}</b> <span className="mut">({t.remisiones})</span></div>
              <div><div className="mut">Base inicial</div><b>{money(t.base)}</b></div>
              <div><div className="mut">Efectivo cobrado</div><b>{money(t.efectivo)}</b></div>
              <div><div className="mut">Transferencias</div><b>{money(t.transferencias)}</b></div>
              <div><div className="mut">Gastos</div><b>{money(t.gastos)}</b></div>
              <div><div className="mut">Efectivo esperado</div><b className="ok">{money(t.esperado)}</b></div>
            </div>
            <hr style={{ border: 0, borderTop: '1px solid var(--bd)', margin: '14px 0' }} />
            <Campo label="Efectivo que entregas al cerrar" inputMode="decimal" value={entregado} onChange={(e) => setEntregado(e.target.value)} />
            <Campo label="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
            <button className="btn block" disabled={ocupado || entregado === ''}
              onClick={() => { if (window.confirm('¿Cerrar el turno? Después tendrás que abrir otro para seguir vendiendo.')) run(async () => { const r = await post('/turnos/cerrar', { entregado, nota }); setCerrado(r); setEntregado(''); setNota(''); recargar(); }, 'Turno cerrado'); }}>Cerrar turno</button>
          </div>
        ) : (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Abrir turno</h3>
            {act.data?.exigir && <div className="aviso pend">Para vender necesitas tener un turno abierto.</div>}
            {cerrado && (
              <div className={'aviso ' + (cerrado.diferencia ? 'mal' : 'ok')}>
                Turno cerrado: esperado {money(cerrado.esperado)} · entregado {money(cerrado.entregado)} · {cerrado.diferencia === 0 ? 'sin diferencia' : `diferencia ${money(cerrado.diferencia)}`}
              </div>)}
            {elige && <SelectorPunto bodegas={bodegas} value={punto} onChange={setPunto} label="Punto de venta" />}
            <Campo label="Base de efectivo con la que empiezas (opcional)" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} />
            <button className="btn block" disabled={ocupado || (elige && !punto)} onClick={() => run(async () => { await post('/turnos/abrir', { punto: elige ? punto : undefined, base }); setBase(''); setCerrado(null); recargar(); }, 'Turno abierto')}>Abrir turno</button>
          </div>
        )}
        {(lista.data || []).length > 0 && (
          <div className="card"><h3 style={{ marginTop: 0 }}>{can(user, 'informes') ? 'Turnos de hoy' : 'Mis turnos de hoy'}</h3>
            {lista.data.map((x) => (
              <div key={x.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)' }}>
                <div><b>{x.vendedor}</b><div className="mut">{x.punto_nombre} · {x.abierto_en.slice(11, 16)}{x.cerrado_en ? `–${x.cerrado_en.slice(11, 16)}` : ' · abierto'}</div></div>
                <div className="right">
                  {x.cerrado_en ? (<><b>{money(x.entregado)}</b><div className={x.diferencia ? 'mal' : 'mut'}>{x.diferencia ? `diferencia ${money(x.diferencia)}` : 'cuadra'}</div></>)
                    : <><b>{money(x.ventas)}</b><div className="mut">en curso</div></>}
                </div>
              </div>))}
          </div>)}
      </main>
    </>
  );
}
