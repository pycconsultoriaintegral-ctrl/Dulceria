import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './ayuda.js';
import { Limitador } from '../limitador.js';
import { celda, aCsv } from '../csvout.js';

test('el limitador bloquea tras varios fallos y se libera con el tiempo', () => {
  let t = 1_000_000;
  const l = new Limitador({ max: 3, ventanaMs: 60_000, bloqueoMs: 120_000, ahora: () => t });
  l.fallo('a'); l.fallo('a');
  assert.equal(l.espera('a'), 0);
  l.fallo('a'); // el tercero bloquea
  assert.equal(l.espera('a'), 120_000);
  assert.equal(l.espera('otro'), 0);
  t += 119_000; assert.ok(l.espera('a') > 0);
  t += 2_000; assert.equal(l.espera('a'), 0); // pasó el bloqueo
  // los fallos viejos no cuentan: dos fallos separados más que la ventana no bloquean
  l.fallo('b'); t += 61_000; l.fallo('b'); l.fallo('b');
  assert.equal(l.espera('b'), 0);
  // un ingreso correcto borra los fallos
  l.fallo('c'); l.fallo('c'); l.exito('c'); l.fallo('c');
  assert.equal(l.espera('c'), 0);
});

test('CSV para Excel: separador, decimales, comillas y protección contra fórmulas', () => {
  assert.equal(celda(1200), '1200');
  assert.equal(celda(12.5), '12,5');
  assert.equal(celda(-500), '-500'); // un número negativo no es una fórmula
  assert.equal(celda('Julypan; grande'), '"Julypan; grande"');
  assert.equal(celda('dice "hola"'), '"dice ""hola"""');
  assert.equal(celda('=HYPERLINK("http://malo")'), `"'=HYPERLINK(""http://malo"")"`);
  assert.equal(celda('+57 300 111'), "'+57 300 111");
  assert.equal(celda('@cmd'), "'@cmd");
  assert.equal(celda(null), '');
  assert.equal(aCsv(['a', 'b'], [[1, 'x']]), '﻿a;b\r\n1;x\r\n');
});

const { server, call, login } = await iniciar();
after(() => server.close());
const ctx = {};

