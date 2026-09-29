import { db, tx, moverStock } from './db.js';
import { hashClave } from './auth.js';
import { fileURLToPath } from 'node:url';

// Garantiza que exista un administrador para poder entrar por primera vez.
export function asegurarAdmin() {
  if (db.prepare("SELECT 1 FROM usuarios WHERE rol='admin'").get()) return;
  const clave = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare("INSERT INTO usuarios (nombre,usuario,clave_hash,rol) VALUES ('Administrador','admin',?, 'admin')").run(hashClave(clave));
  console.log(`Usuario inicial creado -> usuario: admin  contraseña: ${clave}  (cámbiala al entrar)`);
}

// Datos de ejemplo para demostración: npm run seed
export function sembrarDemo() {
  asegurarAdmin();
  if (db.prepare('SELECT 1 FROM productos').get()) return console.log('Ya hay datos; no se siembra la demo.');
  tx(() => {
    const ruta = Number(db.prepare("INSERT INTO rutas (nombre) VALUES ('Ruta Norte')").run().lastInsertRowid);
    db.prepare("INSERT INTO usuarios (nombre,usuario,clave_hash,rol,ruta_id) VALUES ('Carlos Vendedor','carlos',?, 'vendedor', ?)").run(hashClave('carlos123'), ruta);
    const prods = [['Papas pollo 25g', 'und', 1200, 800, 24], ['Gaseosa 400ml', 'und', 2000, 1400, 12], ['Chocolatina', 'und', 1500, 1000, 30], ['Chicles caja x20', 'caja', 6000, 4200, 6], ['Galletas paquete', 'und', 900, 600, 20]];
    for (const [nombre, unidad, precio, costo, min] of prods) {
      const id = Number(db.prepare('INSERT INTO productos (nombre,unidad,precio,costo,stock_minimo) VALUES (?,?,?,?,?)').run(nombre, unidad, precio, costo, min).lastInsertRowid);
      moverStock({ productoId: id, ubicacion: 0, delta: 200, tipo: 'ajuste', costo, referencia: 'INICIAL' });
      moverStock({ productoId: id, ubicacion: 0, delta: -60, tipo: 'cargue', referencia: 'CG-DEMO' });
      moverStock({ productoId: id, ubicacion: ruta, delta: 60, tipo: 'cargue', referencia: 'CG-DEMO' });
    }
    db.prepare("INSERT INTO clientes (nombre,negocio,telefono,direccion,ruta_id) VALUES ('Doña Marta','Tienda La Esquina','3001112233','Cra 5 # 10-20',?)").run(ruta);
    db.prepare("INSERT INTO clientes (nombre,negocio,telefono,direccion,ruta_id) VALUES ('Pedro Gómez','Miscelánea El Sol','3104445566','Cl 8 # 3-15',?)").run(ruta);
  });
  console.log('Demo lista. Admin: admin/admin123 · Vendedor: carlos/carlos123');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) sembrarDemo();
