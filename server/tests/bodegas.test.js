import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './ayuda.js';

const { server, call, login } = await iniciar();

// Escenario: Bodega 1 (con Ruta Norte) y Bodega 2 (con Ruta Occidente y Ruta Sur), un encargado por bodega
const ctx = {};
test('preparar bodegas, rutas, usuarios y productos', async () => {
  const admin = ctx.admin = await login('admin', 'admin123');
  ctx.b1 = (await call('GET', '/bodegas', null, admin)).body[0].id;
  ctx.b2 = (await call('POST', '/bodegas', { nombre: 'Occidente' }, admin)).body.id;
  assert.equal((await call('POST', '/bodegas', { nombre: 'Occidente' }, admin)).status, 409);
  ctx.rNorte = (await call('POST', '/rutas', { nombre: 'Norte', bodega_id: ctx.b1 }, admin)).body.id;
  ctx.rOcc = (await call('POST', '/rutas', { nombre: 'Occidente 1', bodega_id: ctx.b2 }, admin)).body.id;
  ctx.rSur = (await call('POST', '/rutas', { nombre: 'Sur', bodega_id: ctx.b2 }, admin)).body.id;
  assert.equal((await call('POST', '/rutas', { nombre: 'Sin bodega' }, admin)).status, 400);

  // validaciones de usuarios por rol
  assert.equal((await call('POST', '/usuarios', { nombre: 'X', usuario: 'x', clave: 'secreto1', rol: 'bodeguero' }, admin)).status, 400);
  assert.equal((await call('POST', '/usuarios', { nombre: 'X', usuario: 'x', clave: 'secreto1', rol: 'vendedor' }, admin)).status, 400);
  assert.equal((await call('POST', '/usuarios', { nombre: 'Ana', usuario: 'ana', clave: 'secreto1', rol: 'bodeguero', bodega_id: ctx.b1 }, admin)).status, 200);
  assert.equal((await call('POST', '/usuarios', { nombre: 'Luis', usuario: 'luis', clave: 'secreto1', rol: 'bodeguero', bodega_id: ctx.b2 }, admin)).status, 200);
  assert.equal((await call('POST', '/usuarios', { nombre: 'Vera', usuario: 'vera', clave: 'secreto1', rol: 'vendedor', ruta_id: ctx.rOcc }, admin)).status, 200);
  assert.equal((await call('POST', '/usuarios', { nombre: 'Nico', usuario: 'nico', clave: 'secreto1', rol: 'vendedor', ruta_id: ctx.rNorte }, admin)).status, 200);
  ctx.ana = await login('ana', 'secreto1');
  ctx.luis = await login('luis', 'secreto1');
  ctx.vera = await login('vera', 'secreto1');
  ctx.nico = await login('nico', 'secreto1');
  ctx.prod = (await call('POST', '/productos', { nombre: 'Julypan grande', precio: 1000, costo: 0, stock_minimo: 20 }, admin)).body.id;
  ctx.prod2 = (await call('POST', '/productos', { nombre: 'Algusto grande', precio: 2000, costo: 0 }, admin)).body.id;

  // el administrador no puede quitarse su propio rol
  const yo = (await call('GET', '/auth/me', null, admin)).body.id;
  assert.equal((await call('PUT', `/usuarios/${yo}`, { rol: 'vendedor', ruta_id: ctx.rNorte }, admin)).status, 409);
});

