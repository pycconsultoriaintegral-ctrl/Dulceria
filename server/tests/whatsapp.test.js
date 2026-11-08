// Resumen diario por WhatsApp contra un servidor falso que imita la API de Meta
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { iniciar } from './ayuda.js';

// --- API de Meta simulada ---
const recibidos = [];
let fallar = false;
const meta = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => { cuerpo += c; });
  req.on('end', () => {
    recibidos.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(cuerpo) });
    res.setHeader('Content-Type', 'application/json');
    if (fallar) { res.statusCode = 400; res.end(JSON.stringify({ error: { message: 'Template name does not exist in the translation', error_data: { details: 'plantilla no aprobada' } } })); return; }
    res.end(JSON.stringify({ messages: [{ id: `wamid.${recibidos.length}` }] }));
  });
});
await new Promise((ok) => meta.listen(0, ok));

const { server, call, login } = await iniciar();
after(() => { server.close(); meta.close(); });
const wa = await import('../whatsapp.js');
const ctx = {};

test('ajustes: validación y privacidad de los números', async () => {
  const admin = ctx.admin = await login('admin', 'admin123');
  assert.equal((await call('PUT', '/config', { whatsapp_hora: '25:00' }, admin)).status, 400);
  assert.equal((await call('PUT', '/config', { whatsapp_numeros: '300123' }, admin)).status, 400);
  assert.equal((await call('PUT', '/config', { whatsapp_plantilla: 'Resumen Diario' }, admin)).status, 400);
  assert.equal((await call('PUT', '/config', { whatsapp_activo: '1', whatsapp_numeros: '300 123 4567, 573109876543', whatsapp_hora: '20:00' }, admin)).status, 200);
  assert.deepEqual(wa.numerosConfigurados(), ['573001234567', '573109876543']);
  // preparar un vendedor para comprobar que no ve los números del dueño
  const b1 = ctx.b1 = (await call('GET', '/bodegas', null, admin)).body[0].id;
  ctx.ruta = (await call('POST', '/rutas', { nombre: 'Carro 1', bodega_id: b1 }, admin)).body.id;
  await call('POST', '/usuarios', { nombre: 'Nico', usuario: 'nico', clave: 'secreto1', rol: 'vendedor', ruta_id: ctx.ruta }, admin);
  ctx.nico = await login('nico', 'secreto1');
  const cfgVend = (await call('GET', '/config', null, ctx.nico)).body;
  assert.ok(!Object.keys(cfgVend).some((k) => k.startsWith('whatsapp_')));
  assert.equal((await call('GET', '/config', null, admin)).body.whatsapp_hora, '20:00');
  assert.equal((await call('GET', '/whatsapp', null, ctx.nico)).status, 403);
});

test('el resumen del día: ventas, cobros, gastos, cierres pendientes, cartera', async () => {
  const { admin, nico, b1, ruta } = ctx;
  const prod = (await call('POST', '/productos', { nombre: 'Mantecadas', precio: 1000, costo: 0 }, admin)).body.id;
  await call('POST', '/compras', { bodega_id: b1, items: [{ producto_id: prod, cantidad: 100, costo: 600 }] }, admin);
  await call('POST', '/inventario/cargue', { ruta_id: ruta, sentido: 'cargue', items: [{ producto_id: prod, cantidad: 40 }] }, admin);
  const cli = (await call('POST', '/clientes', { nombre: 'Tienda' }, nico)).body.id;
  await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', items: [{ producto_id: prod, cantidad: 10 }] }, nico);
  await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'credito', abono: 2000, metodo: 'transferencia', items: [{ producto_id: prod, cantidad: 5 }] }, nico);
  await call('POST', '/gastos', { concepto: 'Gasolina', valor: 1000 }, nico);
  let r = wa.resumenDelDia();
  assert.deepEqual([r.ventas, r.remisiones, r.efectivo, r.transferencias, r.gastos, r.cartera], [15000, 2, 10000, 2000, 1000, 3000]);
  assert.deepEqual(r.puntos_sin_cierre, ['Ruta Carro 1']);
  assert.match(r.texto_cierres, /0 de 1 \(faltan Ruta Carro 1\)/);
  await call('POST', '/cierre', { entregado: 8500 }, nico);
  r = wa.resumenDelDia();
  assert.equal(r.texto_cierres, 'todos (1), diferencia -$500');
  const p = wa.parametros(r);
  assert.equal(p.length, 9);
  assert.equal(p[1], '$15.000');
  assert.ok(p.every((x) => !/[\n\t]/.test(x) && !/ {4,}/.test(x)), 'los parámetros de plantilla no admiten saltos de línea');
  const vista = (await call('GET', '/whatsapp', null, admin)).body;
  assert.match(vista.texto, /Vendido: \*\$15\.000\* \(2 remisiones\)/);
  assert.match(vista.texto, /Ruta Carro 1: \$15\.000/);
  assert.equal(vista.configurado, false);
});

