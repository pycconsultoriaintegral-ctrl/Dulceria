// Importación masiva desde Excel (pegando las filas) o CSV, siempre con vista previa antes de aplicar.
import { Router } from 'express';
import { db, tx, HttpError, getStock, moverStock } from '../db.js';
import { soloAdmin } from '../auth.js';
import { wrap } from '../util.js';
import { leerObjetos, leerNumero, normalizar } from '../csv.js';
import { aBase } from '../presentaciones.js';
import { auditar } from '../auditoria.js';
import { exigir, esAdminOBodeguero, puedeUb, puedeRuta, parseUb, getRuta, getBodega } from '../scope.js';

const router = Router();
const MAX_FILAS = 5000;

function tabla(req, alias, obligatorios) {
  const texto = String(req.body.texto ?? '');
  if (!texto.trim()) throw new HttpError(400, 'Pega las filas desde Excel o sube un archivo CSV');
  const t = leerObjetos(texto, alias);
  const faltan = obligatorios.filter((c) => t.indice?.[c] === undefined);
  if (faltan.length) throw new HttpError(400, `Falta la columna "${faltan.join('" / "')}" en la primera fila. Columnas reconocidas: ${Object.values(alias).map((a) => a[0]).join(', ')}`);
  if (t.filas.length > MAX_FILAS) throw new HttpError(400, `Máximo ${MAX_FILAS} filas por importación`);
  return t;
}
const resumen = (filas) => {
  const r = { crear: 0, actualizar: 0, ajustar: 0, sin_cambios: 0, errores: 0 };
  for (const f of filas) { if (f.error) r.errores++; else r[f.accion] = (r[f.accion] || 0) + 1; } // sin_contar solo aparece en conteos con celdas vacías
  return r;
};
const numero = (valor, campo, f) => {
  if (valor === undefined || valor === '') return undefined;
  const x = leerNumero(valor);
  if (x === null || x < 0) { f.error = `${campo} inválido: "${valor}"`; return undefined; }
  return x;
};

