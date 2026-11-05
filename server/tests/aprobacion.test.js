// Pago anticipado: el cliente marcado "paga antes" solo recibe mercancía cuando un encargado o el administrador aprueban su soporte de pago.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './ayuda.js';

const { server, call, login } = await iniciar();
after(() => server.close());
const ctx = {};

// imagen mínima con firma JPEG válida; "marca" cambia los bytes para tener fotos distintas
const foto = (marca = 'a') => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from(`JFIF-${marca}-`.repeat(20))]).toString('base64');
const stock = async (t, ub, id) => (await call('GET', `/inventario?ub=${ub}`, t)).body?.productos?.find((p) => p.id === id)?.cantidad;
const cantidadEn = async (t, ub, id) => (await call('GET', `/inventario?ub=${ub}`, null, t)).body.productos.find((p) => p.id === id).cantidad;

test('preparar: dos bodegas, encargados, vendedores y un cliente que paga antes', async () => {
  const admin = ctx.admin = await login('admin', 'admin123');
  ctx.b1 = (await call('GET', '/bodegas', null, admin)).body[0].id;
  ctx.b2 = (await call('POST', '/bodegas', { nombre: 'Occidente' }, admin)).body.id;
  ctx.rNorte = (await call('POST', '/rutas', { nombre: 'Norte', bodega_id: ctx.b1 }, admin)).body.id;
  ctx.rOcc = (await call('POST', '/rutas', { nombre: 'Occidente 1', bodega_id: ctx.b2 }, admin)).body.id;
  for (const [nombre, usuario, rol, extra] of [['Ana', 'ana', 'bodeguero', { bodega_id: ctx.b1 }], ['Luis', 'luis', 'bodeguero', { bodega_id: ctx.b2 }],
    ['Nico', 'nico', 'vendedor', { ruta_id: ctx.rNorte }], ['Vera', 'vera', 'vendedor', { ruta_id: ctx.rOcc }]])
    assert.equal((await call('POST', '/usuarios', { nombre, usuario, clave: 'secreto1', rol, ...extra }, admin)).status, 200);
  for (const u of ['ana', 'luis', 'nico', 'vera']) ctx[u] = await login(u, 'secreto1');

  ctx.prod = (await call('POST', '/productos', { nombre: 'Julypan', precio: 1000, costo: 0 }, admin)).body.id;
  assert.equal((await call('POST', '/compras', { bodega_id: ctx.b1, items: [{ producto_id: ctx.prod, cantidad: 100, costo: 600 }] }, admin)).status, 200);
  assert.equal((await call('POST', '/inventario/cargue', { ruta_id: ctx.rNorte, sentido: 'cargue', items: [{ producto_id: ctx.prod, cantidad: 40 }] }, admin)).status, 200);

  // un vendedor no puede marcar ni desmarcar clientes; un encargado y el administrador sí
  const c1 = (await call('POST', '/clientes', { nombre: 'Tienda Pepe', paga_antes: true }, ctx.nico)).body.id;
  assert.equal((await call('GET', `/clientes/${c1}`, null, ctx.nico)).body.paga_antes, 0);
  ctx.cli = (await call('POST', '/clientes', { nombre: 'Doña Marta', ruta_id: ctx.rNorte, paga_antes: true }, ctx.ana)).body.id;
  assert.equal((await call('GET', `/clientes/${ctx.cli}`, null, ctx.nico)).body.paga_antes, 1);
  const quitar = await call('PUT', `/clientes/${ctx.cli}`, { nombre: 'Doña Marta', ruta_id: ctx.rNorte, paga_antes: false }, ctx.nico);
  assert.equal(quitar.status, 200);
  assert.equal((await call('GET', `/clientes/${ctx.cli}`, null, ctx.nico)).body.paga_antes, 1, 'el vendedor no puede quitar la marca');
  ctx.normal = (await call('POST', '/clientes', { nombre: 'Cliente normal', ruta_id: ctx.rNorte }, ctx.nico)).body.id;
});

