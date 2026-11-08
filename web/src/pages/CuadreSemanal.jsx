import { useMemo, useState } from 'react';
import { get, post, money, qty, useCarga, ir } from '../lib.js';
import { Header, Cargando, Vacio, useAccion, Confirmar } from '../ui.jsx';

const fechaCorta = (f) => { const [, m, d] = f.split('-'); return `${d}/${m}`; };
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const diaSemana = (f) => DIAS[new Date(`${f}T12:00:00Z`).getUTCDay()];
const Dif = ({ v }) => (Math.abs(v) < 0.5 ? <span className="ok">$0</span> : <span className={v < 0 ? 'mal' : 'warn'}>{v > 0 ? '+' : '−'}{money(Math.abs(v))}</span>);
const consulta = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));

// Pantalla principal: todos los puntos (carros y mostradores) de la semana
export function CuadreSemanal({ punto }) {
  const q = consulta();
  const [rango, setRango] = useState({ desde: q.desde || '', hasta: q.hasta || '' });
  const qs = rango.desde && rango.hasta ? `?desde=${rango.desde}&hasta=${rango.hasta}` : '';
  if (punto) return <DetalleCuadre punto={punto} qs={qs} />;
  return <ListaCuadre rango={rango} setRango={setRango} qs={qs} />;
}

