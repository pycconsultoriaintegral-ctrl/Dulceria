import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './ayuda.js';

const { server, call, login } = await iniciar();
after(() => server.close());

const ctx = {};
test('preparar: bodega, ruta, vendedor, producto con inventario', async () => {
  const admin = ctx.admin = await login('admin', 'admin123');
  ctx.b = (await call('GET', '/bodegas', null, admin)).body[0].id;
  ctx.ruta = (await call('POST', '/rutas', { nombre: 'Carro 1', bodega_id: ctx.b }, admin)).body.id;
  await call('POST', '/usuarios', { nombre: 'Nico', usuario: 'nico', clave: 'secreto1', rol: 'vendedor', ruta_id: ctx.ruta }, admin);
  await call('POST', '/usuarios', { nombre: 'Cora', usuario: 'cora', clave: 'secreto1', rol: 'contador' }, admin);
  ctx.nico = await login('nico', 'secreto1');
  ctx.cora = await login('cora', 'secreto1');
  ctx.prod = (await call('POST', '/productos', { nombre: 'Pan', precio: 1000, costo: 600 }, admin)).body.id;
  await call('POST', '/compras', { bodega_id: ctx.b, items: [{ producto_id: ctx.prod, cantidad: 100, costo: 600 }] }, admin);
  await call('POST', '/inventario/cargue', { ruta_id: ctx.ruta, sentido: 'cargue', items: [{ producto_id: ctx.prod, cantidad: 50 }] }, admin);
  ctx.cli = (await call('POST', '/clientes', { nombre: 'Tienda La Paz' }, ctx.nico)).body.id;
});

test('GPS: la venta y el cliente guardan ubicación válida; la inválida se ignora sin romper la venta', async () => {
  const v = await call('POST', '/remisiones', { cliente_id: ctx.cli, tipo_pago: 'contado', lat: 7.8872, lng: -76.6283, gps_precision: 12.4, items: [{ producto_id: ctx.prod, cantidad: 1 }] }, ctx.nico);
  assert.equal(v.status, 200);
  const r = (await call('GET', `/remisiones/${v.body.id}`, null, ctx.nico)).body;
  assert.deepEqual([r.lat, r.lng, r.gps_precision], [7.8872, -76.6283, 12]);
  const mala = await call('POST', '/remisiones', { cliente_id: ctx.cli, tipo_pago: 'contado', lat: 999, lng: 'x', items: [{ producto_id: ctx.prod, cantidad: 1 }] }, ctx.nico);
  assert.equal(mala.status, 200);
  assert.equal((await call('GET', `/remisiones/${mala.body.id}`, null, ctx.nico)).body.lat, null);
  // ubicación de la tienda
  assert.equal((await call('POST', `/clientes/${ctx.cli}/ubicacion`, { lat: 95, lng: 0 }, ctx.nico)).status, 400);
  assert.equal((await call('POST', `/clientes/${ctx.cli}/ubicacion`, { lat: 7.9, lng: -76.6 }, ctx.nico)).status, 200);
  const c = (await call('GET', `/clientes/${ctx.cli}`, null, ctx.nico)).body;
  assert.deepEqual([c.lat, c.lng], [7.9, -76.6]);
  const nuevo = (await call('POST', '/clientes', { nombre: 'Con GPS', lat: 7.1, lng: -76.2 }, ctx.nico)).body.id;
  assert.equal((await call('GET', `/clientes/${nuevo}`, null, ctx.nico)).body.lat, 7.1);
});

test('turnos: abrir con base, vender, cerrar con diferencia; uno abierto a la vez', async () => {
  assert.equal((await call('GET', '/turnos/actual', null, ctx.nico)).body.turno, null);
  assert.equal((await call('POST', '/turnos/cerrar', { entregado: 0 }, ctx.nico)).status, 409); // nada que cerrar
  assert.equal((await call('POST', '/turnos/abrir', { base: -5 }, ctx.nico)).status, 400);
  assert.equal((await call('POST', '/turnos/abrir', { base: 20000 }, ctx.cora)).status, 403); // el contador no vende
  await new Promise((r) => setTimeout(r, 1100)); // la hora se guarda al segundo: lo vendido antes de abrir no cuenta en el turno
  assert.equal((await call('POST', '/turnos/abrir', { base: 20000 }, ctx.nico)).status, 200);
  assert.equal((await call('POST', '/turnos/abrir', { base: 1 }, ctx.nico)).status, 409);
  await call('POST', '/remisiones', { cliente_id: ctx.cli, tipo_pago: 'contado', items: [{ producto_id: ctx.prod, cantidad: 10 }] }, ctx.nico); // 10.000 en efectivo
  await call('POST', '/remisiones', { cliente_id: ctx.cli, tipo_pago: 'contado', metodo: 'transferencia', items: [{ producto_id: ctx.prod, cantidad: 3 }] }, ctx.nico);
  await call('POST', '/gastos', { concepto: 'Combustible', valor: 4000 }, ctx.nico);
  const act = (await call('GET', '/turnos/actual', null, ctx.nico)).body.turno;
  assert.deepEqual([act.base, act.efectivo, act.transferencias, act.gastos, act.esperado], [20000, 10000, 3000, 4000, 26000]);
  const cierre = (await call('POST', '/turnos/cerrar', { entregado: 25000, nota: 'Faltan 1.000' }, ctx.nico)).body;
  assert.deepEqual([cierre.esperado, cierre.entregado, cierre.diferencia], [26000, 25000, -1000]);
  assert.equal((await call('GET', '/turnos/actual', null, ctx.nico)).body.turno, null);
  // el administrador (con informes) ve los turnos de todos; el contador también; el vendedor solo los suyos
  const lista = (await call('GET', '/turnos', null, ctx.admin)).body;
  assert.equal(lista.length, 1);
  assert.equal(lista[0].diferencia, -1000);
  assert.equal(lista[0].vendedor, 'Nico');
  assert.equal((await call('GET', '/turnos', null, ctx.cora)).body.length, 1);
  assert.equal((await call('GET', '/turnos', null, ctx.nico)).body.length, 1);
});

test('exigir turno: sin turno abierto no se vende; con turno, sí', async () => {
  assert.equal((await call('PUT', '/config', { exigir_turno: 'x' }, ctx.admin)).status, 400);
  await call('PUT', '/config', { exigir_turno: '1' }, ctx.admin);
  const venta = () => call('POST', '/remisiones', { cliente_id: ctx.cli, tipo_pago: 'contado', items: [{ producto_id: ctx.prod, cantidad: 1 }] }, ctx.nico);
  assert.equal((await venta()).status, 409);
  await call('POST', '/turnos/abrir', { base: 0 }, ctx.nico);
  assert.equal((await venta()).status, 200);
  await call('POST', '/turnos/cerrar', { entregado: 1000 }, ctx.nico);
  await call('PUT', '/config', { exigir_turno: '0' }, ctx.admin);
  assert.equal((await venta()).status, 200);
});