// ---------- Productos ----------
const ALIAS_PRODUCTO = {
  nombre: ['nombre', 'producto', 'descripcion', 'articulo', 'item'],
  codigo: ['codigo', 'cod', 'sku', 'referencia', 'ref', 'codigo de barras'],
  unidad: ['unidad', 'und', 'medida', 'unidad base'],
  precio: ['precio', 'precio venta', 'precio de venta', 'pvp', 'valor', 'precio publico'],
  costo: ['costo', 'precio compra', 'costo compra', 'precio de compra'],
  minimo: ['minimo', 'stock minimo', 'stock min', 'min', 'alerta', 'minimo bodega', 'minimo en bodega'],
  minimo_carro: ['minimo carro', 'minimo en carro', 'minimo en cada carro', 'minimo por carro', 'minimo ruta'],
};
router.post('/productos', soloAdmin, wrap((req, res) => {
  const t = tabla(req, ALIAS_PRODUCTO, ['nombre']);
  const existentes = db.prepare('SELECT * FROM productos').all();
  const porCodigo = new Map(existentes.filter((p) => p.codigo).map((p) => [normalizar(p.codigo), p]));
  const porNombre = new Map(existentes.map((p) => [normalizar(p.nombre), p]));
  const vistos = new Map();
  const filas = t.filas.map((r) => {
    const f = { linea: r._linea, nombre: r.nombre, accion: 'crear', cambios: [] };
    if (!r.nombre) { f.error = 'Falta el nombre'; return f; }
    const clave = normalizar(r.codigo || r.nombre);
    if (vistos.has(clave)) { f.error = `Repetido en el archivo (ya está en la línea ${vistos.get(clave)})`; return f; }
    vistos.set(clave, r._linea);
    const campos = { precio: numero(r.precio, 'Precio', f), costo: numero(r.costo, 'Costo', f), stock_minimo: numero(r.minimo, 'Stock mínimo', f), minimo_carro: numero(r.minimo_carro, 'Mínimo en carro', f) };
    if (f.error) return f;
    if (r.unidad) campos.unidad = r.unidad;
    if (r.codigo) campos.codigo = r.codigo;
    const ya = (r.codigo && porCodigo.get(normalizar(r.codigo))) || porNombre.get(normalizar(r.nombre));
    // si el producto ya existe con el mismo nombre (aunque cambien mayúsculas o tildes) se conserva su nombre
    f.datos = { nombre: ya && normalizar(ya.nombre) === normalizar(r.nombre) ? ya.nombre : r.nombre, ...Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined)) };
    if (ya) {
      f.id = ya.id;
      f.accion = 'actualizar';
      for (const [k, v] of Object.entries(f.datos)) if (v !== ya[k]) f.cambios.push(`${k}: ${ya[k] ?? '—'} → ${v}`);
      if (!f.cambios.length) f.accion = 'sin_cambios';
    }
    return f;
  });
  if (req.body.aplicar) {
    tx(() => {
      for (const f of filas) {
        if (f.error) continue;
        const d = f.datos;
        if (f.accion === 'crear') db.prepare('INSERT INTO productos (codigo,nombre,unidad,precio,costo,stock_minimo,minimo_carro) VALUES (?,?,?,?,?,?,?)')
          .run(d.codigo ?? null, d.nombre, d.unidad ?? 'und', d.precio ?? 0, d.costo ?? 0, d.stock_minimo ?? 0, d.minimo_carro ?? 0);
        else if (f.accion === 'actualizar') db.prepare('UPDATE productos SET codigo=COALESCE(?,codigo), nombre=?, unidad=COALESCE(?,unidad), precio=COALESCE(?,precio), costo=COALESCE(?,costo), stock_minimo=COALESCE(?,stock_minimo), minimo_carro=COALESCE(?,minimo_carro) WHERE id=?')
          .run(d.codigo ?? null, d.nombre, d.unidad ?? null, d.precio ?? null, d.costo ?? null, d.stock_minimo ?? null, d.minimo_carro ?? null, f.id);
      }
    });
  }
  if (req.body.aplicar) auditar(req.user, 'importar', 'productos', null, JSON.stringify(resumen(filas)));
  res.json({ aplicado: !!req.body.aplicar, resumen: resumen(filas), filas: filas.map(({ datos, ...x }) => x) });
}));

