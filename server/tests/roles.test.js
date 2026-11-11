import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './ayuda.js';

const { server, call, login } = await iniciar();
after(() => server.close());

const ctx = {};
test('roles base y nuevos de fábrica; el administrador no se toca', async () => {
  const admin = ctx.admin = await login('admin', 'admin123');
  const roles = (await call('GET', '/roles', null, admin)).body;
  assert.deepEqual(roles.map((r) => r.clave).sort(), ['admin', 'auxiliar', 'bodeguero', 'contador', 'supervisor', 'vendedor']);
  assert.equal(roles.find((r) => r.clave === 'admin').permisos.length, (await call('GET', '/permisos', null, admin)).body.length);
  assert.equal((await call('PUT', '/roles/admin', { permisos: [] }, admin)).status, 409);
  assert.equal((await call('DELETE', '/roles/admin', null, admin)).status, 409);
  assert.equal((await call('DELETE', '/roles/vendedor', null, admin)).status, 409);
  assert.equal((await call('PUT', '/roles/vendedor', { alcance: 'todo' }, admin)).status, 409); // el alcance de un rol base no cambia
  // solo quien administra ve y cambia roles
  ctx.b = (await call('GET', '/bodegas', null, admin)).body[0].id;
  ctx.ruta = (await call('POST', '/rutas', { nombre: 'Norte', bodega_id: ctx.b }, admin)).body.id;
  await call('POST', '/usuarios', { nombre: 'Nico', usuario: 'nico', clave: 'secreto1', rol: 'vendedor', ruta_id: ctx.ruta }, admin);
  ctx.nico = await login('nico', 'secreto1');
  assert.equal((await call('GET', '/roles', null, ctx.nico)).status, 403);
  assert.equal((await call('POST', '/roles', { nombre: 'Hacker', alcance: 'todo', permisos: ['administrar'] }, ctx.nico)).status, 403);
});

test('crear un rol propio, asignarlo y que los permisos se apliquen al instante', async () => {
  const { admin } = ctx;
  assert.equal((await call('POST', '/roles', { nombre: 'Cajero', alcance: 'bodega', permisos: ['inventariox'] }, admin)).status, 400); // permiso inexistente
  assert.equal((await call('POST', '/roles', { nombre: 'Cajero', alcance: 'mundo', permisos: [] }, admin)).status, 400);
  const r = await call('POST', '/roles', { nombre: 'Cajero de mostrador', alcance: 'bodega', permisos: ['vender'] }, admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.clave, 'cajero_de_mostrador');
  assert.equal((await call('POST', '/roles', { nombre: 'Cajero de mostrador', alcance: 'bodega', permisos: [] }, admin)).status, 409);
  // un rol de bodega necesita bodega
  assert.equal((await call('POST', '/usuarios', { nombre: 'Caja', usuario: 'caja', clave: 'secreto1', rol: 'cajero_de_mostrador' }, admin)).status, 400);
  assert.equal((await call('POST', '/usuarios', { nombre: 'Caja', usuario: 'caja', clave: 'secreto1', rol: 'cajero_de_mostrador', bodega_id: ctx.b }, admin)).status, 200);
  assert.equal((await call('POST', '/usuarios', { nombre: 'Rara', usuario: 'rara', clave: 'secreto1', rol: 'inexistente' }, admin)).status, 400);
  const caja = await login('caja', 'secreto1');
  const me = (await call('GET', '/auth/me', null, caja)).body;
  assert.deepEqual(me.permisos, ['vender']);
  assert.equal(me.alcance, 'bodega');
  assert.equal(me.rol_nombre, 'Cajero de mostrador');
  const prod = (await call('POST', '/productos', { nombre: 'Pan', precio: 1000, costo: 600 }, admin)).body.id;
  // sin permisos de compras, inventario, productos, informes
  assert.equal((await call('POST', '/compras', { bodega_id: ctx.b, items: [{ producto_id: prod, cantidad: 1, costo: 1 }] }, caja)).status, 403);
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: ctx.ruta, sentido: 'cargue', items: [{ producto_id: prod, cantidad: 1 }] }, caja)).status, 403);
  assert.equal((await call('POST', '/productos', { nombre: 'X' }, caja)).status, 403);
  assert.equal((await call('GET', '/informes/productos.xlsx', null, caja)).status, 403);
  assert.equal((await call('GET', '/usuarios', null, caja)).status, 403);
  assert.equal((await call('GET', '/productos', null, caja)).body[0].costo, undefined); // sin ver_costos
  // se le da "ver costos" + "inventario" y funciona sin volver a entrar
  assert.equal((await call('PUT', '/roles/cajero_de_mostrador', { permisos: ['vender', 'ver_costos', 'inventario'] }, admin)).status, 200);
  assert.equal((await call('GET', '/productos', null, caja)).body[0].costo, 600);
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: ctx.ruta, sentido: 'cargue', items: [{ producto_id: prod, cantidad: 1 }] }, caja)).status !== 403, true);
  // y se le quita "vender"
  await call('PUT', '/roles/cajero_de_mostrador', { permisos: ['ver_costos'] }, admin);
  const cli = (await call('POST', '/clientes', { nombre: 'Marta' }, admin)).body.id;
  assert.equal((await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', punto: `B${ctx.b}`, items: [{ producto_id: prod, cantidad: 1 }] }, caja)).status, 403);
  // un rol con usuarios no se elimina; sin usuarios, sí
  assert.equal((await call('DELETE', '/roles/cajero_de_mostrador', null, admin)).status, 409);
  await call('PUT', `/usuarios/${(await call('GET', '/usuarios', null, admin)).body.find((u) => u.usuario === 'caja').id}`, { rol: 'vendedor', ruta_id: ctx.ruta }, admin);
  assert.equal((await call('DELETE', '/roles/cajero_de_mostrador', null, admin)).status, 200);
});

