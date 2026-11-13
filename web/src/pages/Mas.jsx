import { useState } from 'react';
import { post, cerrarSesion, ir, can, getUser, guardarSesion } from '../lib.js';
import { Header, Campo, Modal, useAccion } from '../ui.jsx';

export function Mas({ user }) {
  const [clave, setClave] = useState(false);
  const items = [
    ['/aprobaciones', '⏳', can(user, 'aprobar_pagos') ? 'Pagos por aprobar' : 'Mis pendientes de pago'], ['/turno', '⏱️', 'Turno (abrir / cerrar)'], ['/cartera', '💰', 'Cartera (por cobrar)'], ['/cierre', '🧾', 'Cierre del día'], ['/alertas', '📦', 'Alertas de inventario'], ['/impresora', '🖨', 'Impresora de tirillas'],
    ...(can(user, 'cuadre') ? [['/cuadre-semanal', '📅', 'Cuadre semanal (sábado)']] : []),
    ['/mapa', '🗺️', 'Mapa de ventas y tiendas'],
    ...(can(user, 'inventario') ? [['/kardex', '📒', 'Kardex (movimientos de inventario)'], ['/traslados', '🚚', 'Traslados entre bodegas']] : []),
    ...(can(user, 'compras') || can(user, 'pagar_proveedores') ? [['/compras', '📥', 'Compras y proveedores']] : []),
    ...(can(user, 'informes') ? [['/reportes', '📊', 'Reportes']] : []),
    ...(can(user, 'importar') || can(user, 'productos') ? [['/importar', '📤', 'Importar desde Excel']] : []),
    ...(can(user, 'productos') ? [['/productos', '🥖', 'Productos']] : []),
    ...(can(user, 'administrar') ? [['/actividad', '🕵️', 'Registro de actividad'], ['/ajustes', '⚙️', 'Ajustes, bodegas, rutas, usuarios y roles']] : []),
  ];
  return (
    <>
      <Header titulo="Más" />
      <main>
        <div className="card list">{items.map(([to, ic, t]) => <div key={to} className="item" onClick={() => ir(to)}><span style={{ fontSize: 22 }}>{ic}</span><span className="grow bold">{t}</span><span className="mut">›</span></div>)}</div>
        <div className="card"><div className="bold">{user.nombre}</div><div className="mut">@{user.usuario} · {user.rol_nombre}</div>
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
      <button className="btn block" disabled={ocupado} onClick={() => run(async () => { const r = await post('/auth/clave', { actual: a, nueva: n }); if (r.token) guardarSesion(r.token, getUser()); onClose(); }, 'Contraseña actualizada (se cerraron tus otras sesiones)')}>Guardar</button>
    </Modal>
  );
}
