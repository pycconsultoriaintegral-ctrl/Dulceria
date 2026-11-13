// Soportes de pago: tomar o elegir la foto del comprobante, comprimirla y mostrarla.
import { useEffect, useRef, useState } from 'react';
import { blob, post } from './lib.js';
import { toast, useAccion } from './ui.jsx';

// Reduce la foto (los celulares dan 3-8 MB) a ~1280 px y JPEG: pesa ~150-300 KB y se lee igual. Devuelve un data URL.
export async function comprimirImagen(file, lado = 1280, calidad = 0.72) {
  if (!file?.type?.startsWith('image/')) throw new Error('Elige una foto (imagen)');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('No se pudo leer la foto. Prueba con otra.')); i.src = url; });
    const k = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // PNG con transparencia -> fondo blanco
    g.drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/jpeg', calidad);
    if (out.length > 1_900_000) throw new Error('La foto es demasiado pesada. Prueba con una captura de pantalla más pequeña.');
    return out;
  } finally { URL.revokeObjectURL(url); }
}

// Botón que abre la cámara o la galería. En el iPhone el selector ofrece "Tomar foto", "Fototeca" y "Archivos".
export function BotonFoto({ onFoto, texto = '📷 Adjuntar soporte', disabled, clase = 'btn sec' }) {
  const ref = useRef(null);
  const [ocupado, setOcupado] = useState(false);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (!f) return;
        setOcupado(true);
        try { await onFoto(await comprimirImagen(f)); } catch (err) { toast(err.message, true); } finally { setOcupado(false); }
      }} />
      <button type="button" className={clase} disabled={disabled || ocupado} onClick={() => ref.current?.click()}>{ocupado ? 'Procesando…' : texto}</button>
    </>
  );
}

// Carga una imagen protegida (necesita la sesión) y la muestra
export function Imagen({ id, alt, onClick, url: ruta }) {
  const [src, setSrc] = useState(null);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    let url; let vivo = true;
    blob(ruta || `/soportes/${id}`).then((b) => { if (vivo) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => vivo && setFallo(true));
    return () => { vivo = false; if (url) URL.revokeObjectURL(url); };
  }, [id, ruta]);
  if (fallo) return <div className="foto vacia mut">No se pudo cargar</div>;
  return src ? <img className="foto" src={src} alt={alt} onClick={onClick} /> : <div className="foto vacia mut">…</div>;
}

// Fotos elegidas en la venta antes de enviarla (aún no están en el servidor)
export function FotosPendientes({ fotos, onQuitar }) {
  if (!fotos.length) return null;
  return <div className="fotos">{fotos.map((f, i) => (
    <div key={i} className="foto-wrap"><img className="foto" src={f} alt={`Soporte ${i + 1}`} /><button type="button" aria-label="Quitar foto" onClick={() => onQuitar(i)}>×</button></div>
  ))}</div>;
}

// Soportes ya guardados de una remisión. Tocar una foto la abre grande.
export function Soportes({ remision, puedeAdjuntar, onCambio, esAprobador }) {
  const [grande, setGrande] = useState(null);
  const [ocupado, run] = useAccion();
  const lista = remision.soportes || [];
  return (
    <div className="card">
      <h3>Soporte de pago{lista.length ? ` (${lista.length})` : ''}</h3>
      {lista.length === 0 && <div className="mut" style={{ marginBottom: 8 }}>Aún no hay foto del comprobante.</div>}
      <div className="fotos">{lista.map((s) => (
        <div key={s.id} className="foto-wrap">
          <Imagen id={s.id} alt="Soporte de pago" onClick={() => setGrande(s)} />
          {esAprobador && s.repetido_en?.length > 0 && <span className="tag mal" style={{ position: 'absolute', left: 4, bottom: 4 }}>Repetida</span>}
        </div>))}</div>
      {esAprobador && lista.filter((s) => s.repetido_en?.length).map((s) => (
        <div key={s.id} className="mal" style={{ marginTop: 6, fontSize: 13 }}>⚠ Esta misma imagen ya se usó en la remisión {s.repetido_en.join(', ')}. Verifica que no sea un comprobante reutilizado.</div>))}
      {puedeAdjuntar && lista.length < 5 && (
        <div style={{ marginTop: 10 }}>
          <BotonFoto disabled={ocupado} texto={lista.length ? '📷 Agregar otra foto' : '📷 Adjuntar soporte de pago'}
            onFoto={(imagen) => run(async () => { await post(`/remisiones/${remision.id}/soportes`, { imagen }); onCambio(); }, 'Soporte adjuntado')} />
        </div>)}
      {grande && (
        <div className="visor-foto" onClick={() => setGrande(null)}>
          <div className="mut" style={{ color: '#fff' }}>{grande.fecha.slice(0, 16)} · {grande.subido_por || ''}{grande.nota ? ` · ${grande.nota}` : ''}</div>
          <Imagen id={grande.id} alt="Soporte de pago ampliado" />
          <button className="btn sm gris" onClick={() => setGrande(null)}>Cerrar</button>
        </div>)}
    </div>
  );
}

export const textoEstado = (r) => (r.pendiente ? 'Pendiente de pago' : r.rechazada ? 'Pago rechazado' : r.anulada ? 'Anulada' : '');
