import { Router } from 'express';
import { db, HttpError } from '../db.js';
import { wrap, n, req_, entero } from '../util.js';
import { getRuta, puedeRuta, exigir, sqlAlcance } from '../scope.js';
import { auditar } from '../auditoria.js';

const router = Router();
// El saldo que ve cada usuario es el de su alcance (un cliente sin ruta puede deber en varias rutas o bodegas)
export const saldoSQL = (u) => `COALESCE((SELECT SUM(r.total-r.pagado) FROM remisiones r WHERE r.cliente_id=c.id AND r.anulada=0 AND ${sqlAlcance(u, 'r')}),0)`;

// Un cliente sin ruta es de todos; con ruta, solo lo ven quienes tienen alcance sobre esa ruta
export function puedeVerCliente(u, c) {
  if (!c) throw new HttpError(404, 'Cliente no encontrado');
  if (c.ruta_id && !puedeRuta(u, c.ruta_id)) throw new HttpError(403, 'Ese cliente es de otra ruta');
}

router.get('/', (req, res) => {
  const u = req.user;
  const cond = u.alcance === 'todo' ? '1=1'
    : u.alcance === 'ruta' ? `(c.ruta_id=${Number(u.ruta_id)} OR c.ruta_id IS NULL)`
    : `(c.ruta_id IS NULL OR c.ruta_id IN (SELECT id FROM rutas WHERE bodega_id=${Number(u.bodega_id)}))`;
  res.json(db.prepare(`SELECT c.*, ru.nombre AS ruta, ${saldoSQL(u)} AS saldo FROM clientes c LEFT JOIN rutas ru ON ru.id=c.ruta_id
    WHERE c.activo=1 AND ${cond} ORDER BY c.nombre`).all());
});

router.get('/:id', wrap((req, res) => {
  const c = db.prepare(`SELECT c.*, ${saldoSQL(req.user)} AS saldo FROM clientes c WHERE c.id=?`).get(entero(req.params.id));
  puedeVerCliente(req.user, c);
  c.remisiones = db.prepare(`SELECT id,consecutivo,fecha,total,pagado,tipo_pago,anulada FROM remisiones r WHERE cliente_id=? AND ${sqlAlcance(req.user, 'r')} ORDER BY id DESC LIMIT 50`).all(c.id);
  c.pagos = db.prepare(`SELECT id,fecha,valor,metodo,remision_id,anulado FROM pagos p WHERE cliente_id=? AND remision_id IS NOT NULL AND ${sqlAlcance(req.user, 'p')} ORDER BY id DESC LIMIT 50`).all(c.id);
  res.json(c);
}));

// La ruta del cliente: el vendedor la fija a la suya; encargado y admin pueden elegir (el encargado, solo de su bodega)
function rutaDelCliente(u, valor) {
  if (u.alcance === 'ruta') return u.ruta_id;
  if (valor === undefined || valor === null || valor === '') return null;
  const r = getRuta(Number(valor));
  if (!r) throw new HttpError(400, 'La ruta no existe');
  exigir(puedeRuta(u, r.id), 'Esa ruta pertenece a otra bodega');
  return r.id;
}

// "Paga antes": solo el encargado y el administrador deciden qué clientes deben pagar antes de recibir la mercancía.
// Un vendedor no puede marcar ni desmarcar (quitaría el control), así que su valor se ignora.
const pagaAntesDe = (u, valor) => (u.alcance === 'ruta' || valor === undefined || valor === null ? null : valor ? 1 : 0);

router.post('/', wrap((req, res) => {
  const b = req.body;
  const id = Number(db.prepare('INSERT INTO clientes (nombre,negocio,telefono,direccion,documento,ruta_id,paga_antes) VALUES (?,?,?,?,?,?,?)')
    .run(req_(b.nombre, 'El nombre es obligatorio'), n(b.negocio), n(b.telefono), n(b.direccion), n(b.documento), rutaDelCliente(req.user, b.ruta_id), pagaAntesDe(req.user, b.paga_antes) ?? 0).lastInsertRowid);
  if (pagaAntesDe(req.user, b.paga_antes)) auditar(req.user, 'marcar paga antes', 'cliente', id, b.nombre);
  res.json({ id });
}));

router.put('/:id', wrap((req, res) => {
  const b = req.body;
  const id = entero(req.params.id);
  const antes = db.prepare('SELECT * FROM clientes WHERE id=?').get(id);
  puedeVerCliente(req.user, antes);
  const pagaAntes = pagaAntesDe(req.user, b.paga_antes);
  db.prepare('UPDATE clientes SET nombre=?,negocio=?,telefono=?,direccion=?,documento=?,ruta_id=?,activo=COALESCE(?,activo),paga_antes=COALESCE(?,paga_antes) WHERE id=?')
    .run(req_(b.nombre, 'El nombre es obligatorio'), n(b.negocio), n(b.telefono), n(b.direccion), n(b.documento),
      rutaDelCliente(req.user, b.ruta_id), req.user.alcance === 'todo' && b.activo !== undefined ? Number(b.activo) : null, pagaAntes, id);
  if (pagaAntes !== null && pagaAntes !== antes.paga_antes) auditar(req.user, pagaAntes ? 'marcar paga antes' : 'quitar paga antes', 'cliente', id, antes.nombre);
  res.json({ ok: true });
}));

export default router;
