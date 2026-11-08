// Cuadre semanal del sábado: efectivo de la semana vs cierres, transferencias verificadas, cartera, gastos y conteo físico
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './ayuda.js';

const { server, call, login } = await iniciar();
after(() => server.close());
const { semana } = await import('../routes/cuadres.js');
const ctx = {};

test('la semana va del lunes al día del cuadre (máximo 31 días)', () => {
  assert.deepEqual(semana({ hasta: '2026-11-07' }), { desde: '2026-11-02', hasta: '2026-11-07' }); // sábado
  assert.deepEqual(semana({ hasta: '2026-11-08' }), { desde: '2026-11-02', hasta: '2026-11-08' }); // domingo
  assert.deepEqual(semana({ hasta: '2026-11-09' }), { desde: '2026-11-09', hasta: '2026-11-09' }); // lunes
  assert.throws(() => semana({ desde: '2026-01-01', hasta: '2026-03-01' }), /31 días/);
  assert.throws(() => semana({ desde: '2026-11-08', hasta: '2026-11-07' }), /posterior/);
});

test('preparar: una semana de una ruta con ventas, abonos por transferencia, gastos y cierre con faltante', async () => {
  const admin = ctx.admin = await login('admin', 'admin123');
  ctx.b1 = (await call('GET', '/bodegas', null, admin)).body[0].id;
  ctx.b2 = (await call('POST', '/bodegas', { nombre: 'Occidente' }, admin)).body.id;
  ctx.ruta = (await call('POST', '/rutas', { nombre: 'Carro 1', bodega_id: ctx.b1 }, admin)).body.id;
  for (const [nombre, usuario, rol, extra] of [['Ana', 'ana', 'bodeguero', { bodega_id: ctx.b1 }], ['Luis', 'luis', 'bodeguero', { bodega_id: ctx.b2 }], ['Nico', 'nico', 'vendedor', { ruta_id: ctx.ruta }]])
    await call('POST', '/usuarios', { nombre, usuario, clave: 'secreto1', rol, ...extra }, admin);
  for (const u of ['ana', 'luis', 'nico']) ctx[u] = await login(u, 'secreto1');
  ctx.prod = (await call('POST', '/productos', { nombre: 'Mantecadas', precio: 1000, costo: 0 }, admin)).body.id;
  await call('POST', '/compras', { bodega_id: ctx.b1, items: [{ producto_id: ctx.prod, cantidad: 100, costo: 600 }] }, admin);
  await call('POST', '/inventario/cargue', { ruta_id: ctx.ruta, sentido: 'cargue', items: [{ producto_id: ctx.prod, cantidad: 40 }] }, admin);
  const cli = ctx.cli = (await call('POST', '/clientes', { nombre: 'Tienda' }, ctx.nico)).body.id;
  await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', items: [{ producto_id: ctx.prod, cantidad: 10 }] }, ctx.nico);
  await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'credito', abono: 2000, metodo: 'transferencia', items: [{ producto_id: ctx.prod, cantidad: 5 }] }, ctx.nico);
  await call('POST', '/gastos', { concepto: 'Gasolina', valor: 1000 }, ctx.nico);
  // debía entregar 10.000 − 1.000 = 9.000 y entregó 8.500
  assert.equal((await call('POST', '/cierre', { entregado: 8500 }, ctx.nico)).body.esperado, 9000);
  // venta de mostrador sin cierre: debe avisarse
  await call('POST', '/remisiones', { cliente_id: cli, punto: `B${ctx.b1}`, tipo_pago: 'contado', items: [{ producto_id: ctx.prod, cantidad: 1 }] }, ctx.ana);
});

test('resumen de la semana por punto, con permisos', async () => {
  const { ana, luis, nico, admin, ruta, b1 } = ctx;
  assert.equal((await call('GET', '/cuadres/semana', null, nico)).status, 403);
  const s = (await call('GET', '/cuadres/semana', null, ana)).body;
  const carro = s.puntos.find((p) => p.punto === `R${ruta}`);
  assert.equal(carro.nombre, 'Ruta Carro 1');
  assert.deepEqual({ ventas: carro.totales.ventas, efectivo: carro.totales.efectivo, gastos: carro.totales.gastos, esperado: carro.totales.esperado, entregado: carro.totales.entregado,
    diferencia: carro.totales.diferencia_efectivo, transferencias: carro.totales.transferencias, verificadas: carro.totales.transferencias_verificadas, cartera: carro.totales.cartera },
  { ventas: 15000, efectivo: 10000, gastos: 1000, esperado: 9000, entregado: 8500, diferencia: -500, transferencias: 2000, verificadas: 0, cartera: 3000 });
  assert.deepEqual(carro.totales.dias_sin_cierre, []);
  const mostrador = s.puntos.find((p) => p.punto === `B${b1}`);
  assert.equal(mostrador.totales.dias_sin_cierre.length, 1, 'el mostrador vendió y no hizo cierre');
  assert.equal(s.totales.ventas, 16000);
  // el encargado de otra bodega no ve esa ruta ni puede abrir su detalle
  assert.ok(!(await call('GET', '/cuadres/semana', null, luis)).body.puntos.some((p) => p.punto === `R${ruta}`));
  assert.equal((await call('GET', `/cuadres/detalle?punto=R${ruta}`, null, luis)).status, 403);
  assert.equal((await call('GET', `/cuadres/detalle?punto=R${ruta}`, null, admin)).status, 200);
});

