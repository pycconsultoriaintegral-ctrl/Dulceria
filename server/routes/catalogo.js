// Configuración, bodegas, rutas, usuarios, productos y selector de ubicaciones
import { Router } from 'express';
import { db, tx, HttpError, getConfig, permiteSinStock, PERMISOS, TODOS_LOS_PERMISOS, esConcepto } from '../db.js';
import { soloAdmin, requierePermiso, hashClave } from '../auth.js';
import { wrap, n, num, req_, entero } from '../util.js';
import { presentacionesDe, guardarPresentaciones } from '../presentaciones.js';
import { auditar, diferencias } from '../auditoria.js';
import { normalizarNumero } from '../whatsapp.js';
import { B, R, getBodega, getRuta, ubicacionesPermitidas, can, parseUb, puedeUb } from '../scope.js';

const router = Router();

// ---------- Configuración ----------
router.get('/config', (req, res) => {
  const c = getConfig();
  delete c.jwt_secret;
  c.sin_stock_ok = permiteSinStock(); // la app deja vender sin existencias (carga inicial del inventario)
  // los números y ajustes del resumen por WhatsApp solo los ve el administrador
  if (!can(req.user, 'administrar')) for (const k of Object.keys(c)) if (k.startsWith('whatsapp_')) delete c[k];
  res.json(c);
});
router.put('/config', soloAdmin, wrap((req, res) => {
  if (req.body.whatsapp_hora !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.whatsapp_hora)) throw new HttpError(400, 'La hora del resumen debe ser HH:MM (ej. 20:00)');
  if (req.body.whatsapp_numeros !== undefined) {
    const malos = String(req.body.whatsapp_numeros).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).filter((x) => normalizarNumero(x).length < 11);
    if (malos.length) throw new HttpError(400, `Número de WhatsApp inválido: ${malos.join(', ')} (usa 10 dígitos, ej. 3001234567)`);
  }
  if (req.body.whatsapp_plantilla !== undefined && !/^[a-z0-9_]{1,512}$/.test(req.body.whatsapp_plantilla)) throw new HttpError(400, 'El nombre de la plantilla solo lleva minúsculas, números y _');
  if (req.body.exigir_turno !== undefined && !['', '0', '1'].includes(String(req.body.exigir_turno))) throw new HttpError(400, 'Valor inválido para exigir turno');
  if (req.body.permitir_sin_stock !== undefined && !['', '0', '1'].includes(String(req.body.permitir_sin_stock))) throw new HttpError(400, 'Valor inválido para vender sin inventario');
  if (req.body.dias_sin_movimiento !== undefined && !(Number.isInteger(Number(req.body.dias_sin_movimiento)) && Number(req.body.dias_sin_movimiento) >= 1 && Number(req.body.dias_sin_movimiento) <= 365)) throw new HttpError(400, 'Los días sin movimiento deben ser un número entre 1 y 365');
  for (const k of ['negocio', 'nit', 'telefono', 'direccion', 'pie_remision', 'prefijo', 'dias_sin_movimiento', 'permitir_sin_stock', 'exigir_turno', 'whatsapp_activo', 'whatsapp_numeros', 'whatsapp_hora', 'whatsapp_plantilla', 'whatsapp_idioma']) {
    if (req.body[k] !== undefined) db.prepare('INSERT INTO config (clave,valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor').run(k, String(req.body[k]));
  }
  auditar(req.user, 'editar', 'config', null, 'Datos del negocio');
  res.json(getConfig());
}));

// Bodegas con sus rutas, según lo que el usuario puede ver (para los selectores de la interfaz)
router.get('/ubicaciones', (req, res) => res.json({ bodegas: ubicacionesPermitidas(req.user) }));

