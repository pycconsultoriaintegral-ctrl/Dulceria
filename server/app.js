import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, tx, ahora, HttpError, moverStock, getStock, getConfig } from './db.js';
import { requireAuth, soloAdmin, firmar, hashClave, verificarClave } from './auth.js';
import { remisionPdf } from './pdf.js';

const wrap = (fn) => (req, res, next) => { try { Promise.resolve(fn(req, res)).catch(next); } catch (e) { next(e); } };
const n = (v) => (v === undefined || v === '' ? null : v);
const num = (v, campo = 'valor') => {
  const x = Number(v);
  if (!Number.isFinite(x)) throw new HttpError(400, `${campo} inválido`);
  return x;
};
const req_ = (v, msg) => { if (v === undefined || v === null || String(v).trim() === '') throw new HttpError(400, msg); return typeof v === 'string' ? v.trim() : v; };
const r2 = (x) => Math.round(x * 100) / 100;

export function crearApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  const api = express.Router();
  app.use('/api', api);

  // ---------- Auth ----------
  api.post('/auth/login', wrap((req, res) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE usuario=? AND activo=1').get(String(req.body.usuario || '').trim().toLowerCase());
    if (!u || !verificarClave(String(req.body.clave || ''), u.clave_hash)) throw new HttpError(401, 'Usuario o contraseña incorrectos');
    res.json({ token: firmar(u), user: { id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol, ruta_id: u.ruta_id } });
  }));
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use(requireAuth);
  api.get('/auth/me', (req, res) => res.json(req.user));
  api.post('/auth/clave', wrap((req, res) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id=?').get(req.user.id);
    if (!verificarClave(String(req.body.actual || ''), u.clave_hash)) throw new HttpError(400, 'La contraseña actual no coincide');
    const nueva = String(req.body.nueva || '');
    if (nueva.length < 6) throw new HttpError(400, 'La nueva contraseña debe tener al menos 6 caracteres');
    db.prepare('UPDATE usuarios SET clave_hash=? WHERE id=?').run(hashClave(nueva), u.id);
    res.json({ ok: true });
  }));

  // Ruta sobre la que opera la petición: el vendedor siempre la suya; el admin la que indique (0 = bodega)
  const rutaDe = (req, valor) => {
    if (req.user.rol === 'vendedor') {
      if (!req.user.ruta_id) throw new HttpError(400, 'Tu usuario no tiene ruta asignada. Pide al administrador que la asigne.');
      return req.user.ruta_id;
    }
    return valor === undefined || valor === null || valor === '' ? 0 : Number(valor);
  };

  // ---------- Configuración ----------
  api.get('/config', (_req, res) => { const c = getConfig(); delete c.jwt_secret; res.json(c); });
  api.put('/config', soloAdmin, wrap((req, res) => {
    for (const k of ['negocio', 'nit', 'telefono', 'direccion', 'pie_remision', 'prefijo']) {
      if (req.body[k] !== undefined) db.prepare('INSERT INTO config (clave,valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor').run(k, String(req.body[k]));
    }
    res.json(getConfig());
  }));

  // ---------- Rutas y usuarios ----------
  api.get('/rutas', (_req, res) => res.json(db.prepare('SELECT * FROM rutas ORDER BY nombre').all()));
  api.post('/rutas', soloAdmin, wrap((req, res) => {
    const nombre = req_(req.body.nombre, 'El nombre es obligatorio');
    try { res.json({ id: Number(db.prepare('INSERT INTO rutas (nombre) VALUES (?)').run(nombre).lastInsertRowid) }); }
    catch { throw new HttpError(409, 'Ya existe una ruta con ese nombre'); }
  }));
  api.put('/rutas/:id', soloAdmin, wrap((req, res) => {
    db.prepare('UPDATE rutas SET nombre=COALESCE(?,nombre), activa=COALESCE(?,activa) WHERE id=?').run(n(req.body.nombre), n(req.body.activa), req.params.id);
    res.json({ ok: true });
  }));

  api.get('/usuarios', soloAdmin, (_req, res) => res.json(db.prepare(
    'SELECT u.id,u.nombre,u.usuario,u.rol,u.ruta_id,u.activo,r.nombre AS ruta FROM usuarios u LEFT JOIN rutas r ON r.id=u.ruta_id ORDER BY u.nombre').all()));
  api.post('/usuarios', soloAdmin, wrap((req, res) => {
    const b = req.body;
    const usuario = String(req_(b.usuario, 'El usuario es obligatorio')).toLowerCase();
    if (String(b.clave || '').length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres');
    if (!['admin', 'vendedor'].includes(b.rol)) throw new HttpError(400, 'Rol inválido');
    if (b.rol === 'vendedor' && !b.ruta_id) throw new HttpError(400, 'El vendedor necesita una ruta');
    try {
      const id = db.prepare('INSERT INTO usuarios (nombre,usuario,clave_hash,rol,ruta_id) VALUES (?,?,?,?,?)')
        .run(req_(b.nombre, 'El nombre es obligatorio'), usuario, hashClave(b.clave), b.rol, n(b.ruta_id)).lastInsertRowid;
      res.json({ id: Number(id) });
    } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(409, 'Ese usuario ya existe'); }
  }));
  api.put('/usuarios/:id', soloAdmin, wrap((req, res) => {
    const b = req.body;
    db.prepare('UPDATE usuarios SET nombre=COALESCE(?,nombre), rol=COALESCE(?,rol), ruta_id=?, activo=COALESCE(?,activo) WHERE id=?')
      .run(n(b.nombre), n(b.rol), n(b.ruta_id), n(b.activo), req.params.id);
    if (b.clave) {
      if (String(b.clave).length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres');
      db.prepare('UPDATE usuarios SET clave_hash=? WHERE id=?').run(hashClave(b.clave), req.params.id);
    }
    res.json({ ok: true });
  }));

  // ---------- Productos ----------
  api.get('/productos', (req, res) => {
    const ruta = req.user.rol === 'vendedor' ? req.user.ruta_id : Number(req.query.ruta_id ?? 0);
    const rows = db.prepare(`SELECT p.*, COALESCE(sb.cantidad,0) AS stock_bodega, COALESCE(sr.cantidad,0) AS stock_ruta
      FROM productos p LEFT JOIN stock sb ON sb.producto_id=p.id AND sb.ubicacion=0
      LEFT JOIN stock sr ON sr.producto_id=p.id AND sr.ubicacion=?
      WHERE p.activo=1 OR ?=1 ORDER BY p.nombre`).all(ruta ?? -1, req.query.todos ? 1 : 0);
    if (req.user.rol === 'vendedor') for (const p of rows) { delete p.costo; delete p.stock_bodega; }
    res.json(rows);
  });
  const guardarProducto = (req, id) => {
    const b = req.body;
    const nombre = req_(b.nombre, 'El nombre es obligatorio');
    const precio = num(b.precio ?? 0, 'Precio'), costo = num(b.costo ?? 0, 'Costo');
    if (precio < 0 || costo < 0) throw new HttpError(400, 'Precio y costo no pueden ser negativos');
    if (id) {
      db.prepare('UPDATE productos SET codigo=?,nombre=?,unidad=?,precio=?,costo=?,stock_minimo=?,activo=COALESCE(?,activo) WHERE id=?')
        .run(n(b.codigo), nombre, b.unidad || 'und', precio, costo, num(b.stock_minimo ?? 0, 'Stock mínimo'), n(b.activo), id);
      return id;
    }
    return Number(db.prepare('INSERT INTO productos (codigo,nombre,unidad,precio,costo,stock_minimo) VALUES (?,?,?,?,?,?)')
      .run(n(b.codigo), nombre, b.unidad || 'und', precio, costo, num(b.stock_minimo ?? 0, 'Stock mínimo')).lastInsertRowid);
  };
  api.post('/productos', soloAdmin, wrap((req, res) => res.json({ id: guardarProducto(req) })));
  api.put('/productos/:id', soloAdmin, wrap((req, res) => res.json({ id: guardarProducto(req, Number(req.params.id)) })));

  // ---------- Proveedores y compras ----------
  api.get('/proveedores', soloAdmin, (_req, res) => res.json(db.prepare(`SELECT pr.*, COALESCE((SELECT SUM(total-pagado) FROM compras c WHERE c.proveedor_id=pr.id AND c.anulada=0),0) AS deuda
    FROM proveedores pr WHERE activo=1 ORDER BY nombre`).all()));
  api.post('/proveedores', soloAdmin, wrap((req, res) => res.json({ id: Number(db.prepare('INSERT INTO proveedores (nombre,telefono,nota) VALUES (?,?,?)')
    .run(req_(req.body.nombre, 'El nombre es obligatorio'), n(req.body.telefono), n(req.body.nota)).lastInsertRowid) })));
  api.put('/proveedores/:id', soloAdmin, wrap((req, res) => {
    db.prepare('UPDATE proveedores SET nombre=?,telefono=?,nota=?,activo=COALESCE(?,activo) WHERE id=?')
      .run(req_(req.body.nombre, 'El nombre es obligatorio'), n(req.body.telefono), n(req.body.nota), n(req.body.activo), req.params.id);
    res.json({ ok: true });
  }));

  api.get('/compras', soloAdmin, (req, res) => {
    const rows = db.prepare(`SELECT c.*, pr.nombre AS proveedor FROM compras c LEFT JOIN proveedores pr ON pr.id=c.proveedor_id
      WHERE substr(c.fecha,1,10) BETWEEN ? AND ? ORDER BY c.id DESC LIMIT 300`).all(req.query.desde || '0000-01-01', req.query.hasta || '9999-12-31');
    res.json(rows);
  });
  api.get('/compras/:id', soloAdmin, wrap((req, res) => {
    const c = db.prepare('SELECT c.*, pr.nombre AS proveedor FROM compras c LEFT JOIN proveedores pr ON pr.id=c.proveedor_id WHERE c.id=?').get(req.params.id);
    if (!c) throw new HttpError(404, 'Compra no encontrada');
    c.items = db.prepare('SELECT ci.*, p.nombre FROM compra_items ci JOIN productos p ON p.id=ci.producto_id WHERE compra_id=?').all(c.id);
    res.json(c);
  }));
  api.post('/compras', soloAdmin, wrap((req, res) => {
    const b = req.body;
    if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'Agrega al menos un producto');
    const id = tx(() => {
      let total = 0;
      const items = b.items.map((i) => {
        const cantidad = num(i.cantidad, 'Cantidad'), costo = num(i.costo, 'Costo');
        if (cantidad <= 0 || costo < 0) throw new HttpError(400, 'Cantidad y costo deben ser válidos');
        total += cantidad * costo;
        return { producto_id: Number(i.producto_id), cantidad, costo };
      });
      total = r2(total);
      const pagado = b.pagado === undefined || b.pagado === '' ? total : num(b.pagado, 'Pagado');
      if (pagado < 0 || pagado > total + 0.001) throw new HttpError(400, 'El valor pagado no puede superar el total');
      const cid = Number(db.prepare('INSERT INTO compras (fecha,proveedor_id,factura,total,pagado,nota,usuario_id) VALUES (?,?,?,?,?,?,?)')
        .run(ahora(), n(b.proveedor_id), n(b.factura), total, pagado, n(b.nota), req.user.id).lastInsertRowid);
      for (const i of items) {
        const p = db.prepare('SELECT id, costo FROM productos WHERE id=?').get(i.producto_id);
        if (!p) throw new HttpError(400, 'Producto no existe');
        // costo promedio ponderado con el stock total actual
        const existente = db.prepare('SELECT COALESCE(SUM(cantidad),0) AS q FROM stock WHERE producto_id=?').get(p.id).q;
        const nuevoCosto = existente > 0 ? r2((existente * p.costo + i.cantidad * i.costo) / (existente + i.cantidad)) : i.costo;
        db.prepare('UPDATE productos SET costo=? WHERE id=?').run(nuevoCosto, p.id);
        db.prepare('INSERT INTO compra_items (compra_id,producto_id,cantidad,costo) VALUES (?,?,?,?)').run(cid, p.id, i.cantidad, i.costo);
        moverStock({ productoId: p.id, ubicacion: 0, delta: i.cantidad, tipo: 'compra', costo: i.costo, referencia: `C-${cid}`, usuarioId: req.user.id });
      }
      return cid;
    });
    res.json({ id });
  }));
  api.post('/compras/:id/anular', soloAdmin, wrap((req, res) => {
    tx(() => {
      const c = db.prepare('SELECT * FROM compras WHERE id=?').get(req.params.id);
      if (!c) throw new HttpError(404, 'Compra no encontrada');
      if (c.anulada) throw new HttpError(409, 'La compra ya está anulada');
      for (const i of db.prepare('SELECT * FROM compra_items WHERE compra_id=?').all(c.id))
        moverStock({ productoId: i.producto_id, ubicacion: 0, delta: -i.cantidad, tipo: 'anulacion_compra', costo: i.costo, referencia: `C-${c.id}`, usuarioId: req.user.id });
      db.prepare('UPDATE compras SET anulada=1 WHERE id=?').run(c.id);
    });
    res.json({ ok: true });
  }));
  api.post('/compras/:id/pago', soloAdmin, wrap((req, res) => {
    const c = db.prepare('SELECT * FROM compras WHERE id=? AND anulada=0').get(req.params.id);
    if (!c) throw new HttpError(404, 'Compra no encontrada');
    const v = num(req.body.valor);
    if (v <= 0 || v > c.total - c.pagado + 0.001) throw new HttpError(400, 'Valor inválido: excede la deuda');
    db.prepare('UPDATE compras SET pagado=pagado+? WHERE id=?').run(v, c.id);
    res.json({ ok: true });
  }));

  // ---------- Inventario ----------
  api.get('/inventario', (req, res) => {
    const rutas = db.prepare('SELECT id, nombre FROM rutas WHERE activa=1 ORDER BY nombre').all()
      .filter((r) => req.user.rol === 'admin' || r.id === req.user.ruta_id);
    const prods = db.prepare('SELECT id,codigo,nombre,unidad,costo,stock_minimo FROM productos WHERE activo=1 ORDER BY nombre').all();
    const st = new Map(db.prepare('SELECT producto_id, ubicacion, cantidad FROM stock').all().map((s) => [`${s.producto_id}:${s.ubicacion}`, s.cantidad]));
    const out = prods.map((p) => {
      const porRuta = {};
      for (const r of rutas) porRuta[r.id] = st.get(`${p.id}:${r.id}`) ?? 0;
      const bodega = st.get(`${p.id}:0`) ?? 0;
      const row = { ...p, bodega, rutas: porRuta };
      if (req.user.rol !== 'admin') { delete row.costo; delete row.bodega; }
      return row;
    });
    res.json({ rutas, productos: out });
  });

  // Cargue: bodega -> ruta. Devolución: ruta -> bodega.
  api.post('/inventario/traslado', soloAdmin, wrap((req, res) => {
    const { ruta_id, sentido, items } = req.body;
    if (!['cargue', 'devolucion'].includes(sentido)) throw new HttpError(400, 'Sentido inválido');
    if (!ruta_id || !db.prepare('SELECT 1 FROM rutas WHERE id=?').get(ruta_id)) throw new HttpError(400, 'Ruta inválida');
    if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Agrega al menos un producto');
    tx(() => {
      const ref = `${sentido === 'cargue' ? 'CG' : 'DV'}-${ruta_id}-${ahora().slice(0, 10)}`;
      for (const i of items) {
        const q = num(i.cantidad, 'Cantidad');
        if (q <= 0) continue;
        const sign = sentido === 'cargue' ? 1 : -1;
        moverStock({ productoId: i.producto_id, ubicacion: 0, delta: -q * sign, tipo: sentido, referencia: ref, usuarioId: req.user.id });
        moverStock({ productoId: i.producto_id, ubicacion: ruta_id, delta: q * sign, tipo: sentido, referencia: ref, usuarioId: req.user.id });
      }
    });
    res.json({ ok: true });
  }));
  api.post('/inventario/ajuste', soloAdmin, wrap((req, res) => {
    const { producto_id, ubicacion = 0, cantidad_real, nota } = req.body;
    const real = num(cantidad_real, 'Cantidad real');
    if (real < 0) throw new HttpError(400, 'La cantidad no puede ser negativa');
    tx(() => {
      const delta = real - getStock(producto_id, ubicacion);
      if (delta !== 0) moverStock({ productoId: producto_id, ubicacion, delta, tipo: 'ajuste', referencia: 'AJ', usuarioId: req.user.id, nota: n(nota) });
    });
    res.json({ ok: true });
  }));
  api.get('/inventario/kardex/:productoId', soloAdmin, (req, res) => res.json(db.prepare(
    `SELECT m.*, u.nombre AS usuario FROM movimientos m LEFT JOIN usuarios u ON u.id=m.usuario_id
     WHERE producto_id=? ORDER BY m.id DESC LIMIT 200`).all(req.params.productoId)));

  // ---------- Clientes ----------
  const saldoSQL = `COALESCE((SELECT SUM(r.total-r.pagado) FROM remisiones r WHERE r.cliente_id=c.id AND r.anulada=0),0)`;
  api.get('/clientes', (req, res) => {
    const rows = req.user.rol === 'vendedor'
      ? db.prepare(`SELECT c.*, ${saldoSQL} AS saldo FROM clientes c WHERE c.activo=1 AND (c.ruta_id=? OR c.ruta_id IS NULL) ORDER BY c.nombre`).all(req.user.ruta_id)
      : db.prepare(`SELECT c.*, ru.nombre AS ruta, ${saldoSQL} AS saldo FROM clientes c LEFT JOIN rutas ru ON ru.id=c.ruta_id WHERE c.activo=1 ORDER BY c.nombre`).all();
    res.json(rows);
  });
  const puedeVerCliente = (req, c) => {
    if (!c) throw new HttpError(404, 'Cliente no encontrado');
    if (req.user.rol === 'vendedor' && c.ruta_id && c.ruta_id !== req.user.ruta_id) throw new HttpError(403, 'Ese cliente es de otra ruta');
  };
  api.get('/clientes/:id', wrap((req, res) => {
    const c = db.prepare(`SELECT c.*, ${saldoSQL} AS saldo FROM clientes c WHERE c.id=?`).get(req.params.id);
    puedeVerCliente(req, c);
    c.remisiones = db.prepare('SELECT id,consecutivo,fecha,total,pagado,tipo_pago,anulada FROM remisiones WHERE cliente_id=? ORDER BY id DESC LIMIT 50').all(c.id);
    c.pagos = db.prepare('SELECT id,fecha,valor,metodo,remision_id,anulado FROM pagos WHERE cliente_id=? AND remision_id IS NOT NULL ORDER BY id DESC LIMIT 50').all(c.id);
    res.json(c);
  }));
  api.post('/clientes', wrap((req, res) => {
    const b = req.body;
    const ruta = req.user.rol === 'vendedor' ? req.user.ruta_id : n(b.ruta_id);
    const id = db.prepare('INSERT INTO clientes (nombre,negocio,telefono,direccion,documento,ruta_id) VALUES (?,?,?,?,?,?)')
      .run(req_(b.nombre, 'El nombre es obligatorio'), n(b.negocio), n(b.telefono), n(b.direccion), n(b.documento), ruta).lastInsertRowid;
    res.json({ id: Number(id) });
  }));
  api.put('/clientes/:id', wrap((req, res) => {
    const b = req.body;
    puedeVerCliente(req, db.prepare('SELECT * FROM clientes WHERE id=?').get(req.params.id));
    const ruta = req.user.rol === 'vendedor' ? req.user.ruta_id : n(b.ruta_id);
    db.prepare('UPDATE clientes SET nombre=?,negocio=?,telefono=?,direccion=?,documento=?,ruta_id=?,activo=COALESCE(?,activo) WHERE id=?')
      .run(req_(b.nombre, 'El nombre es obligatorio'), n(b.negocio), n(b.telefono), n(b.direccion), n(b.documento), ruta, req.user.rol === 'admin' ? n(b.activo) : null, req.params.id);
    res.json({ ok: true });
  }));

  // ---------- Remisiones (ventas) ----------
  api.post('/remisiones', wrap((req, res) => {
    const b = req.body;
    if (b.uuid) {
      const ya = db.prepare('SELECT id, consecutivo FROM remisiones WHERE uuid=?').get(b.uuid);
      if (ya) return res.json({ ...ya, repetida: true });
    }
    if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'Agrega al menos un producto');
    const ruta = rutaDe(req, b.ruta_id);
    const out = tx(() => {
      const cli = db.prepare('SELECT * FROM clientes WHERE id=? AND activo=1').get(b.cliente_id);
      puedeVerCliente(req, cli);
      let subtotal = 0;
      const items = b.items.map((i) => {
        const p = db.prepare('SELECT * FROM productos WHERE id=? AND activo=1').get(i.producto_id);
        if (!p) throw new HttpError(400, 'Producto no disponible');
        const cantidad = num(i.cantidad, 'Cantidad');
        if (cantidad <= 0) throw new HttpError(400, 'La cantidad debe ser mayor a cero');
        // el vendedor puede negociar el precio hacia abajo o arriba; queda registrado en la remisión
        const precio = i.precio === undefined ? p.precio : num(i.precio, 'Precio');
        if (precio < 0) throw new HttpError(400, 'Precio inválido');
        subtotal += cantidad * precio;
        return { p, cantidad, precio };
      });
      subtotal = r2(subtotal);
      const descuento = r2(num(b.descuento ?? 0, 'Descuento'));
      if (descuento < 0 || descuento > subtotal) throw new HttpError(400, 'Descuento inválido');
      const total = r2(subtotal - descuento);
      if (!['contado', 'credito'].includes(b.tipo_pago)) throw new HttpError(400, 'Tipo de pago inválido');
      const pagado = b.tipo_pago === 'contado' ? total : r2(num(b.abono ?? 0, 'Abono'));
      if (pagado < 0 || pagado > total + 0.001) throw new HttpError(400, 'El abono no puede superar el total');
      const cons = (db.prepare('SELECT MAX(consecutivo) AS m FROM remisiones').get().m ?? 0) + 1;
      const fecha = ahora();
      const id = Number(db.prepare(`INSERT INTO remisiones (uuid,consecutivo,fecha,cliente_id,ruta_id,usuario_id,tipo_pago,subtotal,descuento,total,pagado,nota)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(n(b.uuid), cons, fecha, cli.id, ruta, req.user.id, b.tipo_pago, subtotal, descuento, total, pagado, n(b.nota)).lastInsertRowid);
      for (const i of items) {
        db.prepare('INSERT INTO remision_items (remision_id,producto_id,descripcion,cantidad,precio,costo) VALUES (?,?,?,?,?,?)')
          .run(id, i.p.id, i.p.nombre, i.cantidad, i.precio, i.p.costo);
        moverStock({ productoId: i.p.id, ubicacion: ruta, delta: -i.cantidad, tipo: 'venta', costo: i.p.costo, referencia: `R-${cons}`, usuarioId: req.user.id });
      }
      if (pagado > 0) db.prepare('INSERT INTO pagos (fecha,cliente_id,remision_id,ruta_id,usuario_id,valor,metodo) VALUES (?,?,?,?,?,?,?)')
        .run(fecha, cli.id, id, ruta, req.user.id, pagado, b.metodo || 'efectivo');
      return { id, consecutivo: cons, total };
    });
    res.json(out);
  }));

  api.get('/remisiones', (req, res) => {
    const q = req.query;
    const cond = ['substr(r.fecha,1,10) BETWEEN @desde AND @hasta'];
    const p = { desde: q.desde || '0000-01-01', hasta: q.hasta || '9999-12-31' };
    if (req.user.rol === 'vendedor') { cond.push('r.ruta_id=@ruta'); p.ruta = req.user.ruta_id; }
    else if (q.ruta_id) { cond.push('r.ruta_id=@ruta'); p.ruta = Number(q.ruta_id); }
    if (q.cliente_id) { cond.push('r.cliente_id=@cli'); p.cli = Number(q.cliente_id); }
    res.json(db.prepare(`SELECT r.*, c.nombre AS cliente, c.negocio, u.nombre AS vendedor FROM remisiones r
      JOIN clientes c ON c.id=r.cliente_id JOIN usuarios u ON u.id=r.usuario_id
      WHERE ${cond.join(' AND ')} ORDER BY r.id DESC LIMIT 300`).all(p));
  });
  const cargarRemision = (req, id) => {
    const r = db.prepare(`SELECT r.*, c.nombre AS cliente, c.negocio, c.telefono, c.direccion AS cliente_direccion, c.documento AS cliente_documento,
      u.nombre AS vendedor, ru.nombre AS ruta FROM remisiones r JOIN clientes c ON c.id=r.cliente_id JOIN usuarios u ON u.id=r.usuario_id
      LEFT JOIN rutas ru ON ru.id=r.ruta_id WHERE r.id=?`).get(id);
    if (!r) throw new HttpError(404, 'Remisión no encontrada');
    if (req.user.rol === 'vendedor' && r.ruta_id !== req.user.ruta_id) throw new HttpError(403, 'No puedes ver remisiones de otra ruta');
    r.items = db.prepare('SELECT * FROM remision_items WHERE remision_id=?').all(id);
    r.saldo = r.anulada ? 0 : r2(r.total - r.pagado);
    // saldo total del cliente para mostrarlo en el documento
    r.saldo_cliente = db.prepare('SELECT COALESCE(SUM(total-pagado),0) AS s FROM remisiones WHERE cliente_id=? AND anulada=0').get(r.cliente_id).s;
    if (req.user.rol === 'vendedor') for (const i of r.items) delete i.costo;
    return r;
  };
  api.get('/remisiones/:id', wrap((req, res) => res.json(cargarRemision(req, req.params.id))));
  api.get('/remisiones/:id/pdf', wrap((req, res) => {
    const r = cargarRemision(req, req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="remision-${r.consecutivo}.pdf"`);
    remisionPdf(r, getConfig()).pipe(res);
  }));
  api.post('/remisiones/:id/anular', wrap((req, res) => {
    tx(() => {
      const r = cargarRemision(req, req.params.id);
      if (r.anulada) throw new HttpError(409, 'La remisión ya está anulada');
      if (req.user.rol === 'vendedor' && (r.usuario_id !== req.user.id || r.fecha.slice(0, 10) !== ahora().slice(0, 10)))
        throw new HttpError(403, 'Solo puedes anular tus remisiones del día. Pide ayuda al administrador.');
      const motivo = req_(req.body.motivo, 'Indica el motivo de la anulación');
      for (const i of db.prepare('SELECT * FROM remision_items WHERE remision_id=?').all(r.id))
        moverStock({ productoId: i.producto_id, ubicacion: r.ruta_id, delta: i.cantidad, tipo: 'anulacion_venta', costo: i.costo, referencia: `R-${r.consecutivo}`, usuarioId: req.user.id, permitirNegativo: true });
      db.prepare('UPDATE remisiones SET anulada=1, motivo_anulacion=? WHERE id=?').run(motivo, r.id);
      db.prepare('UPDATE pagos SET anulado=1 WHERE remision_id=?').run(r.id);
    });
    res.json({ ok: true });
  }));

  // ---------- Cartera y abonos ----------
  api.get('/cartera', (req, res) => {
    const soloRuta = req.user.rol === 'vendedor' ? req.user.ruta_id : (req.query.ruta_id ? Number(req.query.ruta_id) : null);
    const rows = db.prepare(`SELECT c.id, c.nombre, c.negocio, c.telefono, c.ruta_id, SUM(r.total-r.pagado) AS saldo,
      MIN(r.fecha) AS mas_antigua FROM clientes c JOIN remisiones r ON r.cliente_id=c.id AND r.anulada=0
      WHERE (@ruta IS NULL OR c.ruta_id=@ruta OR r.ruta_id=@ruta) GROUP BY c.id HAVING saldo > 0.005 ORDER BY saldo DESC`).all({ ruta: soloRuta });
    res.json({ total: r2(rows.reduce((a, x) => a + x.saldo, 0)), clientes: rows });
  });

  // Abono a cliente: se aplica a las remisiones a crédito más antiguas
  api.post('/pagos', wrap((req, res) => {
    const b = req.body;
    if (b.uuid) {
      const ya = db.prepare('SELECT 1 FROM pagos WHERE uuid=? OR uuid LIKE ?').get(b.uuid, `${b.uuid}:%`);
      if (ya) return res.json({ ok: true, repetido: true });
    }
    const valor = num(b.valor);
    if (valor <= 0) throw new HttpError(400, 'El valor debe ser mayor a cero');
    const ruta = rutaDe(req, b.ruta_id);
    const aplicado = tx(() => {
      const cli = db.prepare('SELECT * FROM clientes WHERE id=?').get(b.cliente_id);
      puedeVerCliente(req, cli);
      const pend = db.prepare(`SELECT id, total-pagado AS deuda FROM remisiones WHERE cliente_id=? AND anulada=0 AND total-pagado>0.005 ORDER BY id`).all(cli.id);
      const deudaTotal = pend.reduce((a, x) => a + x.deuda, 0);
      if (valor > deudaTotal + 0.005) throw new HttpError(400, `El abono ($${valor}) supera la deuda del cliente ($${r2(deudaTotal)})`);
      let resto = valor, k = 0;
      const fecha = ahora();
      for (const r of pend) {
        if (resto <= 0.005) break;
        const parte = r2(Math.min(resto, r.deuda));
        db.prepare('UPDATE remisiones SET pagado=pagado+? WHERE id=?').run(parte, r.id);
        db.prepare('INSERT INTO pagos (uuid,fecha,cliente_id,remision_id,ruta_id,usuario_id,valor,metodo,nota) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(b.uuid ? `${b.uuid}:${k++}` : null, fecha, cli.id, r.id, ruta, req.user.id, parte, b.metodo || 'efectivo', n(b.nota));
        resto = r2(resto - parte);
      }
      return valor;
    });
    res.json({ ok: true, aplicado });
  }));

  // ---------- Gastos de ruta ----------
  api.post('/gastos', wrap((req, res) => {
    const ruta = rutaDe(req, req.body.ruta_id);
    const valor = num(req.body.valor);
    if (valor <= 0) throw new HttpError(400, 'El valor debe ser mayor a cero');
    const id = db.prepare('INSERT INTO gastos (fecha,ruta_id,usuario_id,concepto,valor) VALUES (?,?,?,?,?)')
      .run(ahora(), ruta, req.user.id, req_(req.body.concepto, 'Indica el concepto'), valor).lastInsertRowid;
    res.json({ id: Number(id) });
  }));

  // ---------- Cierre diario por ruta ----------
  const calcularCierre = (fecha, ruta) => {
    const ventas = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total, COALESCE(SUM(CASE WHEN tipo_pago='contado' THEN total ELSE 0 END),0) AS contado,
      COALESCE(SUM(CASE WHEN tipo_pago='credito' THEN total ELSE 0 END),0) AS credito
      FROM remisiones WHERE anulada=0 AND ruta_id=? AND substr(fecha,1,10)=?`).get(ruta, fecha);
    // Todo el dinero recibido ese día, ventas de contado + abonos + abonos iniciales
    const cobrado = db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM pagos WHERE anulado=0 AND ruta_id=? AND substr(fecha,1,10)=?`).get(ruta, fecha).v;
    const abonos = db.prepare(`SELECT COALESCE(SUM(p.valor),0) AS v FROM pagos p JOIN remisiones r ON r.id=p.remision_id
      WHERE p.anulado=0 AND p.ruta_id=? AND substr(p.fecha,1,10)=? AND substr(r.fecha,1,10)<>?`).get(ruta, fecha, fecha).v;
    const gastos = db.prepare('SELECT COALESCE(SUM(valor),0) AS v FROM gastos WHERE ruta_id=? AND substr(fecha,1,10)=?').get(ruta, fecha).v;
    const lista_gastos = db.prepare('SELECT id, concepto, valor FROM gastos WHERE ruta_id=? AND substr(fecha,1,10)=?').all(ruta, fecha);
    const inventario = db.prepare(`SELECT p.nombre, s.cantidad FROM stock s JOIN productos p ON p.id=s.producto_id WHERE s.ubicacion=? AND s.cantidad<>0 ORDER BY p.nombre`).all(ruta);
    const guardado = db.prepare('SELECT * FROM cierres WHERE fecha=? AND ruta_id=?').get(fecha, ruta);
    return {
      fecha, ruta_id: ruta, remisiones: ventas.n, ventas_total: r2(ventas.total), ventas_contado: r2(ventas.contado), ventas_credito: r2(ventas.credito),
      cobrado: r2(cobrado), abonos: r2(abonos), gastos: r2(gastos), lista_gastos, esperado: r2(cobrado - gastos), inventario, cierre: guardado ?? null,
    };
  };
  api.get('/cierre', wrap((req, res) => res.json(calcularCierre(req.query.fecha || ahora().slice(0, 10), rutaDe(req, req.query.ruta_id)))));
  api.post('/cierre', wrap((req, res) => {
    const ruta = rutaDe(req, req.body.ruta_id);
    const fecha = req.body.fecha || ahora().slice(0, 10);
    const c = calcularCierre(fecha, ruta);
    const entregado = num(req.body.entregado, 'Efectivo entregado');
    db.prepare(`INSERT INTO cierres (fecha,ruta_id,usuario_id,ventas_contado,abonos,gastos,esperado,entregado,diferencia,nota) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(fecha,ruta_id) DO UPDATE SET usuario_id=excluded.usuario_id, ventas_contado=excluded.ventas_contado, abonos=excluded.abonos, gastos=excluded.gastos,
      esperado=excluded.esperado, entregado=excluded.entregado, diferencia=excluded.diferencia, nota=excluded.nota`)
      .run(fecha, ruta, req.user.id, c.ventas_contado, c.abonos, c.gastos, c.esperado, entregado, r2(entregado - c.esperado), n(req.body.nota));
    res.json(calcularCierre(fecha, ruta));
  }));

  // ---------- Reportes ----------
  api.get('/reportes/resumen', soloAdmin, (req, res) => {
    const p = { desde: req.query.desde || ahora().slice(0, 8) + '01', hasta: req.query.hasta || ahora().slice(0, 10) };
    const ventas = db.prepare(`SELECT COUNT(*) AS remisiones, COALESCE(SUM(total),0) AS ventas FROM remisiones WHERE anulada=0 AND substr(fecha,1,10) BETWEEN @desde AND @hasta`).get(p);
    const costo = db.prepare(`SELECT COALESCE(SUM(i.cantidad*i.costo),0) AS v FROM remision_items i JOIN remisiones r ON r.id=i.remision_id
      WHERE r.anulada=0 AND substr(r.fecha,1,10) BETWEEN @desde AND @hasta`).get(p).v;
    const descuentos = db.prepare(`SELECT COALESCE(SUM(descuento),0) AS v FROM remisiones WHERE anulada=0 AND substr(fecha,1,10) BETWEEN @desde AND @hasta`).get(p).v;
    const gastos = db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM gastos WHERE substr(fecha,1,10) BETWEEN @desde AND @hasta`).get(p).v;
    const compras = db.prepare(`SELECT COALESCE(SUM(total),0) AS v FROM compras WHERE anulada=0 AND substr(fecha,1,10) BETWEEN @desde AND @hasta`).get(p).v;
    const porRuta = db.prepare(`SELECT COALESCE(ru.nombre,'Bodega / mostrador') AS ruta, COUNT(*) AS remisiones, SUM(r.total) AS ventas FROM remisiones r
      LEFT JOIN rutas ru ON ru.id=r.ruta_id WHERE r.anulada=0 AND substr(r.fecha,1,10) BETWEEN @desde AND @hasta GROUP BY r.ruta_id ORDER BY ventas DESC`).all(p);
    const topProductos = db.prepare(`SELECT i.descripcion AS nombre, SUM(i.cantidad) AS cantidad, SUM(i.cantidad*i.precio) AS ventas, SUM(i.cantidad*(i.precio-i.costo)) AS utilidad
      FROM remision_items i JOIN remisiones r ON r.id=i.remision_id WHERE r.anulada=0 AND substr(r.fecha,1,10) BETWEEN @desde AND @hasta
      GROUP BY i.producto_id ORDER BY ventas DESC LIMIT 10`).all(p);
    const porDia = db.prepare(`SELECT substr(fecha,1,10) AS dia, SUM(total) AS ventas FROM remisiones WHERE anulada=0 AND substr(fecha,1,10) BETWEEN @desde AND @hasta GROUP BY dia ORDER BY dia`).all(p);
    const cartera = db.prepare('SELECT COALESCE(SUM(total-pagado),0) AS v FROM remisiones WHERE anulada=0').get().v;
    const porPagar = db.prepare('SELECT COALESCE(SUM(total-pagado),0) AS v FROM compras WHERE anulada=0').get().v;
    const valorInv = db.prepare('SELECT COALESCE(SUM(s.cantidad*p.costo),0) AS v FROM stock s JOIN productos p ON p.id=s.producto_id').get().v;
    const bajos = db.prepare(`SELECT p.id, p.nombre, p.stock_minimo, COALESCE(SUM(s.cantidad),0) AS total FROM productos p LEFT JOIN stock s ON s.producto_id=p.id
      WHERE p.activo=1 GROUP BY p.id HAVING p.stock_minimo>0 AND total<=p.stock_minimo ORDER BY total`).all();
    const utilBruta = r2(ventas.ventas - costo);
    res.json({ ...p, ...ventas, costo: r2(costo), descuentos: r2(descuentos), utilidad_bruta: utilBruta, gastos: r2(gastos), utilidad_neta: r2(utilBruta - gastos),
      compras: r2(compras), cartera: r2(cartera), por_pagar: r2(porPagar), valor_inventario: r2(valorInv), por_ruta: porRuta, top_productos: topProductos, por_dia: porDia, stock_bajo: bajos });
  });

  // ---------- Frontend estático ----------
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));
  app.use((err, _req, res, _next) => {
    if (!(err instanceof HttpError)) console.error(err);
    const status = err.status || 500;
    res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : err.message });
  });
  return app;
}
