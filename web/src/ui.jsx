import { useEffect, useState } from 'react';
import { ir } from './lib.js';

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
