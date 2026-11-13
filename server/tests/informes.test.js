// Informes en Excel (vendedores, productos, clientes) y alertas de inventario
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { iniciar } from './ayuda.js';

const { server, call, login } = await iniciar();
after(() => server.close());
const { db } = await import('../db.js');
const { periodos } = await import('../routes/informes.js');
const ctx = {};

// Lee un .xlsx (ZIP) y devuelve { 'xl/worksheets/sheet1.xml': '<xml…>', … }
function leerXlsx(buf) {
  const out = {};
  for (let i = 0; i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50;) {
    const metodo = buf.readUInt16LE(i + 8), comp = buf.readUInt32LE(i + 18), nlen = buf.readUInt16LE(i + 26), xlen = buf.readUInt16LE(i + 28);
    const nombre = buf.subarray(i + 30, i + 30 + nlen).toString();
    const datos = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + comp);
    out[nombre] = (metodo === 8 ? zlib.inflateRawSync(datos) : datos).toString();
    i += 30 + nlen + xlen + comp;
  }
  return out;
}
const textos = (xml) => [...xml.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map((m) => m[1]);
// valores numéricos de la fila cuyo primer texto es "etiqueta"
function filaDe(xml, etiqueta) {
  const fila = [...xml.matchAll(/<row r="\d+"[^>]*>(.*?)<\/row>/g)].map((m) => m[1]).find((r) => r.includes(`<t xml:space="preserve">${etiqueta}</t>`));
  return fila ? [...fila.matchAll(/<c r="([A-Z]+)\d+"[^>]*>(?:<f>[^<]*<\/f>)?<v>([^<]*)<\/v><\/c>/g)].reduce((o, m) => ({ ...o, [m[1]]: Number(m[2]) }), {}) : null;
}

test('el periodo anterior tiene la misma duración', () => {
  assert.deepEqual(periodos({ desde: '2026-11-01', hasta: '2026-11-08' }).antes, { desde: '2026-10-24', hasta: '2026-10-31' });
  assert.deepEqual(periodos({ desde: '2026-11-01', hasta: '2026-11-30' }).antes, { desde: '2026-10-02', hasta: '2026-10-31' });
  assert.throws(() => periodos({ desde: '2026-11-09', hasta: '2026-11-08' }), /posterior/);
});

test('preparar: dos vendedores, ventas este periodo y el anterior', async () => {
  const admin = ctx.admin = await login('admin', 'admin123');
  ctx.b1 = (await call('GET', '/bodegas', null, admin)).body[0].id;
  ctx.b2 = (await call('POST', '/bodegas', { nombre: 'Sur' }, admin)).body.id;
  ctx.r1 = (await call('POST', '/rutas', { nombre: 'Carro 1', bodega_id: ctx.b1 }, admin)).body.id;
  ctx.r2 = (await call('POST', '/rutas', { nombre: 'Carro 2', bodega_id: ctx.b1 }, admin)).body.id;
  for (const [nombre, usuario, rol, extra] of [['Nico', 'nico', 'vendedor', { ruta_id: ctx.r1 }], ['Vera', 'vera', 'vendedor', { ruta_id: ctx.r2 }], ['Ana', 'ana', 'bodeguero', { bodega_id: ctx.b1 }], ['Luis', 'luis', 'bodeguero', { bodega_id: ctx.b2 }]])
    await call('POST', '/usuarios', { nombre, usuario, clave: 'secreto1', rol, ...extra }, admin);
  for (const u of ['nico', 'vera', 'ana', 'luis']) ctx[u] = await login(u, 'secreto1');
  ctx.pan = (await call('POST', '/productos', { nombre: 'Pan tajado', precio: 1000, costo: 0, stock_minimo: 50, minimo_carro: 20 }, admin)).body.id;
  ctx.rosc = (await call('POST', '/productos', { nombre: 'Roscón', precio: 3000, costo: 0 }, admin)).body.id;
  await call('POST', '/compras', { bodega_id: ctx.b1, items: [{ producto_id: ctx.pan, cantidad: 100, costo: 600 }, { producto_id: ctx.rosc, cantidad: 30, costo: 2000 }] }, admin);
  await call('POST', '/inventario/cargue', { ruta_id: ctx.r1, sentido: 'cargue', items: [{ producto_id: ctx.pan, cantidad: 40 }, { producto_id: ctx.rosc, cantidad: 10 }] }, admin);
  await call('POST', '/inventario/cargue', { ruta_id: ctx.r2, sentido: 'cargue', items: [{ producto_id: ctx.pan, cantidad: 30 }] }, admin);
  ctx.c1 = (await call('POST', '/clientes', { nombre: 'Tienda Uno' }, ctx.nico)).body.id;
  ctx.c2 = (await call('POST', '/clientes', { nombre: 'Tienda Dos' }, ctx.vera)).body.id;
  ctx.c3 = (await call('POST', '/clientes', { nombre: 'Tienda Tres' }, ctx.nico)).body.id;
  // periodo anterior: Tienda Tres compró hace 10 días (fecha movida a mano) y no ha vuelto
  const vieja = (await call('POST', '/remisiones', { cliente_id: ctx.c3, tipo_pago: 'contado', items: [{ producto_id: ctx.pan, cantidad: 5 }] }, ctx.nico)).body;
  const hace10 = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(new Date(Date.now() - 10 * 86400000)); // en la hora del negocio, no en UTC (de noche difieren de día)
  db.prepare("UPDATE remisiones SET fecha=? || substr(fecha,11) WHERE id=?").run(hace10, vieja.id);
  db.prepare("UPDATE pagos SET fecha=? || substr(fecha,11) WHERE remision_id=?").run(hace10, vieja.id);
  ctx.hace10 = hace10;
  // este periodo
  await call('POST', '/remisiones', { cliente_id: ctx.c1, tipo_pago: 'contado', items: [{ producto_id: ctx.pan, cantidad: 10 }, { producto_id: ctx.rosc, cantidad: 2, precio: 2500 }] }, ctx.nico);
  await call('POST', '/remisiones', { cliente_id: ctx.c1, tipo_pago: 'credito', items: [{ producto_id: ctx.pan, cantidad: 5 }] }, ctx.nico);
  await call('POST', '/remisiones', { cliente_id: ctx.c2, tipo_pago: 'contado', items: [{ producto_id: ctx.pan, cantidad: 12 }] }, ctx.vera);
  ctx.hoy = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10); // hora de Colombia
});

