import { useState } from 'react';
import { get, post, put, useCarga, ROL_NOMBRE, telWhatsApp } from '../lib.js';
import { Header, Cargando, Modal, Campo, useAccion, toast } from '../ui.jsx';

export function Ajustes({ cfgRefrescar }) {
  const cfg = useCarga(() => get('/config'), []);
  const bodegas = useCarga(() => get('/bodegas'), []);
  const rutas = useCarga(() => get('/rutas'), []);
  const usuarios = useCarga(() => get('/usuarios'), []);
  const [f, setF] = useState(null);
  const [ed, setEd] = useState(null); // { tipo: 'bodega'|'ruta'|'usuario', dato }
  const [qRuta, setQRuta] = useState('');
  const [qUsu, setQUsu] = useState('');
  const [ocupado, run] = useAccion();
  const v = f || cfg.data;
  const set = (k) => (e) => setF({ ...v, [k]: e.target.value });
  const recargar = () => { bodegas.recargar(); rutas.recargar(); usuarios.recargar(); };
  const rutasPor = (id) => (rutas.data || []).filter((r) => r.bodega_id === id && r.nombre.toLowerCase().includes(qRuta.toLowerCase()));
  return (
    <>
      <Header titulo="Ajustes del negocio" atras="/mas" />
      <main>
        {cfg.loading || !v ? <Cargando s={cfg} /> : (
          <div className="card"><h3>Datos que salen en la remisión</h3>
            <Campo label="Nombre del negocio" value={v.negocio} onChange={set('negocio')} />
            <div className="grid2"><Campo label="NIT / Cédula" value={v.nit} onChange={set('nit')} /><Campo label="Teléfono" value={v.telefono} onChange={set('telefono')} /></div>
            <Campo label="Dirección" value={v.direccion} onChange={set('direccion')} />
            <Campo label="Prefijo del consecutivo" value={v.prefijo} onChange={set('prefijo')} />
            <label className="f">Mensaje al pie<textarea rows={2} value={v.pie_remision} onChange={set('pie_remision')} /></label>
            <button className="btn block" disabled={ocupado} onClick={() => run(async () => { await put('/config', v); cfgRefrescar(); }, 'Guardado')}>Guardar</button>
          </div>
        )}

        <div className="card"><h3>Bodegas</h3>
          {(bodegas.data || []).map((b) => (
            <div key={b.id} className="item row between" style={{ padding: '9px 0', cursor: 'pointer', opacity: b.activa ? 1 : 0.5 }} onClick={() => setEd({ tipo: 'bodega', dato: b })}>
              <div><b>{b.nombre}</b><div className="mut">{b.rutas} ruta(s) activa(s){b.direccion ? ` · ${b.direccion}` : ''}</div></div><span className="mut">Editar</span>
            </div>
          ))}
          <button className="btn sec block" style={{ marginTop: 8 }} onClick={() => setEd({ tipo: 'bodega', dato: { nombre: '', direccion: '', nuevo: true } })}>+ Nueva bodega</button>
        </div>

        <div className="card"><h3>Rutas por bodega</h3>
          <input className="q" placeholder="Buscar ruta…" value={qRuta} onChange={(e) => setQRuta(e.target.value)} />
          {(bodegas.data || []).map((b) => {
            const lista = rutasPor(b.id);
            if (!lista.length && qRuta) return null;
            return (
              <div key={b.id} style={{ marginBottom: 8 }}>
                <div className="mut bold" style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>{b.nombre}</div>
                {lista.map((r) => (
                  <div key={r.id} className="item row between" style={{ padding: '8px 0', cursor: 'pointer', opacity: r.activa ? 1 : 0.5 }} onClick={() => setEd({ tipo: 'ruta', dato: r })}>
                    <span>{r.nombre}</span><span className="mut">Editar</span>
                  </div>
                ))}
                {!lista.length && <div className="mut">Sin rutas</div>}
              </div>
            );
          })}
          <button className="btn sec block" onClick={() => setEd({ tipo: 'ruta', dato: { nombre: '', bodega_id: bodegas.data?.[0]?.id || '', nuevo: true } })}>+ Nueva ruta</button>
        </div>

        <div className="card"><h3>Usuarios</h3>
          <input className="q" placeholder="Buscar usuario…" value={qUsu} onChange={(e) => setQUsu(e.target.value)} />
          {(usuarios.data || []).filter((x) => `${x.nombre} ${x.usuario}`.toLowerCase().includes(qUsu.toLowerCase())).map((x) => (
            <div key={x.id} className="item row between" style={{ padding: '8px 0', cursor: 'pointer', opacity: x.activo ? 1 : 0.5 }} onClick={() => setEd({ tipo: 'usuario', dato: x })}>
              <div><b>{x.nombre}</b><div className="mut">@{x.usuario} · {ROL_NOMBRE[x.rol]}{x.ruta ? ` · ${x.ruta}` : ''}{x.bodega ? ` · ${x.bodega}` : ''}</div></div><span className="mut">Editar</span>
            </div>
          ))}
          <button className="btn sec block" style={{ marginTop: 8 }} onClick={() => setEd({ tipo: 'usuario', dato: { nombre: '', usuario: '', rol: 'vendedor', ruta_id: '', bodega_id: '', activo: 1, nuevo: true } })}>+ Nuevo usuario</button>
        </div>
        <ResumenWhatsApp />
      </main>
      {ed?.tipo === 'bodega' && <EditarBodega b={ed.dato} onClose={() => setEd(null)} onHecho={() => { setEd(null); recargar(); }} />}
      {ed?.tipo === 'ruta' && <EditarRuta r={ed.dato} bodegas={bodegas.data || []} onClose={() => setEd(null)} onHecho={() => { setEd(null); recargar(); }} />}
      {ed?.tipo === 'usuario' && <EditarUsuario u={ed.dato} bodegas={bodegas.data || []} rutas={rutas.data || []} onClose={() => setEd(null)} onHecho={() => { setEd(null); recargar(); }} />}
    </>
  );
}

