// Envía la tirilla a la impresora térmica. Cada celular guarda su propia configuración (cada carro tiene su impresora).
//  - 'rawbt': Android + app gratuita RawBT. Funciona con impresoras Bluetooth clásicas (como la de los carros) y BLE.
//  - 'ble':   Bluetooth LE directo desde el navegador (Chrome en Android; en iPhone solo con el navegador Bluefy).
//  - 'pdf':   sin impresora: abre el ticket en PDF para compartirlo.
import { escpos, aBase64 } from './tirilla.js';

const CLAVE = 'dr_impresora';
export const esAndroid = () => /Android/i.test(navigator.userAgent);
export const esIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const hayBluetoothWeb = () => !!navigator.bluetooth;

export function preferencias() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { /* sin almacenamiento */ }
  return { metodo: p.metodo || (esAndroid() ? 'rawbt' : 'pdf'), papel: p.papel || '58', tildes: p.tildes !== false, configurada: !!p.metodo };
}
export function guardarPreferencias(p) {
  try { localStorage.setItem(CLAVE, JSON.stringify({ metodo: p.metodo, papel: p.papel, tildes: p.tildes })); } catch { /* */ }
}

// ---------- Android: RawBT ----------
// La app RawBT recibe los bytes por un "intent" y los manda a la impresora emparejada. Si no está instalada, Android abre la Play Store.
function enviarRawBT(bytes) {
  location.href = `intent:base64,${aBase64(bytes)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

// ---------- Bluetooth LE directo ----------
// Servicios que usan las impresoras térmicas más comunes (Xprinter, ZJiang, GOOJPRT, MTP, etc.)
const SERVICIOS = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb'];
let canal = null; // característica de escritura de la impresora conectada
let nombreConectada = '';

export async function conectarBle() {
  if (!hayBluetoothWeb()) throw new Error(esIOS() ? 'Safari y Chrome en iPhone no permiten Bluetooth. Abre la app en el navegador "Bluefy" o comparte el PDF.' : 'Este navegador no permite Bluetooth. Usa Chrome o la opción RawBT.');
  const disp = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICIOS });
  const gatt = await disp.gatt.connect();
  for (const s of await gatt.getPrimaryServices()) {
    for (const c of await s.getCharacteristics()) {
      if (c.properties.writeWithoutResponse || c.properties.write) {
        canal = c; nombreConectada = disp.name || 'Impresora';
        disp.addEventListener('gattserverdisconnected', () => { canal = null; });
        return nombreConectada;
      }
    }
  }
  gatt.disconnect();
  throw new Error('Esa impresora no acepta impresión por Bluetooth LE. En Android usa la opción RawBT.');
}
export const bleConectada = () => (canal ? nombreConectada : '');

const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function enviarBle(bytes) {
  if (!canal) await conectarBle();
  // se envía por partes; si la impresora no acepta partes grandes se baja a 20 bytes (el mínimo del estándar)
  let tam = 180;
  for (let i = 0; i < bytes.length;) {
    const parte = bytes.slice(i, i + tam);
    try {
      if (canal.properties.writeWithoutResponse) await canal.writeValueWithoutResponse(parte);
      else await canal.writeValue(parte);
      i += parte.length;
      await pausa(tam > 20 ? 25 : 8);
    } catch (e) {
      if (tam > 20) { tam = 20; continue; }
      canal = null;
      throw new Error('Se perdió la conexión con la impresora. Revisa que esté encendida y vuelve a intentar.');
    }
  }
}

// Imprime una remisión. "obtener" puede ser la remisión o una función async que la trae del servidor.
// Con Bluetooth LE hay que conectar ANTES de cualquier espera: el navegador solo deja abrir el selector justo después del toque.
export async function imprimirRemision(obtener, cfg, { alPdf } = {}) {
  const p = preferencias();
  if (p.metodo === 'ble' && !canal) await conectarBle();
  const r = typeof obtener === 'function' ? await obtener() : obtener;
  if (p.metodo === 'pdf') { if (alPdf) return alPdf(r); throw new Error('Configura la impresora en Más → Impresora'); }
  const bytes = escpos(r, cfg, { papel: p.papel, tildes: p.tildes });
  if (p.metodo === 'ble') return enviarBle(bytes);
  return enviarRawBT(bytes);
}
