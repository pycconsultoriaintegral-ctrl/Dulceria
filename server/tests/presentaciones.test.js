import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './ayuda.js';

const { server, call, login } = await iniciar();
after(() => server.close());
const ctx = {};
const stock = async (t, ub, id) => (await call('GET', `/inventario?ub=${ub}`, null, t)).body.productos.find((p) => p.id === id).cantidad;

test('un producto con presentaciones: validaciones y consulta', async () => {
  const admin = ctx.admin = await login('admin', 'admin123');
  ctx.b1 = (await call('GET', '/bodegas', null, admin)).body[0].id;
  ctx.b2 = (await call('POST', '/bodegas', { nombre: 'Occidente' }, admin)).body.id;
  ctx.ruta = (await call('POST', '/rutas', { nombre: 'Norte', bodega_id: ctx.b1 }, admin)).body.id;
  await call('POST', '/usuarios', { nombre: 'Nico Vendedor', usuario: 'nico', clave: 'secreto1', rol: 'vendedor', ruta_id: ctx.ruta }, admin);
  ctx.nico = await login('nico', 'secreto1');
  // equivalencia 1 o repetida no son válidas
  const malo = { nombre: 'X', precio: 1, presentaciones: [{ nombre: 'caja', factor: 1 }] };
  assert.equal((await call('POST', '/productos', malo, admin)).status, 400);
  assert.equal((await call('POST', '/productos', { ...malo, presentaciones: [{ nombre: 'caja', factor: 20 }, { nombre: 'Caja', factor: 24 }] }, admin)).status, 400);
  assert.equal((await call('GET', '/productos?todos=1', null, admin)).body.length, 0); // nada quedó a medias

  const id = (await call('POST', '/productos', { nombre: 'JULYPAN GRANDE', unidad: 'und', precio: 1500, costo: 0,
    presentaciones: [{ nombre: 'caja', factor: 20 }, { nombre: 'estiba', factor: 400, precio: 560000 }] }, admin)).body.id;
  ctx.jp = id;
  const p = (await call('GET', '/productos', null, admin)).body.find((x) => x.id === id);
  assert.deepEqual(p.presentaciones.map((x) => [x.nombre, x.factor, x.precio]), [['caja', 20, null], ['estiba', 400, 560000]]);
  ctx.caja = p.presentaciones[0].id;
  ctx.estiba = p.presentaciones[1].id;
  // una presentación de otro producto no se puede usar
  ctx.otro = (await call('POST', '/productos', { nombre: 'OTRO', precio: 100, presentaciones: [{ nombre: 'paca', factor: 6 }] }, admin)).body.id;
  ctx.paca = (await call('GET', '/productos', null, admin)).body.find((x) => x.id === ctx.otro).presentaciones[0].id;
  // el vendedor también ve las presentaciones pero no los costos
  const v = (await call('GET', '/productos', null, ctx.nico)).body.find((x) => x.id === id);
  assert.equal(v.presentaciones.length, 2);
  assert.equal(v.costo, undefined);
});

test('compra en estibas: el inventario sube en unidades y el costo queda por unidad', async () => {
  const { admin, b1, jp, estiba, paca } = ctx;
  assert.equal((await call('POST', '/compras', { bodega_id: b1, items: [{ producto_id: jp, presentacion_id: paca, cantidad: 1, costo: 1 }] }, admin)).status, 400);
  const c = (await call('POST', '/compras', { bodega_id: b1, items: [{ producto_id: jp, presentacion_id: estiba, cantidad: 2, costo: 200000 }] }, admin)).body.id;
  assert.equal(await stock(admin, `B${b1}`, jp), 800); // 2 estibas x 400
  const producto = (await call('GET', '/productos?todos=1', null, admin)).body.find((x) => x.id === jp);
  assert.equal(producto.costo, 500); // 200.000 / 400 unidades
  const det = (await call('GET', `/compras/${c}`, null, admin)).body;
  assert.equal(det.total, 400000);
  assert.equal(det.items[0].presentacion, 'estiba');
  assert.equal(det.items[0].factor, 400);
  // una segunda compra suelta (en unidades) promedia el costo por unidad
  await call('POST', '/compras', { bodega_id: b1, items: [{ producto_id: jp, cantidad: 800, costo: 800 }] }, admin);
  assert.equal(await stock(admin, `B${b1}`, jp), 1600);
  assert.equal((await call('GET', '/productos?todos=1', null, admin)).body.find((x) => x.id === jp).costo, 650); // (800*500 + 800*800) / 1600
  // anular la compra en estibas descuenta las 800 unidades
  assert.equal((await call('POST', `/compras/${c}/anular`, {}, admin)).status, 200);
  assert.equal(await stock(admin, `B${b1}`, jp), 800);
  await call('POST', '/compras', { bodega_id: b1, items: [{ producto_id: jp, presentacion_id: estiba, cantidad: 2, costo: 200000 }] }, admin); // vuelve a 1600
});

