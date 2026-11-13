import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Base creada con el esquema v1 (una sola bodega implícita, ubicacion 0 = bodega, N = ruta N)
const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')), 'v1.db');
const hash = (clave) => { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(clave, salt, 64).toString('hex')}`; };
{
  const v1 = new DatabaseSync(archivo);
  v1.exec(fs.readFileSync(new URL('./fixtures/schema-v1.sql', import.meta.url), 'utf8'));
  v1.exec(`
    INSERT INTO rutas (id,nombre) VALUES (1,'Norte'),(2,'Sur');
    INSERT INTO usuarios (id,nombre,usuario,clave_hash,rol,ruta_id) VALUES (1,'Admin','admin','${hash('admin123')}','admin',NULL),(2,'Freddy','freddy','${hash('freddy123')}','vendedor',1);
    INSERT INTO productos (id,nombre,precio,costo) VALUES (1,'Julypan',1000,600),(2,'Algusto',2000,1500);
    INSERT INTO stock (producto_id,ubicacion,cantidad) VALUES (1,0,500),(1,1,40),(1,2,10),(2,0,70);
    INSERT INTO movimientos (fecha,producto_id,ubicacion,tipo,cantidad,costo,referencia) VALUES ('2026-09-30T10:00:00Z',1,0,'compra',500,600,'C-1'),('2026-09-30T11:00:00Z',1,1,'cargue',40,0,'CG-1');
    INSERT INTO clientes (id,nombre,ruta_id) VALUES (1,'Marta',1),(2,'Pedro',NULL);
    INSERT INTO remisiones (id,uuid,consecutivo,fecha,cliente_id,ruta_id,usuario_id,tipo_pago,subtotal,total,pagado) VALUES
      (1,'u1',1,'2026-09-30 10:00:00',1,1,2,'credito',10000,10000,4000), (2,'u2',2,'2026-09-30 11:00:00',2,0,1,'contado',3000,3000,3000);
    INSERT INTO remision_items (remision_id,producto_id,descripcion,cantidad,precio,costo) VALUES (1,1,'Julypan',10,1000,600),(2,1,'Julypan',3,1000,600);
    INSERT INTO pagos (fecha,cliente_id,remision_id,ruta_id,usuario_id,valor,metodo) VALUES ('2026-09-30 10:00:00',1,1,1,2,4000,'efectivo'),('2026-09-30 11:00:00',2,2,0,1,3000,'efectivo');
    INSERT INTO gastos (fecha,ruta_id,usuario_id,concepto,valor) VALUES ('2026-09-30 12:00:00',1,2,'Gasolina',5000);
    INSERT INTO compras (id,fecha,total,pagado,usuario_id) VALUES (1,'2026-09-30 09:00:00',300000,300000,1);
    INSERT INTO compra_items (compra_id,producto_id,cantidad,costo) VALUES (1,1,500,600);
    INSERT INTO cierres (fecha,ruta_id,usuario_id,esperado,entregado,diferencia) VALUES ('2026-09-30',1,2,0,0,0),('2026-09-30',0,1,3000,3000,0);
  `);
  v1.close();
}

process.env.DB_FILE = archivo;
const { db } = await import('../db.js');
const { iniciar } = await import('./ayuda.js');

test('la base v1 se migra a v2 sin perder datos', () => {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 10);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const bodegas = db.prepare('SELECT * FROM bodegas').all();
  assert.equal(bodegas.length, 1);
  assert.equal(bodegas[0].nombre, 'Bodega principal');
  // las rutas pasan a la bodega principal
  assert.deepEqual(db.prepare('SELECT id, nombre, bodega_id FROM rutas ORDER BY id').all().map((r) => [r.id, r.nombre, r.bodega_id]), [[1, 'Norte', 1], [2, 'Sur', 1]]);
  // ubicaciones: 0 -> B1, N -> RN
  const stock = Object.fromEntries(db.prepare("SELECT producto_id || ':' || ubicacion AS k, cantidad FROM stock").all().map((r) => [r.k, r.cantidad]));
  assert.deepEqual(stock, { '1:B1': 500, '1:R1': 40, '1:R2': 10, '2:B1': 70 });
  assert.deepEqual(db.prepare('SELECT ubicacion FROM movimientos ORDER BY id').all().map((m) => m.ubicacion), ['B1', 'R1']);
  // ventas: ruta 0 (mostrador) -> ruta NULL con bodega 1
  const rem = db.prepare('SELECT id, ruta_id, bodega_id, total, pagado FROM remisiones ORDER BY id').all();
  assert.deepEqual(rem.map((r) => [r.ruta_id, r.bodega_id, r.total, r.pagado]), [[1, 1, 10000, 4000], [null, 1, 3000, 3000]]);
  assert.deepEqual(db.prepare('SELECT ruta_id, bodega_id FROM pagos ORDER BY id').all().map((p) => [p.ruta_id, p.bodega_id]), [[1, 1], [null, 1]]);
  assert.equal(db.prepare('SELECT bodega_id FROM gastos').get().bodega_id, 1);
  assert.equal(db.prepare('SELECT bodega_id FROM compras').get().bodega_id, 1);
  assert.deepEqual(db.prepare('SELECT punto, ruta_id, bodega_id FROM cierres ORDER BY id').all().map((c) => [c.punto, c.ruta_id, c.bodega_id]), [['R1', 1, 1], ['B1', null, 1]]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM remision_items').get().n, 2);
  // las tablas nuevas existen
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM traslados').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM presentaciones').get().n, 0);
  // las líneas vendidas de antes quedan como unidad base, sin precio de lista (no entran al reporte de precios bajos)
  assert.deepEqual(db.prepare('SELECT DISTINCT factor, presentacion, precio_lista FROM remision_items').all().map((i) => [i.factor, i.presentacion, i.precio_lista]), [[1, null, null]]);
});

test('después de migrar, la app funciona con los usuarios y datos de antes', async () => {
  const { server, call, login } = await iniciar();
  after(() => server.close());
  const admin = await login('admin', 'admin123');
  const freddy = await login('freddy', 'freddy123');
  assert.ok(admin && freddy);
  assert.equal((await call('GET', '/auth/me', null, freddy)).body.bodega_id, 1); // hereda la bodega de su ruta
  // inventario y saldos de antes
  assert.equal((await call('GET', '/inventario?ub=R1', null, freddy)).body.productos.find((p) => p.id === 1).cantidad, 40);
  assert.equal((await call('GET', '/clientes/1', null, freddy)).body.saldo, 6000);
  // vender de nuevo y abonar sobre una remisión que venía de v1
  assert.equal((await call('POST', '/pagos', { cliente_id: 1, valor: 6000 }, freddy)).status, 200);
  assert.equal((await call('POST', '/remisiones', { cliente_id: 1, tipo_pago: 'contado', items: [{ producto_id: 1, cantidad: 5 }] }, freddy)).body.consecutivo, 3);
  assert.equal((await call('GET', '/inventario?ub=R1', null, freddy)).body.productos.find((p) => p.id === 1).cantidad, 35);
  assert.equal((await call('GET', '/cierre?punto=B1&fecha=2026-09-30', null, admin)).body.cierre.entregado, 3000);
  // y abrir de nuevo la base ya migrada no la vuelve a tocar
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 10);
});