test('contador: ve costos e informes pero no vende ni cambia el catálogo; siempre queda un administrador', async () => {
  const { admin } = ctx;
  assert.equal((await call('POST', '/usuarios', { nombre: 'Cora', usuario: 'cora', clave: 'secreto1', rol: 'contador' }, admin)).status, 200);
  const cora = await login('cora', 'secreto1');
  assert.equal((await call('GET', '/informes/productos.xlsx', null, cora)).status, 200);
  assert.equal((await call('POST', '/productos', { nombre: 'X' }, cora)).status, 403);
  assert.equal((await call('POST', '/remisiones', { cliente_id: 1, tipo_pago: 'contado', items: [] }, cora)).status, 403);
  assert.equal((await call('GET', '/auditoria', null, cora)).status, 403);
  const yo = (await call('GET', '/auth/me', null, admin)).body.id;
  assert.equal((await call('PUT', `/usuarios/${yo}`, { rol: 'contador' }, admin)).status, 409);
  // un segundo administrador permite que el primero cambie
  await call('POST', '/usuarios', { nombre: 'Otro', usuario: 'otro', clave: 'secreto1', rol: 'admin' }, admin);
  const otro = await login('otro', 'secreto1');
  const idAdmin = (await call('GET', '/usuarios', null, otro)).body.find((u) => u.usuario === 'admin').id;
  assert.equal((await call('PUT', `/usuarios/${idAdmin}`, { rol: 'contador' }, otro)).status, 200);
  ctx.admin = otro; // el resto de las pruebas sigue con el segundo administrador
});