test('la venta a un cliente que paga antes queda pendiente: sin inventario, sin venta, sin cartera', async () => {
  const { nico, admin, rNorte, cli, prod } = ctx;
  // aunque el vendedor pida crédito, se fuerza contado anticipado; y no puede pedir más de lo que hay
  const sobre = await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'credito', items: [{ producto_id: prod, cantidad: 41 }] }, nico);
  assert.equal(sobre.status, 409);
  const v = (await call('POST', '/remisiones', { uuid: 'ant-1', cliente_id: cli, tipo_pago: 'credito', abono: 0, items: [{ producto_id: prod, cantidad: 10 }] }, nico)).body;
  assert.equal(v.pendiente, true);
  ctx.rem = v.id;

  assert.equal(await cantidadEn(admin, `R${rNorte}`, prod), 40, 'el inventario de la ruta no baja hasta aprobar');
  const d = (await call('GET', `/remisiones/${v.id}`, null, nico)).body;
  assert.equal(d.pendiente, true);
  assert.equal(d.tipo_pago, 'contado');
  assert.equal(d.saldo, 0, 'una remisión pendiente no es deuda');
  assert.equal(d.pagado, 0);
  // no cuenta en ventas, cartera ni cierre
  const res = (await call('GET', '/reportes/resumen', null, admin)).body;
  assert.equal(res.ventas, 0);
  assert.equal(res.cartera, 0);
  const cierre = (await call('GET', '/cierre', null, nico)).body;
  assert.equal(cierre.ventas_total, 0);
  assert.equal(cierre.transferencias, 0);
  assert.equal((await call('GET', `/clientes/${cli}`, null, nico)).body.saldo, 0);
  // el PDF se genera (marcado como no válido)
  const pdf = await call('GET', `/remisiones/${v.id}/pdf`, null, nico);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  // reintento con el mismo uuid no duplica
  const rep = (await call('POST', '/remisiones', { uuid: 'ant-1', cliente_id: cli, tipo_pago: 'contado', items: [{ producto_id: prod, cantidad: 10 }] }, nico)).body;
  assert.equal(rep.id, v.id);
  // aparece en la lista de aprobaciones del encargado y del administrador, y del vendedor
  assert.equal((await call('GET', '/aprobaciones', null, ctx.ana)).body.length, 1);
  assert.equal((await call('GET', '/aprobaciones', null, admin)).body.length, 1);
  assert.equal((await call('GET', '/aprobaciones', null, nico)).body.length, 1);
  assert.equal((await call('GET', '/aprobaciones', null, ctx.luis)).body.length, 0, 'el encargado de otra bodega no ve esa solicitud');
  assert.equal((await call('GET', '/aprobaciones', null, ctx.vera)).body.length, 0);
});

test('soportes: solo imágenes válidas, con alcance y avisando si se reutiliza una foto', async () => {
  const { nico, vera, ana, luis, rem } = ctx;
  for (const malo of ['hola', 'data:text/html;base64,PGI+', 'data:image/jpeg;base64,' + Buffer.from('esto no es una imagen, aunque diga jpeg').toString('base64')])
    assert.equal((await call('POST', `/remisiones/${rem}/soportes`, { imagen: malo }, nico)).status, 400);
  const enorme = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1_600_000, 1)]).toString('base64');
  assert.equal((await call('POST', `/remisiones/${rem}/soportes`, { imagen: enorme }, nico)).status, 413);

  const ok = await call('POST', `/remisiones/${rem}/soportes`, { imagen: foto('a'), nota: 'Nequi' }, nico);
  assert.equal(ok.status, 200);
  ctx.soporte = ok.body.id;
  assert.equal(ok.body.soportes.length, 1);
  // otra ruta u otra bodega no pueden ni listar, ni subir, ni ver la imagen
  assert.equal((await call('GET', `/remisiones/${rem}/soportes`, null, vera)).status, 403);
  assert.equal((await call('POST', `/remisiones/${rem}/soportes`, { imagen: foto('b') }, vera)).status, 403);
  assert.equal((await call('GET', `/soportes/${ctx.soporte}`, null, vera)).status, 403);
  assert.equal((await call('GET', `/soportes/${ctx.soporte}`, null, luis)).status, 403);
  const img = await call('GET', `/soportes/${ctx.soporte}`, null, ana);
  assert.equal(img.status, 200);
  assert.equal(img.body[0], 0xff);
  assert.equal((await call('GET', `/soportes/${ctx.soporte}`)).status, 401);
  // máximo 5 por remisión
  for (const m of ['c', 'd', 'e', 'f']) assert.equal((await call('POST', `/remisiones/${rem}/soportes`, { imagen: foto(m) }, nico)).status, 200);
  assert.equal((await call('POST', `/remisiones/${rem}/soportes`, { imagen: foto('g') }, nico)).status, 409);
});

