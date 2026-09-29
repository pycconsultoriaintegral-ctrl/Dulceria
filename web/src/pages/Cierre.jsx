import { useState } from 'react';
import { get, post, money, qty, useCarga, hoyStr } from '../lib.js';
import { Header, Cargando, Campo, Modal, useAccion } from '../ui.jsx';

export function Cierre({ user }) {
  const admin = user.rol === 'admin';
  const [fecha, setFecha] = useState(hoyStr());
  const [ruta, setRuta] = useState(admin ? '' : user.ruta_id);
  const rutas = useCarga(() => (admin ? get('/rutas') : []), []);
  const s = useCarga(() => (ruta === '' ? null : get(`/cierre?fecha=${fecha}&ruta_id=${ruta}`)), [fecha, ruta]);
  const [gasto, setGasto] = useState(false);
  const [entregado, setEntregado] = useState('');
  const [nota, setNota] = useState('');
  const [ocupado, run] = useAccion();
  const d = s.data;
  return (
    <>
      <Header titulo="Cierre del día" atras="/mas" />
      <main>
        <div className="grid2">
          <Campo type="date" label="Fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          {admin && <label className="f">Ruta<select value={ruta} onChange={(e) => setRuta(e.target.value)}><option value="">— elegir —</option>{(rutas.data || []).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}<option value={0}>Bodega / mostrador</option></select></label>}
        </div>
        {ruta === '' ? <div className="mut">Elige una ruta.</div> : s.loading || s.error || !d ? <Cargando s={s} /> : (
          <>
            <div className="card">
              <div className="row between"><span>Remisiones</span><b>{d.remisiones}</b></div>
              <div className="row between"><span>Vendido total</span><b>{money(d.ventas_total)}</b></div>
              <div className="row between mut"><span>· de contado</span><span>{money(d.ventas_contado)}</span></div>
              <div className="row between mut"><span>· a crédito</span><span>{money(d.ventas_credito)}</span></div>
            </div>
            <div className="card">
              <div className="row between"><span>Dinero cobrado hoy</span><b>{money(d.cobrado)}</b></div>
              <div className="row between mut"><span>· incluye abonos de deudas anteriores</span><span>{money(d.abonos)}</span></div>
              <div className="row between"><span>Gastos de ruta</span><b className="mal">-{money(d.gastos)}</b></div>
              {d.lista_gastos.map((g) => <div key={g.id} className="row between mut"><span>· {g.concepto}</span><span>{money(g.valor)}</span></div>)}
              <button className="btn sm sec" style={{ marginTop: 6 }} onClick={() => setGasto(true)}>+ Registrar gasto</button>
              <hr />
              <div className="row between"><b>Efectivo que debe entregar</b><span className="big">{money(d.esperado)}</span></div>
            </div>
            <div className="card">
              <h3>Inventario que queda en la ruta</h3>
              {d.inventario.length === 0 ? <div className="mut">Sin mercancía</div> : d.inventario.map((i) => <div key={i.nombre} className="row between"><span>{i.nombre}</span><b>{qty(i.cantidad)}</b></div>)}
            </div>
            <div className="card">
              <h3>Cuadre de caja</h3>
              {d.cierre && <p className={d.cierre.diferencia === 0 ? 'ok' : d.cierre.diferencia < 0 ? 'mal' : 'warn'}>Cierre guardado: entregó {money(d.cierre.entregado)} · diferencia {money(d.cierre.diferencia)}</p>}
              <Campo label="Efectivo realmente entregado" inputMode="decimal" value={entregado} onChange={(e) => setEntregado(e.target.value)} />
              {entregado !== '' && <p className={Number(entregado) - d.esperado === 0 ? 'ok' : 'mal'}>Diferencia: {money(Number(entregado) - d.esperado)}</p>}
              <Campo label="Nota" value={nota} onChange={(e) => setNota(e.target.value)} />
              <button className="btn block" disabled={ocupado || entregado === ''} onClick={() => run(async () => { await post('/cierre', { fecha, ruta_id: ruta, entregado: Number(entregado), nota }); s.recargar(); }, 'Cierre guardado')}>Guardar cierre</button>
            </div>
          </>
        )}
      </main>
      {gasto && <Gasto ruta={ruta} onClose={() => setGasto(false)} onHecho={() => { setGasto(false); s.recargar(); }} />}
    </>
  );
}
function Gasto({ ruta, onClose, onHecho }) {
  const [concepto, setConcepto] = useState('');
  const [valor, setValor] = useState('');
  const [ocupado, run] = useAccion();
  return (
    <Modal titulo="Gasto de ruta" onClose={onClose}>
      <Campo label="Concepto (gasolina, almuerzo, peaje…)" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
      <Campo label="Valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { await post('/gastos', { concepto, valor: Number(valor), ruta_id: ruta }); onHecho(); }, 'Gasto registrado')}>Guardar</button>
    </Modal>
  );
}
