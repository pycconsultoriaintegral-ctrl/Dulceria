import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './ayuda.js';

const { server, call, login } = await iniciar();
after(() => server.close());

const foto = (marca = 'a') => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from(`JFIF-${marca}-`.repeat(20))]).toString('base64');
const ctx = {};

test('preparar: bodega, rutas, vendedores, productos, compra con foto y ventas con GPS', async () => {
  const admin = ctx.admin = await login('admin', 'admin123');
  ctx.b = (await call('GET', '/bodegas', null, admin)).body[0].id;
  ctx.r1 = (await call('POST', '/rutas', { nombre: 'Norte', bodega_id: ctx.b }, admin)).body.id;
  ctx.r2 = (await call('POST', '/rutas', { nombre: 'Sur', bodega_id: ctx.b }, admin)).body.id;
  await call('POST', '/usuarios', { nombre: 'Nico', usuario: 'nico', clave: 'secreto1', rol: 'vendedor', ruta_id: ctx.r1 }, admin);
  await call('POST', '/usuarios', { nombre: 'Vera', usuario: 'vera', clave: 'secreto1', rol: 'vendedor', ruta_id: ctx.r2 }, admin);
  ctx.nico = await login('nico', 'secreto1');
  ctx.vera = await login('vera', 'secreto1');
  ctx.pan = (await call('POST', '/productos', { nombre: 'Pan', precio: 1000, costo: 0 }, admin)).body.id;
  ctx.cola = (await call('POST', '/productos', { nombre: 'Gaseosa', precio: 2000, costo: 0 }, admin)).body.id;
  // compra con foto de la factura
  const c = await call('POST', '/compras', { bodega_id: ctx.b, factura: 'F-100', fotos: [foto('uno')], items: [{ producto_id: ctx.pan, cantidad: 100, costo: 600 }, { producto_id: ctx.cola, cantidad: 50, costo: 1200 }] }, admin);
  assert.equal(c.status, 200);
  ctx.compra = c.body.id;
  await call('POST', '/inventario/cargue', { ruta_id: ctx.r1, sentido: 'cargue', items: [{ producto_id: ctx.pan, cantidad: 40 }] }, admin);
  ctx.cli = (await call('POST', '/clientes', { nombre: 'Tienda Mapa', lat: 7.88, lng: -76.62 }, admin)).body.id;
  ctx.cli2 = (await call('POST', '/clientes', { nombre: 'Tienda Sin Mapa' }, admin)).body.id;
  await call('POST', '/remisiones', { cliente_id: ctx.cli, tipo_pago: 'contado', lat: 7.8872, lng: -76.6283, items: [{ producto_id: ctx.pan, cantidad: 5 }] }, ctx.nico);
  await call('POST', '/remisiones', { cliente_id: ctx.cli, tipo_pago: 'contado', items: [{ producto_id: ctx.pan, cantidad: 2 }] }, ctx.nico); // sin GPS
});

test('foto de la factura de la compra: se guarda, se sirve con sesión y respeta el alcance', async () => {
  const d = (await call('GET', `/compras/${ctx.compra}`, null, ctx.admin)).body;
  assert.equal(d.fotos.length, 1);
  const img = await call('GET', `/compras/${ctx.compra}/foto/${d.fotos[0].id}`, null, ctx.admin);
  assert.equal(img.status, 200);
  assert.ok(Buffer.isBuffer(img.body));
  assert.equal((await call('GET', `/compras/${ctx.compra}/foto/${d.fotos[0].id}`, null, ctx.nico)).status, 403); // el vendedor no entra a compras
  // agregar otra a una compra ya hecha; inválidas se rechazan; máximo 5
  assert.equal((await call('POST', `/compras/${ctx.compra}/foto`, { imagen: foto('dos') }, ctx.admin)).status, 200);
  assert.equal((await call('POST', `/compras/${ctx.compra}/foto`, { imagen: 'hola' }, ctx.admin)).status, 400);
  for (const m of ['3', '4', '5']) await call('POST', `/compras/${ctx.compra}/foto`, { imagen: foto(m) }, ctx.admin);
  assert.equal((await call('POST', `/compras/${ctx.compra}/foto`, { imagen: foto('6') }, ctx.admin)).status, 409);
});