test('aprobar: permisos, sin autoaprobación, inventario, pago por transferencia y reportes', async () => {
  const { nico, vera, ana, luis, admin, rem, rNorte, prod, cli } = ctx;
  assert.equal((await call('POST', `/remisiones/${rem}/aprobar`, {}, nico)).status, 403, 'el vendedor no aprueba');
  assert.equal((await call('POST', `/remisiones/${rem}/aprobar`, {}, vera)).status, 403);
  assert.equal((await call('POST', `/remisiones/${rem}/aprobar`, {}, luis)).status, 403, 'el encargado de otra bodega no aprueba');

  const antes = (await call('GET', `/remisiones/${rem}`, null, ana)).body;
  assert.equal(antes.pendiente, true);
  // el soporte se ve con el detalle; el vendedor no ve costos
  assert.equal(antes.soportes.length, 5);
  assert.equal((await call('GET', `/remisiones/${rem}`, null, nico)).body.items[0].costo, undefined);

  const r = await call('POST', `/remisiones/${rem}/aprobar`, { nota: 'Nequi 3001234567' }, ana);
  assert.equal(r.status, 200);
  assert.equal((await call('POST', `/remisiones/${rem}/aprobar`, {}, ana)).status, 409, 'no se aprueba dos veces');

  assert.equal(await cantidadEn(admin, `R${rNorte}`, prod), 30, 'ahora sí sale el inventario');
  const d = (await call('GET', `/remisiones/${rem}`, null, nico)).body;
  assert.equal(d.pendiente, false);
  assert.equal(d.anulada, 0);
  assert.equal(d.pagado, 10000);
  assert.equal(d.saldo, 0);
  assert.equal(d.aprobador, 'Ana');
  const res = (await call('GET', '/reportes/resumen', null, admin)).body;
  assert.equal(res.ventas, 10000);
  assert.equal(res.cartera, 0);
  // el dinero entra como transferencia en el cierre (no hay efectivo que entregar)
  const cierre = (await call('GET', '/cierre', null, nico)).body;
  assert.equal(cierre.ventas_total, 10000);
  assert.equal(cierre.transferencias, 10000);
  assert.equal(cierre.cobrado_efectivo, 0);
  assert.equal(cierre.esperado, 0);
  assert.equal((await call('GET', '/aprobaciones', null, ana)).body.length, 0);
  // queda en el registro de actividad
  const aud = (await call('GET', '/auditoria', null, admin)).body;
  const acciones = (aud.filas ?? aud).map((a) => a.accion);
  assert.ok(acciones.includes('aprobar pago'));
  assert.ok(acciones.includes('venta con pago anticipado'));
  void cli;
});

