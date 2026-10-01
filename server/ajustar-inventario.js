// Ajuste de inventario de la bodega central por conteo físico.
//   node server/ajustar-inventario.js            -> solo muestra qué cambiaría (no escribe)
//   node server/ajustar-inventario.js --aplicar  -> aplica los ajustes y los deja en el kardex
// Usa DB_FILE igual que la app (por defecto data/dulceria.db).
import { db, tx, getStock, moverStock } from './db.js';

const CONTEO = [
  ['JULYPAN GRANDE', 25898],
  ['ESTIBA JULYPAN', 130],
  ['ALGUSTO GRANDE', 2287],
  ['ESTIBA ALGUSTO', 147],
  ['GENERICA GRANDE', 51],
  ['GENERICA MEDIANA', 6],
  ['ESTIBA GENERICA', 422],
  ['CAJONES GRANDES', 159],
];
const NOTA = 'Conteo físico bodega';
const BODEGA = 0;

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const aplicar = process.argv.includes('--aplicar');

const productos = db.prepare('SELECT id, nombre FROM productos').all();
const porNombre = new Map(productos.map((p) => [norm(p.nombre), p]));

const plan = [];
const faltan = [];
for (const [nombre, real] of CONTEO) {
  const p = porNombre.get(norm(nombre));
  if (!p) { faltan.push(nombre); continue; }
  const actual = getStock(p.id, BODEGA);
  plan.push({ p, real, actual, delta: real - actual });
}

console.table(plan.map(({ p, real, actual, delta }) => ({ producto: p.nombre, actual, conteo: real, diferencia: delta })));
if (faltan.length) {
  console.error('\nNo existen estos productos (revisa el nombre exacto en la app):\n - ' + faltan.join('\n - '));
  console.error('\nProductos disponibles:\n - ' + productos.map((p) => p.nombre).join('\n - '));
  console.error('\nNo se aplicó nada.');
  process.exit(1);
}
if (!aplicar) { console.log('\nSimulación. Para aplicar: node server/ajustar-inventario.js --aplicar'); process.exit(0); }

tx(() => {
  for (const { p, delta } of plan) {
    if (delta !== 0) moverStock({ productoId: p.id, ubicacion: BODEGA, delta, tipo: 'ajuste', referencia: 'AJ', nota: NOTA });
  }
});
console.log('\nInventario de bodega ajustado.');
