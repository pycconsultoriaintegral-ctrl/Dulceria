import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';

// Copia consistente de la base (VACUUM INTO) y conserva solo las últimas N
const dir = process.env.BACKUP_DIR || path.resolve('respaldos');
const conservar = Number(process.env.BACKUP_KEEP || 14);
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const destino = path.join(dir, `dulceria-${stamp}.db`);
db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
const viejos = fs.readdirSync(dir).filter((f) => /^dulceria-.*\.db$/.test(f)).sort().slice(0, -conservar);
for (const f of viejos) fs.rmSync(path.join(dir, f));
console.log(`Respaldo creado: ${destino} (se conservan ${conservar})`);
