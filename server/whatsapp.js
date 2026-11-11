// Resumen diario al WhatsApp del dueño, con la API oficial de WhatsApp (Meta Cloud API).
// Los mensajes que inicia el negocio deben usar una PLANTILLA aprobada por Meta (ver WHATSAPP.md).
// Credenciales solo por variables de entorno: WHATSAPP_TOKEN y WHATSAPP_PHONE_ID (nunca en la base de datos).
import { db, ahora, hoy, getConfig } from './db.js';
import { r2, conPrefijo } from './util.js';
import { alertasInventario, textoAlertas } from './alertas.js';
import { usuarioSistema } from './auth.js';

const API = () => (process.env.WHATSAPP_API_URL || 'https://graph.facebook.com').replace(/\/$/, '');
const VERSION = () => process.env.WHATSAPP_API_VERSION || 'v23.0';
export const configurado = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);

const pesos = (v) => '$' + Math.round(Number(v) || 0).toLocaleString('es-CO').replace(/,/g, '.');
// Número colombiano de 10 dígitos -> 57XXXXXXXXXX; otros se dejan como vienen (solo dígitos)
export const normalizarNumero = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length === 10 && d.startsWith('3') ? '57' + d : d; };
export const numerosConfigurados = (cfg = getConfig()) => String(cfg.whatsapp_numeros || '').split(/[,;\n]+/).map(normalizarNumero).filter((x) => x.length >= 11);

// Ajustes del resumen (los guarda el administrador en Ajustes)
export function ajustes(cfg = getConfig()) {
  return {
    activo: cfg.whatsapp_activo === '1', numeros: numerosConfigurados(cfg), hora: /^\d{2}:\d{2}$/.test(cfg.whatsapp_hora || '') ? cfg.whatsapp_hora : '20:00',
    plantilla: cfg.whatsapp_plantilla || 'resumen_diario', idioma: cfg.whatsapp_idioma || 'es', configurado: configurado(),
  };
}

// Números del día para todo el negocio (todas las bodegas, rutas y mostradores)
export function resumenDelDia(fecha = hoy()) {
  const v = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM remisiones WHERE anulada=0 AND substr(fecha,1,10)=?").get(fecha);
  const p = db.prepare(`SELECT COALESCE(SUM(CASE WHEN metodo='efectivo' THEN valor END),0) AS efectivo, COALESCE(SUM(CASE WHEN metodo<>'efectivo' THEN valor END),0) AS transf
    FROM pagos WHERE anulado=0 AND substr(fecha,1,10)=?`).get(fecha);
  const gastos = db.prepare('SELECT COALESCE(SUM(valor),0) AS v FROM gastos WHERE substr(fecha,1,10)=?').get(fecha).v;
  // puntos que tuvieron movimiento ese día y cuáles hicieron cierre
  const conMov = db.prepare(`SELECT DISTINCT CASE WHEN ruta_id IS NULL THEN 'B'||bodega_id ELSE 'R'||ruta_id END AS punto FROM (
      SELECT ruta_id, bodega_id FROM remisiones WHERE anulada=0 AND substr(fecha,1,10)=@f
      UNION ALL SELECT ruta_id, bodega_id FROM pagos WHERE anulado=0 AND substr(fecha,1,10)=@f
      UNION ALL SELECT ruta_id, bodega_id FROM gastos WHERE substr(fecha,1,10)=@f)`).all({ f: fecha }).map((x) => x.punto);
  const cierres = db.prepare('SELECT punto, diferencia FROM cierres WHERE fecha=?').all(fecha);
  const cerrados = new Set(cierres.map((c) => c.punto));
  const sinCierre = conMov.filter((x) => !cerrados.has(x));
  const diferencia = r2(cierres.reduce((a, c) => a + (c.diferencia || 0), 0));
  const cartera = db.prepare('SELECT COALESCE(SUM(total-pagado),0) AS v FROM remisiones WHERE anulada=0').get().v;
  const porAprobar = db.prepare('SELECT COUNT(*) AS n FROM remisiones WHERE anulada=2').get().n;
  const porPunto = db.prepare(`SELECT r.ruta_id, r.bodega_id, ru.nombre AS ruta, b.nombre AS bodega, SUM(r.total) AS total, COUNT(*) AS n FROM remisiones r
    JOIN bodegas b ON b.id=r.bodega_id LEFT JOIN rutas ru ON ru.id=r.ruta_id WHERE r.anulada=0 AND substr(r.fecha,1,10)=? GROUP BY r.ruta_id, r.bodega_id ORDER BY total DESC`).all(fecha)
    .map((x) => ({ nombre: x.ruta ? conPrefijo('Ruta', x.ruta) : `Mostrador ${x.bodega}`, total: r2(x.total), remisiones: x.n }));
  const nombres = (codigos) => codigos.map((c) => (c[0] === 'R' ? conPrefijo('Ruta', db.prepare('SELECT nombre FROM rutas WHERE id=?').get(Number(c.slice(1)))?.nombre) : `Mostrador ${db.prepare('SELECT nombre FROM bodegas WHERE id=?').get(Number(c.slice(1)))?.nombre}`));
  const textoCierres = !conMov.length ? 'sin movimiento' : sinCierre.length ? `${conMov.length - sinCierre.length} de ${conMov.length} (faltan ${nombres(sinCierre).join(', ')})`
    : `todos (${conMov.length})${Math.abs(diferencia) >= 1 ? `, diferencia ${diferencia < 0 ? '-' : '+'}${pesos(Math.abs(diferencia))}` : ', sin diferencias'}`;
  // alertas de inventario de todo el negocio (bodegas y carros)
  const inv = alertasInventario(usuarioSistema());
  return {
    fecha, remisiones: v.n, inventario: textoAlertas(inv), alertas: inv.resumen, ventas: r2(v.total), efectivo: r2(p.efectivo), transferencias: r2(p.transf), gastos: r2(gastos), cartera: r2(cartera),
    por_aprobar: porAprobar, puntos_con_movimiento: conMov.length, puntos_sin_cierre: nombres(sinCierre), diferencia_cierres: diferencia, por_punto: porPunto, texto_cierres: textoCierres,
  };
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaLarga = (f) => { const [y, m, d] = f.split('-'); return `${Number(d)} ${MESES[Number(m) - 1]} ${y}`; };
// Los parámetros de una plantilla no pueden llevar saltos de línea, tabulaciones ni más de 4 espacios seguidos
const limpiar = (t) => String(t).replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 300);