function ListaCuadre({ rango, setRango, qs }) {
  const s = useCarga(() => get(`/cuadres/semana${qs}`), [qs]);
  const d = s.data;
  const t = d?.totales;
  return (
    <>
      <Header titulo="Cuadre semanal" atras="/mas" />
      <main>
        <div className="card">
          <div className="grid2">
            <label className="f">Desde<input type="date" value={rango.desde || d?.desde || ''} onChange={(e) => setRango({ desde: e.target.value, hasta: rango.hasta || d?.hasta })} /></label>
            <label className="f">Hasta<input type="date" value={rango.hasta || d?.hasta || ''} onChange={(e) => setRango({ desde: rango.desde || d?.desde, hasta: e.target.value })} /></label>
          </div>
          <div className="mut">Por defecto, de lunes a hoy. El sábado se cuenta el inventario y se cuadra el dinero de la semana.</div>
        </div>
        {s.loading || s.error ? <Cargando s={s} /> : (
          <>
            <div className="grid2" style={{ marginBottom: 14 }}>
              <div className="kpi"><div className="l">Vendido en la semana</div><div className="v">{money(t.ventas)}</div></div>
              <div className="kpi"><div className="l">Diferencia de efectivo</div><div className="v"><Dif v={t.diferencia_efectivo} /></div><div className="l">Entregado {money(t.entregado)}</div></div>
              <div className="kpi"><div className="l">Transferencias</div><div className="v">{money(t.transferencias)}</div>
                <div className={'l ' + (t.transferencias_verificadas + 0.5 < t.transferencias ? 'warn' : 'ok')}>Verificadas {money(t.transferencias_verificadas)}</div></div>
              <div className="kpi"><div className="l">Por cobrar (cartera)</div><div className="v warn">{money(t.cartera)}</div><div className="l">Gastos {money(t.gastos)}</div></div>
            </div>
            <div className="card list">
              {d.puntos.map((p) => {
                const x = p.totales;
                return (
                  <div key={p.punto} className="item" onClick={() => ir(`/cuadre-semanal/${p.punto}${qs || `?desde=${d.desde}&hasta=${d.hasta}`}`)}>
                    <div className="grow">
                      <div className="bold">{p.nombre}</div>
                      <div className="mut">Vendió {money(x.ventas)} · efectivo <Dif v={x.diferencia_efectivo} />{x.transferencias > 0 && <> · 📲 {money(x.transferencias_verificadas)}/{money(x.transferencias)}</>}</div>
                      {x.dias_sin_cierre.length > 0 && <div className="mut warn">⚠ Sin cierre: {x.dias_sin_cierre.map((f) => `${diaSemana(f)} ${fechaCorta(f)}`).join(', ')}</div>}
                    </div>
                    {p.cuadre ? <span className="tag ok">✓ Cuadrado</span> : x.ventas > 0 ? <span className="tag warn">Pendiente</span> : <span className="tag">Sin ventas</span>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </>
  );
}

function DetalleCuadre({ punto, qs }) {
  const s = useCarga(() => get(`/cuadres/detalle?punto=${punto}${qs ? '&' + qs.slice(1) : ''}`), [punto, qs]);
  const [tab, setTab] = useState('dinero');
  const [conteo, setConteo] = useState({}); // producto_id -> texto contado
  const [ajustar, setAjustar] = useState(true);
  const [nota, setNota] = useState('');
  const [buscar, setBuscar] = useState('');
  const [ocupado, run] = useAccion();
  const d = s.data;
  const filas = useMemo(() => (d?.inventario || []).map((i) => {
    const txt = conteo[i.id];
    const contado = txt === undefined || txt === '' ? null : Number(String(txt).replace(',', '.'));
    const dif = contado === null || Number.isNaN(contado) ? null : contado - i.sistema;
    return { ...i, contado, dif, valor: dif === null ? 0 : dif * i.costo };
  }), [d, conteo]);
  if (s.loading || s.error) return <><Header titulo="Cuadre" atras="/cuadre-semanal" /><main><Cargando s={s} /></main></>;
  const t = d.totales;
  const contados = filas.filter((f) => f.dif !== null);
  const conDif = contados.filter((f) => Math.abs(f.dif) > 1e-9);
  const valorDif = conDif.reduce((a, f) => a + f.valor, 0);
  const visibles = filas.filter((f) => f.nombre.toLowerCase().includes(buscar.toLowerCase()) && (buscar || f.sistema !== 0 || f.contado !== null));
  const guardar = () => run(async () => {
    if (!contados.length && !Confirmar('No contaste ningún producto. ¿Guardar el cuadre solo con el dinero?')) return;
    if (ajustar && conDif.length && !Confirmar(`Se ajustará el inventario de ${conDif.length} producto(s) al conteo (${money(valorDif)} al costo). ¿Continuar?`)) return;
    await post('/cuadres', { punto, desde: d.desde, hasta: d.hasta, conteo: contados.map((f) => ({ producto_id: f.id, contado: f.contado })), aplicar_ajuste: ajustar, nota });
    setConteo({}); s.recargar(); setTab('dinero');
  }, 'Cuadre guardado');
  const verificar = (p) => run(async () => { await post(`/pagos/${p.id}/verificar`, { verificado: !p.verificado }); s.recargar(); });
  return (
    <>
      <Header titulo={d.nombre} atras={`/cuadre-semanal?desde=${d.desde}&hasta=${d.hasta}`} />
      <main>
        <div className="mut" style={{ marginBottom: 8 }}>Semana del {fechaCorta(d.desde)} al {fechaCorta(d.hasta)}</div>
        {d.cuadre && <div className="aviso ok"><b>✓ Cuadrado</b> por {d.cuadre.usuario} el {d.cuadre.fecha.slice(0, 16)}. Efectivo <Dif v={d.cuadre.diferencia_efectivo} /> · inventario {d.cuadre.productos_con_diferencia} producto(s) con diferencia (<Dif v={d.cuadre.diferencia_inventario} />){d.cuadre.ajuste_aplicado ? ', ajustado' : ''}.{d.cuadre.nota ? ` Nota: ${d.cuadre.nota}` : ''} Puedes volver a guardarlo.</div>}
        <div className="pestanas">
          {[['dinero', '💵 Dinero'], ['transf', `📲 Transferencias${t.transferencias_por_verificar > 0.5 ? ' •' : ''}`], ['inventario', '📦 Inventario'], ['cartera', '🧾 Cartera']].map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>))}
        </div>

        {tab === 'dinero' && (
          <>
            <div className="card">
              <table className="t"><thead><tr><th>Día</th><th className="n">Vendido</th><th className="n">Debía</th><th className="n">Entregó</th><th className="n">Dif.</th></tr></thead>
                <tbody>{d.dias.filter((x) => x.remisiones || x.efectivo || x.gastos || x.entregado !== null).map((x) => (
                  <tr key={x.fecha}><td>{diaSemana(x.fecha)} {fechaCorta(x.fecha)}</td><td className="n">{money(x.ventas)}</td><td className="n">{money(x.esperado)}</td>
                    <td className="n">{x.entregado === null ? <span className="warn">Sin cierre</span> : money(x.entregado)}</td><td className="n">{x.diferencia === null ? '—' : <Dif v={x.diferencia} />}</td></tr>))}
                </tbody></table>
              {!d.dias.some((x) => x.remisiones || x.efectivo || x.gastos) && <Vacio>Sin movimiento esta semana</Vacio>}
            </div>
            <div className="card">
              <div className="row between"><span>Vendido (contado {money(t.contado)} · crédito {money(t.credito)})</span><b>{money(t.ventas)}</b></div>
              <div className="row between"><span>💵 Cobrado en efectivo</span><b>{money(t.efectivo)}</b></div>
              <div className="row between"><span>Gastos</span><b className={t.gastos ? 'mal' : ''}>{t.gastos ? '−' : ''}{money(t.gastos)}</b></div>
              <div className="row between"><span>Efectivo que debía entregar</span><b>{money(t.esperado)}</b></div>
              <div className="row between"><span>Entregado en los cierres</span><b>{money(t.entregado)}</b></div>
              <hr />
              <div className="row between"><b>Diferencia de efectivo</b><b className="big"><Dif v={t.diferencia_efectivo} /></b></div>
              {t.dias_sin_cierre.length > 0 && <div className="mut warn" style={{ marginTop: 6 }}>⚠ Días con ventas y sin cierre: {t.dias_sin_cierre.map(fechaCorta).join(', ')}. Su efectivo no entra en la diferencia.</div>}
            </div>
          </>
        )}

        {tab === 'transf' && (
          <div className="card">
            <div className="row between" style={{ marginBottom: 8 }}><span className="mut">Marca cada una cuando la veas en el banco</span>
              <b className={t.transferencias_por_verificar > 0.5 ? 'warn' : 'ok'}>{money(t.transferencias_verificadas)} / {money(t.transferencias)}</b></div>
            {d.transferencias.length === 0 ? <Vacio>Sin transferencias esta semana</Vacio> : d.transferencias.map((p) => (
              <label key={p.id} className="item" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={!!p.verificado} disabled={ocupado} onChange={() => verificar(p)} style={{ width: 22, height: 22 }} />
                <div className="grow"><div className="bold">{p.cliente}</div><div className="mut">{diaSemana(p.fecha.slice(0, 10))} {p.fecha.slice(5, 16)}{p.consecutivo ? ` · R-${p.consecutivo}` : ''}{p.verificado ? ` · ✓ ${p.verificado_por}` : ''}</div></div>
                <b>{money(p.valor)}</b>
              </label>))}
          </div>
        )}

        {tab === 'inventario' && (
          <>
            <div className="card">
              <div className="mut" style={{ marginBottom: 8 }}>Escribe lo que hay físicamente. Lo que dejes vacío no se cuenta.</div>
              <input className="q" placeholder="Buscar producto (también los que están en cero)…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
              {visibles.length === 0 ? <Vacio>No hay inventario en este punto</Vacio> : (
                <table className="t conteo"><thead><tr><th>Producto</th><th className="n">Sistema</th><th className="n">Contado</th><th className="n">Dif.</th></tr></thead>
                  <tbody>{visibles.map((f) => (
                    <tr key={f.id}><td>{f.nombre}</td><td className="n">{qty(f.sistema)}</td>
                      <td className="n"><input inputMode="decimal" value={conteo[f.id] ?? ''} placeholder={qty(f.sistema)} onChange={(e) => setConteo({ ...conteo, [f.id]: e.target.value })} /></td>
                      <td className="n">{f.dif === null ? '' : Math.abs(f.dif) < 1e-9 ? <span className="ok">✓</span> : <span className={f.dif < 0 ? 'mal' : 'warn'}>{f.dif > 0 ? '+' : ''}{qty(f.dif)}</span>}</td></tr>))}
                  </tbody></table>
              )}
              <button className="btn sm gris" style={{ marginTop: 8 }} onClick={() => setConteo(Object.fromEntries(filas.filter((f) => f.sistema !== 0).map((f) => [f.id, conteo[f.id] ?? String(f.sistema)])))}>Llenar con lo del sistema</button>
            </div>
            <div className="card">
              <div className="row between"><span>Productos contados</span><b>{contados.length}</b></div>
              <div className="row between"><span>Con diferencia</span><b className={conDif.length ? 'warn' : 'ok'}>{conDif.length}</b></div>
              <div className="row between"><span>Valor de la diferencia (al costo)</span><b><Dif v={valorDif} /></b></div>
              <label className="row" style={{ gap: 8, marginTop: 10 }}><input type="checkbox" checked={ajustar} onChange={(e) => setAjustar(e.target.checked)} /><span>Ajustar el inventario del sistema al conteo</span></label>
            </div>
          </>
        )}

        {tab === 'cartera' && (
          <>
            <div className="card"><h3>Por cobrar en este punto · {money(t.cartera)}</h3>
              {d.cartera.length === 0 ? <Vacio>🎉 Nadie debe</Vacio> : d.cartera.map((c) => (
                <div key={c.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--bd)', cursor: 'pointer' }} onClick={() => ir(`/clientes/${c.id}`)}>
                  <span>{c.nombre}<div className="mut">desde {c.desde.slice(0, 10)}</div></span><b className="warn">{money(c.saldo)}</b></div>))}
            </div>
            <div className="card"><h3>Gastos de la semana · {money(t.gastos)}</h3>
              {d.gastos.length === 0 ? <Vacio>Sin gastos</Vacio> : d.gastos.map((g, i) => (
                <div key={i} className="row between mut" style={{ padding: '4px 0' }}><span>{diaSemana(g.fecha.slice(0, 10))} · {g.concepto}</span><span>{money(g.valor)}</span></div>))}
            </div>
          </>
        )}

        <div className="card">
          <label className="f">Nota del cuadre (opcional)<textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: faltaron 2 cajas, el vendedor repone el lunes" /></label>
          <button className="btn block" disabled={ocupado} onClick={guardar}>{d.cuadre ? 'Volver a guardar el cuadre' : 'Guardar cuadre de la semana'}</button>
          {tab !== 'inventario' && !contados.length && <div className="mut" style={{ marginTop: 6 }}>Para contar el inventario abre la pestaña 📦 Inventario antes de guardar.</div>}
        </div>
      </main>
    </>
  );
}
