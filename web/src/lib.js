import { useEffect, useState, useCallback } from 'react';

// ---------- Formato ----------
export const money = (v) => '$' + Math.round(Number(v) || 0).toLocaleString('es-CO');
export const qty = (v) => (Number.isInteger(+v) ? String(+v) : (+v).toFixed(2));
export const hoyStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
export const numRem = (cfg, c) => `${cfg?.prefijo || 'R'}-${String(c).padStart(6, '0')}`;

// ---------- Sesión ----------
const K = { token: 'dr_token', user: 'dr_user', cola: 'dr_cola', rech: 'dr_rechazadas' };
const ls = {
  get: (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; /* sin almacenamiento */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* */ } },
};
export const getToken = () => ls.get(K.token);
export const getUser = () => ls.get(K.user);
export function guardarSesion(token, user) { ls.set(K.token, token); ls.set(K.user, user); }
export function cerrarSesion() { Object.values(K).forEach(ls.del); Object.keys(localStorage).filter((k) => k.startsWith('dr_cache:')).forEach(ls.del); location.hash = '#/'; location.reload(); }

// ---------- API ----------
export class ApiError extends Error { constructor(m, status) { super(m); this.status = status; } }
export class OfflineError extends Error { constructor() { super('Sin conexión'); } }

async function raw(method, url, body, opts = {}) {
  let r;
  try {
    r = await fetch('/api' + url, {
      method, headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new OfflineError(); }
  if (r.status === 401 && !opts.noAuthRedirect) cerrarSesion();
  if (opts.blob) { if (!r.ok) throw new ApiError('No se pudo descargar el documento', r.status); return r.blob(); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(data.error || 'Error inesperado', r.status);
  return data;
}

// GET con respaldo en caché local para poder trabajar sin señal (catálogos)
const CACHEABLES = ['/productos', '/clientes', '/config', '/rutas', '/ubicaciones'];
export async function get(url) {
  const cacheable = CACHEABLES.includes(url.split('?')[0]);
  try {
    const d = await raw('GET', url);
    if (cacheable) ls.set('dr_cache:' + url, d);
    return d;
  } catch (e) {
    if (e instanceof OfflineError && cacheable) { const c = ls.get('dr_cache:' + url); if (c) return c; }
    throw e;
  }
}
export const post = (u, b) => raw('POST', u, b ?? {});
export const put = (u, b) => raw('PUT', u, b ?? {});
export const login = (usuario, clave) => raw('POST', '/auth/login', { usuario, clave }, { noAuthRedirect: true });
export const blob = (u) => raw('GET', u, undefined, { blob: true });

// ---------- Cola sin conexión (ventas y abonos) ----------
const listeners = new Set();
const avisar = () => listeners.forEach((f) => f());
export const cola = () => ls.get(K.cola, []);
export const rechazadas = () => ls.get(K.rech, []);
export const descartarRechazada = (id) => { ls.set(K.rech, rechazadas().filter((x) => x.uuid !== id)); avisar(); };

// Envía la operación; si no hay conexión queda guardada y se sincroniza sola después.
export async function enviar(tipo, payload, etiqueta) {
  try {
    const url = tipo === 'venta' ? '/remisiones' : '/pagos';
    return { ok: true, data: await post(url, payload) };
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    // si el celular no tiene espacio (por ejemplo, con varias fotos de comprobantes) no se puede guardar: hay que avisar, no perder la venta en silencio
    if (!ls.set(K.cola, [...cola(), { tipo, payload, uuid: payload.uuid, etiqueta }])) throw new Error('No hay espacio en el celular para guardar la venta sin señal. Quita las fotos del soporte o espera a tener conexión.');
    avisar();
    return { ok: false, pendiente: true };
  }
}

let sincronizando = false;
export async function sincronizar() {
  if (sincronizando || !getToken()) return;
  sincronizando = true;
  try {
    for (const item of cola()) {
      try {
        await post(item.tipo === 'venta' ? '/remisiones' : '/pagos', item.payload);
      } catch (e) {
        if (e instanceof OfflineError) break; // seguimos sin señal
        ls.set(K.rech, [...rechazadas(), { ...item, error: e.message }]); // rechazada por el servidor (ej. sin stock)
      }
      ls.set(K.cola, cola().filter((x) => x.uuid !== item.uuid));
      avisar();
    }
  } finally { sincronizando = false; }
}
export function useCola() {
  const [, setN] = useState(0);
  useEffect(() => { const f = () => setN((n) => n + 1); listeners.add(f); return () => listeners.delete(f); }, []);
  return { pendientes: cola(), rechazadas: rechazadas() };
}

// ---------- Hooks ----------
export function useHash() {
  const [h, setH] = useState(location.hash.slice(1) || '/');
  useEffect(() => { const f = () => { setH(location.hash.slice(1) || '/'); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}
export const ir = (p) => { location.hash = '#' + p; };

export function useCarga(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const recargar = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then((data) => setState({ data, error: null, loading: false }), (error) => setState({ data: null, error: error.message, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(recargar, [recargar]);
  return { ...state, recargar };
}

// ---------- Compartir remisión ----------
export function telWhatsApp(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length === 10 ? '57' + d : d;
}
export async function compartirRemision(r, cfg) {
  const numero = numRem(cfg, r.consecutivo);
  const texto = `${cfg?.negocio || 'Remisión'}\nRemisión ${numero}\nTotal: ${money(r.total)}${r.saldo > 0 ? `\nSaldo pendiente: ${money(r.saldo)}` : ''}\n¡Gracias por su compra!`;
  const pdf = await blob(`/remisiones/${r.id}/pdf`);
  const file = new File([pdf], `remision-${numero}.pdf`, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text: texto, title: `Remisión ${numero}` }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  // Respaldo: descarga el PDF y abre WhatsApp con el resumen (el PDF se adjunta desde Descargas)
  const a = document.createElement('a'); a.href = URL.createObjectURL(pdf); a.download = file.name; a.click();
  const tel = telWhatsApp(r.telefono);
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank');
}
// Abre el visor de remisión dentro de la app (lo pinta <VisorPdf/> en App.jsx)
export function abrirPdf(r) { window.dispatchEvent(new CustomEvent('ver-pdf', { detail: r })); }
export async function descargarPdf(r, cfg, formato = 'ticket') {
  const pdf = await blob(`/remisiones/${r.id}/pdf?formato=${formato}`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(pdf);
  a.download = `remision-${numRem(cfg, r.consecutivo)}${formato === 'carta' ? '-carta' : ''}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------- Bodegas y puntos de venta ----------
export const esAdmin = (u) => u?.rol === 'admin';
export const esEncargado = (u) => u?.rol === 'bodeguero';
export const puedeGestionar = (u) => u?.rol === 'admin' || u?.rol === 'bodeguero'; // inventario, compras, traslados
export const ROL_NOMBRE = { admin: 'Administrador', bodeguero: 'Encargado de bodega', vendedor: 'Vendedor de ruta' };

// Bodegas (con sus rutas) que el usuario puede ver; sirve para todos los selectores
export function useUbicaciones() {
  const s = useCarga(() => get('/ubicaciones'), []);
  return { ...s, bodegas: s.data?.bodegas || [] };
}
// Lista plana de puntos de venta: el mostrador de cada bodega y cada ruta
export function puntosDe(bodegas, { mostrador = true } = {}) {
  const out = [];
  for (const b of bodegas) {
    if (mostrador && b.puede_mostrador && b.activa) out.push({ codigo: `B${b.id}`, nombre: `Mostrador · ${b.nombre}`, bodega: b.nombre });
    for (const r of b.rutas) if (r.activa) out.push({ codigo: `R${r.id}`, nombre: conPrefijo('Ruta', r.nombre), bodega: b.nombre });
  }
  return out;
}
export const nombreBodega = (bodegas, id) => bodegas.find((b) => b.id === Number(id))?.nombre || '';

export const conPrefijo = (prefijo, nombre) => (String(nombre ?? '').toLowerCase().startsWith(prefijo.toLowerCase()) ? String(nombre) : `${prefijo} ${nombre}`);

// ---------- Presentaciones (unidad base, caja, estiba…) ----------
export const presDe = (p, id) => (id ? p.presentaciones?.find((x) => x.id === Number(id)) : null) || null;
export const factorDe = (p, id) => presDe(p, id)?.factor ?? 1;
// precio de lista de una presentación: el suyo, o el de la unidad por la equivalencia
export const listaDe = (p, id) => { const x = presDe(p, id); return x ? (x.precio ?? Math.round(p.precio * x.factor * 100) / 100) : p.precio; };
// 1.350 unidades -> "3 estiba + 3 caja + 10 und" (solo si el producto tiene presentaciones)
export function desglose(cantidad, presentaciones = [], unidad = 'und') {
  if (!presentaciones.length) return '';
  let resto = Math.round(Number(cantidad) * 1e6) / 1e6;
  const partes = [];
  for (const p of [...presentaciones].sort((a, b) => b.factor - a.factor)) {
    const n = Math.floor(resto / p.factor + 1e-9);
    if (n > 0) { partes.push(`${n} ${p.nombre}`); resto = Math.round((resto - n * p.factor) * 1e6) / 1e6; }
  }
  if (!partes.length) return '';
  if (resto > 1e-9) partes.push(`${qty(resto)} ${unidad}`);
  return partes.join(' + ');
}

// Descarga un archivo del servidor (con la sesión): CSV o Excel (.xlsx)
export async function descargar(url, nombreArchivo) {
  const archivo = await blob(url);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(archivo);
  a.download = nombreArchivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
export const descargarCsv = (url, nombre) => descargar(url, `${nombre}-${hoyStr()}.csv`);