// ---------- Clientes ----------
const ALIAS_CLIENTE = {
  nombre: ['nombre', 'cliente', 'nombre cliente', 'propietario', 'contacto'],
  negocio: ['negocio', 'establecimiento', 'tienda', 'razon social', 'nombre negocio'],
  telefono: ['telefono', 'tel', 'celular', 'whatsapp', 'movil', 'cel'],
  direccion: ['direccion', 'dir', 'barrio', 'ubicacion'],
  documento: ['documento', 'cedula', 'nit', 'cc', 'identificacion', 'nit/cc'],
  ruta: ['ruta'],
};
router.post('/clientes', wrap((req, res) => {
  exigir(esAdminOBodeguero(req.user));
  const t = tabla(req, ALIAS_CLIENTE, []);
  if (t.indice.nombre === undefined && t.indice.negocio === undefined) throw new HttpError(400, 'Falta la columna "nombre" (o "negocio") en la primera fila');
  const rutas = db.prepare('SELECT id, nombre FROM rutas').all();
  const rutaPorNombre = new Map();
  for (const r of rutas) { const n = normalizar(r.nombre); rutaPorNombre.set(n, r); rutaPorNombre.set(n.replace(/^ruta /, ''), r); }
  const dig = (x) => String(x ?? '').replace(/\D/g, '');
  const existentes = db.prepare('SELECT * FROM clientes WHERE activo=1').all();
  const porDoc = new Map(existentes.filter((c) => c.documento).map((c) => [normalizar(c.documento), c]));
  const porTel = new Map(existentes.filter((c) => dig(c.telefono).length >= 7).map((c) => [dig(c.telefono), c]));
  const porNom = new Map(existentes.map((c) => [normalizar(`${c.nombre}|${c.negocio ?? ''}`), c]));
  const vistos = new Map();
  const filas = t.filas.map((r) => {
    const nombre = r.nombre || r.negocio;
    const f = { linea: r._linea, nombre, negocio: r.negocio || '', accion: 'crear', cambios: [] };
    if (!nombre) { f.error = 'Falta el nombre'; return f; }
    let ruta_id;
    if (r.ruta) {
      const nr = normalizar(r.ruta);
      const ruta = rutaPorNombre.get(nr) || rutaPorNombre.get(nr.replace(/^ruta /, '')); // acepta "Norte" o "Ruta Norte"
      if (!ruta) { f.error = `La ruta "${r.ruta}" no existe`; return f; }
      if (!puedeRuta(req.user, ruta.id)) { f.error = `La ruta "${r.ruta}" no es de tu bodega`; return f; }
      ruta_id = ruta.id;
    }
    // un cliente es el mismo si coincide su cédula, su celular o su nombre y negocio
    const claves = [r.documento && `d:${normalizar(r.documento)}`, dig(r.telefono).length >= 7 && `t:${dig(r.telefono)}`, `n:${normalizar(`${nombre}|${r.negocio ?? ''}`)}`].filter(Boolean);
    const repetida = claves.find((k) => vistos.has(k));
    if (repetida) { f.error = `Repetido en el archivo (ya está en la línea ${vistos.get(repetida)})`; return f; }
    for (const k of claves) vistos.set(k, r._linea);
    const datos = { nombre, negocio: r.negocio || undefined, telefono: r.telefono || undefined, direccion: r.direccion || undefined, documento: r.documento || undefined, ruta_id };
    f.datos = Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined));
    const ya = (r.documento && porDoc.get(normalizar(r.documento))) || (dig(r.telefono).length >= 7 && porTel.get(dig(r.telefono))) || porNom.get(normalizar(`${nombre}|${r.negocio ?? ''}`));
    if (ya) {
      // el encargado solo actualiza clientes de su alcance
      if (ya.ruta_id && !puedeRuta(req.user, ya.ruta_id)) { f.error = 'Ese cliente ya existe y es de otra bodega'; return f; }
      f.id = ya.id;
      f.accion = 'actualizar';
      for (const [k, v] of Object.entries(f.datos)) if (v !== ya[k]) f.cambios.push(`${k}: ${ya[k] ?? '—'} → ${v}`);
      if (!f.cambios.length) f.accion = 'sin_cambios';
    }
    return f;
  });
  if (req.body.aplicar) {
    tx(() => {
      for (const f of filas) {
        if (f.error) continue;
        const d = f.datos;
        if (f.accion === 'crear') db.prepare('INSERT INTO clientes (nombre,negocio,telefono,direccion,documento,ruta_id) VALUES (?,?,?,?,?,?)')
          .run(d.nombre, d.negocio ?? null, d.telefono ?? null, d.direccion ?? null, d.documento ?? null, d.ruta_id ?? null);
        else if (f.accion === 'actualizar') db.prepare('UPDATE clientes SET nombre=?, negocio=COALESCE(?,negocio), telefono=COALESCE(?,telefono), direccion=COALESCE(?,direccion), documento=COALESCE(?,documento), ruta_id=COALESCE(?,ruta_id) WHERE id=?')
          .run(d.nombre, d.negocio ?? null, d.telefono ?? null, d.direccion ?? null, d.documento ?? null, d.ruta_id ?? null, f.id);
      }
    });
  }
  if (req.body.aplicar) auditar(req.user, 'importar', 'clientes', null, JSON.stringify(resumen(filas)));
  res.json({ aplicado: !!req.body.aplicar, resumen: resumen(filas), filas: filas.map(({ datos, ...x }) => x) });
}));