test('cargue, traslado y ajuste en presentaciones', async () => {
  const { admin, b1, b2, ruta, jp, estiba, caja } = ctx;
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: ruta, sentido: 'cargue', items: [{ producto_id: jp, presentacion_id: estiba, cantidad: 1 }] }, admin)).status, 200);
  assert.equal(await stock(admin, `R${ruta}`, jp), 400);
  assert.equal(await stock(admin, `B${b1}`, jp), 1200);
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: ruta, sentido: 'devolucion', items: [{ producto_id: jp, presentacion_id: caja, cantidad: 5 }] }, admin)).status, 200);
  assert.equal(await stock(admin, `R${ruta}`, jp), 300); // volvieron 5 cajas = 100 unidades
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: ruta, sentido: 'cargue', items: [{ producto_id: jp, cantidad: 100 }] }, admin)).status, 200); // vuelve a 400
  // traslado de una estiba a otra bodega
  const t = (await call('POST', '/traslados', { origen_id: b1, destino_id: b2, items: [{ producto_id: jp, presentacion_id: estiba, cantidad: 1 }] }, admin)).body.id;
  const det = (await call('GET', `/traslados/${t}`, null, admin)).body;
  assert.equal(det.items[0].cantidad, 400); // se guarda en unidades base
  await call('POST', `/traslados/${t}/recibir`, { items: [{ producto_id: jp, cantidad_recibida: 380 }] }, admin);
  assert.equal(await stock(admin, `B${b2}`, jp), 380);
  assert.equal(await stock(admin, `B${b1}`, jp), 800); // 1200 - 400 (la devolución y el cargue de 100 unidades se cancelan)
  // conteo físico: la bodega 2 tiene 3 estibas
  assert.equal((await call('POST', '/inventario/ajuste', { producto_id: jp, ub: `B${b2}`, cantidad_real: 3, presentacion_id: estiba }, admin)).status, 200);
  assert.equal(await stock(admin, `B${b2}`, jp), 1200);
});

