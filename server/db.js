import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DB_FILE || path.resolve('data/dulceria.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Ubicaciones de inventario: 'B<id>' = bodega, 'R<id>' = inventario en la ruta.
// Esquema v2: varias bodegas; cada ruta pertenece a una bodega.
const VERSION_ESQUEMA = 10;

const DDL = {
  config: (t) => `CREATE TABLE ${t} (clave TEXT PRIMARY KEY, valor TEXT)`,
  bodegas: (t) => `CREATE TABLE ${t} (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, direccion TEXT, activa INTEGER DEFAULT 1)`,
  rutas: (t) => `CREATE TABLE ${t} (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE,
    bodega_id INTEGER NOT NULL REFERENCES bodegas(id), activa INTEGER DEFAULT 1)`,
  usuarios: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, usuario TEXT NOT NULL UNIQUE, clave_hash TEXT NOT NULL,
    rol TEXT NOT NULL,
    ruta_id INTEGER REFERENCES rutas(id), bodega_id INTEGER REFERENCES bodegas(id), activo INTEGER DEFAULT 1)`,
  // Roles configurables: alcance = hasta dónde ve (todo, su bodega o su ruta); permisos = lista JSON de funciones habilitadas
  roles: (t) => `CREATE TABLE ${t} (clave TEXT PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, alcance TEXT NOT NULL CHECK (alcance IN ('todo','bodega','ruta')),
    permisos TEXT NOT NULL DEFAULT '[]', sistema INTEGER NOT NULL DEFAULT 0)`,
  productos: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, codigo TEXT, nombre TEXT NOT NULL, unidad TEXT DEFAULT 'und',
    precio REAL NOT NULL DEFAULT 0, costo REAL NOT NULL DEFAULT 0, stock_minimo REAL DEFAULT 0, activo INTEGER DEFAULT 1,
    minimo_carro REAL NOT NULL DEFAULT 0)`, // stock_minimo: alerta en cada bodega; minimo_carro: alerta en cada carro (ruta)
  // Presentaciones de un producto: el inventario siempre se lleva en la unidad base; factor = unidades base que trae la presentación
  presentaciones: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, producto_id INTEGER NOT NULL REFERENCES productos(id), nombre TEXT NOT NULL,
    factor REAL NOT NULL CHECK (factor > 0), precio REAL, activo INTEGER DEFAULT 1, UNIQUE (producto_id, nombre))`,
  stock: (t) => `CREATE TABLE ${t} (
    producto_id INTEGER NOT NULL REFERENCES productos(id), ubicacion TEXT NOT NULL, cantidad REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (producto_id, ubicacion))`,
  movimientos: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, producto_id INTEGER NOT NULL REFERENCES productos(id),
    ubicacion TEXT NOT NULL, tipo TEXT NOT NULL, cantidad REAL NOT NULL, costo REAL DEFAULT 0,
    referencia TEXT, usuario_id INTEGER, nota TEXT)`,
  proveedores: (t) => `CREATE TABLE ${t} (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, telefono TEXT, nota TEXT, activo INTEGER DEFAULT 1)`,
  compras: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, proveedor_id INTEGER REFERENCES proveedores(id), factura TEXT,
    bodega_id INTEGER NOT NULL REFERENCES bodegas(id),
    total REAL NOT NULL, pagado REAL NOT NULL DEFAULT 0, nota TEXT, usuario_id INTEGER, anulada INTEGER DEFAULT 0)`,
  compra_items: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, compra_id INTEGER NOT NULL REFERENCES compras(id), producto_id INTEGER NOT NULL REFERENCES productos(id),
    cantidad REAL NOT NULL, costo REAL NOT NULL, factor REAL NOT NULL DEFAULT 1, presentacion TEXT)`,
  clientes: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, negocio TEXT, telefono TEXT, direccion TEXT, documento TEXT,
    ruta_id INTEGER REFERENCES rutas(id), activo INTEGER DEFAULT 1,
    paga_antes INTEGER NOT NULL DEFAULT 0, lat REAL, lng REAL)`, // lat/lng: ubicación de la tienda. paga_antes = 1: sus ventas exigen soporte de pago aprobado antes de despachar
  // ruta_id NULL = venta de mostrador de la bodega bodega_id
  remisiones: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, uuid TEXT UNIQUE, consecutivo INTEGER NOT NULL UNIQUE, fecha TEXT NOT NULL,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id), ruta_id INTEGER REFERENCES rutas(id),
    bodega_id INTEGER NOT NULL REFERENCES bodegas(id), usuario_id INTEGER NOT NULL,
    tipo_pago TEXT NOT NULL CHECK (tipo_pago IN ('contado','credito')), subtotal REAL NOT NULL, descuento REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL, pagado REAL NOT NULL DEFAULT 0, nota TEXT, anulada INTEGER DEFAULT 0, motivo_anulacion TEXT,
    requiere_aprobacion INTEGER NOT NULL DEFAULT 0, fecha_solicitud TEXT, aprobado_por INTEGER, fecha_aprobacion TEXT,
    lat REAL, lng REAL, gps_precision REAL)`, // lat/lng: dónde estaba el vendedor al hacer la venta (si dio permiso de ubicación)
  // anulada: 0 = válida, 1 = anulada (o pago rechazado), 2 = pendiente de aprobación del pago (no mueve inventario ni cuenta en ventas ni cartera).
  // Todo lo que filtra "anulada=0" ignora por sí solo las pendientes y las rechazadas.
  // Soportes de pago (foto del comprobante de transferencia) adjuntos a una remisión
  soportes: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, remision_id INTEGER NOT NULL REFERENCES remisiones(id), fecha TEXT NOT NULL, usuario_id INTEGER,
    mime TEXT NOT NULL, bytes INTEGER NOT NULL, huella TEXT NOT NULL, datos BLOB NOT NULL, nota TEXT)`,
  // Foto de la factura del proveedor adjunta a una compra (se guarda en la base: entra en la copia de seguridad)
  compra_fotos: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, compra_id INTEGER NOT NULL REFERENCES compras(id), fecha TEXT NOT NULL, usuario_id INTEGER,
    mime TEXT NOT NULL, bytes INTEGER NOT NULL, datos BLOB NOT NULL)`,
  remision_items: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, remision_id INTEGER NOT NULL REFERENCES remisiones(id), producto_id INTEGER NOT NULL REFERENCES productos(id),
    descripcion TEXT NOT NULL, cantidad REAL NOT NULL, precio REAL NOT NULL, costo REAL NOT NULL DEFAULT 0,
    factor REAL NOT NULL DEFAULT 1, presentacion TEXT, precio_lista REAL)`,
  pagos: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, uuid TEXT UNIQUE, fecha TEXT NOT NULL, cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    remision_id INTEGER REFERENCES remisiones(id), ruta_id INTEGER, bodega_id INTEGER NOT NULL REFERENCES bodegas(id),
    usuario_id INTEGER, valor REAL NOT NULL, metodo TEXT DEFAULT 'efectivo', nota TEXT, anulado INTEGER DEFAULT 0,
    verificado INTEGER NOT NULL DEFAULT 0, verificado_por INTEGER, fecha_verificado TEXT)`, // verificado = la transferencia se confirmó en el banco
  gastos: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, ruta_id INTEGER, bodega_id INTEGER NOT NULL REFERENCES bodegas(id),
    usuario_id INTEGER, concepto TEXT NOT NULL, valor REAL NOT NULL)`,
  cierres: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, punto TEXT NOT NULL, ruta_id INTEGER, bodega_id INTEGER NOT NULL REFERENCES bodegas(id),
    usuario_id INTEGER, ventas_contado REAL, abonos REAL, transferencias REAL DEFAULT 0, gastos REAL, esperado REAL, entregado REAL, diferencia REAL, nota TEXT,
    UNIQUE (fecha, punto))`,
  // Turno de un vendedor en un punto (ruta o mostrador): abre con una base de efectivo y cierra contando lo que entrega
  turnos: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), punto TEXT NOT NULL, ruta_id INTEGER, bodega_id INTEGER NOT NULL REFERENCES bodegas(id),
    abierto_en TEXT NOT NULL, base REAL NOT NULL DEFAULT 0, cerrado_en TEXT, ventas_efectivo REAL, abonos_efectivo REAL, transferencias REAL, gastos REAL,
    esperado REAL, entregado REAL, diferencia REAL, nota TEXT)`,
  // Cuadre semanal (los sábados) de un punto: efectivo de la semana, transferencias verificadas, cartera, gastos y conteo físico
  cuadres: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, punto TEXT NOT NULL, ruta_id INTEGER, bodega_id INTEGER NOT NULL REFERENCES bodegas(id),
    desde TEXT NOT NULL, hasta TEXT NOT NULL, usuario_id INTEGER, ventas REAL, efectivo_esperado REAL, efectivo_entregado REAL, diferencia_efectivo REAL,
    transferencias REAL, transferencias_verificadas REAL, gastos REAL, cartera REAL, diferencia_inventario REAL, productos_con_diferencia INTEGER,
    ajuste_aplicado INTEGER DEFAULT 0, datos TEXT, nota TEXT, UNIQUE (punto, desde, hasta))`,
  // Envíos del resumen diario por WhatsApp (para no repetirlos y para ver errores)
  envios_whatsapp: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, fecha_resumen TEXT NOT NULL, para TEXT NOT NULL, tipo TEXT NOT NULL,
    estado TEXT NOT NULL CHECK (estado IN ('enviado','error')), mensaje_id TEXT, detalle TEXT)`,
  // Registro de actividad: quién hizo qué (cambios de precios, usuarios, anulaciones, importaciones…)
  auditoria: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, usuario_id INTEGER, usuario TEXT, accion TEXT NOT NULL,
    entidad TEXT NOT NULL, entidad_id INTEGER, detalle TEXT)`,
  // Traslados entre bodegas: salen de la origen al enviar y entran a la destino al recibir
  traslados: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, origen_id INTEGER NOT NULL REFERENCES bodegas(id),
    destino_id INTEGER NOT NULL REFERENCES bodegas(id),
    estado TEXT NOT NULL DEFAULT 'enviado' CHECK (estado IN ('enviado','recibido','anulado')),
    usuario_envia INTEGER, usuario_recibe INTEGER, fecha_recibo TEXT, nota TEXT)`,
  traslado_items: (t) => `CREATE TABLE ${t} (
    id INTEGER PRIMARY KEY, traslado_id INTEGER NOT NULL REFERENCES traslados(id),
    producto_id INTEGER NOT NULL REFERENCES productos(id), cantidad REAL NOT NULL, cantidad_recibida REAL)`,
};
const ORDEN = ['config', 'bodegas', 'rutas', 'roles', 'usuarios', 'productos', 'presentaciones', 'stock', 'movimientos', 'proveedores', 'compras', 'compra_items', 'compra_fotos',
  'clientes', 'remisiones', 'soportes', 'remision_items', 'pagos', 'gastos', 'cierres', 'turnos', 'cuadres', 'envios_whatsapp', 'traslados', 'traslado_items', 'auditoria'];
const INDICES = ['CREATE INDEX IF NOT EXISTS ix_mov_prod ON movimientos(producto_id, fecha)',
  'CREATE INDEX IF NOT EXISTS ix_rem_fecha ON remisiones(fecha)', 'CREATE INDEX IF NOT EXISTS ix_pagos_fecha ON pagos(fecha)', 'CREATE INDEX IF NOT EXISTS ix_aud_fecha ON auditoria(fecha)',
  'CREATE INDEX IF NOT EXISTS ix_turno_usuario ON turnos(usuario_id, cerrado_en)', 'CREATE INDEX IF NOT EXISTS ix_sop_rem ON soportes(remision_id)', 'CREATE INDEX IF NOT EXISTS ix_sop_huella ON soportes(huella)'];

// Funciones que se pueden dar o quitar a cada rol
export const PERMISOS = [
  ['vender', 'Vender, cobrar y registrar gastos', 'Hacer remisiones, cobrar abonos y anotar gastos de su punto'],
  ['anular_remisiones', 'Anular remisiones de otros', 'Anular remisiones de su alcance (quien vende siempre puede anular las suyas del día)'],
  ['aprobar_pagos', 'Aprobar pagos anticipados', 'Aprobar o rechazar soportes de pago de clientes que pagan antes'],
  ['inventario', 'Gestionar inventario', 'Cargar rutas, contar, ajustar y hacer traslados entre bodegas'],
  ['compras', 'Registrar compras y proveedores', 'Entrada de mercancía con precio de compra'],
  ['pagar_proveedores', 'Pagos a proveedores y anular compras', 'Registrar pagos a proveedores, anular compras y ver lo que se les debe'],
  ['productos', 'Crear y editar productos', 'Catálogo: precios, mínimos, presentaciones, activar y desactivar'],
  ['importar', 'Importar desde Excel', 'Carga masiva de clientes, inventario y conteos'],
  ['ver_costos', 'Ver costos y márgenes', 'Costo de compra y utilidad de los productos'],
  ['informes', 'Informes, reportes y alertas', 'Reportes, descargas en Excel y alertas de inventario'],
  ['cuadre', 'Cuadre semanal y verificar transferencias', 'Cuadre del sábado y confirmación de transferencias en el banco'],
  ['administrar', 'Administrar la app', 'Usuarios, roles, rutas, bodegas, datos del negocio, WhatsApp y registro de actividad'],
];
export const TODOS_LOS_PERMISOS = PERMISOS.map((p) => p[0]);
const DEFAULT_ROLES = [
  ['admin', 'Administrador', 'todo', TODOS_LOS_PERMISOS, 1],
  ['bodeguero', 'Encargado de bodega', 'bodega', ['vender', 'anular_remisiones', 'aprobar_pagos', 'inventario', 'compras', 'importar', 'ver_costos', 'informes', 'cuadre'], 1],
  ['vendedor', 'Vendedor de ruta', 'ruta', ['vender'], 1],
  ['auxiliar', 'Auxiliar de bodega', 'bodega', ['vender', 'inventario'], 0],
  ['contador', 'Contador / cartera', 'todo', ['ver_costos', 'informes', 'cuadre', 'pagar_proveedores'], 0],
  ['supervisor', 'Supervisor de rutas', 'todo', ['vender', 'anular_remisiones', 'aprobar_pagos', 'informes', 'cuadre'], 0],
];
export function sembrarRoles() {
  const ins = db.prepare('INSERT OR IGNORE INTO roles (clave,nombre,alcance,permisos,sistema) VALUES (?,?,?,?,?)');
  for (const [c, nombre, alcance, permisos, sistema] of DEFAULT_ROLES) ins.run(c, nombre, alcance, JSON.stringify(permisos), sistema);
}

// Conceptos contables de Pluma7 que se colaron en la lista de productos: no se venden ni se cuentan
const CONCEPTOS = ['traslado entre bancos', 'gastos bancarios', 'ingreso libre', 'aporte de socios', 'gastos', 'gastós'];
export const esConcepto = (nombre) => { const x = String(nombre).trim().toLowerCase().replace(/\s+/g, ' '); return CONCEPTOS.includes(x) || /^(cuentas por|abonos a facturas|anticipo de)/.test(x); };

const existe = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

function crearEsquema() {
  for (const t of ORDEN) if (!existe(t)) db.exec(DDL[t](t));
  for (const i of INDICES) db.exec(i);
}

// Migra una base creada con el esquema v1 (una sola bodega implícita) a la v2, conservando todos los datos.
// Procedimiento recomendado por SQLite: tabla nueva, copiar, borrar la vieja y renombrar (con claves foráneas apagadas).
function migrarDeV1() {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(DDL.bodegas('bodegas'));
    db.exec("INSERT INTO bodegas (id, nombre) VALUES (1, 'Bodega principal')");
    const ub = (c) => `CASE ${c} WHEN 0 THEN 'B1' ELSE 'R' || ${c} END`;
    const reconstruir = (t, copiar) => {
      db.exec(DDL[t](`${t}_n`));
      db.exec(copiar.replaceAll('{n}', `${t}_n`).replaceAll('{o}', t));
      db.exec(`DROP TABLE ${t}`);
      db.exec(`ALTER TABLE ${t}_n RENAME TO ${t}`);
    };
    reconstruir('rutas', 'INSERT INTO {n} (id,nombre,bodega_id,activa) SELECT id,nombre,1,activa FROM {o}');
    reconstruir('usuarios', 'INSERT INTO {n} (id,nombre,usuario,clave_hash,rol,ruta_id,bodega_id,activo) SELECT id,nombre,usuario,clave_hash,rol,ruta_id,NULL,activo FROM {o}');
    reconstruir('stock', `INSERT INTO {n} (producto_id,ubicacion,cantidad) SELECT producto_id,${ub('ubicacion')},cantidad FROM {o}`);
    reconstruir('movimientos', `INSERT INTO {n} (id,fecha,producto_id,ubicacion,tipo,cantidad,costo,referencia,usuario_id,nota)
      SELECT id,fecha,producto_id,${ub('ubicacion')},tipo,cantidad,costo,referencia,usuario_id,nota FROM {o}`);
    reconstruir('compras', 'INSERT INTO {n} (id,fecha,proveedor_id,factura,bodega_id,total,pagado,nota,usuario_id,anulada) SELECT id,fecha,proveedor_id,factura,1,total,pagado,nota,usuario_id,anulada FROM {o}');
    reconstruir('remisiones', `INSERT INTO {n} (id,uuid,consecutivo,fecha,cliente_id,ruta_id,bodega_id,usuario_id,tipo_pago,subtotal,descuento,total,pagado,nota,anulada,motivo_anulacion)
      SELECT id,uuid,consecutivo,fecha,cliente_id,NULLIF(ruta_id,0),1,usuario_id,tipo_pago,subtotal,descuento,total,pagado,nota,anulada,motivo_anulacion FROM {o}`);
    reconstruir('pagos', `INSERT INTO {n} (id,uuid,fecha,cliente_id,remision_id,ruta_id,bodega_id,usuario_id,valor,metodo,nota,anulado)
      SELECT id,uuid,fecha,cliente_id,remision_id,NULLIF(ruta_id,0),1,usuario_id,valor,metodo,nota,anulado FROM {o}`);
    reconstruir('gastos', 'INSERT INTO {n} (id,fecha,ruta_id,bodega_id,usuario_id,concepto,valor) SELECT id,fecha,NULLIF(ruta_id,0),1,usuario_id,concepto,valor FROM {o}');
    reconstruir('cierres', `INSERT INTO {n} (id,fecha,punto,ruta_id,bodega_id,usuario_id,ventas_contado,abonos,gastos,esperado,entregado,diferencia,nota)
      SELECT id,fecha,${ub('ruta_id')},NULLIF(ruta_id,0),1,usuario_id,ventas_contado,abonos,gastos,esperado,entregado,diferencia,nota FROM {o}`);
    crearEsquema(); // traslados, traslado_items e índices
    const rotas = db.prepare('PRAGMA foreign_key_check').all();
    if (rotas.length) throw new Error(`Migración inválida: ${rotas.length} referencias rotas`);
    db.exec('PRAGMA user_version = 2');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// Migraciones incrementales: cada una lleva la base de la versión anterior a la indicada.
// Deben ser idempotentes (una base migrada desde v1 ya trae algunas columnas del esquema actual).
function agregarColumna(tabla, columna, definicion) {
  if (!db.prepare(`SELECT 1 FROM pragma_table_info('${tabla}') WHERE name=?`).get(columna)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
}
const MIGRACIONES = {
  // v3: el cierre separa el dinero recibido por transferencia del efectivo
  3: () => agregarColumna('cierres', 'transferencias', 'REAL DEFAULT 0'),
  // v4: presentaciones (la tabla nueva la crea crearEsquema) y precio de lista en cada línea vendida
  4: () => {
    agregarColumna('remision_items', 'factor', 'REAL NOT NULL DEFAULT 1');
    agregarColumna('remision_items', 'presentacion', 'TEXT');
    agregarColumna('remision_items', 'precio_lista', 'REAL');
    agregarColumna('compra_items', 'factor', 'REAL NOT NULL DEFAULT 1');
    agregarColumna('compra_items', 'presentacion', 'TEXT');
  },
  // v5: registro de actividad (la tabla nueva la crea crearEsquema)
  5: () => {},
  // v6: pago anticipado con soporte (la tabla soportes la crea crearEsquema)
  6: () => {
    agregarColumna('clientes', 'paga_antes', 'INTEGER NOT NULL DEFAULT 0');
    agregarColumna('remisiones', 'requiere_aprobacion', 'INTEGER NOT NULL DEFAULT 0');
    agregarColumna('remisiones', 'fecha_solicitud', 'TEXT');
    agregarColumna('remisiones', 'aprobado_por', 'INTEGER');
    agregarColumna('remisiones', 'fecha_aprobacion', 'TEXT');
  },
  // v7: cuadre semanal y envíos de WhatsApp (las tablas nuevas las crea crearEsquema) y verificación de transferencias en el banco
  7: () => {
    agregarColumna('pagos', 'verificado', 'INTEGER NOT NULL DEFAULT 0');
    agregarColumna('pagos', 'verificado_por', 'INTEGER');
    agregarColumna('pagos', 'fecha_verificado', 'TEXT');
  },
  // v8: mínimo de inventario en cada carro (para las alertas de inventario)
  8: () => agregarColumna('productos', 'minimo_carro', 'REAL NOT NULL DEFAULT 0'),
  // v9: roles y permisos configurables (usuarios.rol deja de estar limitado a 3 valores) y conceptos contables fuera del catálogo
  9: () => {
    sembrarRoles(); // (la tabla usuarios sin límite de roles se reconstruye antes, en quitarLimiteDeRoles)
    // los conceptos contables de la lista de Pluma7 (cuentas por cobrar, gastos bancarios…) no son productos: se desactivan si no tienen historial
    for (const p of db.prepare('SELECT id, nombre FROM productos WHERE activo=1').all()) {
      if (esConcepto(p.nombre) && !db.prepare('SELECT 1 FROM movimientos WHERE producto_id=?').get(p.id) && !db.prepare('SELECT 1 FROM remision_items WHERE producto_id=?').get(p.id))
        db.prepare('UPDATE productos SET activo=0 WHERE id=?').run(p.id);
    }
  },
  // v10: GPS de la venta, ubicación de las tiendas y turnos de vendedor (la tabla turnos la crea crearEsquema)
  10: () => {
    agregarColumna('clientes', 'lat', 'REAL'); agregarColumna('clientes', 'lng', 'REAL');
    agregarColumna('remisiones', 'lat', 'REAL'); agregarColumna('remisiones', 'lng', 'REAL'); agregarColumna('remisiones', 'gps_precision', 'REAL');
  },
};

// v9: usuarios.rol ya no se limita a admin/bodeguero/vendedor. SQLite no permite quitar un CHECK: se reconstruye la tabla
// (con las claves foráneas apagadas, lo que no se puede dentro de otra transacción).
function quitarLimiteDeRoles() {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='usuarios'").get()?.sql || '';
  if (!/CHECK\s*\(\s*rol\s+IN/i.test(sql)) return;
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(DDL.usuarios('usuarios_n'));
    db.exec('INSERT INTO usuarios_n (id,nombre,usuario,clave_hash,rol,ruta_id,bodega_id,activo) SELECT id,nombre,usuario,clave_hash,rol,ruta_id,bodega_id,activo FROM usuarios');
    db.exec('DROP TABLE usuarios');
    db.exec('ALTER TABLE usuarios_n RENAME TO usuarios');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Migración inválida: referencias rotas');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
}

function aplicarMigraciones() {
  let version = db.prepare('PRAGMA user_version').get().user_version;
  while (version < VERSION_ESQUEMA) {
    version += 1;
    if (version === 9) quitarLimiteDeRoles();
    db.exec('BEGIN');
    try {
      MIGRACIONES[version]?.();
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

(function iniciarEsquema() {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version >= VERSION_ESQUEMA) { crearEsquema(); sembrarRoles(); return; }
  if (existe('rutas') && !db.prepare("SELECT 1 FROM pragma_table_info('rutas') WHERE name='bodega_id'").get()) {
    migrarDeV1();
    aplicarMigraciones();
    sembrarRoles();
    return;
  }
  if (!existe('rutas')) { // base nueva: se crea directamente con el esquema actual
    crearEsquema();
    if (!db.prepare('SELECT 1 FROM bodegas').get()) db.exec("INSERT INTO bodegas (id, nombre) VALUES (1, 'Bodega principal')");
    db.exec(`PRAGMA user_version = ${VERSION_ESQUEMA}`);
    sembrarRoles();
    return;
  }
  crearEsquema();
  aplicarMigraciones();
  sembrarRoles();
})();

export const now = () => new Date().toISOString();
// Fecha local del negocio (Colombia por defecto) en formato YYYY-MM-DD
export const hoy = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ_NEGOCIO || 'America/Bogota' }).format(d);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ubicacion: 'B<id>' (bodega) o 'R<id>' (ruta)
export function getStock(productoId, ubicacion) {
  return db.prepare('SELECT cantidad FROM stock WHERE producto_id=? AND ubicacion=?').get(productoId, ubicacion)?.cantidad ?? 0;
}

// Mueve inventario y deja rastro en el kardex. delta > 0 entra, < 0 sale.
export function moverStock({ productoId, ubicacion, delta, tipo, costo = 0, referencia = null, usuarioId = null, nota = null, permitirNegativo = false }) {
  const actual = getStock(productoId, ubicacion);
  if (!permitirNegativo && actual + delta < -1e-9) {
    const p = db.prepare('SELECT nombre FROM productos WHERE id=?').get(productoId);
    throw new HttpError(409, `Inventario insuficiente de "${p?.nombre}" (disponible ${actual})`);
  }
  db.prepare(`INSERT INTO stock (producto_id, ubicacion, cantidad) VALUES (?,?,?)
    ON CONFLICT(producto_id, ubicacion) DO UPDATE SET cantidad = cantidad + excluded.cantidad`).run(productoId, ubicacion, delta);
  db.prepare(`INSERT INTO movimientos (fecha, producto_id, ubicacion, tipo, cantidad, costo, referencia, usuario_id, nota)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(now(), productoId, ubicacion, tipo, delta, costo, referencia, usuarioId, nota);
}

// Vender sin existencias registradas: por defecto solo mientras aún no se ha cargado inventario (modo "carga inicial");
// después se exige inventario. El administrador puede fijarlo siempre en sí ('1') o no ('0') desde Ajustes.
export const permiteSinStock = () => {
  const v = db.prepare("SELECT valor FROM config WHERE clave='permitir_sin_stock'").get()?.valor;
  if (v === '1') return true;
  if (v === '0') return false;
  return !db.prepare('SELECT 1 FROM movimientos WHERE cantidad>0 LIMIT 1').get();
};

export function getConfig() {
  const o = { negocio: 'Panificadora Mi Pan Colombia SAS', nit: '', telefono: '', direccion: '', pie_remision: 'Gracias por su compra. Documento sin validez tributaria (remisión).', prefijo: 'R' };
  for (const r of db.prepare('SELECT clave, valor FROM config').all()) o[r.clave] = r.valor;
  return o;
}

// Fecha y hora local del negocio: "YYYY-MM-DD HH:MM:SS" (los primeros 10 caracteres son el día)
export const ahora = (d = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: process.env.TZ_NEGOCIO || 'America/Bogota', dateStyle: 'short', timeStyle: 'medium' }).format(d);