// ---------- Conteo de inventario (deja el inventario de una bodega o ruta igual al conteo) ----------
const ALIAS_CONTEO = {
  producto: ['producto', 'nombre', 'descripcion', 'articulo', 'item'],
  codigo: ['codigo', 'cod', 'sku', 'referencia', 'ref'],
  cantidad: ['cantidad', 'conteo', 'existencia', 'existencias', 'stock', 'cant', 'inventario'],
  presentacion: ['presentacion', 'en', 'medida'], // opcional: "estiba", "caja"… (la cantidad está en esa presentación)
};
router.post('/inventario', wrap((req, res) => {
  exigir(esAdminOBodeguero(req.user));
  const ub = req.body.ub;
  parseUb(ub);
  exigir(puedeUb(req.user, ub), 'No tienes permiso sobre esa ubicación');
  // La cantidad puede venir en una columna "cantidad", en la que el usuario elija (ej. "Carro 2" de una plantilla con una
  // columna por lugar) o en una con el nombre del lugar contado (ej. "Bodega principal", "Ruta Norte", "Norte").
  const p = parseUb(ub);
  const nombre = p.tipo === 'B' ? getBodega(p.id)?.nombre : getRuta(p.id)?.nombre;
  const delLugar = nombre ? [normalizar(nombre), normalizar(`${p.tipo === 'B' ? 'bodega' : 'ruta'} ${nombre}`), ...(p.tipo === 'B' ? ['bodega'] : [])] : [];
  const columna = req.body.columna ? normalizar(req.body.columna) : null;
  const alias = { ...ALIAS_CONTEO, cantidad: columna ? [columna] : [...ALIAS_CONTEO.cantidad, ...delLugar] };
  const t = tabla(req, alias, ['cantidad']);
  t.columna = t.encabezados[t.indice.cantidad];
  if (t.indice.producto === undefined && t.indice.codigo === undefined) throw new HttpError(400, 'Falta la columna "producto" (o "codigo") en la primera fila');
  const productos = db.prepare('SELECT id, codigo, nombre, unidad FROM productos WHERE activo=1').all();
  const porCodigo = new Map(productos.filter((p) => p.codigo).map((p) => [normalizar(p.codigo), p]));
  const porNombre = new Map(productos.map((p) => [normalizar(p.nombre), p]));
  const vistos = new Map();
  const filas = t.filas.map((r) => {
    const f = { linea: r._linea, producto: r.producto || r.codigo, accion: 'ajustar' };
    const p = (r.codigo && porCodigo.get(normalizar(r.codigo))) || (r.producto && porNombre.get(normalizar(r.producto)));
    if (!p) { f.error = `No existe el producto "${r.producto || r.codigo}" (créalo primero en Productos o impórtalo)`; return f; }
    f.producto = p.nombre;
    if (vistos.has(p.id)) { f.error = `Repetido en el archivo (ya está en la línea ${vistos.get(p.id)})`; return f; }
    vistos.set(p.id, r._linea);
    if (r.cantidad === '') { f.accion = 'sin_contar'; return f; } // celda vacía: ese producto no se contó en este lugar
    let real = leerNumero(r.cantidad);
    if (real === null || real < 0) { f.error = `Cantidad inválida: "${r.cantidad}"`; return f; }
    if (r.presentacion && normalizar(r.presentacion) !== normalizar(p.unidad ?? '')) {
      const pr = db.prepare('SELECT * FROM presentaciones WHERE producto_id=? AND activo=1').all(p.id).find((x) => normalizar(x.nombre) === normalizar(r.presentacion));
      if (!pr) { f.error = `"${p.nombre}" no tiene la presentación "${r.presentacion}"`; return f; }
      real = aBase(real, pr);
      f.presentacion = pr.nombre;
    }
    f.producto_id = p.id;
    f.actual = getStock(p.id, ub);
    f.conteo = real;
    f.diferencia = real - f.actual;
    if (f.diferencia === 0) f.accion = 'sin_cambios';
    return f;
  });
  if (req.body.aplicar) {
    tx(() => {
      for (const f of filas) if (!f.error && f.accion === 'ajustar') moverStock({ productoId: f.producto_id, ubicacion: ub, delta: f.diferencia, tipo: 'ajuste', referencia: 'IMP', usuarioId: req.user.id, nota: 'Conteo importado' });
    });
  }
  if (req.body.aplicar) auditar(req.user, 'importar', 'inventario', null, `${ub} · ${JSON.stringify(resumen(filas))}`);
  res.json({ aplicado: !!req.body.aplicar, resumen: resumen(filas), columna: t.columna, filas });
}));

