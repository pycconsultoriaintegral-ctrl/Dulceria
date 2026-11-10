import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Copia consistente de la base (VACUUM INTO) y conserva solo las últimas N.
// Abre la base SOLO PARA LECTURA y nunca la crea: este proceso corre como root en su propio contenedor, y si creara
// la base (o sus archivos -wal/-shm) quedarían a nombre de root y la app, que corre como usuario normal, no podría escribir.
const origen = process.env.DB_FILE || path.resolve('data/dulceria.db');
const dir = process.env.BACKUP_DIR || path.resolve('respaldos');
const conservar = Number(process.env.BACKUP_KEEP || 14);
if (!fs.existsSync(origen)) {
  console.log(`Aún no hay base de datos en ${origen}: no hay nada que respaldar.`);
  process.exit(0);
}
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const destino = path.join(dir, `dulceria-${stamp}.db`);
const db = new DatabaseSync(origen, { readOnly: true });
try {
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
} finally {
  db.close();
}
const viejos = fs.readdirSync(dir).filter((f) => /^dulceria-.*\.db$/.test(f)).sort().slice(0, -conservar);
for (const f of viejos) fs.rmSync(path.join(dir, f));
console.log(`Respaldo creado: ${destino} (se conservan ${conservar})`);