// ---------- Bodegas ----------
router.get('/bodegas', (req, res) => {
  const rows = db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM rutas r WHERE r.bodega_id=b.id AND r.activa=1) AS rutas
    FROM bodegas b ORDER BY b.nombre`).all();
  res.json(req.user.alcance === 'todo' ? rows : rows.filter((b) => b.id === req.user.bodega_id));
});
router.post('/bodegas', soloAdmin, wrap((req, res) => {
  const nombre = req_(req.body.nombre, 'El nombre es obligatorio');
  let id;
  try { id = Number(db.prepare('INSERT INTO bodegas (nombre,direccion) VALUES (?,?)').run(nombre, n(req.body.direccion)).lastInsertRowid); }
  catch { throw new HttpError(409, 'Ya existe una bodega con ese nombre'); }
  auditar(req.user, 'crear', 'bodega', id, nombre);
  res.json({ id });
}));
router.put('/bodegas/:id', soloAdmin, wrap((req, res) => {
  const id = entero(req.params.id);
  const b = getBodega(id);
  if (!b) throw new HttpError(404, 'Bodega no encontrada');
  if (req.body.activa === 0 || req.body.activa === false) {
    if (db.prepare('SELECT 1 FROM rutas WHERE bodega_id=? AND activa=1').get(id)) throw new HttpError(409, 'La bodega aún tiene rutas activas: muévelas a otra bodega primero');
    if (db.prepare('SELECT 1 FROM stock WHERE ubicacion=? AND cantidad<>0').get(B(id))) throw new HttpError(409, 'La bodega aún tiene inventario: trasládalo antes de desactivarla');
  }
  try {
    db.prepare('UPDATE bodegas SET nombre=COALESCE(?,nombre), direccion=COALESCE(?,direccion), activa=COALESCE(?,activa) WHERE id=?')
      .run(n(req.body.nombre), n(req.body.direccion), req.body.activa === undefined ? null : Number(req.body.activa), id);
  } catch { throw new HttpError(409, 'Ya existe una bodega con ese nombre'); }
  auditar(req.user, 'editar', 'bodega', id, diferencias(b, { ...req.body, activa: req.body.activa === undefined ? undefined : Number(req.body.activa) }, ['nombre', 'direccion', 'activa']) || 'Sin cambios');
  res.json({ ok: true });
}));

// ---------- Rutas ----------
router.get('/rutas', (req, res) => {
  const rows = db.prepare('SELECT r.*, b.nombre AS bodega FROM rutas r JOIN bodegas b ON b.id=r.bodega_id ORDER BY r.nombre').all();
  const u = req.user;
  res.json(u.alcance === 'todo' ? rows : u.alcance === 'bodega' ? rows.filter((r) => r.bodega_id === u.bodega_id) : rows.filter((r) => r.id === u.ruta_id));
});
router.post('/rutas', soloAdmin, wrap((req, res) => {
  const nombre = req_(req.body.nombre, 'El nombre es obligatorio');
  const bodega = entero(req.body.bodega_id, 'Elige la bodega de la ruta');
  if (!getBodega(bodega)) throw new HttpError(400, 'La bodega no existe');
  let id;
  try { id = Number(db.prepare('INSERT INTO rutas (nombre,bodega_id) VALUES (?,?)').run(nombre, bodega).lastInsertRowid); }
  catch { throw new HttpError(409, 'Ya existe una ruta con ese nombre'); }
  auditar(req.user, 'crear', 'ruta', id, `${nombre} (bodega ${bodega})`);
  res.json({ id });
}));
router.put('/rutas/:id', soloAdmin, wrap((req, res) => {
  const id = entero(req.params.id);
  const rutaAntes = getRuta(id);
  if (!rutaAntes) throw new HttpError(404, 'Ruta no encontrada');
  if (req.body.bodega_id !== undefined && !getBodega(Number(req.body.bodega_id))) throw new HttpError(400, 'La bodega no existe');
  try {
    db.prepare('UPDATE rutas SET nombre=COALESCE(?,nombre), activa=COALESCE(?,activa), bodega_id=COALESCE(?,bodega_id) WHERE id=?')
      .run(n(req.body.nombre), req.body.activa === undefined ? null : Number(req.body.activa), n(req.body.bodega_id), id);
  } catch { throw new HttpError(409, 'Ya existe una ruta con ese nombre'); }
  auditar(req.user, 'editar', 'ruta', id, diferencias(rutaAntes, { ...req.body, activa: req.body.activa === undefined ? undefined : Number(req.body.activa) }, ['nombre', 'bodega_id', 'activa']) || 'Sin cambios');
  res.json({ ok: true });
}));

// ---------- Roles y permisos ----------
const rolDe = (clave) => db.prepare('SELECT * FROM roles WHERE clave=?').get(clave);
const formatoRol = (r) => ({ clave: r.clave, nombre: r.nombre, alcance: r.alcance, sistema: !!r.sistema,
  permisos: r.clave === 'admin' ? TODOS_LOS_PERMISOS : JSON.parse(r.permisos),
  usuarios: db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE rol=?').get(r.clave).n });
const ALCANCES = ['todo', 'bodega', 'ruta'];
function validarRol(b, actual) {
  const nombre = req_(b.nombre ?? actual?.nombre, 'El nombre del rol es obligatorio');
  const alcance = b.alcance ?? actual?.alcance;
  if (!ALCANCES.includes(alcance)) throw new HttpError(400, 'Alcance inválido: todo, bodega o ruta');
  const permisos = b.permisos ?? (actual ? JSON.parse(actual.permisos) : []);
  if (!Array.isArray(permisos) || permisos.some((p) => !TODOS_LOS_PERMISOS.includes(p))) throw new HttpError(400, 'Permiso inválido');
  return { nombre, alcance, permisos: [...new Set(permisos)] };
}
router.get('/permisos', soloAdmin, (_req, res) => res.json(PERMISOS.map(([clave, nombre, detalle]) => ({ clave, nombre, detalle }))));
router.get('/roles', soloAdmin, (_req, res) => res.json(db.prepare('SELECT * FROM roles ORDER BY sistema DESC, nombre').all().map(formatoRol)));
router.post('/roles', soloAdmin, wrap((req, res) => {
  const v = validarRol(req.body);
  const clave = String(req.body.clave || v.nombre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
  if (!clave) throw new HttpError(400, 'Nombre de rol inválido');
  if (rolDe(clave) || db.prepare('SELECT 1 FROM roles WHERE nombre=?').get(v.nombre)) throw new HttpError(409, 'Ya existe un rol con ese nombre');
  db.prepare('INSERT INTO roles (clave,nombre,alcance,permisos,sistema) VALUES (?,?,?,?,0)').run(clave, v.nombre, v.alcance, JSON.stringify(v.permisos));
  auditar(req.user, 'crear', 'rol', null, `${v.nombre} (${v.alcance}): ${v.permisos.join(', ') || 'sin permisos'}`);
  res.json({ clave });
}));
router.put('/roles/:clave', soloAdmin, wrap((req, res) => {
  const actual = rolDe(req.params.clave);
  if (!actual) throw new HttpError(404, 'Rol no encontrado');
  if (actual.clave === 'admin') throw new HttpError(409, 'El rol de administrador no se puede modificar: siempre tiene todos los permisos');
  const v = validarRol(req.body, actual);
  // el alcance de los roles base (encargado, vendedor) no cambia: los usuarios ya asignados dependen de su bodega o ruta
  if (actual.sistema && v.alcance !== actual.alcance) throw new HttpError(409, 'El alcance de un rol base no se puede cambiar. Crea un rol nuevo.');
  if (v.alcance !== actual.alcance && db.prepare('SELECT 1 FROM usuarios WHERE rol=?').get(actual.clave)) throw new HttpError(409, 'Hay usuarios con este rol: cámbiales el rol antes de modificar el alcance');
  if (db.prepare('SELECT 1 FROM roles WHERE nombre=? AND clave<>?').get(v.nombre, actual.clave)) throw new HttpError(409, 'Ya existe un rol con ese nombre');
  db.prepare('UPDATE roles SET nombre=?, alcance=?, permisos=? WHERE clave=?').run(v.nombre, v.alcance, JSON.stringify(v.permisos), actual.clave);
  auditar(req.user, 'editar', 'rol', null, `${v.nombre}: ${v.permisos.join(', ') || 'sin permisos'}`);
  res.json({ ok: true });
}));
router.delete('/roles/:clave', soloAdmin, wrap((req, res) => {
  const actual = rolDe(req.params.clave);
  if (!actual) throw new HttpError(404, 'Rol no encontrado');
  if (actual.sistema) throw new HttpError(409, 'Los roles base no se pueden eliminar');
  if (db.prepare('SELECT 1 FROM usuarios WHERE rol=?').get(actual.clave)) throw new HttpError(409, 'Hay usuarios con este rol: cámbiales el rol antes de eliminarlo');
  db.prepare('DELETE FROM roles WHERE clave=?').run(actual.clave);
  auditar(req.user, 'eliminar', 'rol', null, actual.nombre);
  res.json({ ok: true });
}));

// ---------- Usuarios ----------
// El rol define el alcance: 'ruta' necesita una ruta asignada, 'bodega' una bodega y 'todo' ninguna
function validarAsignacion(rol, ruta_id, bodega_id) {
  const r = rolDe(rol);
  if (!r) throw new HttpError(400, 'Rol inválido');
  if (r.alcance === 'ruta' && !(ruta_id && getRuta(Number(ruta_id)))) throw new HttpError(400, `El rol "${r.nombre}" necesita una ruta`);
  if (r.alcance === 'bodega' && !(bodega_id && getBodega(Number(bodega_id)))) throw new HttpError(400, `El rol "${r.nombre}" necesita una bodega`);
  return { ruta_id: r.alcance === 'ruta' ? Number(ruta_id) : null, bodega_id: r.alcance === 'bodega' ? Number(bodega_id) : null };
}
router.get('/usuarios', soloAdmin, (_req, res) => res.json(db.prepare(
  `SELECT u.id,u.nombre,u.usuario,u.rol,ro.nombre AS rol_nombre,ro.alcance,u.ruta_id,u.bodega_id,u.activo,r.nombre AS ruta,b.nombre AS bodega
   FROM usuarios u LEFT JOIN roles ro ON ro.clave=u.rol LEFT JOIN rutas r ON r.id=u.ruta_id LEFT JOIN bodegas b ON b.id=u.bodega_id ORDER BY u.nombre`).all()));
router.post('/usuarios', soloAdmin, wrap((req, res) => {
  const b = req.body;
  const usuario = String(req_(b.usuario, 'El usuario es obligatorio')).toLowerCase();
  if (String(b.clave || '').length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres');
  const a = validarAsignacion(b.rol, b.ruta_id, b.bodega_id);
  try {
    const id = db.prepare('INSERT INTO usuarios (nombre,usuario,clave_hash,rol,ruta_id,bodega_id) VALUES (?,?,?,?,?,?)')
      .run(req_(b.nombre, 'El nombre es obligatorio'), usuario, hashClave(b.clave), b.rol, a.ruta_id, a.bodega_id).lastInsertRowid;
    auditar(req.user, 'crear', 'usuario', Number(id), `${usuario} (${b.rol})`);
    res.json({ id: Number(id) });
  } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(409, 'Ese usuario ya existe'); }
}));
router.put('/usuarios/:id', soloAdmin, wrap((req, res) => {
  const b = req.body;
  const id = entero(req.params.id);
  const actual = db.prepare('SELECT * FROM usuarios WHERE id=?').get(id);
  if (!actual) throw new HttpError(404, 'Usuario no encontrado');
  const rol = b.rol ?? actual.rol;
  // al cambiar de rol se parte de lo que el rol nuevo necesita (otra ruta, otra bodega); si no cambia, se conserva lo asignado
  const a = validarAsignacion(rol, b.ruta_id ?? actual.ruta_id, b.bodega_id ?? actual.bodega_id);
  if (id === req.user.id && (rol !== 'admin' || b.activo === 0)) throw new HttpError(409, 'No puedes quitarte el rol de administrador ni desactivarte a ti mismo');
  // siempre debe quedar al menos un administrador activo
  if (actual.rol === 'admin' && (rol !== 'admin' || b.activo === 0) && !db.prepare("SELECT 1 FROM usuarios WHERE rol='admin' AND activo=1 AND id<>?").get(id))
    throw new HttpError(409, 'Debe quedar al menos un administrador activo');
  db.prepare('UPDATE usuarios SET nombre=COALESCE(?,nombre), rol=?, ruta_id=?, bodega_id=?, activo=COALESCE(?,activo) WHERE id=?')
    .run(n(b.nombre), rol, a.ruta_id, a.bodega_id, b.activo === undefined ? null : Number(b.activo), id);
  let detalle = diferencias(actual, { nombre: b.nombre, rol, ruta_id: a.ruta_id, bodega_id: a.bodega_id, activo: b.activo === undefined ? undefined : Number(b.activo) }, ['nombre', 'rol', 'ruta_id', 'bodega_id', 'activo']);
  if (b.clave) {
    if (String(b.clave).length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres');
    db.prepare('UPDATE usuarios SET clave_hash=? WHERE id=?').run(hashClave(b.clave), id); // sus sesiones abiertas dejan de valer
    detalle = [detalle, 'contraseña restablecida'].filter(Boolean).join(' · ');
  }
  auditar(req.user, 'editar', 'usuario', id, `${actual.usuario}: ${detalle || 'Sin cambios'}`);
  res.json({ ok: true });
}));

// ---------- Productos ----------
// ?punto=R3|B1 -> stock_punto es lo disponible para vender en ese punto (el vendedor siempre usa su ruta)
router.get('/productos', (req, res) => {
  const u = req.user;
  let ub = null;
  if (u.alcance === 'ruta') ub = u.ruta_id ? R(u.ruta_id) : null;
  else if (req.query.punto) { parseUb(req.query.punto); if (puedeUb(u, req.query.punto)) ub = req.query.punto; }
  const rows = db.prepare(`SELECT p.*, COALESCE(s.cantidad,0) AS stock_punto FROM productos p
    LEFT JOIN stock s ON s.producto_id=p.id AND s.ubicacion=? WHERE p.activo=1 OR ?=1 ORDER BY p.nombre`).all(ub ?? '-', req.query.todos && can(u, 'productos') ? 1 : 0);
  if (!can(u, 'ver_costos')) for (const p of rows) delete p.costo;
  const pres = presentacionesDe(rows.map((p) => p.id));
  for (const p of rows) p.presentaciones = pres.get(p.id) ?? [];
  res.json(rows);
});
function guardarProducto(req, id) {
  return tx(() => guardarProductoTx(req, id));
}
function guardarProductoTx(req, id) {
  const b = req.body;
  const nombre = req_(b.nombre, 'El nombre es obligatorio');
  const precio = num(b.precio ?? 0, 'Precio'), costo = num(b.costo ?? 0, 'Costo');
  if (precio < 0 || costo < 0) throw new HttpError(400, 'Precio y costo no pueden ser negativos');
  const minimo = num(b.stock_minimo ?? 0, 'Stock mínimo');
  const minimoCarro = num(b.minimo_carro ?? 0, 'Mínimo en carro');
  if (minimo < 0 || minimoCarro < 0) throw new HttpError(400, 'Los mínimos no pueden ser negativos');
  if (id) {
    const antes = db.prepare('SELECT * FROM productos WHERE id=?').get(id);
    if (!antes) throw new HttpError(404, 'Producto no encontrado');
    const nuevos = { codigo: n(b.codigo), nombre, unidad: b.unidad || 'und', precio, costo, stock_minimo: minimo, minimo_carro: minimoCarro, activo: b.activo === undefined ? undefined : Number(b.activo) };
    const cambios = diferencias(antes, nuevos, ['codigo', 'nombre', 'unidad', 'precio', 'costo', 'stock_minimo', 'minimo_carro', 'activo']);
    if (cambios) auditar(req.user, 'editar', 'producto', id, `${antes.nombre}: ${cambios}`);
    db.prepare('UPDATE productos SET codigo=?,nombre=?,unidad=?,precio=?,costo=?,stock_minimo=?,minimo_carro=?,activo=COALESCE(?,activo) WHERE id=?')
      .run(n(b.codigo), nombre, b.unidad || 'und', precio, costo, minimo, minimoCarro, b.activo === undefined ? null : Number(b.activo), id);
    guardarPresentaciones(id, b.presentaciones);
    return id;
  }
  const nuevo = Number(db.prepare('INSERT INTO productos (codigo,nombre,unidad,precio,costo,stock_minimo,minimo_carro) VALUES (?,?,?,?,?,?,?)')
    .run(n(b.codigo), nombre, b.unidad || 'und', precio, costo, minimo, minimoCarro).lastInsertRowid);
  guardarPresentaciones(nuevo, b.presentaciones);
  auditar(req.user, 'crear', 'producto', nuevo, `${nombre} · precio ${precio} · costo ${costo}`);
  return nuevo;
}
router.post('/productos', requierePermiso('productos'), wrap((req, res) => res.json({ id: guardarProducto(req) })));
router.put('/productos/:id', requierePermiso('productos'), wrap((req, res) => res.json({ id: guardarProducto(req, entero(req.params.id)) })));

// Edición en bloque: activa/desactiva, fija mínimos o ajusta precios de varios productos a la vez
router.post('/productos/masivo', requierePermiso('productos'), wrap((req, res) => {
  const { accion } = req.body;
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw new HttpError(400, 'Elige al menos un producto');
  if (ids.length > 2000) throw new HttpError(400, 'Máximo 2000 productos por vez');
  const valor = req.body.valor === undefined || req.body.valor === '' ? null : num(req.body.valor, 'Valor');
  const necesitaValor = ['minimo_bodega', 'minimo_carro', 'precio_porcentaje', 'precio_fijo', 'costo_fijo'];
  if (!['activar', 'desactivar', ...necesitaValor].includes(accion)) throw new HttpError(400, 'Acción inválida');
  if (necesitaValor.includes(accion) && valor === null) throw new HttpError(400, 'Escribe el valor');
  if (necesitaValor.includes(accion) && accion !== 'precio_porcentaje' && valor < 0) throw new HttpError(400, 'El valor no puede ser negativo');
  const sql = {
    activar: ['UPDATE productos SET activo=1 WHERE id=?'], desactivar: ['UPDATE productos SET activo=0 WHERE id=?'],
    minimo_bodega: ['UPDATE productos SET stock_minimo=? WHERE id=?', valor], minimo_carro: ['UPDATE productos SET minimo_carro=? WHERE id=?', valor],
    precio_fijo: ['UPDATE productos SET precio=? WHERE id=?', valor], costo_fijo: ['UPDATE productos SET costo=? WHERE id=?', valor],
    precio_porcentaje: ['UPDATE productos SET precio=MAX(0, ROUND(precio*?)) WHERE id=?', 1 + (valor ?? 0) / 100],
  }[accion];
  let cambiados = 0;
  tx(() => { for (const id of ids) cambiados += Number(db.prepare(sql[0]).run(...(sql.length > 1 ? [sql[1]] : []), id).changes); });
  auditar(req.user, 'editar', 'producto', null, `En bloque (${cambiados} productos): ${accion}${valor !== null ? ` ${valor}` : ''}`);
  res.json({ cambiados });
}));
// Desactiva de una vez los conceptos contables (cuentas por cobrar, gastos bancarios…) que se hayan colado como productos
router.post('/productos/quitar-conceptos', requierePermiso('productos'), wrap((_req, res) => {
  let n_ = 0;
  tx(() => {
    for (const p of db.prepare('SELECT id, nombre FROM productos WHERE activo=1').all()) {
      if (esConcepto(p.nombre)) { db.prepare('UPDATE productos SET activo=0 WHERE id=?').run(p.id); n_ += 1; }
    }
  });
  res.json({ desactivados: n_ });
}));

// ---------- Proveedores ----------
router.get('/proveedores', (req, res) => {
  if (!can(req.user, 'compras') && !can(req.user, 'pagar_proveedores')) throw new HttpError(403, 'No tienes permiso para esto');
  const rows = db.prepare(`SELECT pr.*, COALESCE((SELECT SUM(total-pagado) FROM compras c WHERE c.proveedor_id=pr.id AND c.anulada=0),0) AS deuda
    FROM proveedores pr WHERE activo=1 ORDER BY nombre`).all();
  if (!can(req.user, 'pagar_proveedores')) for (const p of rows) delete p.deuda;
  res.json(rows);
});
router.post('/proveedores', wrap((req, res) => {
  if (!can(req.user, 'compras')) throw new HttpError(403, 'No tienes permiso para esto');
  res.json({ id: Number(db.prepare('INSERT INTO proveedores (nombre,telefono,nota) VALUES (?,?,?)')
    .run(req_(req.body.nombre, 'El nombre es obligatorio'), n(req.body.telefono), n(req.body.nota)).lastInsertRowid) });
}));
router.put('/proveedores/:id', requierePermiso('compras'), wrap((req, res) => {
  db.prepare('UPDATE proveedores SET nombre=?,telefono=?,nota=?,activo=COALESCE(?,activo) WHERE id=?')
    .run(req_(req.body.nombre, 'El nombre es obligatorio'), n(req.body.telefono), n(req.body.nota), n(req.body.activo), req.params.id);
  res.json({ ok: true });
}));

export default router;