const rangoActual = () => `desde=${new Date(Date.now() - 5 * 3600000 - 5 * 86400000).toISOString().slice(0, 10)}&hasta=${ctx.hoy}`; // 6 días; el anterior incluye hace 10 días

test('permisos: el vendedor no descarga informes; el encargado no puede pedir otra bodega', async () => {
  assert.equal((await call('GET', '/informes/vendedores.xlsx', null, ctx.nico)).status, 403);
  assert.equal((await call('GET', `/informes/vendedores.xlsx?bodega_id=${ctx.b1}`, null, ctx.luis)).status, 403);
  const r = await call('GET', '/informes/vendedores.xlsx', null, ctx.admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.subarray(0, 2).toString(), 'PK');
});

test('informe de vendedores: ventas, promedio, bajo lista, utilidad y comparación', async () => {
  const r = await call('GET', `/informes/vendedores.xlsx?${rangoActual()}`, null, ctx.admin);
  const x = leerXlsx(r.body);
  assert.ok(x['xl/workbook.xml'].includes('name="Vendedores"'));
  const hoja = x['xl/worksheets/sheet1.xml'];
  assert.ok(textos(hoja).includes('Informe de vendedores'));
  // Nico: 2 remisiones (15.000 + 5.000), 1 cliente; Roscón a 2.500 en vez de 3.000 = 1.000 bajo lista; periodo anterior 5.000
  const nico = filaDe(hoja, 'Nico');
  assert.deepEqual([nico.D, nico.E, nico.F, nico.G, nico.H, nico.I, nico.K, nico.P], [2, 1, 20000, 10000, 15000, 5000, 1000, 5000]);
  assert.equal(nico.Q, 3); // +300 %
  assert.equal(nico.L, 15 * 600 + 2 * 2000); // costo
  const vera = filaDe(hoja, 'Vera');
  assert.equal(vera.F, 12000);
  const total = filaDe(hoja, 'TOTAL');
  assert.equal(total.F, 32000);
  assert.ok(hoja.includes('<f>SUM(F'));
  // el encargado de la otra bodega descarga el suyo, sin estas ventas
  const luis = leerXlsx((await call('GET', `/informes/vendedores.xlsx?${rangoActual()}`, null, ctx.luis)).body)['xl/worksheets/sheet1.xml'];
  assert.equal(filaDe(luis, 'Nico'), null);
  // filtrado por un carro
  const soloR2 = leerXlsx((await call('GET', `/informes/vendedores.xlsx?${rangoActual()}&punto=R${ctx.r2}`, null, ctx.admin)).body)['xl/worksheets/sheet1.xml'];
  assert.equal(filaDe(soloR2, 'Nico'), null);
  assert.equal(filaDe(soloR2, 'Vera').F, 12000);
});