test('cada encargado compra para su bodega y solo ve la suya', async () => {
  const { admin, ana, luis, b1, b2, prod, prod2 } = ctx;
  assert.equal((await call('POST', '/compras', { bodega_id: b1, items: [{ producto_id: prod, cantidad: 100, costo: 600 }, { producto_id: prod2, cantidad: 10, costo: 1500 }] }, admin)).status, 200);
  // el encargado de Occidente compra: aunque pida la bodega 1, llega a la suya
  assert.equal((await call('POST', '/compras', { bodega_id: b1, items: [{ producto_id: prod, cantidad: 50, costo: 700 }] }, luis)).status, 200);

  const invAna = (await call('GET', `/inventario?ub=B${b1}`, null, ana)).body;
  assert.equal(invAna.productos.find((p) => p.id === prod).cantidad, 100);
  const invLuis = (await call('GET', `/inventario?ub=B${b2}`, null, luis)).body;
  assert.equal(invLuis.productos.find((p) => p.id === prod).cantidad, 50);
  assert.equal((await call('GET', `/inventario?ub=B${b1}`, null, luis)).status, 403);
  assert.equal((await call('GET', `/inventario?ub=B${b2}`, null, ana)).status, 403);

  // el resumen del encargado incluye solo su bodega
  const res = (await call('GET', '/inventario?ub=resumen', null, luis)).body;
  assert.deepEqual(res.bodegas.map((b) => b.id), [b2]);
  assert.equal(res.productos.find((p) => p.id === prod).total, 50);
  assert.equal((await call('GET', '/inventario?ub=resumen', null, ctx.vera)).status, 403);

  // el encargado no ve las compras de otra bodega
  assert.equal((await call('GET', '/compras', null, luis)).body.length, 1);
  assert.equal((await call('GET', '/compras', null, admin)).body.length, 2);
  // pero no puede anularlas ni pagarlas
  const id = (await call('GET', '/compras', null, luis)).body[0].id;
  assert.equal((await call('POST', `/compras/${id}/anular`, {}, luis)).status, 403);
  // costo promedio ponderado entre bodegas: (100*600 + 50*700) / 150
  const p = (await call('GET', '/productos?todos=1', null, admin)).body.find((x) => x.id === prod);
  assert.equal(Math.round(p.costo), 633);
});