test('sin credenciales en el servidor no envía y lo explica', async () => {
  const r = (await call('POST', '/whatsapp/probar', {}, ctx.admin)).body.resultados;
  assert.equal(r[0].ok, false);
  assert.match(r[0].error, /WHATSAPP_TOKEN/);
  assert.equal(recibidos.length, 0);
});

test('con credenciales: envía la plantilla a cada número y registra el envío', async () => {
  process.env.WHATSAPP_API_URL = `http://localhost:${meta.address().port}`;
  process.env.WHATSAPP_TOKEN = 'token-secreto';
  process.env.WHATSAPP_PHONE_ID = '1234567890';
  const r = (await call('POST', '/whatsapp/probar', {}, ctx.admin)).body.resultados;
  assert.deepEqual(r.map((x) => [x.para, x.ok]), [['573001234567', true], ['573109876543', true]]);
  assert.equal(recibidos.length, 2);
  const m = recibidos[0];
  assert.equal(m.url, '/v23.0/1234567890/messages');
  assert.equal(m.auth, 'Bearer token-secreto');
  assert.equal(m.body.to, '573001234567');
  assert.equal(m.body.template.name, 'resumen_diario');
  assert.equal(m.body.template.language.code, 'es');
  assert.equal(m.body.template.components[0].parameters.length, 9);
  const envios = (await call('GET', '/whatsapp', null, ctx.admin)).body.envios;
  assert.equal(envios.filter((e) => e.estado === 'enviado' && e.tipo === 'prueba').length, 2);
  // el token nunca sale por la API
  assert.ok(!JSON.stringify(await call('GET', '/whatsapp', null, ctx.admin)).includes('token-secreto'));
});

test('programación diaria: a la hora envía una sola vez; si falla, reintenta cada 15 minutos hasta 3 veces', async () => {
  const n0 = recibidos.length;
  await call('PUT', '/config', { whatsapp_numeros: '3001234567', whatsapp_hora: '00:00' }, ctx.admin);
  const ahora = new Date();
  assert.equal((await wa.revisarProgramacion(ahora)).length, 1);
  assert.equal((await wa.revisarProgramacion(ahora)).length, 0, 'no repite el mismo día');
  assert.equal(recibidos.length, n0 + 1);
  // apagado: no envía
  await call('PUT', '/config', { whatsapp_activo: '0' }, ctx.admin);
  assert.equal(await wa.revisarProgramacion(ahora), null);

  // un número nuevo con la plantilla rechazada: queda el error y se reintenta pasados 15 minutos
  await call('PUT', '/config', { whatsapp_activo: '1', whatsapp_numeros: '3150000000' }, ctx.admin);
  fallar = true;
  const t0 = new Date();
  const e1 = await wa.revisarProgramacion(t0);
  assert.equal(e1[0].ok, false);
  assert.match(e1[0].error, /plantilla no aprobada/);
  assert.equal((await wa.revisarProgramacion(new Date(t0.getTime() + 5 * 60000))).length, 0, 'espera 15 minutos');
  fallar = false;
  const e2 = await wa.revisarProgramacion(new Date(t0.getTime() + 16 * 60000));
  assert.equal(e2.length, 1);
  assert.equal(e2[0].ok, true);
  const ultimos = (await call('GET', '/whatsapp', null, ctx.admin)).body.envios.filter((e) => e.para === '573150000000');
  assert.deepEqual(ultimos.map((e) => e.estado), ['enviado', 'error']);
});
