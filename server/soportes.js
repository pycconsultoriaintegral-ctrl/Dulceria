// Soportes de pago: fotos del comprobante de transferencia adjuntas a una remisión.
// Se guardan en la propia base de datos (así entran en la copia de seguridad diaria) y solo se sirven con sesión y alcance.
import crypto from 'node:crypto';
import { db, ahora, HttpError } from './db.js';

export const MAX_BYTES = 1_500_000; // la app comprime la foto antes de enviarla (~200 KB); esto es solo el tope de seguridad
export const MAX_POR_REMISION = 5;

const FIRMAS = [
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];

// Recibe "data:image/jpeg;base64,...." y devuelve { mime, datos }. El tipo se decide por el contenido real, no por lo que diga el cliente.
export function leerImagen(dataUrl) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw new HttpError(400, 'La imagen del soporte no es válida (usa una foto JPG, PNG o WEBP)');
  const datos = Buffer.from(m[1], 'base64');
  if (datos.length < 12) throw new HttpError(400, 'La imagen del soporte está vacía');
  if (datos.length > MAX_BYTES) throw new HttpError(413, 'La imagen del soporte es demasiado pesada');
  const f = FIRMAS.find(([, ok]) => ok(datos));
  if (!f) throw new HttpError(400, 'El archivo del soporte no es una imagen válida');
  return { mime: f[0], datos };
}

export function guardarSoporte(remisionId, dataUrl, user, nota = null) {
  const { mime, datos } = leerImagen(dataUrl);
  const n = db.prepare('SELECT COUNT(*) AS n FROM soportes WHERE remision_id=?').get(remisionId).n;
  if (n >= MAX_POR_REMISION) throw new HttpError(409, `Una remisión admite máximo ${MAX_POR_REMISION} soportes`);
  const huella = crypto.createHash('sha256').update(datos).digest('hex');
  return Number(db.prepare('INSERT INTO soportes (remision_id,fecha,usuario_id,mime,bytes,huella,datos,nota) VALUES (?,?,?,?,?,?,?,?)')
    .run(remisionId, ahora(), user.id, mime, datos.length, huella, datos, nota ? String(nota).slice(0, 200) : null).lastInsertRowid);
}

// Lista (sin los bytes) de los soportes de una remisión. "repetido_en" avisa si la misma imagen ya se usó en otra remisión.
export function listarSoportes(remisionId) {
  const filas = db.prepare(`SELECT s.id, s.fecha, s.mime, s.bytes, s.nota, s.huella, u.nombre AS subido_por FROM soportes s
    LEFT JOIN usuarios u ON u.id=s.usuario_id WHERE s.remision_id=? ORDER BY s.id`).all(remisionId);
  const otras = db.prepare('SELECT r.consecutivo FROM soportes s JOIN remisiones r ON r.id=s.remision_id WHERE s.huella=? AND s.remision_id<>? ORDER BY r.consecutivo');
  return filas.map(({ huella, ...f }) => ({ ...f, repetido_en: otras.all(huella, remisionId).map((x) => x.consecutivo) }));
}
