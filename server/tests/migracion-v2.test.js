import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Una base en la versión 2 (sin la columna de transferencias en los cierres) se actualiza sola al abrirla
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig2-'));
const archivo = path.join(dir, 'v2.db');
const abrir = () => execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e',
  "import { db } from './server/db.js'; console.log(JSON.stringify({ v: db.prepare('PRAGMA user_version').get().user_version, cols: db.prepare(\"SELECT name FROM pragma_table_info('cierres')\").all().map((c) => c.name) }));"],
{ env: { ...process.env, DB_FILE: archivo }, encoding: 'utf8' });

test('una base v2 recibe la columna de transferencias y conserva sus cierres', () => {
  abrir(); // crea la base con el esquema actual
  const v2 = new DatabaseSync(archivo);
  v2.exec(`INSERT INTO cierres (fecha,punto,bodega_id,esperado,entregado,diferencia) VALUES ('2026-09-30','B1',1,5000,5000,0)`);
  v2.exec('ALTER TABLE cierres DROP COLUMN transferencias; PRAGMA user_version = 2');
  v2.close();
  const salida = JSON.parse(abrir());
  assert.equal(salida.v, 9);
  assert.ok(salida.cols.includes('transferencias'));
  const despues = new DatabaseSync(archivo);
  const c = despues.prepare('SELECT esperado, transferencias FROM cierres').get();
  despues.close();
  assert.equal(c.esperado, 5000); // el dato de antes sigue ahí
  assert.equal(c.transferencias, 0);
  // abrirla otra vez no cambia nada
  assert.equal(JSON.parse(abrir()).v, 9);
});

// v9: usuarios.rol deja de estar limitado a tres valores, sin perder usuarios ni referencias
test('una base v8 (rol limitado a 3 valores) se migra y acepta roles nuevos', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mig9-'));
  const f = path.join(d, 'v8.db');
  const correr = (js) => execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', js], { env: { ...process.env, DB_FILE: f }, encoding: 'utf8' });
  correr("import { db } from './server/db.js'; console.log(1)");
  const v8 = new DatabaseSync(f);
  v8.exec(`PRAGMA foreign_keys=OFF; DROP TABLE roles;
    CREATE TABLE usuarios_v (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, usuario TEXT NOT NULL UNIQUE, clave_hash TEXT NOT NULL,
      rol TEXT NOT NULL CHECK (rol IN ('admin','bodeguero','vendedor')), ruta_id INTEGER REFERENCES rutas(id), bodega_id INTEGER REFERENCES bodegas(id), activo INTEGER DEFAULT 1);
    INSERT INTO usuarios_v SELECT * FROM usuarios; DROP TABLE usuarios; ALTER TABLE usuarios_v RENAME TO usuarios;
    INSERT INTO usuarios (nombre,usuario,clave_hash,rol) VALUES ('Admin','admin','x','admin');
    INSERT INTO productos (nombre) VALUES ('Pan'), ('Gastos bancarios'), ('CUENTAS POR PAGAR A CLIENTES');
    INSERT INTO clientes (id,nombre) VALUES (1,'C'); INSERT INTO remisiones (uuid,consecutivo,fecha,cliente_id,bodega_id,usuario_id,tipo_pago,subtotal,total) VALUES ('u',1,'2026-01-01',1,1,1,'contado',0,0);
    PRAGMA user_version = 8;`);
  assert.throws(() => v8.exec("INSERT INTO usuarios (nombre,usuario,clave_hash,rol) VALUES ('C','c','x','contador')")); // el límite existía
  v8.close();
  const salida = JSON.parse(correr("import { db } from './server/db.js'; console.log(JSON.stringify({ v: db.prepare('PRAGMA user_version').get().user_version, roles: db.prepare('SELECT COUNT(*) n FROM roles').get().n, fk: db.prepare('PRAGMA foreign_key_check').all().length, activos: db.prepare('SELECT nombre FROM productos WHERE activo=1').all().map((p) => p.nombre) }))"));
  assert.equal(salida.v, 9);
  assert.equal(salida.roles, 6);
  assert.equal(salida.fk, 0);
  assert.deepEqual(salida.activos, ['Pan']); // los conceptos contables quedaron inactivos
  const v9 = new DatabaseSync(f);
  v9.exec("INSERT INTO usuarios (nombre,usuario,clave_hash,rol) VALUES ('C','c','x','contador')"); // ahora sí
  assert.equal(v9.prepare("SELECT COUNT(*) n FROM usuarios WHERE rol IN ('admin','contador')").get().n, 2);
  assert.equal(v9.prepare('SELECT usuario_id FROM remisiones').get().usuario_id, 1);
  v9.close();
});