test('kardex general: movimientos con saldo, filtros, alcance y Excel', async () => {
  const k = (await call('GET', '/inventario/movimientos', null, ctx.admin)).body;
  assert.ok(k.tipos.includes('compra') && k.tipos.includes('venta') && k.tipos.includes('cargue'));
  const pan = k.filas.filter((m) => m.producto === 'Pan' && m.lugar.includes('Bodega'));
  // bodega: +100 (compra), -40 (cargue) => saldo 60; el más reciente primero
  assert.deepEqual(pan.map((m) => [m.tipo, m.cantidad, m.saldo]), [['cargue', -40, 60], ['compra', 100, 100]]);
  const ruta = k.filas.filter((m) => m.producto === 'Pan' && m.lugar.includes('Norte'));
  assert.deepEqual(ruta.map((m) => m.saldo), [33, 35, 40]); // +40, -5, -2
  // filtros
  assert.equal((await call('GET', '/inventario/movimientos?tipo=compra', null, ctx.admin)).body.filas.length, 2);
  assert.equal((await call('GET', '/inventario/movimientos?q=gaseosa', null, ctx.admin)).body.filas.every((m) => m.producto === 'Gaseosa'), true);
  assert.equal((await call('GET', `/inventario/movimientos?ub=R${ctx.r1}`, null, ctx.admin)).body.filas.every((m) => m.ubicacion === `R${ctx.r1}`), true);
  assert.equal((await call('GET', '/inventario/movimientos?desde=2999-01-01', null, ctx.admin)).body.filas.length, 0);
  // el vendedor no tiene permiso de inventario
  assert.equal((await call('GET', '/inventario/movimientos', null, ctx.nico)).status, 403);
  const x = await call('GET', '/informes/kardex.xlsx', null, ctx.admin);
  assert.equal(x.status, 200);
  assert.equal(x.body.subarray(0, 2).toString(), 'PK');
  assert.equal((await call('GET', '/informes/kardex.xlsx', null, ctx.nico)).status, 403);
});

test('mapa de ventas y de tiendas, por alcance', async () => {
  const m = (await call('GET', '/mapa/ventas', null, ctx.admin)).body;
  assert.equal(m.total_ventas, 2);
  assert.equal(m.con_ubicacion, 1); // solo la que mandó GPS
  assert.deepEqual([m.ventas[0].lat, m.ventas[0].lng, m.ventas[0].vendedor, m.ventas[0].cliente], [7.8872, -76.6283, 'Nico', 'Tienda Mapa']);
  // el vendedor ve solo las suyas; otro vendedor no ve las de Nico
  assert.equal((await call('GET', '/mapa/ventas', null, ctx.nico)).body.con_ubicacion, 1);
  assert.equal((await call('GET', '/mapa/ventas', null, ctx.vera)).body.total_ventas, 0);
  assert.equal((await call('GET', '/mapa/ventas?fecha=2000-01-01', null, ctx.admin)).body.total_ventas, 0);
  // una venta de cliente que paga antes (pendiente de aprobación) también sale en el mapa, marcada como pendiente
  await call('PUT', `/clientes/${ctx.cli2}`, { nombre: 'Tienda Sin Mapa', paga_antes: 1 }, ctx.admin);
  await call('POST', '/remisiones', { cliente_id: ctx.cli2, tipo_pago: 'contado', lat: 7.9, lng: -76.7, items: [{ producto_id: ctx.pan, cantidad: 1 }] }, ctx.nico);
  const m2 = (await call('GET', '/mapa/ventas', null, ctx.admin)).body;
  assert.equal(m2.con_ubicacion, 2);
  assert.deepEqual(m2.ventas.map((v) => v.pendiente), [false, true]);
  // tiendas
  const c = (await call('GET', '/mapa/clientes', null, ctx.admin)).body;
  assert.equal(c.con_ubicacion, 1);
  assert.equal(c.sin_ubicacion, 1);
  assert.equal(c.clientes[0].nombre, 'Tienda Mapa');
  assert.equal((await call('GET', `/mapa/clientes?ruta_id=${ctx.r1}`, null, ctx.vera)).status, 403);
});