test('edición en bloque de productos y descarga para editar en Excel', async () => {
  const { admin, nico } = { admin: ctx.admin, nico: ctx.nico };
  const ids = [];
  for (const [nombre, precio] of [['Pan A', 1000], ['Pan B', 2000], ['Pan C', 3000]]) ids.push((await call('POST', '/productos', { nombre, precio, costo: 0 }, admin)).body.id);
  assert.equal((await call('POST', '/productos/masivo', { ids, accion: 'minimo_bodega', valor: 12 }, nico)).status, 403);
  assert.equal((await call('POST', '/productos/masivo', { ids: [], accion: 'desactivar' }, admin)).status, 400);
  assert.equal((await call('POST', '/productos/masivo', { ids, accion: 'borrar_todo' }, admin)).status, 400);
  assert.equal((await call('POST', '/productos/masivo', { ids, accion: 'minimo_bodega' }, admin)).status, 400);
  assert.equal((await call('POST', '/productos/masivo', { ids, accion: 'minimo_bodega', valor: 12 }, admin)).body.cambiados, 3);
  assert.equal((await call('POST', '/productos/masivo', { ids, accion: 'minimo_carro', valor: 4 }, admin)).body.cambiados, 3);
  assert.equal((await call('POST', '/productos/masivo', { ids, accion: 'precio_porcentaje', valor: 10 }, admin)).body.cambiados, 3);
  assert.equal((await call('POST', '/productos/masivo', { ids: [ids[0]], accion: 'costo_fijo', valor: 700 }, admin)).body.cambiados, 1);
  let todos = (await call('GET', '/productos?todos=1', null, admin)).body;
  const a = todos.find((p) => p.id === ids[0]), c = todos.find((p) => p.id === ids[2]);
  assert.deepEqual([a.stock_minimo, a.minimo_carro, a.precio, a.costo], [12, 4, 1100, 700]);
  assert.equal(c.precio, 3300);
  assert.equal((await call('POST', '/productos/masivo', { ids: [ids[1], ids[2]], accion: 'desactivar' }, admin)).body.cambiados, 2);
  assert.equal((await call('GET', '/productos', null, admin)).body.some((p) => p.id === ids[1]), false);
  await call('POST', '/productos/masivo', { ids: [ids[1]], accion: 'activar' }, admin);
  assert.equal((await call('GET', '/productos', null, admin)).body.some((p) => p.id === ids[1]), true);
  // Excel para editar
  const x = await call('GET', '/informes/catalogo.xlsx', null, admin);
  assert.equal(x.status, 200);
  assert.equal(x.body.subarray(0, 2).toString(), 'PK');
  assert.equal((await call('GET', '/informes/catalogo.xlsx', null, nico)).status, 403);
});

test('conceptos contables: el importador los omite y se pueden quitar de una vez', async () => {
  const { admin } = ctx;
  const texto = ['Producto\tPrecio', 'Gastos bancarios\t0', 'CUENTAS POR COBRAR A CLIENTES\t0', 'ANTICIPO DE CLIENTES PARA VENTA\t0', 'Pan nuevo\t1500'].join('\n');
  const r = (await call('POST', '/importar/productos', { texto, aplicar: true }, admin)).body;
  assert.equal(r.resumen.omitir, 3);
  assert.equal(r.resumen.crear, 1);
  assert.equal(r.resumen.errores, 0);
  const nombres = (await call('GET', '/productos', null, admin)).body.map((p) => p.nombre);
  assert.ok(nombres.includes('Pan nuevo'));
  assert.ok(!nombres.some((n) => /bancarios|por cobrar|anticipo/i.test(n)));
  // los que ya estaban creados se desactivan con un toque
  await call('POST', '/productos', { nombre: 'Aporte de socios', precio: 0 }, admin);
  await call('POST', '/productos', { nombre: 'Traslado entre bancos', precio: 0 }, admin);
  assert.equal((await call('POST', '/productos/quitar-conceptos', null, admin)).body.desactivados, 2);
  assert.ok(!(await call('GET', '/productos', null, admin)).body.some((p) => p.nombre === 'Aporte de socios'));
});

test('mientras no hay inventario se puede vender; ya cargado, se exige; el administrador lo decide', async () => {
  const { admin } = ctx;
  const b = ctx.b;
  const prod = (await call('POST', '/productos', { nombre: 'Almojábana', precio: 1000, costo: 0, stock_minimo: 5 }, admin)).body.id;
  const cli = (await call('POST', '/clientes', { nombre: 'Tienda' }, admin)).body.id;
  const vende = (n) => call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', punto: `B${b}`, items: [{ producto_id: prod, cantidad: n }] }, admin);
  assert.equal((await vende(3)).status, 200); // carga inicial: aún no hay inventario
  // sin existencias ni movimientos de compra no hay alertas falsas de "agotado"
  assert.equal((await call('GET', '/alertas/inventario', null, admin)).body.bajo_minimo.filter((x) => x.producto_id === prod && x.ub === `B${b}`).length, 1); // vendió: tiene movimiento y quedó en -3
  await call('POST', '/compras', { bodega_id: b, items: [{ producto_id: prod, cantidad: 10, costo: 500 }] }, admin);
  // ya hay inventario cargado: se exige
  assert.equal((await vende(50)).status, 409);
  await call('PUT', '/config', { permitir_sin_stock: '1' }, admin);
  assert.equal((await vende(50)).status, 200);
  await call('PUT', '/config', { permitir_sin_stock: '0' }, admin);
  assert.equal((await vende(50)).status, 409);
});