test('verificar transferencias en el banco', async () => {
  const { ana, luis, nico, ruta } = ctx;
  const d = (await call('GET', `/cuadres/detalle?punto=R${ruta}`, null, ana)).body;
  assert.equal(d.transferencias.length, 1);
  const t = d.transferencias[0];
  assert.equal(t.valor, 2000);
  assert.equal((await call('POST', `/pagos/${t.id}/verificar`, {}, nico)).status, 403);
  assert.equal((await call('POST', `/pagos/${t.id}/verificar`, {}, luis)).status, 403);
  assert.equal((await call('POST', `/pagos/${t.id}/verificar`, {}, ana)).status, 200);
  const d2 = (await call('GET', `/cuadres/detalle?punto=R${ruta}`, null, ana)).body;
  assert.equal(d2.totales.transferencias_verificadas, 2000);
  assert.equal(d2.totales.transferencias_por_verificar, 0);
  assert.equal(d2.transferencias[0].verificado_por, 'Ana');
  // el efectivo no se "verifica"
  const pagoEfectivo = (await call('GET', `/clientes/${ctx.cli}`, null, ana)).body.pagos.find((p) => p.metodo === 'efectivo');
  assert.equal((await call('POST', `/pagos/${pagoEfectivo.id}/verificar`, {}, ana)).status, 400);
  // desmarcar
  assert.equal((await call('POST', `/pagos/${t.id}/verificar`, { verificado: false }, ana)).body.verificado, 0);
  await call('POST', `/pagos/${t.id}/verificar`, {}, ana);
});

test('conteo físico: diferencia valorizada, ajuste opcional y cuadre guardado', async () => {
  const { ana, ruta, prod, admin, nico } = ctx;
  const d = (await call('GET', `/cuadres/detalle?punto=R${ruta}`, null, ana)).body;
  const item = d.inventario.find((i) => i.id === prod);
  assert.equal(item.sistema, 25); // 40 cargadas − 15 vendidas
  assert.equal(d.cuadre, null);
  // el vendedor no hace el cuadre
  assert.equal((await call('POST', '/cuadres', { punto: `R${ruta}`, conteo: [] }, nico)).status, 403);
  assert.equal((await call('POST', '/cuadres', { punto: `R${ruta}`, conteo: [{ producto_id: prod, contado: -1 }] }, ana)).status, 400);
  // contaron 23: faltan 2 a $600 de costo
  const r = (await call('POST', '/cuadres', { punto: `R${ruta}`, conteo: [{ producto_id: prod, contado: 23 }, { producto_id: prod + 999, contado: '' }], aplicar_ajuste: true, nota: 'Faltan 2' }, ana)).body;
  assert.equal(r.productos_con_diferencia, 1);
  assert.equal(r.diferencia_inventario, -1200);
  const inv = (await call('GET', `/inventario?ub=R${ruta}`, null, admin)).body.productos.find((p) => p.id === prod).cantidad;
  assert.equal(inv, 23, 'el inventario quedó ajustado al conteo');
  const g = (await call('GET', `/cuadres/detalle?punto=R${ruta}`, null, ana)).body.cuadre;
  assert.equal(g.usuario, 'Ana');
  assert.equal(g.diferencia_efectivo, -500);
  assert.equal(g.transferencias_verificadas, 2000);
  assert.equal(g.ajuste_aplicado, 1);
  assert.equal(g.datos.conteo[0].diferencia, -2);
  // repetir el cuadre la misma semana lo actualiza (ya sin diferencias) y no olvida que se ajustó
  const r2 = (await call('POST', '/cuadres', { punto: `R${ruta}`, conteo: [{ producto_id: prod, contado: 23 }] }, ana)).body;
  assert.equal(r2.productos_con_diferencia, 0);
  const g2 = (await call('GET', `/cuadres/detalle?punto=R${ruta}`, null, ana)).body.cuadre;
  assert.equal(g2.ajuste_aplicado, 1);
  assert.equal(g2.id, g.id);
  const s = (await call('GET', '/cuadres/semana', null, ana)).body.puntos.find((p) => p.punto === `R${ruta}`);
  assert.ok(s.cuadre);
  // queda en el registro de actividad
  const aud = (await call('GET', '/auditoria', null, admin)).body;
  assert.ok((aud.filas ?? aud).some((a) => a.accion === 'cuadre semanal'));
});