test('traslado entre bodegas: enviar, recibir con faltante, y permisos', async () => {
  const { admin, ana, luis, b1, b2, prod } = ctx;
  assert.equal((await call('POST', '/traslados', { origen_id: b1, destino_id: b1, items: [{ producto_id: prod, cantidad: 1 }] }, ana)).status, 400);
  // luis no puede enviar desde la bodega 1
  assert.equal((await call('POST', '/traslados', { origen_id: b1, destino_id: b2, items: [{ producto_id: prod, cantidad: 1 }] }, luis)).status, 403);
  // no se puede enviar más de lo que hay
  assert.equal((await call('POST', '/traslados', { origen_id: b1, destino_id: b2, items: [{ producto_id: prod, cantidad: 999 }] }, ana)).status, 409);

  const t = (await call('POST', '/traslados', { origen_id: b1, destino_id: b2, items: [{ producto_id: prod, cantidad: 30 }], nota: 'Reposición' }, ana)).body.id;
  // en tránsito: ya salió de la bodega 1 y todavía no entra a la 2
  assert.equal((await call('GET', `/inventario?ub=B${b1}`, null, ana)).body.productos.find((p) => p.id === prod).cantidad, 70);
  assert.equal((await call('GET', `/inventario?ub=B${b2}`, null, luis)).body.productos.find((p) => p.id === prod).cantidad, 50);
  assert.equal((await call('GET', '/traslados?estado=enviado', null, luis)).body.length, 1);

  // la bodega de origen no puede recibir; recibir más de lo enviado falla
  assert.equal((await call('POST', `/traslados/${t}/recibir`, {}, ana)).status, 403);
  assert.equal((await call('POST', `/traslados/${t}/recibir`, { items: [{ producto_id: prod, cantidad_recibida: 31 }] }, luis)).status, 400);
  // luis recibe 28 de 30: quedan 2 de faltante registrados
  const r = (await call('POST', `/traslados/${t}/recibir`, { items: [{ producto_id: prod, cantidad_recibida: 28 }] }, luis)).body;
  assert.equal(r.estado, 'recibido');
  assert.equal(r.items[0].cantidad, 30);
  assert.equal(r.items[0].cantidad_recibida, 28);
  assert.equal((await call('GET', `/inventario?ub=B${b2}`, null, luis)).body.productos.find((p) => p.id === prod).cantidad, 78);
  assert.equal((await call('POST', `/traslados/${t}/recibir`, {}, luis)).status, 409); // ya recibido
  assert.equal((await call('POST', `/traslados/${t}/anular`, {}, ana)).status, 409);

  // anular un envío pendiente devuelve la mercancía a la bodega de origen
  const t2 = (await call('POST', '/traslados', { origen_id: b1, destino_id: b2, items: [{ producto_id: prod, cantidad: 10 }] }, ana)).body.id;
  assert.equal((await call('GET', `/inventario?ub=B${b1}`, null, ana)).body.productos.find((p) => p.id === prod).cantidad, 60);
  assert.equal((await call('POST', `/traslados/${t2}/anular`, {}, luis)).status, 403);
  assert.equal((await call('POST', `/traslados/${t2}/anular`, {}, ana)).status, 200);
  assert.equal((await call('GET', `/inventario?ub=B${b1}`, null, ana)).body.productos.find((p) => p.id === prod).cantidad, 70);
  // el vendedor no ve traslados
  assert.equal((await call('GET', '/traslados', null, ctx.vera)).status, 403);
  // el kardex deja rastro del traslado
  const k = (await call('GET', `/inventario/kardex/${prod}?ub=B${b2}`, null, luis)).body;
  assert.ok(k.some((m) => m.tipo === 'traslado_entrada' && m.cantidad === 28));
  assert.ok((await call('GET', `/inventario/kardex/${prod}`, null, admin)).body.some((m) => m.tipo === 'traslado_salida'));
  assert.equal((await call('GET', `/inventario/kardex/${prod}?ub=B${b1}`, null, luis)).status, 403);
  // el kardex del encargado no incluye movimientos de la otra bodega
  assert.ok((await call('GET', `/inventario/kardex/${prod}`, null, luis)).body.every((m) => m.ubicacion === `B${b2}` || m.ubicacion.startsWith('R')));
});

test('cargue y devolución solo desde la bodega a la que pertenece la ruta', async () => {
  const { admin, ana, luis, vera, rOcc, rNorte, b2, prod } = ctx;
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: rOcc, sentido: 'cargue', items: [{ producto_id: prod, cantidad: 20 }] }, ana)).status, 403);
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: rNorte, sentido: 'cargue', items: [{ producto_id: prod, cantidad: 20 }] }, luis)).status, 403);
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: rOcc, sentido: 'cargue', items: [{ producto_id: prod, cantidad: 20 }] }, vera)).status, 403);
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: rOcc, sentido: 'cargue', items: [{ producto_id: prod, cantidad: 20 }] }, luis)).status, 200);
  // salió de la bodega 2 (78 -> 58) y está en la ruta
  assert.equal((await call('GET', `/inventario?ub=B${b2}`, null, luis)).body.productos.find((p) => p.id === prod).cantidad, 58);
  assert.equal((await call('GET', `/inventario?ub=R${rOcc}`, null, vera)).body.productos.find((p) => p.id === prod).cantidad, 20);
  // el vendedor no ve ni la bodega ni otras rutas
  assert.equal((await call('GET', `/inventario?ub=B${b2}`, null, vera)).status, 403);
  assert.equal((await call('GET', `/inventario?ub=R${rNorte}`, null, vera)).status, 403);
  // devolución parcial
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: rOcc, sentido: 'devolucion', items: [{ producto_id: prod, cantidad: 5 }] }, luis)).status, 200);
  assert.equal((await call('GET', `/inventario?ub=B${b2}`, null, luis)).body.productos.find((p) => p.id === prod).cantidad, 63);
  // el ajuste por conteo también respeta el alcance
  assert.equal((await call('POST', '/inventario/ajuste', { producto_id: prod, ub: `B${ctx.b1}`, cantidad_real: 0 }, luis)).status, 403);
  assert.equal((await call('POST', '/inventario/ajuste', { producto_id: prod, ub: `B${b2}`, cantidad_real: 60, nota: 'conteo' }, luis)).status, 200);
  assert.equal((await call('GET', `/inventario?ub=B${b2}`, null, luis)).body.productos.find((p) => p.id === prod).cantidad, 60);
});

