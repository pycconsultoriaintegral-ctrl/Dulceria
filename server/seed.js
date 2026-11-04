import { db, tx, moverStock } from './db.js';
import { hashClave } from './auth.js';
import { fileURLToPath } from 'node:url';

// Garantiza que exista un administrador para poder entrar por primera vez.
export function asegurarAdmin() {
  if (db.prepare("SELECT 1 FROM usuarios WHERE rol='admin'").get()) return;
  if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) throw new Error('Define ADMIN_PASSWORD antes de iniciar en producción');
  const clave = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare("INSERT INTO usuarios (nombre,usuario,clave_hash,rol) VALUES ('Administrador','admin',?, 'admin')").run(hashClave(clave));
  console.log(process.env.ADMIN_PASSWORD ? 'Usuario inicial creado: admin (contraseña de ADMIN_PASSWORD)' : `Usuario inicial creado -> usuario: admin  contraseña: ${clave}  (cámbiala al entrar)`);
}

// Datos de ejemplo para demostración: npm run seed
export function sembrarDemo() {
  asegurarAdmin();
  if (db.prepare('SELECT 1 FROM productos').get()) return console.log('Ya hay datos; no se siembra la demo.');
  tx(() => {
    const bodega1 = db.prepare('SELECT id FROM bodegas ORDER BY id LIMIT 1').get().id;
    const bodega2 = Number(db.prepare("INSERT INTO bodegas (nombre, direccion) VALUES ('Bodega Occidente', 'Calle 80 # 20-10')").run().lastInsertRowid);
    const ruta = Number(db.prepare('INSERT INTO rutas (nombre, bodega_id) VALUES (?,?)').run('Ruta Norte', bodega1).lastInsertRowid);
    const ruta2 = Number(db.prepare('INSERT INTO rutas (nombre, bodega_id) VALUES (?,?)').run('Ruta Occidente', bodega2).lastInsertRowid);
    db.prepare("INSERT INTO usuarios (nombre,usuario,clave_hash,rol,ruta_id) VALUES ('Freddy','freddy',?, 'vendedor', ?)").run(hashClave('freddy123'), ruta);
    db.prepare("INSERT INTO usuarios (nombre,usuario,clave_hash,rol,bodega_id) VALUES ('Luis (encargado Occidente)','luis',?, 'bodeguero', ?)").run(hashClave('luis123'), bodega2);
    const prods = [['Papas pollo 25g', 'und', 1200, 800, 24], ['Gaseosa 400ml', 'und', 2000, 1400, 12], ['Chocolatina', 'und', 1500, 1000, 30], ['Chicles caja x20', 'caja', 6000, 4200, 6], ['Galletas paquete', 'und', 900, 600, 20]];
    for (const [nombre, unidad, precio, costo, min] of prods) {
      const id = Number(db.prepare('INSERT INTO productos (nombre,unidad,precio,costo,stock_minimo) VALUES (?,?,?,?,?)').run(nombre, unidad, precio, costo, min).lastInsertRowid);
      moverStock({ productoId: id, ubicacion: `B${bodega1}`, delta: 200, tipo: 'ajuste', costo, referencia: 'INICIAL' });
      moverStock({ productoId: id, ubicacion: `B${bodega1}`, delta: -60, tipo: 'cargue', referencia: 'CG-DEMO' });
      moverStock({ productoId: id, ubicacion: `R${ruta}`, delta: 60, tipo: 'cargue', referencia: 'CG-DEMO' });
      moverStock({ productoId: id, ubicacion: `B${bodega2}`, delta: 80, tipo: 'ajuste', costo, referencia: 'INICIAL' });
    }
    db.prepare("INSERT INTO clientes (nombre,negocio,telefono,direccion,ruta_id) VALUES ('Doña Marta','Tienda La Esquina','3001112233','Cra 5 # 10-20',?)").run(ruta);
    db.prepare("INSERT INTO clientes (nombre,negocio,telefono,direccion,ruta_id) VALUES ('Pedro Gómez','Miscelánea El Sol','3104445566','Cl 8 # 3-15',?)").run(ruta);
    db.prepare("INSERT INTO clientes (nombre,negocio,telefono,direccion,ruta_id) VALUES ('Rosa Díaz','Tienda El Paso','3157778899','Cl 80 # 22-5',?)").run(ruta2);
  });
  console.log('Demo lista. Admin: admin/admin123 · Vendedor: freddy/freddy123 · Encargado de bodega: luis/luis123');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) sembrarDemo();