test('informe de productos: unidades, utilidad, margen, inventario y hojas de alertas', async () => {
  const x = leerXlsx((await call('GET', `/informes/productos.xlsx?${rangoActual()}`, null, ctx.admin)).body);
  for (const n of ['Productos', 'Bajo mínimo', 'Sin movimiento']) assert.ok(x['xl/workbook.xml'].includes(`name="${n}"`), n);
  const pan = filaDe(x['xl/worksheets/sheet1.xml'], 'Pan tajado');
  // vendidos 27 a $1.000, costo $600, periodo anterior 5; inventario: 100 − 5 − 27 = 68
  assert.deepEqual([pan.D, pan.E, pan.F, pan.G, pan.K, pan.L, pan.N], [27, 27000, 16200, 10800, 5, 5000, 68]);
  assert.equal(pan.H, 0.4);
  const bajo = textos(x['xl/worksheets/sheet2.xml']);
  // bodega principal: 30 ≤ 50 de mínimo; Carro 1: 40−5−15 = 20 ≤ 20; Carro 2: 30−12 = 18 ≤ 20
  assert.ok(bajo.includes('Bodega principal') && bajo.includes('Ruta Carro 1') && bajo.includes('Ruta Carro 2'));
});

test('informe de clientes: compras, última compra, frecuencia y quiénes dejaron de comprar', async () => {
  const x = leerXlsx((await call('GET', `/informes/clientes.xlsx?${rangoActual()}`, null, ctx.admin)).body);
  const hoja = x['xl/worksheets/sheet1.xml'];
  const uno = filaDe(hoja, 'Tienda Uno');
  assert.deepEqual([uno.E, uno.F, uno.G, uno.K, uno.M], [2, 20000, 10000, 0, 5000]);
  const tres = filaDe(hoja, 'Tienda Tres');
  assert.equal(tres.F ?? 0, 0);
  assert.equal(tres.H, 5000);
  assert.equal(tres.K, 10);
  const dejaron = textos(x['xl/worksheets/sheet2.xml']);
  assert.ok(dejaron.includes('Tienda Tres'));
  assert.ok(dejaron.includes('Compró el periodo anterior y este no'));
  assert.ok(!dejaron.includes('Tienda Uno'));
});

test('alertas de inventario: bajo mínimo por bodega y carro, sin movimiento, por alcance', async () => {
  const { admin, nico, ana, luis, pan, rosc, r1, b1 } = ctx;
  const a = (await call('GET', '/alertas/inventario', null, admin)).body;
  const lugares = a.bajo_minimo.filter((x) => x.producto_id === pan).map((x) => x.ub).sort();
  assert.deepEqual(lugares, [`B${b1}`, `R${r1}`, `R${ctx.r2}`].sort());
  assert.equal(a.sin_movimiento.length, 0);
  // el vendedor ve solo su carro y sin costos
  const v = (await call('GET', '/alertas/inventario', null, nico)).body;
  assert.ok(v.bajo_minimo.every((x) => x.ub === `R${r1}`));
  assert.equal(v.bajo_minimo.length, 1);
  // el encargado de otra bodega no ve nada de esta
  assert.equal((await call('GET', '/alertas/inventario', null, luis)).body.bajo_minimo.length, 0);
  // el Roscón de la bodega lleva 6 días sin salir: aparece con 3 días de umbral, con su valor al costo
  db.prepare("UPDATE movimientos SET fecha=? WHERE producto_id=? AND ubicacion=?").run(new Date(Date.now() - 6 * 86400000).toISOString(), rosc, `B${b1}`);
  const s = (await call('GET', '/alertas/inventario', null, ana)).body;
  const r = s.sin_movimiento.find((x) => x.producto_id === rosc && x.ub === `B${b1}`);
  assert.equal(r.dias, 6);
  assert.equal(r.cantidad, 20);
  assert.equal(r.valor, 40000);
  // con 7 días de umbral ya no aparece
  assert.equal((await call('PUT', '/config', { dias_sin_movimiento: '0' }, admin)).status, 400);
  await call('PUT', '/config', { dias_sin_movimiento: '7' }, admin);
  assert.ok(!(await call('GET', '/alertas/inventario', null, ana)).body.sin_movimiento.some((x) => x.producto_id === rosc));
  // y llega al resumen de WhatsApp
  const { resumenDelDia } = await import('../whatsapp.js');
  assert.match(resumenDelDia().inventario, /3 bajo mínimo: Pan tajado/);
});

test('el mínimo en carro se guarda en el producto y no admite negativos', async () => {
  const { admin, rosc } = ctx;
  assert.equal((await call('PUT', `/productos/${rosc}`, { nombre: 'Roscón', precio: 3000, costo: 2000, minimo_carro: -1 }, admin)).status, 400);
  assert.equal((await call('PUT', `/productos/${rosc}`, { nombre: 'Roscón', precio: 3000, costo: 2000, stock_minimo: 5, minimo_carro: 8 }, admin)).status, 200);
  const p = (await call('GET', '/productos?todos=1', null, admin)).body.find((x) => x.id === rosc);
  assert.equal(p.minimo_carro, 8);
});