test('ventas: de ruta, de mostrador de bodega, clientes y cierres por punto', async () => {
  const { admin, ana, luis, vera, nico, rOcc, rNorte, b1, b2, prod } = ctx;
  const cliOcc = (await call('POST', '/clientes', { nombre: 'Tienda Occ' }, vera)).body.id; // queda en la ruta de Vera
  const cliNorte = (await call('POST', '/clientes', { nombre: 'Tienda Norte' }, nico)).body.id;
  // visibilidad de clientes por rol
  const nombres = async (t) => (await call('GET', '/clientes', null, t)).body.map((c) => c.nombre);
  assert.deepEqual(await nombres(vera), ['Tienda Occ']);
  assert.deepEqual(await nombres(luis), ['Tienda Occ']);
  assert.deepEqual(await nombres(ana), ['Tienda Norte']);
  assert.equal((await call('GET', `/clientes/${cliNorte}`, null, luis)).status, 403);

  // venta de ruta (Vera)
  const v = (await call('POST', '/remisiones', { cliente_id: cliOcc, tipo_pago: 'contado', items: [{ producto_id: prod, cantidad: 4 }] }, vera)).body;
  assert.equal(v.total, 4000);
  // Vera no puede vender a clientes de otra ruta ni elegir otro punto
  assert.equal((await call('POST', '/remisiones', { cliente_id: cliNorte, tipo_pago: 'contado', items: [{ producto_id: prod, cantidad: 1 }] }, vera)).status, 403);
  // venta de mostrador de la bodega 2 por el encargado
  const m = (await call('POST', '/remisiones', { punto: `B${b2}`, cliente_id: cliOcc, tipo_pago: 'contado', items: [{ producto_id: prod, cantidad: 10 }] }, luis)).body;
  assert.equal((await call('GET', `/inventario?ub=B${b2}`, null, luis)).body.productos.find((p) => p.id === prod).cantidad, 50);
  // el encargado no puede vender desde el mostrador de otra bodega
  assert.equal((await call('POST', '/remisiones', { punto: `B${b1}`, cliente_id: cliOcc, tipo_pago: 'contado', items: [{ producto_id: prod, cantidad: 1 }] }, luis)).status, 403);
  // el administrador debe elegir el punto
  assert.equal((await call('POST', '/remisiones', { cliente_id: cliOcc, tipo_pago: 'contado', items: [{ producto_id: prod, cantidad: 1 }] }, ctx.admin)).status, 400);

  // alcance de las remisiones
  const lista = async (t, q = '') => (await call('GET', `/remisiones${q}`, null, t)).body.map((r) => r.consecutivo).sort();
  assert.deepEqual(await lista(vera), [v.consecutivo]);
  assert.deepEqual(await lista(luis), [v.consecutivo, m.consecutivo].sort());
  assert.deepEqual(await lista(ana), []);
  assert.deepEqual(await lista(luis, `?punto=B${b2}`), [m.consecutivo]);
  assert.equal((await call('GET', `/remisiones?punto=B${b1}`, null, luis)).status, 403);
  assert.equal((await call('GET', `/remisiones/${m.id}`, null, vera)).status, 403); // mostrador: no es de su ruta
  assert.equal((await call('GET', `/remisiones/${v.id}`, null, ana)).status, 403);
  const det = (await call('GET', `/remisiones/${m.id}`, null, luis)).body;
  assert.match(det.punto, /^Mostrador /);
  assert.equal((await call('GET', `/remisiones/${m.id}/pdf`, null, luis)).body.subarray(0, 4).toString(), '%PDF');

  // cierres por punto: mostrador del encargado y ruta de la vendedora
  const cm = (await call('GET', `/cierre?punto=B${b2}`, null, luis)).body;
  assert.equal(cm.ventas_total, 10000);
  assert.equal(cm.cobrado, 10000);
  assert.equal((await call('GET', `/cierre?punto=B${b1}`, null, luis)).status, 403);
  assert.equal((await call('GET', `/cierre?punto=R${rNorte}`, null, vera)).body.punto, `R${rOcc}`); // el vendedor siempre usa su ruta
  const cr = (await call('GET', '/cierre', null, vera)).body;
  assert.equal(cr.ventas_total, 4000);
  assert.equal((await call('POST', '/cierre', { punto: `B${b2}`, entregado: 10000 }, luis)).body.cierre.diferencia, 0);
  // cartera: abono de un crédito en el mostrador no mezcla otras bodegas
  const cred = (await call('POST', '/remisiones', { punto: `B${b2}`, cliente_id: cliOcc, tipo_pago: 'credito', items: [{ producto_id: prod, cantidad: 2 }] }, luis)).body;
  assert.equal((await call('GET', '/cartera', null, luis)).body.total, 2000);
  assert.equal((await call('GET', '/cartera', null, ana)).body.total, 0);
  assert.equal((await call('POST', '/pagos', { punto: `B${b2}`, cliente_id: cliOcc, valor: 500, metodo: 'transferencia' }, luis)).status, 200);
  assert.equal((await call('POST', '/pagos', { punto: `B${b2}`, cliente_id: cliOcc, valor: 5, metodo: 'cripto' }, luis)).status, 400);
  assert.equal((await call('GET', '/cartera', null, luis)).body.total, 1500);
  // anular una venta de mostrador devuelve al inventario del mostrador
  assert.equal((await call('POST', `/remisiones/${cred.id}/anular`, { motivo: 'prueba' }, luis)).status, 200);
  assert.equal((await call('GET', `/inventario?ub=B${b2}`, null, luis)).body.productos.find((p) => p.id === prod).cantidad, 50);
});

