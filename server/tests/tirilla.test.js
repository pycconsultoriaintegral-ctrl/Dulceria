// La tirilla térmica se arma en el celular (web/src/tirilla.js); aquí se prueba sin navegador.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { escpos, renglones, textoPlano, codificar, partir, columnas, remisionDePrueba } from '../../web/src/tirilla.js';
import { iniciar } from './ayuda.js';

const cfg = { negocio: 'BAJIRA-VERA', nit: '71351641', direccion: 'APARTADÓ', prefijo: 'R', pie_remision: 'Gracias por tu compra. (Cuenta: Ahorros Bancolombia 912-822590-31)' };

test('ningún renglón se pasa del ancho del papel (58 mm = 32, 80 mm = 48 columnas)', () => {
  const r = remisionDePrueba('Freddy');
  r.items.push({ descripcion: 'Un producto con un nombre larguísimo que no cabe en un solo renglón del papel', cantidad: 120, precio: 1234567 });
  for (const papel of ['58', '80']) {
    const { ancho, renglones: rs } = renglones(r, cfg, { papel });
    assert.equal(ancho, columnas(papel));
    for (const x of rs) assert.ok(x.t.length <= (x.g ? ancho / 2 : ancho), `"${x.t}" (${x.t.length}) excede ${ancho}`);
  }
});

test('contenido: encabezado, consecutivo, productos, totales, forma de pago y pie', () => {
  const txt = textoPlano(remisionDePrueba('Freddy'), cfg, { papel: 58 });
  for (const t of ['BAJIRA-VERA', 'NIT: 71351641', 'REMISIÓN', 'No. R-000001', 'Vendedor: Freddy', 'MANTECADAS X 14', '$26.000', 'TOTAL', '$53.500', 'Efectivo', 'Bancolombia'])
    assert.ok(txt.includes(t), `falta "${t}"`);
});

test('comandos ESC/POS: reinicio, página PC850, tildes codificadas y avance final', () => {
  const b = escpos(remisionDePrueba(), cfg);
  assert.deepEqual([...b.slice(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 2]);
  assert.deepEqual(codificar('áéíóúñÑ¿¡'), [0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa8, 0xad]);
  assert.deepEqual(codificar('Peña', { tildes: false }), [...Buffer.from('Pena')]);
  assert.ok(b.every((x) => x <= 0xff));
  // sin tildes no se envía el cambio de página de códigos ni bytes por encima de ASCII
  const sin = escpos(remisionDePrueba(), cfg, { tildes: false });
  assert.deepEqual([...sin.slice(0, 3)], [0x1b, 0x40, 0x1b]);
  assert.notEqual(sin[3], 0x74);
  assert.ok([...sin].filter((x, i) => i > 2).every((x) => x < 0x80 || x === 0x42));
});

test('venta sin señal: tirilla provisional; pendiente de pago: marcada como no válida', () => {
  const r = { ...remisionDePrueba(), consecutivo: null, provisional: 'AB12CD34' };
  const t = textoPlano(r, cfg);
  assert.ok(t.includes('Provisional AB12CD34'));
  assert.ok(t.includes('número definitivo'));
  const p = textoPlano({ ...remisionDePrueba(), pendiente: true, anulada: 2 }, cfg);
  assert.ok(p.includes('PENDIENTE DE PAGO'));
  assert.ok(p.includes('NO VÁLIDA'));
  assert.ok(!p.includes('Total pagado'));
});

test('partir texto respeta palabras', () => {
  assert.deepEqual(partir('hola mundo cruel', 10), ['hola mundo', 'cruel']);
  assert.deepEqual(partir('abcdefghijkl', 5), ['abcde', 'fghij', 'kl']);
});

const { server, call, login } = await iniciar();
after(() => server.close());

test('el detalle trae las formas de pago y el PDF sale en 58 mm', async () => {
  const admin = await login('admin', 'admin123');
  const b1 = (await call('GET', '/bodegas', null, admin)).body[0].id;
  const prod = (await call('POST', '/productos', { nombre: 'Mantecadas', precio: 16000, costo: 0 }, admin)).body.id;
  await call('POST', '/compras', { bodega_id: b1, items: [{ producto_id: prod, cantidad: 10, costo: 9000 }] }, admin);
  const cli = (await call('POST', '/clientes', { nombre: 'Consumidor final' }, admin)).body.id;
  const v = (await call('POST', '/remisiones', { cliente_id: cli, punto: `B${b1}`, tipo_pago: 'credito', abono: 10000, metodo: 'transferencia', items: [{ producto_id: prod, cantidad: 2 }] }, admin)).body;
  await call('POST', '/pagos', { cliente_id: cli, valor: 5000, punto: `B${b1}` }, admin);
  const d = (await call('GET', `/remisiones/${v.id}`, null, admin)).body;
  assert.deepEqual(d.pagos, [{ metodo: 'efectivo', valor: 5000 }, { metodo: 'transferencia', valor: 10000 }]);
  const t = textoPlano(d, cfg);
  assert.ok(t.includes('Crédito') && t.includes('Transferencia') && t.includes('Saldo remisión'));
  const pdf = await call('GET', `/remisiones/${v.id}/pdf?papel=58`, null, admin);
  assert.equal(pdf.status, 200);
  assert.match(pdf.body.toString('latin1'), /MediaBox \[0 0 164\.41/);
});
