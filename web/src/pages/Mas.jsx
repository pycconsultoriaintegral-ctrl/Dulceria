import { useState } from 'react';
import { post, cerrarSesion, ir } from '../lib.js';
import { Header, Campo, Modal, useAccion } from '../ui.jsx';

export function Mas({ user }) {
  const admin = user.rol === 'admin';
  const [clave, setClave] = useState(false);
  const items = [
    ['/cartera', '💰', 'Cartera (por cobrar)'], ['/cierre', '🧾', 'Cierre del día'],
    ...(admin ? [['/productos', '🍬', 'Productos'], ['/compras', '📥', 'Compras y proveedores'], ['/reportes', '📊', 'Reportes'], ['/ajustes', '⚙️', 'Ajustes, rutas y usuarios']] : []),
  ];
  return (
    <>
      <Header titulo="Más" />
      <main>
        <div className="card list">{items.map(([to, ic, t]) => <div key={to} className="item" onClick={() => ir(to)}><span style={{ fontSize: 22 }}>{ic}</span><span className="grow bold">{t}</span><span className="mut">›</span></div>)}</div>
        <div className="card"><div className="bold">{user.nombre}</div><div className="mut">@{user.usuario} · {admin ? 'Administrador' : 'Vendedor de ruta'}</div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn sec grow" onClick={() => setClave(true)}>Cambiar contraseña</button><button className="btn gris grow" onClick={cerrarSesion}>Cerrar sesión</button></div></div>
      </main>
      {clave && <CambiarClave onClose={() => setClave(false)} />}
    </>
  );
}
function CambiarClave({ onClose }) {
  const [a, setA] = useState(''); const [n, setN] = useState('');
  const [ocupado, run] = useAccion();
  return (
    <Modal titulo="Cambiar contraseña" onClose={onClose}>
      <Campo label="Contraseña actual" type="password" value={a} onChange={(e) => setA(e.target.value)} />
      <Campo label="Nueva contraseña (mín. 6)" type="password" value={n} onChange={(e) => setN(e.target.value)} />
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { await post('/auth/clave', { actual: a, nueva: n }); onClose(); }, 'Contraseña actualizada')}>Guardar</button>
    </Modal>
  );
}
