import { db, ahora } from './db.js';

// Deja constancia de una acción sensible. Nunca debe romper la operación principal.
export function auditar(user, accion, entidad, entidadId, detalle) {
  try {
    db.prepare('INSERT INTO auditoria (fecha, usuario_id, usuario, accion, entidad, entidad_id, detalle) VALUES (?,?,?,?,?,?,?)')
      .run(ahora(), user?.id ?? null, user?.nombre ?? null, accion, entidad, entidadId ?? null, detalle == null ? null : String(detalle).slice(0, 1000));
  } catch (e) { console.error('No se pudo registrar la actividad:', e.message); }
}

// "precio: 1500 → 1800 · costo: 1000 → 900" para los campos que cambiaron
export function diferencias(antes, despues, campos) {
  return campos.filter((c) => despues[c] !== undefined && despues[c] !== null && String(antes[c] ?? '') !== String(despues[c]))
    .map((c) => `${c}: ${antes[c] ?? '—'} → ${despues[c]}`).join(' · ');
}