test('venta en cajas, precio de lista, anulación y reporte de precios bajos', async () => {
  const { admin, nico, ruta, jp, caja, estiba, paca } = ctx;
  const cli = (await call('POST', '/clientes', { nombre: 'Doña Marta' }, nico)).body.id;
  // 3 cajas al precio de lista (1500 x 20 = 30.000)
  const v = (await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', items: [{ producto_id: jp, presentacion_id: caja, cantidad: 3 }] }, nico)).body;
  assert.equal(v.total, 90000);
  assert.equal(await stock(nico, `R${ruta}`, jp), 340); // 400 - 3*20
  const det = (await call('GET', `/remisiones/${v.id}`, null, nico)).body;
  assert.equal(det.items[0].descripcion, 'JULYPAN GRANDE (caja)');
  assert.equal(det.items[0].cantidad, 3);
  assert.equal(det.items[0].precio, 30000);
  assert.equal(det.items[0].factor, 20);
  assert.equal(det.items[0].costo, undefined); // el vendedor no ve costos
  // no se puede vender una estiba entera si en la ruta solo hay 340 unidades
  const sinStock = await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', items: [{ producto_id: jp, presentacion_id: estiba, cantidad: 1 }] }, nico);
  assert.equal(sinStock.status, 409);
  assert.match(sinStock.body.error, /insuficiente/);
  assert.equal(await stock(nico, `R${ruta}`, jp), 340); // la venta rechazada no movió nada
  // venta en unidades sueltas
  assert.equal((await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', items: [{ producto_id: jp, cantidad: 10 }] }, nico)).body.total, 15000);
  // negociada: una caja a 25.000 cuando la lista es 30.000 -> queda marcada en el reporte
  const neg = (await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', items: [{ producto_id: jp, presentacion_id: caja, cantidad: 2, precio: 25000 }] }, nico)).body;
  assert.equal(neg.total, 50000);
  assert.equal(await stock(nico, `R${ruta}`, jp), 340 - 10 - 40);
  // anular la venta de 3 cajas devuelve 60 unidades
  assert.equal((await call('POST', `/remisiones/${v.id}/anular`, { motivo: 'prueba' }, nico)).status, 200);
  assert.equal(await stock(nico, `R${ruta}`, jp), 340 - 10 - 40 + 60);

  const rep = (await call('GET', '/reportes/resumen', null, admin)).body;
  const top = rep.top_productos.find((x) => x.nombre === 'JULYPAN GRANDE');
  assert.equal(top.cantidad, 10 + 40); // en unidades base: 10 sueltas + 2 cajas de 20
  assert.equal(top.ventas, 15000 + 50000);
  assert.equal(rep.precios_bajos.lineas, 1);
  assert.equal(rep.precios_bajos.valor, 10000); // (30.000 - 25.000) x 2 cajas
  assert.equal(rep.precios_bajos.por_vendedor[0].vendedor, 'Nico Vendedor');
  // el costo de lo vendido usa el costo por unidad (575 tras anular y recomprar las 2 estibas): 50 unidades vendidas en total
  assert.equal(rep.costo, (10 + 2 * 20) * 575);
  assert.equal((await call('GET', '/reportes/resumen', null, nico)).status, 403);
});

test('importar presentaciones y conteos en presentaciones', async () => {
  const { admin, b1, otro, jp } = ctx;
  const texto = 'producto;presentacion;equivalencia;precio\nJULYPAN GRANDE;caja;20;\nJULYPAN GRANDE;bulto;100;140.000\nOTRO;paca;6\nNO EXISTE;caja;2\nJULYPAN GRANDE;fardo;1\nJULYPAN GRANDE;Bulto;100';
  const previa = (await call('POST', '/importar/presentaciones', { texto }, admin)).body;
  assert.deepEqual(previa.resumen, { crear: 1, actualizar: 0, ajustar: 0, sin_cambios: 2, errores: 3 });
  assert.match(previa.filas[3].error, /No existe/);
  assert.match(previa.filas[4].error, /Equivalencia inválida/);
  assert.match(previa.filas[5].error, /Repetido/);
  assert.equal((await call('POST', '/importar/presentaciones', { texto, aplicar: true }, admin)).status, 200);
  const p = (await call('GET', '/productos', null, admin)).body.find((x) => x.id === jp);
  assert.deepEqual(p.presentaciones.map((x) => x.nombre).sort(), ['bulto', 'caja', 'estiba']);
  assert.equal(p.presentaciones.find((x) => x.nombre === 'bulto').precio, 140000);

  // conteo de bodega con la presentación en la columna: 2 estibas + 7 sueltas de otro producto
  const conteo = 'producto;cantidad;presentacion\nJULYPAN GRANDE;2;estiba\nOTRO;7;und\nJULYPAN GRANDE;1;barril';
  const previa2 = (await call('POST', '/importar/inventario', { texto: conteo, ub: `B${b1}` }, admin)).body;
  assert.match(previa2.filas[2].error, /no tiene la presentación "barril"|Repetido/);
  const ok = (await call('POST', '/importar/inventario', { texto: conteo.split('\n').slice(0, 3).join('\n'), ub: `B${b1}`, aplicar: true }, admin)).body;
  assert.equal(ok.filas[0].conteo, 800);
  assert.equal(await stock(admin, `B${b1}`, jp), 800);
  assert.equal(await stock(admin, `B${b1}`, otro), 7);
  // quitar una presentación del producto la desactiva pero no rompe lo ya vendido
  const quedan = p.presentaciones.filter((x) => x.nombre !== 'bulto').map((x) => ({ id: x.id, nombre: x.nombre, factor: x.factor, precio: x.precio }));
  assert.equal((await call('PUT', `/productos/${jp}`, { nombre: 'JULYPAN GRANDE', precio: 1500, presentaciones: quedan }, admin)).status, 200);
  assert.deepEqual((await call('GET', '/productos', null, admin)).body.find((x) => x.id === jp).presentaciones.map((x) => x.nombre).sort(), ['caja', 'estiba']);
});
