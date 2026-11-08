import { useState } from 'react';
import { Header, useAccion } from '../ui.jsx';
import { preferencias, guardarPreferencias, imprimirRemision, conectarBle, bleConectada, esAndroid, esIOS, hayBluetoothWeb } from '../impresora.js';
import { remisionDePrueba, textoPlano } from '../tirilla.js';

// Configuración de la impresora térmica de ESTE celular (cada carro tiene la suya)
export function Impresora({ user, cfg }) {
  const [p, setP] = useState(preferencias());
  const [ocupado, run] = useAccion();
  const [conectada, setConectada] = useState(bleConectada());
  const cambiar = (x) => { const n = { ...p, ...x }; setP(n); guardarPreferencias(n); };
  const prueba = remisionDePrueba(user.nombre);
  const android = esAndroid(), ios = esIOS();
  const Opcion = ({ id, titulo, texto, recomendada }) => (
    <label className={'opcion' + (p.metodo === id ? ' on' : '')}>
      <input type="radio" name="metodo" checked={p.metodo === id} onChange={() => cambiar({ metodo: id })} />
      <div><b>{titulo}</b>{recomendada && <span className="tag ok" style={{ marginLeft: 6 }}>Recomendada</span>}<div className="mut">{texto}</div></div>
    </label>
  );
  return (
    <>
      <Header titulo="Impresora de tirillas" atras="/mas" />
      <main>
        <div className="card">
          <h3>¿Cómo imprime este celular?</h3>
          <Opcion id="rawbt" recomendada={android} titulo="Android con RawBT"
            texto="Para impresoras Bluetooth como la de los carros. Necesita la app gratuita RawBT (Play Store)." />
          <Opcion id="ble" titulo="Bluetooth LE directo"
            texto={ios ? 'En iPhone solo funciona abriendo la app en el navegador Bluefy y con impresoras BLE.' : 'Sin apps extra, solo con impresoras que tengan Bluetooth LE (4.0).'} />
          <Opcion id="pdf" recomendada={ios} titulo="Sin impresora (PDF)" texto="La remisión se comparte por WhatsApp como PDF. No muestra el botón de imprimir." />
        </div>

        {p.metodo !== 'pdf' && (
          <div className="card">
            <h3>Papel</h3>
            <div className="row" style={{ marginBottom: 10 }}>
              {['58', '80'].map((x) => <button key={x} className={'btn grow ' + (p.papel === x ? '' : 'gris')} onClick={() => cambiar({ papel: x })}>{x} mm</button>)}
            </div>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={p.tildes} onChange={(e) => cambiar({ tildes: e.target.checked })} />
              <span>Imprimir tildes y eñes <span className="mut">(desactívalo si salen símbolos raros)</span></span></label>
          </div>
        )}

        {p.metodo === 'rawbt' && (
          <div className="card">
            <h3>Pasos (solo la primera vez)</h3>
            <ol className="pasos">
              <li>Prende la impresora. En el celular: <b>Ajustes → Bluetooth</b>, empareja la impresora (si pide clave: <b>0000</b> o <b>1234</b>).</li>
              <li>Instala <b>RawBT</b> desde la Play Store y ábrela.</li>
              <li>En RawBT toca <b>Configuración → Conexión</b>, elige la impresora y el controlador <b>ESC/POS</b>.</li>
              <li>Vuelve aquí y toca <b>Imprimir prueba</b>. La primera vez Android pregunta con qué abrir: elige RawBT y “Siempre”.</li>
            </ol>
            {!android && <div className="mut warn">Este celular no es Android: RawBT no funcionará aquí.</div>}
          </div>
        )}
        {p.metodo === 'ble' && (
          <div className="card">
            <h3>Conexión</h3>
            {!hayBluetoothWeb() ? <div className="mal">Este navegador no permite Bluetooth.{ios ? ' En iPhone instala el navegador “Bluefy” y abre la app desde ahí.' : ' Usa Chrome.'}</div> : (
              <>
                <div className="mut" style={{ marginBottom: 8 }}>{conectada ? `Conectada: ${conectada}` : 'Sin conectar. Al imprimir se pedirá elegir la impresora.'}</div>
                <button className="btn sec block" disabled={ocupado} onClick={() => run(async () => { setConectada(await conectarBle()); }, 'Impresora conectada')}>Buscar impresora</button>
              </>
            )}
          </div>
        )}

        {p.metodo !== 'pdf' && (
          <>
            <button className="btn block" disabled={ocupado} onClick={() => run(async () => { await imprimirRemision(prueba, cfg); setConectada(bleConectada()); }, p.metodo === 'rawbt' ? 'Enviado a RawBT' : 'Impreso')}>🖨 Imprimir prueba</button>
            <div className="card" style={{ marginTop: 14 }}>
              <h3>Así sale la tirilla</h3>
              <pre className="tirilla">{textoPlano(prueba, cfg || {}, { papel: p.papel })}</pre>
            </div>
          </>
        )}
      </main>
    </>
  );
}