// Parámetros {{1}}…{{10}} en el orden de la plantilla de WHATSAPP.md
export function parametros(r) {
  return [fechaLarga(r.fecha), pesos(r.ventas), String(r.remisiones), pesos(r.efectivo), pesos(r.transferencias), pesos(r.gastos), r.texto_cierres, pesos(r.cartera), String(r.por_aprobar), r.inventario].map(limpiar);
}

// El mismo resumen en texto libre: vista previa y envío manual con el botón de WhatsApp
export function texto(r, cfg = getConfig()) {
  const l = [`*${cfg.negocio || 'Resumen'}* · Resumen del ${fechaLarga(r.fecha)}`, '',
    `🛒 Vendido: *${pesos(r.ventas)}* (${r.remisiones} remisiones)`, `💵 Efectivo cobrado: ${pesos(r.efectivo)}`, `📲 Transferencias: ${pesos(r.transferencias)}`,
    `⛽ Gastos: ${pesos(r.gastos)}`, `🧾 Cierres de caja: ${r.texto_cierres}`, `📒 Por cobrar (cartera): ${pesos(r.cartera)}`];
  if (r.por_aprobar) l.push(`⏳ Pagos por aprobar: ${r.por_aprobar}`);
  l.push(`📦 Inventario: ${r.inventario}`);
  if (r.por_punto.length) { l.push('', '*Por punto:*'); for (const x of r.por_punto) l.push(`• ${x.nombre}: ${pesos(x.total)} (${x.remisiones})`); }
  return l.join('\n');
}

// Envía la plantilla a un número. Devuelve { ok, id } o { ok:false, error }.
export async function enviarPlantilla(para, params, a = ajustes()) {
  if (!configurado()) return { ok: false, error: 'WhatsApp no está configurado en el servidor (faltan WHATSAPP_TOKEN y WHATSAPP_PHONE_ID)' };
  try {
    const r = await fetch(`${API()}/${VERSION()}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'template',
        template: { name: a.plantilla, language: { code: a.idioma }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: d?.error?.error_data?.details || d?.error?.message || `Error ${r.status} de WhatsApp` };
    return { ok: true, id: d?.messages?.[0]?.id || null };
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'WhatsApp no respondió a tiempo' : `No se pudo conectar con WhatsApp: ${e.message}` };
  }
}

const registrar = db.prepare('INSERT INTO envios_whatsapp (fecha, fecha_resumen, para, tipo, estado, mensaje_id, detalle) VALUES (?,?,?,?,?,?,?)');
// Envía el resumen de "fecha" a todos los números configurados y deja constancia de cada envío
export async function enviarResumen(fecha = hoy(), tipo = 'resumen') {
  const a = ajustes();
  if (!a.numeros.length) return [{ ok: false, error: 'No hay números de WhatsApp configurados' }];
  const params = parametros(resumenDelDia(fecha));
  const out = [];
  for (const para of a.numeros) {
    const r = await enviarPlantilla(para, params, a);
    registrar.run(ahora(), fecha, para, tipo, r.ok ? 'enviado' : 'error', r.id ?? null, r.ok ? null : String(r.error).slice(0, 500));
    out.push({ para, ...r });
  }
  return out;
}

// Programación: cada minuto revisa si ya es la hora y si el resumen de hoy aún no salió a cada número.
// Si el servidor estuvo apagado a la hora, lo envía al encender (el mismo día). Reintenta un error cada 15 min, máximo 3 veces.
export async function revisarProgramacion(ahoraMismo = new Date()) {
  const a = ajustes();
  if (!a.activo || !a.configurado || !a.numeros.length) return null;
  const hora = new Intl.DateTimeFormat('en-GB', { timeZone: process.env.TZ_NEGOCIO || 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ahoraMismo);
  if (hora < a.hora) return null;
  const fecha = hoy(ahoraMismo);
  const enviados = [];
  for (const para of a.numeros) {
    const previos = db.prepare("SELECT estado, fecha FROM envios_whatsapp WHERE tipo='resumen' AND fecha_resumen=? AND para=? ORDER BY id DESC").all(fecha, para);
    if (previos.some((x) => x.estado === 'enviado') || previos.length >= 3) continue;
    if (previos.length) {
      const ultimo = new Date(previos[0].fecha.replace(' ', 'T') + '-05:00');
      if (ahoraMismo - ultimo < 15 * 60 * 1000) continue;
    }
    const r = await enviarPlantilla(para, parametros(resumenDelDia(fecha)), a);
    registrar.run(ahora(ahoraMismo), fecha, para, 'resumen', r.ok ? 'enviado' : 'error', r.id ?? null, r.ok ? null : String(r.error).slice(0, 500));
    enviados.push({ para, ...r });
  }
  return enviados;
}

let reloj = null;
export function iniciarProgramacion() {
  if (reloj) return;
  reloj = setInterval(() => { revisarProgramacion().catch((e) => console.error('Resumen WhatsApp:', e.message)); }, 60 * 1000);
  reloj.unref?.();
}
