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
  assert.equal(salida.v, 6);
  assert.ok(salida.cols.includes('transferencias'));
  const despues = new DatabaseSync(archivo);
  const c = despues.prepare('SELECT esperado, transferencias FROM cierres').get();
  despues.close();
  assert.equal(c.esperado, 5000); // el dato de antes sigue ahí
  assert.equal(c.transferencias, 0);
  // abrirla otra vez no cambia nada
  assert.equal(JSON.parse(abrir()).v, 6);
});
