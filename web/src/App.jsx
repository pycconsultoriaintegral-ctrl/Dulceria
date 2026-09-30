import { useEffect, useState } from 'react';
import { getUser, getToken, guardarSesion, login, get, useHash, sincronizar, useCola } from './lib.js';
import { Toaster, Campo, useAccion, toast, VisorPdf } from './ui.jsx';
import { Inicio } from './pages/Inicio.jsx';
import Vender from './pages/Vender.jsx';
import { Remisiones, RemisionDetalle } from './pages/Remisiones.jsx';
import { Clientes, ClienteDetalle, Cartera } from './pages/Clientes.jsx';
import { Inventario } from './pages/Inventario.jsx';
import { Productos, Compras, Reportes, Ajustes } from './pages/Admin.jsx';
import { Cierre } from './pages/Cierre.jsx';
import { Mas } from './pages/Mas.jsx';

function Login({ onOk }) {
  const [u, setU] = useState(''); const [c, setC] = useState('');
  const [ocupado, run] = useAccion();
  return (
    <div className="login">
      <div className="hero">
        <div className="logo">🍬</div>
        <h1>Dulcería Ruta</h1>
        <p>Ventas, inventario y remisiones</p>
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
    const on = () => { setOnline(true); sincronizar(); }, off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    const t = setInterval(sincronizar, 30000);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); clearInterval(t); };
  }, [user]);

  if (!user) return <Login onOk={setUser} />;
  const admin = user.rol === 'admin';
  const [, base, id] = ruta.split('/');
  const p = { user, cfg };
  let page;
  switch (base) {
    case 'vender': page = <Vender {...p} />; break;
    case 'remisiones': page = id ? <RemisionDetalle id={id} {...p} /> : <Remisiones {...p} />; break;
    case 'clientes': page = id ? <ClienteDetalle id={id} {...p} /> : <Clientes {...p} />; break;
    case 'cartera': page = <Cartera {...p} />; break;
    case 'inventario': page = <Inventario {...p} />; break;
    case 'cierre': page = <Cierre {...p} />; break;
    case 'productos': page = admin ? <Productos /> : null; break;
    case 'compras': page = admin ? <Compras /> : null; break;
    case 'reportes': page = admin ? <Reportes /> : null; break;
    case 'ajustes': page = admin ? <Ajustes cfgRefrescar={cargarCfg} /> : null; break;
    case 'mas': page = <Mas {...p} />; break;
    default: page = <Inicio {...p} />;
  }
  const tabs = [['', '🏠', 'Inicio'], ['vender', '🛒', 'Vender'], ['remisiones', '🧾', 'Remisiones'], ['clientes', '👥', 'Clientes'], ['inventario', '📦', 'Inventario'], ['mas', '☰', 'Más']];
  const activo = ['productos', 'compras', 'reportes', 'ajustes', 'cartera', 'cierre'].includes(base) ? 'mas' : base || '';
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
