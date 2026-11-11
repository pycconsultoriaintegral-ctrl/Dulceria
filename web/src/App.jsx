import { useEffect, useState } from 'react';
import { getUser, getToken, guardarSesion, login, get, useHash, sincronizar, useCola, can } from './lib.js';
import { Toaster, Campo, useAccion, toast, VisorPdf, Header } from './ui.jsx';
import { Inicio } from './pages/Inicio.jsx';
import Vender from './pages/Vender.jsx';
import { Remisiones, RemisionDetalle } from './pages/Remisiones.jsx';
import { Clientes, ClienteDetalle, Cartera } from './pages/Clientes.jsx';
import { Inventario } from './pages/Inventario.jsx';
import { Productos } from './pages/Admin.jsx';
import { Compras } from './pages/Compras.jsx';
import { Reportes } from './pages/Reportes.jsx';
import { Ajustes } from './pages/Ajustes.jsx';
import { Traslados } from './pages/Traslados.jsx';
import { Importar } from './pages/Importar.jsx';
import { Actividad } from './pages/Actividad.jsx';
import { Cierre } from './pages/Cierre.jsx';
import { Mas } from './pages/Mas.jsx';
import { Aprobaciones } from './pages/Aprobaciones.jsx';
import { Impresora } from './pages/Impresora.jsx';
import { CuadreSemanal } from './pages/CuadreSemanal.jsx';
import { Alertas } from './pages/Alertas.jsx';

function Login({ onOk }) {
  const [u, setU] = useState(''); const [c, setC] = useState('');
  const [ocupado, run] = useAccion();
  return (
    <div className="login">
      <div className="hero">
        <img className="logo" src="/icon-192.png" alt="" />
        <h1>Mi Pan POS</h1>
        <p>Panificadora Mi Pan Colombia SAS</p>
      </div>
      <main>
        <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await login(u, c); guardarSesion(r.token, r.user); onOk(r.user); }); }}>
          <Campo label="Usuario" autoCapitalize="none" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} />
          <Campo label="Contraseña" type="password" autoComplete="current-password" value={c} onChange={(e) => setC(e.target.value)} />
          <button className="btn block" disabled={ocupado}>Entrar</button>
        </form>
      </main>
      <Toaster />
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(getToken() ? getUser() : null);
  const [cfg, setCfg] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const ruta = useHash();
  const { pendientes } = useCola();
  const cargarCfg = () => get('/config').then(setCfg).catch(() => {});

  useEffect(() => {
    if (!user) return;
    cargarCfg(); sincronizar();
    // refresca los datos del usuario (rol, ruta, bodega) por si el administrador los cambió
    get('/auth/me').then((me) => { guardarSesion(getToken(), me); setUser(me); }).catch(() => {});
    const on = () => { setOnline(true); sincronizar(); }, off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    const t = setInterval(sincronizar, 30000);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); clearInterval(t); };
  }, [user]);

  if (!user) return <Login onOk={setUser} />;
  const [, base, id] = ruta.split('?')[0].split('/');
  const p = { user, cfg };
  const sinAcceso = <><Header titulo="Sin acceso" /><main><div className="center mut">🔒 Tu usuario no tiene permiso para ver esta pantalla.</div></main></>;
  let page;
  switch (base) {
    case 'vender': page = <Vender {...p} />; break;
    case 'remisiones': page = id ? <RemisionDetalle id={id} {...p} /> : <Remisiones {...p} />; break;
    case 'clientes': page = id ? <ClienteDetalle id={id} {...p} /> : <Clientes {...p} />; break;
    case 'cartera': page = <Cartera {...p} />; break;
    case 'aprobaciones': page = <Aprobaciones {...p} />; break;
    case 'impresora': page = <Impresora {...p} />; break;
    case 'alertas': page = <Alertas {...p} />; break;
    case 'cuadre-semanal': page = can(user, 'cuadre') ? <CuadreSemanal key={id || 'lista'} punto={id} /> : sinAcceso; break;
    case 'inventario': page = <Inventario {...p} />; break;
    case 'cierre': page = <Cierre {...p} />; break;
    case 'productos': page = can(user, 'productos') ? <Productos /> : sinAcceso; break;
    case 'compras': page = can(user, 'compras') || can(user, 'pagar_proveedores') ? <Compras user={user} /> : sinAcceso; break;
    case 'reportes': page = can(user, 'informes') ? <Reportes user={user} /> : sinAcceso; break;
    case 'actividad': page = can(user, 'administrar') ? <Actividad /> : sinAcceso; break;
    case 'importar': page = can(user, 'importar') || can(user, 'productos') ? <Importar user={user} /> : sinAcceso; break;
    case 'traslados': page = can(user, 'inventario') ? <Traslados user={user} /> : sinAcceso; break;
    case 'ajustes': page = can(user, 'administrar') ? <Ajustes cfgRefrescar={cargarCfg} /> : sinAcceso; break;
    case 'mas': page = <Mas {...p} />; break;
    default: page = <Inicio {...p} />;
  }
  const tabs = [['', '🏠', 'Inicio'], ['vender', '🛒', 'Vender'], ['remisiones', '🧾', 'Remisiones'], ['clientes', '👥', 'Clientes'], ['inventario', '📦', 'Inventario'], ['mas', '☰', 'Más']];
  const activo = ['productos', 'compras', 'reportes', 'ajustes', 'cartera', 'cierre', 'traslados', 'importar', 'actividad', 'aprobaciones', 'impresora', 'cuadre-semanal', 'alertas'].includes(base) ? 'mas' : base || '';
  return (
    <>
      {!online && <div className="banner off">Sin conexión · tus ventas se guardan y se envían al volver la señal</div>}
      {online && pendientes.length > 0 && <div className="banner off">Enviando {pendientes.length} operación(es) pendientes…</div>}
      {page}
      <nav className="tabs">{tabs.map(([to, ic, t]) => <a key={t} href={`#/${to}`} className={activo === to ? 'on' : ''}><b>{ic}</b>{t}</a>)}</nav>
      <VisorPdf cfg={cfg} />
      <Toaster />
    </>
  );
}