test('un cliente compartido entre rutas: cada uno ve y cobra solo la deuda de su alcance', async () => {
  const { admin, nico, vera, luis, ana, prod, rNorte, rOcc, b1 } = ctx;
  // la ruta Norte necesita inventario
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: rNorte, sentido: 'cargue', items: [{ producto_id: prod, cantidad: 10 }] }, ana)).status, 200);
  const comp = (await call('POST', '/clientes', { nombre: 'Compartido' }, admin)).body.id; // sin ruta: es de todos
  assert.equal((await call('POST', '/remisiones', { cliente_id: comp, tipo_pago: 'credito', items: [{ producto_id: prod, cantidad: 3 }] }, nico)).status, 200); // 3000 en Norte
  assert.equal((await call('POST', '/remisiones', { cliente_id: comp, tipo_pago: 'credito', items: [{ producto_id: prod, cantidad: 2 }] }, vera)).status, 200); // 2000 en Occidente
  const saldo = async (t) => (await call('GET', `/clientes/${comp}`, null, t)).body.saldo;
  assert.equal(await saldo(nico), 3000);
  assert.equal(await saldo(ana), 3000);
  assert.equal(await saldo(vera), 2000);
  assert.equal(await saldo(luis), 2000);
  assert.equal(await saldo(admin), 5000);
  // no se puede cobrar más que la deuda del propio alcance, y el abono no toca la deuda de la otra ruta
  assert.equal((await call('POST', '/pagos', { cliente_id: comp, valor: 3500 }, nico)).status, 400);
  assert.equal((await call('POST', '/pagos', { cliente_id: comp, valor: 3000 }, nico)).status, 200);
  assert.equal(await saldo(nico), 0);
  assert.equal(await saldo(vera), 2000);
  assert.equal(await saldo(admin), 2000);
  // el historial del cliente también se limita al alcance
  assert.equal((await call('GET', `/clientes/${comp}`, null, vera)).body.remisiones.length, 1);
  assert.equal((await call('GET', `/clientes/${comp}`, null, admin)).body.remisiones.length, 2);
});

