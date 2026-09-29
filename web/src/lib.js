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
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
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
const CACHEABLES = ['/productos', '/clientes', '/config', '/rutas'];
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
    ls.set(K.cola, [...cola(), { tipo, payload, uuid: payload.uuid, etiqueta }]);
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
export async function abrirPdf(r) {
  const pdf = await blob(`/remisiones/${r.id}/pdf`);
  window.open(URL.createObjectURL(pdf), '_blank');
}