test('bloqueo de ingreso tras intentos fallidos', async () => {
  const admin = ctx.admin = await login('admin', 'admin123');
  await call('POST', '/usuarios', { nombre: 'Víctima', usuario: 'victima', clave: 'correcta1', rol: 'admin' }, admin);
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/login', { usuario: 'victima', clave: 'mala' + i })).status, 401);
  // sexto intento: bloqueado, incluso con la contraseña correcta
  const r = await fetch(`http://localhost:${server.address().port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'victima', clave: 'correcta1' }) });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.match((await r.json()).error, /Demasiados intentos/);
  // otro usuario no se ve afectado
  assert.equal((await call('POST', '/auth/login', { usuario: 'admin', clave: 'admin123' })).status, 200);
});

test('cambiar o restablecer la contraseña cierra las sesiones anteriores', async () => {
  const { admin } = ctx;
  await call('POST', '/usuarios', { nombre: 'Ana', usuario: 'ana', clave: 'secreto1', rol: 'admin' }, admin);
  const t1 = await login('ana', 'secreto1');
  const t2 = await login('ana', 'secreto1'); // otro celular
  assert.equal((await call('GET', '/auth/me', null, t1)).status, 200);
  // ella cambia su contraseña: recibe un token nuevo, el otro celular queda cerrado
  const cambio = (await call('POST', '/auth/clave', { actual: 'secreto1', nueva: 'secreto2' }, t1)).body;
  assert.ok(cambio.token);
  assert.equal((await call('GET', '/auth/me', null, t1)).status, 401);
  assert.equal((await call('GET', '/auth/me', null, t2)).status, 401);
  assert.equal((await call('GET', '/auth/me', null, cambio.token)).status, 200);
  assert.equal((await call('POST', '/auth/login', { usuario: 'ana', clave: 'secreto1' })).status, 401);
  // el administrador restablece la contraseña: la sesión abierta deja de valer
  const id = (await call('GET', '/usuarios', null, admin)).body.find((u) => u.usuario === 'ana').id;
  await call('PUT', `/usuarios/${id}`, { clave: 'nuevaclave3' }, admin);
  assert.equal((await call('GET', '/auth/me', null, cambio.token)).status, 401);
  // desactivar al usuario también cierra su sesión
  const t3 = await login('ana', 'nuevaclave3');
  await call('PUT', `/usuarios/${id}`, { activo: 0 }, admin);
  assert.equal((await call('GET', '/auth/me', null, t3)).status, 401);
  // un token sin huella (de una versión anterior) o falso no entra
  assert.equal((await call('GET', '/auth/me', null, 'abc.def.ghi')).status, 401);
});

test('encabezados de seguridad y salud', async () => {
  const r = await fetch(`http://localhost:${server.address().port}/api/health`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('registro de actividad: precios, usuarios, anulaciones, importaciones y cierres con diferencia', async () => {
  const { admin } = ctx;
  const b1 = (await call('GET', '/bodegas', null, admin)).body[0].id;
  const ruta = (await call('POST', '/rutas', { nombre: 'Norte', bodega_id: b1 }, admin)).body.id;
  await call('POST', '/usuarios', { nombre: 'Nico', usuario: 'nico', clave: 'secreto1', rol: 'vendedor', ruta_id: ruta }, admin);
  const nico = ctx.nico = await login('nico', 'secreto1');
  const prod = (await call('POST', '/productos', { nombre: 'Papas', precio: 1200, costo: 800, stock_minimo: 5 }, admin)).body.id;
  ctx.prod = prod; ctx.ruta = ruta; ctx.b1 = b1;
  await call('PUT', `/productos/${prod}`, { nombre: 'Papas', precio: 1500, costo: 800, stock_minimo: 5 }, admin); // sube el precio
  await call('PUT', `/productos/${prod}`, { nombre: 'Papas', precio: 1500, costo: 800, stock_minimo: 5 }, admin); // sin cambios: no deja rastro
  await call('POST', '/compras', { bodega_id: b1, items: [{ producto_id: prod, cantidad: 100, costo: 800 }] }, admin);
  await call('POST', '/inventario/cargue', { ruta_id: ruta, sentido: 'cargue', items: [{ producto_id: prod, cantidad: 50 }] }, admin);
  const cli = (await call('POST', '/clientes', { nombre: '=HYPERLINK("http://malo")' }, nico)).body.id; ctx.cli = cli;
  const v = (await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', items: [{ producto_id: prod, cantidad: 3 }] }, nico)).body;
  await call('POST', `/remisiones/${v.id}/anular`, { motivo: 'error de digitación' }, nico);
  await call('POST', '/cierre', { entregado: 1000 }, nico); // esperado 0 (la venta se anuló): diferencia
  await call('POST', '/importar/productos', { texto: 'nombre;precio\nGalletas;900', aplicar: true }, admin);

  const log = (await call('GET', '/auditoria', null, admin)).body;
  const hay = (accion, entidad, texto) => log.some((x) => x.accion === accion && x.entidad === entidad && (!texto || x.detalle?.includes(texto)));
  assert.ok(hay('crear', 'producto', 'Papas'));
  assert.ok(hay('editar', 'producto', 'precio: 1200 → 1500'));
  assert.equal(log.filter((x) => x.accion === 'editar' && x.entidad === 'producto').length, 1); // el guardado sin cambios no cuenta
  assert.ok(hay('crear', 'usuario', 'nico (vendedor)'));
  assert.ok(hay('anular', 'remision', 'error de digitación'));
  assert.ok(hay('cierre con diferencia', 'cierre', 'diferencia $1000'));
  assert.ok(hay('importar', 'productos', '"crear":1'));
  assert.equal(log.find((x) => x.accion === 'anular').usuario, 'Nico'); // queda quién lo hizo
  // contraseña restablecida y filtros
  const idNico = (await call('GET', '/usuarios', null, admin)).body.find((u) => u.usuario === 'nico').id;
  await call('PUT', `/usuarios/${idNico}`, { clave: 'secreto1x' }, admin);
  ctx.nico = await login('nico', 'secreto1x');
  assert.ok((await call('GET', '/auditoria?accion=editar&entidad=usuario', null, admin)).body.some((x) => x.detalle.includes('contraseña restablecida')));
  assert.equal((await call('GET', '/auditoria?q=Papas', null, admin)).body.every((x) => /Papas/.test(x.detalle)), true);
  // solo el administrador la consulta
  assert.equal((await call('GET', '/auditoria', null, ctx.nico)).status, 403);
});

test('exportación a CSV: contenido, formato y alcance', async () => {
  const { admin, nico, b1, prod } = ctx;
  const pedir = async (url, t) => {
    const r = await fetch(`http://localhost:${server.address().port}/api${url}`, { headers: { Authorization: `Bearer ${t}` } });
    const bytes = Buffer.from(await r.arrayBuffer());
    // fetch descarta el BOM al decodificar: se revisa en los bytes y el texto se lee sin él
    return { status: r.status, tipo: r.headers.get('content-type'), disp: r.headers.get('content-disposition'), bom: bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), texto: bytes.toString('utf8').replace(/^\uFEFF/, '') };
  };
  const ventas = await pedir('/exportar/ventas', admin);
  assert.equal(ventas.status, 200);
  assert.match(ventas.tipo, /text\/csv/);
  assert.match(ventas.disp, /attachment; filename="ventas.csv"/);
  assert.ok(ventas.bom, 'el archivo lleva BOM para que Excel respete las tildes');
  assert.ok(ventas.texto.startsWith('Fecha;Remisión;Ruta;Bodega;Vendedor;Cliente;Producto'));
  assert.match(ventas.texto, /'=HYPERLINK\(""http:\/\/malo""\)/); // el cliente malicioso quedó neutralizado
  assert.match(ventas.texto, /Anulada/);
  // el vendedor no ve costos en su exportación
  const delVendedor = await pedir('/exportar/ventas', nico);
  assert.ok(!delVendedor.texto.split('\r\n')[0].includes('Costo'));
  assert.ok(ventas.texto.split('\r\n')[0].includes('Costo'));
  // inventario: solo administrador y encargado
  assert.equal((await pedir('/exportar/inventario', nico)).status, 403);
  const inv = await pedir('/exportar/inventario', admin);
  assert.match(inv.texto, /Papas;und;.*;50;/); // 50 en rutas
  assert.match(inv.texto.split('\r\n')[0], /Bodega principal/);
  // el encargado de otra bodega no ve la mercancía de la bodega 1
  const b2 = (await call('POST', '/bodegas', { nombre: 'Occidente' }, admin)).body.id;
  await call('POST', '/usuarios', { nombre: 'Luis', usuario: 'luis', clave: 'secreto1', rol: 'bodeguero', bodega_id: b2 }, admin);
  const luis = await login('luis', 'secreto1');
  const invLuis = await pedir('/exportar/inventario', luis);
  assert.ok(!invLuis.texto.includes('Bodega principal'));
  assert.match(invLuis.texto, /Papas;und;0;0;0;/);
  assert.equal((await pedir('/exportar/movimientos', luis)).texto.split('\r\n').length <= 3, true); // sin movimientos de otra bodega
  assert.ok((await pedir('/exportar/movimientos', admin)).texto.includes('compra'));
  // clientes, cartera, cierres y actividad
  assert.match((await pedir('/exportar/clientes', nico)).texto, /^nombre;negocio;telefono;direccion;cedula;ruta;saldo/);
  assert.match((await pedir('/exportar/cartera', admin)).texto, /^Cliente;Negocio;Teléfono;Saldo/);
  assert.match((await pedir('/exportar/cierres', admin)).texto, /Diferencia/);
  assert.equal((await pedir('/exportar/actividad', nico)).status, 403);
  assert.match((await pedir('/exportar/actividad', admin)).texto, /Papas/);
  assert.equal((await fetch(`http://localhost:${server.address().port}/api/exportar/ventas`)).status, 401); // sin sesión no se descarga
});