test('reportes por bodega y alertas de stock bajo', async () => {
  const { admin, ana, luis, vera, b1, b2, prod } = ctx;
  const global = (await call('GET', '/reportes/resumen', null, admin)).body;
  const bod2 = (await call('GET', `/reportes/resumen?bodega_id=${b2}`, null, admin)).body;
  const delLuis = (await call('GET', '/reportes/resumen', null, luis)).body;
  // Occidente: 4000 de ruta + 10000 de mostrador + 2000 del cliente compartido; Norte: 3000
  assert.equal(global.ventas, 19000);
  assert.equal(bod2.ventas, 16000);
  assert.equal(delLuis.ventas, 16000);
  assert.equal(bod2.bodega_id, b2);
  assert.equal((await call('GET', '/reportes/resumen', null, ana)).body.ventas, 3000);
  assert.equal((await call('GET', `/reportes/resumen?bodega_id=${b1}`, null, luis)).status, 403);
  assert.equal((await call('GET', '/reportes/resumen', null, vera)).status, 403);
  assert.deepEqual(global.por_bodega.map((b) => b.bodega), ['Occidente', 'Bodega principal']);
  assert.ok(global.por_ruta.some((x) => x.punto === 'Ruta Occidente 1') && global.por_ruta.some((x) => x.punto === 'Mostrador Occidente'));
  // inventario valorizado del alcance: el encargado ve solo lo suyo
  assert.ok(global.valor_inventario > delLuis.valor_inventario);
  // stock mínimo 20 de "Julypan": cada bodega se evalúa por separado (la de Ana tiene 70, Occidente 50)
  assert.equal(global.stock_bajo.filter((x) => x.id === prod).length, 0);
  await call('POST', '/inventario/ajuste', { producto_id: prod, ub: `B${b1}`, cantidad_real: 5 }, admin);
  const bajo = (await call('GET', '/reportes/resumen', null, admin)).body.stock_bajo.filter((x) => x.id === prod);
  assert.equal(bajo.length, 1);
  assert.equal(bajo[0].bodega_id, b1);
  assert.equal((await call('GET', '/reportes/resumen', null, luis)).body.stock_bajo.filter((x) => x.id === prod).length, 0);
});

test('administración de bodegas: no se desactiva una bodega con rutas o inventario', async () => {
  const { admin, b2, rOcc, rSur, b1 } = ctx;
  assert.equal((await call('PUT', `/bodegas/${b2}`, { activa: 0 }, admin)).status, 409); // tiene rutas activas
  // mover una ruta a otra bodega
  assert.equal((await call('PUT', `/rutas/${rSur}`, { bodega_id: b1 }, admin)).status, 200);
  assert.equal((await call('PUT', `/rutas/${rOcc}`, { bodega_id: b1 }, admin)).status, 200);
  assert.equal((await call('PUT', `/bodegas/${b2}`, { activa: 0 }, admin)).status, 409); // aún tiene inventario
  const ub = (await call('GET', '/ubicaciones', null, ctx.ana)).body.bodegas;
  assert.equal(ub.length, 1);
  assert.equal(ub[0].rutas.length, 3);
  assert.equal((await call('GET', '/ubicaciones', null, admin)).body.bodegas.length, 2);
  assert.deepEqual((await call('GET', '/ubicaciones', null, ctx.vera)).body.bodegas.map((b) => b.rutas.map((r) => r.id)), [[rOcc]]);
  server.close();
});
