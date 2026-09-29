import { useEffect, useRef, useState } from 'react';
import { ir, get, blob, compartirRemision, descargarPdf } from './lib.js';

export function Header({ titulo, atras }) {
  return (
    <header className="top">
      {atras && <button onClick={() => (atras === true ? history.back() : ir(atras))} aria-label="Volver">‹</button>}
      <h1>{titulo}</h1>
    </header>
  );
}

let mostrarToast = () => {};
export const toast = (msg, err = false) => mostrarToast({ msg, err });
export function Toaster() {
  const [t, setT] = useState(null);
  useEffect(() => { mostrarToast = (x) => { setT(x); setTimeout(() => setT(null), 3500); }; }, []);
  return t ? <div className={'toast' + (t.err ? ' err' : '')} role="status">{t.msg}</div> : null;
}

export const Cargando = ({ s }) => <div className="center mut">{s.loading ? 'Cargando…' : null}{s.error && <span className="mal">{s.error} <button className="btn sm sec" onClick={s.recargar}>Reintentar</button></span>}</div>;
export const Vacio = ({ children }) => <div className="center mut">{children}</div>;

export function Modal({ titulo, onClose, children }) {
  return (
    <div className="modal" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h3 style={{ margin: 0 }}>{titulo}</h3><button className="btn sm gris" onClick={onClose}>Cerrar</button></div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}

export function Campo({ label, ...p }) {
  return <label className="f">{label}<input {...p} /></label>;
}

// Ejecuta una acción async mostrando errores como aviso
export function useAccion() {
  const [ocupado, setOcupado] = useState(false);
  const run = async (fn, okMsg) => {
    if (ocupado) return;
    setOcupado(true);
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) { toast(e.message, true); }
    finally { setOcupado(false); }
  };
  return [ocupado, run];
}

export function Stepper({ value, onChange, max }) {
  const v = Number(value) || 0;
  const set = (x) => onChange(Math.max(0, max !== undefined ? Math.min(max, x) : x));
  return (
    <div className="stepper">
      <button type="button" onClick={() => set(v - 1)} aria-label="menos">−</button>
      <input inputMode="decimal" value={value} onChange={(e) => set(Number(e.target.value.replace(',', '.')) || 0)} />
      <button type="button" onClick={() => set(v + 1)} aria-label="más">+</button>
    </div>
  );
}

export function Confirmar(msg) { return window.confirm(msg); }

// Visor de la remisión en pantalla completa (ticket angosto, legible en el celular)
export function VisorPdf({ cfg }) {
  const [r, setR] = useState(null);
  const [pdf, setPdf] = useState(null); // bytes del PDF
  const [error, setError] = useState(null);
  const [ocupado, run] = useAccion();
  useEffect(() => {
    const abrir = (e) => setR(e.detail);
    addEventListener('ver-pdf', abrir);
    return () => removeEventListener('ver-pdf', abrir);
  }, []);
  useEffect(() => {
    if (!r) return;
    setPdf(null); setError(null);
    blob(`/remisiones/${r.id}/pdf`).then((b) => b.arrayBuffer()).then(setPdf, (e) => setError(e.message));
  }, [r]);
  if (!r) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: '#e9e2e5', display: 'flex', flexDirection: 'column' }}>
      <header className="top">
        <button onClick={() => setR(null)} aria-label="Cerrar">‹</button>
        <h1>Remisión</h1>
      </header>
      <div style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {error ? <div className="center mal">{error}</div> : !pdf ? <div className="center mut">Cargando…</div> : <Paginas pdf={pdf} />}
      </div>
      <div style={{ padding: '10px 16px calc(10px + env(safe-area-inset-bottom))', background: '#fff', borderTop: '1px solid var(--bd)', display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
        <button className="btn" disabled={ocupado} onClick={() => run(async () => compartirRemision(await get(`/remisiones/${r.id}`), cfg))}>Compartir</button>
        <button className="btn sec" disabled={ocupado} onClick={() => run(() => descargarPdf(r, cfg))}>Descargar</button>
        <button className="btn gris" style={{ gridColumn: '1 / -1' }} disabled={ocupado} onClick={() => run(() => descargarPdf(r, cfg, 'carta'))}>Descargar en hoja carta</button>
      </div>
    </div>
  );
}

// Dibuja el PDF en canvas con pdf.js: Chrome en Android no muestra PDFs dentro de un iframe.
function Paginas({ pdf }) {
  const [paginas, setPaginas] = useState(null);
  const [error, setError] = useState(null);
  const [ancho, setAncho] = useState(Math.min(window.innerWidth, 520));
  useEffect(() => {
    let vivo = true, tarea;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
        const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        tarea = pdfjs.getDocument({ data: pdf.slice(0) });
        const doc = await tarea.promise;
        const lista = [];
        for (let i = 1; i <= doc.numPages; i++) lista.push(await doc.getPage(i));
        if (vivo) setPaginas(lista);
      } catch { if (vivo) setError('No se pudo mostrar la remisión. Usa Descargar.'); }
    })();
    return () => { vivo = false; tarea?.destroy?.(); };
  }, [pdf]);
  useEffect(() => { const f = () => setAncho(Math.min(window.innerWidth, 520)); addEventListener('resize', f); return () => removeEventListener('resize', f); }, []);
  if (error) return <div className="center mal">{error}</div>;
  if (!paginas) return <div className="center mut">Cargando…</div>;
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '8px 0' }}>{paginas.map((p, i) => <Pagina key={i} p={p} ancho={ancho} />)}</div>;
}
function Pagina({ p, ancho }) {
  const ref = useCallbackRef();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const base = p.getViewport({ scale: 1 });
    const escala = (ancho - 16) / base.width;
    const dpr = window.devicePixelRatio || 1;
    const vp = p.getViewport({ scale: escala * dpr });
    c.width = vp.width; c.height = vp.height;
    c.style.width = `${vp.width / dpr}px`; c.style.height = `${vp.height / dpr}px`;
    const tarea = p.render({ canvasContext: c.getContext('2d'), viewport: vp });
    return () => tarea.cancel();
  }, [p, ancho]);
  return <canvas ref={ref} style={{ background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.25)' }} />;
}
const useCallbackRef = () => useRef(null);
