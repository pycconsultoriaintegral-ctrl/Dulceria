import { useState } from 'react';
import { get, post, money, qty, useCarga, hoyStr, useUbicaciones } from '../lib.js';
import { Header, Cargando, Campo, Modal, useAccion, SelectorPunto } from '../ui.jsx';

export function Cierre({ user }) {
  const elige = user.rol !== 'vendedor'; // el vendedor cierra siempre su ruta
  const { bodegas } = useUbicaciones();
  const [fecha, setFecha] = useState(hoyStr());
  const [ruta, setRuta] = useState(user.rol === 'bodeguero' ? `B${user.bodega_id}` : user.rol === 'vendedor' ? `R${user.ruta_id}` : '');
  const s = useCarga(() => (ruta === '' ? null : get(`/cierre?fecha=${fecha}&punto=${ruta}`)), [fecha, ruta]);
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
          {elige && <SelectorPunto bodegas={bodegas} value={ruta} onChange={setRuta} label="Punto" />}
        </div>
        {ruta === '' ? <div className="mut">Elige una ruta o un mostrador.</div> : s.loading || s.error || !d ? <Cargando s={s} /> : (
          <>
            <div className="card">
              <div className="row between"><span>Remisiones</span><b>{d.remisiones}</b></div>
              <div className="row between"><span>Vendido total</span><b>{money(d.ventas_total)}</b></div>
              <div className="row between mut"><span>· de contado</span><span>{money(d.ventas_contado)}</span></div>
              <div className="row between mut"><span>· a crédito</span><span>{money(d.ventas_credito)}</span></div>
            </div>
            <div className="card">
              <div className="row between"><span>💵 Cobrado en efectivo</span><b>{money(d.cobrado_efectivo)}</b></div>
              <div className="row between"><span>📲 Cobrado por transferencia</span><b>{money(d.transferencias)}</b></div>
              <div className="row between mut"><span>· total cobrado (incluye abonos de deudas anteriores: {money(d.abonos)})</span><span>{money(d.cobrado)}</span></div>
              <div className="row between"><span>Gastos de ruta</span><b className="mal">-{money(d.gastos)}</b></div>
              {d.lista_gastos.map((g) => <div key={g.id} className="row between mut"><span>· {g.concepto}</span><span>{money(g.valor)}</span></div>)}
              <button className="btn sm sec" style={{ marginTop: 6 }} onClick={() => setGasto(true)}>+ Registrar gasto</button>
              <hr />
              <div className="row between"><b>Efectivo que debe entregar</b><span className="big">{money(d.esperado)}</span></div>
            </div>
            <div className="card">
              <h3>Inventario que queda en este punto</h3>
              {d.inventario.length === 0 ? <div className="mut">Sin mercancía</div> : d.inventario.map((i) => <div key={i.nombre} className="row between"><span>{i.nombre}</span><b>{qty(i.cantidad)}</b></div>)}
            </div>
            <div className="card">
              <h3>Cuadre de caja</h3>
              {d.cierre && <p className={d.cierre.diferencia === 0 ? 'ok' : d.cierre.diferencia < 0 ? 'mal' : 'warn'}>Cierre guardado: entregó {money(d.cierre.entregado)} · diferencia {money(d.cierre.diferencia)}</p>}
              <Campo label="Efectivo realmente entregado" inputMode="decimal" value={entregado} onChange={(e) => setEntregado(e.target.value)} />
              {entregado !== '' && <p className={Number(entregado) - d.esperado === 0 ? 'ok' : 'mal'}>Diferencia: {money(Number(entregado) - d.esperado)}</p>}
              <Campo label="Nota" value={nota} onChange={(e) => setNota(e.target.value)} />
              <button className="btn block" disabled={ocupado || entregado === ''} onClick={() => run(async () => { await post('/cierre', { fecha, punto: ruta, entregado: Number(entregado), nota }); s.recargar(); }, 'Cierre guardado')}>Guardar cierre</button>
            </div>
          </>
        )}
      </main>
      {gasto && <Gasto punto={ruta} onClose={() => setGasto(false)} onHecho={() => { setGasto(false); s.recargar(); }} />}
    </>
  );
}
function Gasto({ punto, onClose, onHecho }) {
  const [concepto, setConcepto] = useState('');
  const [valor, setValor] = useState('');
  const [ocupado, run] = useAccion();
  return (
    <Modal titulo="Gasto de ruta" onClose={onClose}>
      <Campo label="Concepto (gasolina, almuerzo, peaje…)" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
      <Campo label="Valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { await post('/gastos', { concepto, valor: Number(valor), punto }); onHecho(); }, 'Gasto registrado')}>Guardar</button>
    </Modal>
  );
}
