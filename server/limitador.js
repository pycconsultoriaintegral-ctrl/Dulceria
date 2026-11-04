// Límite de intentos de ingreso fallidos, en memoria (la app corre en un solo proceso).
// Se bloquea por usuario y también por dirección IP, para frenar tanto la adivinanza de una contraseña
// como el probar muchos usuarios desde un mismo lugar.
export class Limitador {
  constructor({ max, ventanaMs, bloqueoMs, ahora = () => Date.now() }) {
    Object.assign(this, { max, ventanaMs, bloqueoMs, ahora });
    this.claves = new Map(); // clave -> { fallos: [timestamps], hasta }
  }
  // Milisegundos que faltan para poder reintentar (0 = permitido)
  espera(clave) {
    const e = this.claves.get(clave);
    return e?.hasta && e.hasta > this.ahora() ? e.hasta - this.ahora() : 0;
  }
  fallo(clave) {
    const t = this.ahora();
    const e = this.claves.get(clave) ?? { fallos: [], hasta: 0 };
    e.fallos = e.fallos.filter((x) => t - x < this.ventanaMs);
    e.fallos.push(t);
    if (e.fallos.length >= this.max) { e.hasta = t + this.bloqueoMs; e.fallos = []; }
    this.claves.set(clave, e);
  }
  exito(clave) { this.claves.delete(clave); }
  limpiar() {
    const t = this.ahora();
    for (const [k, e] of this.claves) if ((!e.hasta || e.hasta < t) && e.fallos.every((x) => t - x >= this.ventanaMs)) this.claves.delete(k);
  }
  reiniciar() { this.claves.clear(); }
}

const minutos = (n) => n * 60 * 1000;
export const porUsuario = new Limitador({ max: Number(process.env.LOGIN_MAX_USUARIO || 5), ventanaMs: minutos(15), bloqueoMs: minutos(15) });
export const porIp = new Limitador({ max: Number(process.env.LOGIN_MAX_IP || 30), ventanaMs: minutos(15), bloqueoMs: minutos(15) });
setInterval(() => { porUsuario.limpiar(); porIp.limpiar(); }, minutos(10)).unref();
