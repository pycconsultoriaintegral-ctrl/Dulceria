// Genera los íconos de la app (Android, iPhone y navegador) a partir del logo.
// Uso:  node web/marca/generar-iconos.mjs [ruta-del-logo.svg|png|jpg] [color-de-fondo]
// Necesita Playwright con Chromium (npx playwright install chromium) solo en la máquina que genera los íconos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const salida = path.resolve(aqui, '../public');
const logo = path.resolve(process.argv[2] || path.join(aqui, 'logo.svg'));
const fondo = process.argv[3] || '#0b1f4d';
let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch { console.error('Falta Playwright: npm i -D playwright && npx playwright install chromium'); process.exit(1); }

// tamaño, nombre y relleno: los íconos "maskable" de Android dejan un margen de seguridad (el sistema los recorta en círculo)
const iconos = [
  [192, 'icon-192.png', 0], [512, 'icon-512.png', 0], [512, 'icon-maskable-512.png', 0.12], [180, 'apple-touch-icon.png', 0], [32, 'favicon-32.png', 0],
];
const b = await chromium.launch();
const p = await b.newPage();
const tmp = path.join(aqui, '.render.html');
for (const [tam, nombre, margen] of iconos) {
  const m = Math.round(tam * margen);
  fs.writeFileSync(tmp, `<html><body style="margin:0;background:${fondo}"><div style="width:${tam}px;height:${tam}px;display:grid;place-items:center;background:${fondo}">
    <img src="${pathToFileURL(logo)}" style="width:${tam - 2 * m}px;height:${tam - 2 * m}px;object-fit:contain"></div></body></html>`);
  await p.setViewportSize({ width: tam, height: tam });
  await p.goto(pathToFileURL(tmp).href);
  await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(salida, nombre), clip: { x: 0, y: 0, width: tam, height: tam } });
  console.log('✓', nombre);
}
fs.rmSync(tmp);
if (logo.endsWith('.svg')) fs.copyFileSync(logo, path.join(salida, 'icon.svg'));
await b.close();