// ---------- Presentaciones de productos existentes ----------
const ALIAS_PRESENTACION = {
  producto: ['producto', 'nombre', 'descripcion', 'articulo'],
  codigo: ['codigo', 'cod', 'sku', 'referencia', 'ref'],
  presentacion: ['presentacion', 'nombre presentacion', 'empaque'],
  factor: ['equivalencia', 'factor', 'unidades', 'contiene', 'trae', 'cantidad'],
  precio: ['precio', 'precio presentacion', 'precio venta', 'pvp'],
};
router.post('/presentaciones', soloAdmin, wrap((req, res) => {
  const t = tabla(req, ALIAS_PRESENTACION, ['presentacion', 'factor']);
  if (t.indice.producto === undefined && t.indice.codigo === undefined) throw new HttpError(400, 'Falta la columna "producto" (o "codigo") en la primera fila');
  const productos = db.prepare('SELECT id, codigo, nombre FROM productos').all();
  const porCodigo = new Map(productos.filter((p) => p.codigo).map((p) => [normalizar(p.codigo), p]));
  const porNombre = new Map(productos.map((p) => [normalizar(p.nombre), p]));
  const vistos = new Map();
  const filas = t.filas.map((r) => {
    const f = { linea: r._linea, producto: r.producto || r.codigo, presentacion: r.presentacion, accion: 'crear', cambios: [] };
    const p = (r.codigo && porCodigo.get(normalizar(r.codigo))) || (r.producto && porNombre.get(normalizar(r.producto)));
    if (!p) { f.error = `No existe el producto "${r.producto || r.codigo}"`; return f; }
    f.producto = p.nombre;
    if (!r.presentacion) { f.error = 'Falta el nombre de la presentación'; return f; }
    const factor = leerNumero(r.factor);
    if (factor === null || !(factor > 0) || factor === 1) { f.error = `Equivalencia inválida: "${r.factor}" (cuántas unidades trae; no puede ser 1)`; return f; }
    const precio = r.precio ? leerNumero(r.precio) : null;
    if (r.precio && (precio === null || precio < 0)) { f.error = `Precio inválido: "${r.precio}"`; return f; }
    const clave = `${p.id}:${normalizar(r.presentacion)}`;
    if (vistos.has(clave)) { f.error = `Repetido en el archivo (ya está en la línea ${vistos.get(clave)})`; return f; }
    vistos.set(clave, r._linea);
    f.datos = { producto_id: p.id, nombre: r.presentacion, factor, precio };
    const ya = db.prepare('SELECT * FROM presentaciones WHERE producto_id=? AND lower(nombre)=lower(?)').get(p.id, r.presentacion);
    if (ya) {
      f.accion = ya.activo && ya.factor === factor && (precio === null || ya.precio === precio) ? 'sin_cambios' : 'actualizar';
      if (ya.factor !== factor) f.cambios.push(`equivalencia: ${ya.factor} → ${factor}`);
      if (precio !== null && ya.precio !== precio) f.cambios.push(`precio: ${ya.precio ?? '—'} → ${precio}`);
      f.id = ya.id;
    }
    return f;
  });
  if (req.body.aplicar) {
    tx(() => {
      for (const f of filas) {
        if (f.error) continue;
        const d = f.datos;
        if (f.accion === 'crear') db.prepare('INSERT INTO presentaciones (producto_id,nombre,factor,precio) VALUES (?,?,?,?)').run(d.producto_id, d.nombre, d.factor, d.precio);
        else if (f.accion === 'actualizar') db.prepare('UPDATE presentaciones SET factor=?, precio=COALESCE(?,precio), activo=1 WHERE id=?').run(d.factor, d.precio, f.id);
      }
    });
  }
  if (req.body.aplicar) auditar(req.user, 'importar', 'presentaciones', null, JSON.stringify(resumen(filas)));
  res.json({ aplicado: !!req.body.aplicar, resumen: resumen(filas), filas: filas.map(({ datos, ...x }) => x) });
}));

export default router;