const Activo = ({ f, setF }) => (
  <label className="f"><input type="checkbox" checked={!!f.activa} onChange={(e) => setF({ ...f, activa: e.target.checked ? 1 : 0 })} style={{ display: 'inline', width: 'auto' }} /> Activa</label>
);

function EditarBodega({ b, onClose, onHecho }) {
  const [f, setF] = useState({ ...b, activa: b.activa ?? 1 });
  const [ocupado, run] = useAccion();
  return (
    <Modal titulo={b.nuevo ? 'Nueva bodega' : 'Editar bodega'} onClose={onClose}>
      <Campo label="Nombre" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
      <Campo label="Dirección" value={f.direccion || ''} onChange={(e) => setF({ ...f, direccion: e.target.value })} />
      {!b.nuevo && <Activo f={f} setF={setF} />}
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { b.nuevo ? await post('/bodegas', f) : await put(`/bodegas/${b.id}`, f); onHecho(); }, 'Guardado')}>Guardar</button>
    </Modal>
  );
}

function EditarRuta({ r, bodegas, onClose, onHecho }) {
  const [f, setF] = useState({ ...r, activa: r.activa ?? 1 });
  const [ocupado, run] = useAccion();
  return (
    <Modal titulo={r.nuevo ? 'Nueva ruta' : 'Editar ruta'} onClose={onClose}>
      <Campo label="Nombre de la ruta" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
      <label className="f">Bodega que la despacha
        <select value={f.bodega_id} onChange={(e) => setF({ ...f, bodega_id: Number(e.target.value) })}>{bodegas.filter((b) => b.activa || b.id === r.bodega_id).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</select>
      </label>
      {!r.nuevo && <Activo f={f} setF={setF} />}
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { r.nuevo ? await post('/rutas', f) : await put(`/rutas/${r.id}`, f); onHecho(); }, 'Guardado')}>Guardar</button>
    </Modal>
  );
}

function EditarUsuario({ u, bodegas, rutas, onClose, onHecho }) {
  const [f, setF] = useState({ ...u, clave: '' });
  const [ocupado, run] = useAccion();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal titulo={u.nuevo ? 'Nuevo usuario' : 'Editar usuario'} onClose={onClose}>
      <Campo label="Nombre" value={f.nombre} onChange={set('nombre')} />
      {u.nuevo && <Campo label="Usuario (para iniciar sesión)" autoCapitalize="none" value={f.usuario} onChange={set('usuario')} />}
      <Campo label={u.nuevo ? 'Contraseña (mín. 6)' : 'Nueva contraseña (vacío = no cambiar)'} type="password" value={f.clave} onChange={set('clave')} />
      <label className="f">Rol
        <select value={f.rol} onChange={set('rol')}>
          <option value="vendedor">Vendedor de ruta</option>
          <option value="bodeguero">Encargado de bodega</option>
          <option value="admin">Administrador</option>
        </select>
      </label>
      {f.rol === 'vendedor' && (
        <label className="f">Ruta
          <select value={f.ruta_id ?? ''} onChange={set('ruta_id')}><option value="">— elegir —</option>
            {bodegas.map((b) => <optgroup key={b.id} label={b.nombre}>{rutas.filter((r) => r.bodega_id === b.id).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</optgroup>)}
          </select>
        </label>
      )}
      {f.rol === 'bodeguero' && (
        <label className="f">Bodega a su cargo
          <select value={f.bodega_id ?? ''} onChange={set('bodega_id')}><option value="">— elegir —</option>{bodegas.filter((b) => b.activa).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</select>
        </label>
      )}
      {f.rol === 'bodeguero' && <p className="mut">Ve y mueve solo el inventario de su bodega y de las rutas que despacha. También compra, vende en el mostrador, envía y recibe traslados.</p>}
      {!u.nuevo && <label className="f"><input type="checkbox" checked={!!f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked ? 1 : 0 })} style={{ display: 'inline', width: 'auto' }} /> Activo</label>}
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { const b = { ...f }; if (!b.clave) delete b.clave; u.nuevo ? await post('/usuarios', b) : await put(`/usuarios/${u.id}`, b); onHecho(); }, 'Guardado')}>Guardar</button>
    </Modal>
  );
}

