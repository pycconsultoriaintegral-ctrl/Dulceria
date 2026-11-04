import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './ayuda.js';

const { server, call, login } = await iniciar();

test('flujo completo: compra -> cargue -> venta -> abono -> cierre -> anulación -> reportes', async () => {
  const admin = await login('admin', 'admin123');
  const bodega = (await call('GET', '/bodegas', null, admin)).body[0].id; // la bodega principal que se crea sola
  const ruta = (await call('POST', '/rutas', { nombre: 'Norte', bodega_id: bodega }, admin)).body.id;
  await call('POST', '/usuarios', { nombre: 'Vende', usuario: 'vende', clave: 'secreto1', rol: 'vendedor', ruta_id: ruta }, admin);
  const vend = await login('vende', 'secreto1');
  const prod = (await call('POST', '/productos', { nombre: 'Papas', precio: 1200, costo: 0 }, admin)).body.id;

  assert.equal((await call('POST', '/productos', { nombre: 'X' }, vend)).status, 403);
  assert.equal((await call('POST', '/compras', { bodega_id: bodega, items: [{ producto_id: prod, cantidad: 100, costo: 800 }] }, admin)).status, 200);
  // el vendedor no puede comprar ni cargar
  assert.equal((await call('POST', '/compras', { bodega_id: bodega, items: [{ producto_id: prod, cantidad: 1, costo: 1 }] }, vend)).status, 403);
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: ruta, sentido: 'cargue', items: [{ producto_id: prod, cantidad: 500 }] }, admin)).status, 409);
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: ruta, sentido: 'cargue', items: [{ producto_id: prod, cantidad: 40 }] }, admin)).status, 200);

  const cli = (await call('POST', '/clientes', { nombre: 'Marta' }, vend)).body.id;
  // no se puede vender más de lo que hay en la ruta
  assert.equal((await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', items: [{ producto_id: prod, cantidad: 41 }] }, vend)).status, 409);

  const v1 = (await call('POST', '/remisiones', { uuid: 'u-1', cliente_id: cli, tipo_pago: 'credito', abono: 2000, items: [{ producto_id: prod, cantidad: 10 }] }, vend)).body;
  assert.equal(v1.total, 12000);
  // idempotencia (reintento sin conexión)
  const rep = (await call('POST', '/remisiones', { uuid: 'u-1', cliente_id: cli, tipo_pago: 'credito', items: [{ producto_id: prod, cantidad: 10 }] }, vend)).body;
  assert.equal(rep.consecutivo, v1.consecutivo);
  await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', items: [{ producto_id: prod, cantidad: 5 }] }, vend);

  assert.equal((await call('GET', `/clientes/${cli}`, null, vend)).body.saldo, 10000);
  assert.equal((await call('POST', '/pagos', { cliente_id: cli, valor: 20000 }, vend)).status, 400);
  assert.equal((await call('POST', '/pagos', { cliente_id: cli, valor: 4000 }, vend)).status, 200);
  assert.equal((await call('GET', `/clientes/${cli}`, null, vend)).body.saldo, 6000);

  const inv = (await call('GET', '/inventario?ub=resumen', null, admin)).body.productos[0];
  assert.equal(inv.por_bodega[bodega], 60);
  assert.equal(inv.en_rutas, 25);
  assert.equal((await call('GET', `/inventario?ub=R${ruta}`, null, vend)).body.productos[0].cantidad, 25);

  const cierre = (await call('GET', '/cierre', null, vend)).body;
  assert.equal(cierre.ventas_total, 18000);
  assert.equal(cierre.cobrado, 2000 + 6000 + 4000);
  await call('POST', '/gastos', { concepto: 'Gasolina', valor: 3000 }, vend);
  const c2 = (await call('POST', '/cierre', { entregado: 9000 }, vend)).body;
  assert.equal(c2.esperado, 9000);
  assert.equal(c2.cierre.diferencia, 0);

  const pdf = await call('GET', `/remisiones/${v1.id}/pdf`, null, vend);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  const pdfCarta = await call('GET', `/remisiones/${v1.id}/pdf?formato=carta`, null, vend);
  assert.equal(pdfCarta.body.subarray(0, 4).toString(), '%PDF');

  assert.equal((await call('POST', `/remisiones/${v1.id}/anular`, { motivo: 'error' }, vend)).status, 200);
  assert.equal((await call('GET', `/clientes/${cli}`, null, vend)).body.saldo, 0);
  assert.equal((await call('GET', `/inventario?ub=R${ruta}`, null, admin)).body.productos[0].cantidad, 35);
  const rep2 = (await call('GET', '/reportes/resumen', null, admin)).body;
  assert.equal(rep2.ventas, 6000);
  assert.equal((await call('GET', '/reportes/resumen', null, vend)).status, 403);
  server.close();
});