test('no se aprueba sin soporte; el encargado no aprueba su propia venta; el administrador sí puede', async () => {
  const { nico, ana, admin, cli, prod, b1 } = ctx;
  // venta sin foto
  const v = (await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', items: [{ producto_id: prod, cantidad: 5 }] }, nico)).body;
  const sin = await call('POST', `/remisiones/${v.id}/aprobar`, {}, ana);
  assert.equal(sin.status, 409);
  assert.match(sin.body.error, /soporte/i);
  // venta de mostrador de la bodega hecha por el encargado: no se autoaprueba
  const cm = (await call('POST', '/clientes', { nombre: 'Mostrador anticipado', paga_antes: true }, admin)).body.id;
  const m = (await call('POST', '/remisiones', { cliente_id: cm, punto: `B${b1}`, tipo_pago: 'contado', soportes: [foto('m')], items: [{ producto_id: prod, cantidad: 3 }] }, ana)).body;
  assert.equal(m.pendiente, true);
  assert.equal((await call('POST', `/remisiones/${m.id}/aprobar`, {}, ana)).status, 403);
  const antes = await cantidadEn(admin, `B${b1}`, prod);
  assert.equal((await call('POST', `/remisiones/${m.id}/aprobar`, {}, admin)).status, 200);
  assert.equal(await cantidadEn(admin, `B${b1}`, prod), antes - 3);
  ctx.pendiente2 = v.id;
});

test('rechazar deja la remisión anulada con el motivo y sin tocar el inventario', async () => {
  const { nico, ana, vera, admin, pendiente2, rNorte, prod } = ctx;
  const inv = await cantidadEn(admin, `R${rNorte}`, prod);
  assert.equal((await call('POST', `/remisiones/${pendiente2}/rechazar`, {}, ana)).status, 400, 'exige motivo');
  assert.equal((await call('POST', `/remisiones/${pendiente2}/rechazar`, { motivo: 'x' }, nico)).status, 403);
  assert.equal((await call('POST', `/remisiones/${pendiente2}/rechazar`, { motivo: 'x' }, vera)).status, 403);
  assert.equal((await call('POST', `/remisiones/${pendiente2}/rechazar`, { motivo: 'El comprobante no corresponde' }, ana)).status, 200);
  const d = (await call('GET', `/remisiones/${pendiente2}`, null, nico)).body;
  assert.equal(d.anulada, 1);
  assert.equal(d.rechazada, true);
  assert.match(d.motivo_anulacion, /no corresponde/);
  assert.equal(await cantidadEn(admin, `R${rNorte}`, prod), inv);
  assert.equal((await call('POST', `/remisiones/${pendiente2}/aprobar`, {}, ana)).status, 409);
  assert.equal((await call('POST', `/remisiones/${pendiente2}/soportes`, { imagen: foto('z') }, nico)).status, 409);
});

test('si el inventario se agota antes de aprobar, no se aprueba; anular una pendiente no devuelve inventario', async () => {
  const { nico, ana, admin, cli, rNorte, prod } = ctx;
  const disponible = await cantidadEn(admin, `R${rNorte}`, prod); // 30
  // dos pendientes que juntas superan lo disponible (cada una por separado sí cabe)
  const a = (await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', soportes: [foto('p1')], items: [{ producto_id: prod, cantidad: disponible - 5 }] }, nico)).body;
  const b = (await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', soportes: [foto('p2')], items: [{ producto_id: prod, cantidad: 20 }] }, nico)).body;
  assert.equal((await call('POST', `/remisiones/${a.id}/aprobar`, {}, ana)).status, 200);
  const falla = await call('POST', `/remisiones/${b.id}/aprobar`, {}, ana);
  assert.equal(falla.status, 409);
  assert.match(falla.body.error, /Inventario insuficiente/);
  assert.equal((await call('GET', `/remisiones/${b.id}`, null, ana)).body.pendiente, true, 'queda pendiente, sin cambios');
  assert.equal(await cantidadEn(admin, `R${rNorte}`, prod), 5);
  // anular la pendiente: el inventario no sube (nunca bajó)
  assert.equal((await call('POST', `/remisiones/${b.id}/anular`, { motivo: 'El cliente no pagó' }, nico)).status, 200);
  assert.equal(await cantidadEn(admin, `R${rNorte}`, prod), 5);
  assert.equal((await call('GET', `/remisiones/${b.id}`, null, nico)).body.anulada, 1);
});

test('la misma foto en otra remisión se señala; ventas normales también admiten soporte opcional', async () => {
  const { nico, ana, normal, prod, cli, admin, rNorte } = ctx;
  await call('POST', '/inventario/cargue', { ruta_id: rNorte, sentido: 'cargue', items: [{ producto_id: prod, cantidad: 10 }] }, admin);
  const x = (await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', soportes: [foto('repetida')], items: [{ producto_id: prod, cantidad: 1 }] }, nico)).body;
  const y = (await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'contado', soportes: [foto('repetida')], items: [{ producto_id: prod, cantidad: 1 }] }, nico)).body;
  const dy = (await call('GET', `/remisiones/${y.id}`, null, ana)).body;
  assert.deepEqual(dy.soportes[0].repetido_en, [(await call('GET', `/remisiones/${x.id}`, null, ana)).body.consecutivo]);
  // el vendedor no ve con qué otras remisiones coincide
  assert.deepEqual((await call('GET', `/remisiones/${y.id}`, null, nico)).body.soportes[0].repetido_en, []);

  // cliente normal: venta de contado inmediata (sin aprobación), con foto opcional de la transferencia
  const n = (await call('POST', '/remisiones', { cliente_id: normal, tipo_pago: 'contado', metodo: 'transferencia', soportes: [foto('normal')], items: [{ producto_id: prod, cantidad: 2 }] }, nico)).body;
  assert.equal(n.pendiente, false);
  const dn = (await call('GET', `/remisiones/${n.id}`, null, nico)).body;
  assert.equal(dn.anulada, 0);
  assert.equal(dn.pagado, 2000);
  assert.equal(dn.soportes.length, 1);
  assert.equal((await call('POST', `/remisiones/${n.id}/soportes`, { imagen: foto('otra') }, nico)).status, 200);
  assert.equal((await call('POST', `/remisiones/${n.id}/aprobar`, {}, ana)).status, 409, 'no pendiente');
});

test('la marca "paga antes" se puede quitar y el cliente vuelve a vender normal', async () => {
  const { ana, nico, cli, prod, admin, rNorte } = ctx;
  assert.equal((await call('PUT', `/clientes/${cli}`, { nombre: 'Doña Marta', ruta_id: rNorte, paga_antes: false }, ana)).status, 200);
  const v = (await call('POST', '/remisiones', { cliente_id: cli, tipo_pago: 'credito', abono: 0, items: [{ producto_id: prod, cantidad: 1 }] }, nico)).body;
  assert.equal(v.pendiente, false);
  assert.equal((await call('GET', `/clientes/${cli}`, null, nico)).body.saldo, 1000);
  const aud = (await call('GET', '/auditoria', null, admin)).body;
  assert.ok((aud.filas ?? aud).some((a) => a.accion === 'quitar paga antes'));
  void stock;
});

test('el tamaño del cuerpo: un anónimo no puede enviar cuerpos grandes; con sesión sí caben las fotos', async () => {
  const { nico, cli, prod } = ctx;
  const grande = { cliente_id: cli, tipo_pago: 'contado', items: [{ producto_id: prod, cantidad: 1 }], relleno: 'x'.repeat(3_000_000) };
  assert.equal((await call('POST', '/remisiones', grande)).status, 413, 'sin sesión se corta en 2 MB');
  const conSesion = await call('POST', '/remisiones', { ...grande, relleno: undefined, soportes: [foto('s1'), foto('s2'), foto('s3')] }, nico);
  assert.equal(conSesion.status, 200);
  assert.equal((await call('GET', `/remisiones/${conSesion.body.id}`, null, nico)).body.soportes.length, 3);
});