// Resumen diario por WhatsApp al dueño (API oficial de Meta; mientras tanto, envío manual con un toque)
function ResumenWhatsApp() {
  const s = useCarga(() => get('/whatsapp'), []);
  const [f, setF] = useState(null);
  const [ocupado, run] = useAccion();
  const d = s.data;
  if (s.loading || s.error) return <div className="card"><h3>Resumen diario por WhatsApp</h3><Cargando s={s} /></div>;
  const v = f || { activo: d.activo, numeros: d.numeros.map((x) => (x.startsWith('57') && x.length === 12 ? x.slice(2) : x)).join(', '), hora: d.hora, plantilla: d.plantilla, idioma: d.idioma };
  const set = (k) => (e) => setF({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const guardar = () => run(async () => {
    await put('/config', { whatsapp_activo: v.activo ? '1' : '0', whatsapp_numeros: v.numeros, whatsapp_hora: v.hora, whatsapp_plantilla: v.plantilla, whatsapp_idioma: v.idioma });
    setF(null); s.recargar();
  }, 'Guardado');
  const primero = telWhatsApp(String(v.numeros).split(/[,;\n]+/)[0]);
  return (
    <div className="card">
      <h3>Resumen diario por WhatsApp</h3>
      {d.configurado ? <div className="aviso ok">✅ Conectado a la API oficial de WhatsApp.</div>
        : <div className="aviso pend">Falta conectar la API oficial de WhatsApp en el servidor (ver <b>WHATSAPP.md</b>). Mientras tanto puedes enviar el resumen con el botón verde.</div>}
      <label className="row" style={{ gap: 8, marginBottom: 12 }}><input type="checkbox" checked={!!v.activo} onChange={set('activo')} /><span>Enviar el resumen automáticamente todos los días</span></label>
      <Campo label="WhatsApp del dueño (separa varios con coma)" inputMode="tel" placeholder="3001234567" value={v.numeros} onChange={set('numeros')} />
      <div className="grid2">
        <Campo label="Hora de envío" type="time" value={v.hora} onChange={set('hora')} />
        <Campo label="Plantilla aprobada en Meta" value={v.plantilla} onChange={set('plantilla')} />
      </div>
      <button className="btn block" disabled={ocupado} onClick={guardar}>Guardar</button>
      <h3 style={{ marginTop: 16 }}>Vista previa de hoy</h3>
      <pre className="tirilla" style={{ width: '100%', whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14 }}>{d.texto}</pre>
      <div className="row" style={{ marginTop: 10 }}>
        <a className="btn grow" style={{ background: '#16a34a', textAlign: 'center', textDecoration: 'none' }} target="_blank" rel="noreferrer"
          href={`https://wa.me/${primero}?text=${encodeURIComponent(d.texto)}`}>Enviar ahora por WhatsApp</a>
        {d.configurado && <button className="btn sec grow" disabled={ocupado || f !== null} onClick={() => run(async () => {
          const r = (await post('/whatsapp/probar')).resultados;
          s.recargar();
          const malos = r.filter((x) => !x.ok);
          if (malos.length) throw new Error(malos.map((x) => `${x.para || ''} ${x.error}`).join(' · '));
        }, 'Resumen enviado por la API')}>Probar envío automático</button>}
      </div>
      {d.envios.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Últimos envíos</h3>
          {d.envios.slice(0, 8).map((e, i) => (
            <div key={i} className="row between mut" style={{ padding: '3px 0' }}>
              <span>{e.fecha.slice(0, 16)} · {e.para}{e.tipo === 'prueba' ? ' (prueba)' : ''}{e.detalle ? <div className="mal">{e.detalle}</div> : null}</span>
              <span className={e.estado === 'enviado' ? 'tag ok' : 'tag mal'}>{e.estado}</span>
            </div>))}
        </>
      )}
    </div>
  );
}
