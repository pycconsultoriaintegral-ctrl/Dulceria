import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './ayuda.js';
import { leerNumero, leerTabla } from '../csv.js';

test('lectura de números y tablas con formatos colombianos', () => {
  const casos = { '1200': 1200, '$ 1.200': 1200, '1.200.000': 1200000, '1.200,50': 1200.5, '1,200.50': 1200.5, '12,5': 12.5, '12.5': 12.5, '1,200': 1200, '0,5': 0.5, ' 3 ': 3, '-4,25': -4.25 };
  for (const [entrada, esperado] of Object.entries(casos)) assert.equal(leerNumero(entrada), esperado, entrada);
  assert.equal(leerNumero('abc'), null);
  assert.equal(leerNumero(''), null);
  assert.deepEqual(leerTabla('nombre;precio\n"Julypan; grande";1.200\n"Dice ""hola""";900\n'), [['nombre', 'precio'], ['Julypan; grande', '1.200'], ['Dice "hola"', '900']]);
  assert.deepEqual(leerTabla('a\tb\r\n1\t2\r\n'), [['a', 'b'], ['1', '2']]); // lo que se copia desde Excel
});

const { server, call, login } = await iniciar();
after(() => server.close());
const ctx = {};

test('importar productos: vista previa sin escribir, aplicar, y reimportar', async () => {
  const admin = ctx.admin = await login('admin', 'admin123');
  const texto = ['Producto\tCódigo\tPrecio venta\tCosto\tUnidad\tMínimo',
    'JULYPAN GRANDE\tJP1\t$ 1.500\t1.000\tund\t20',
    'ALGUSTO GRANDE\tAG1\t2.000\t1.400,50\tund\t10',
    'ESTIBA JULYPAN\tJP-E\t300.000\t200.000\testiba\t',
    '\tX9\t100\t50\t\t',                 // sin nombre
    'GENERICA\tG1\tabc\t10\t\t',          // precio inválido
    'julypan grande\tJP1\t1\t1\t\t'].join('\n'); // repetido
  const previa = (await call('POST', '/importar/productos', { texto }, admin)).body;
  assert.equal(previa.aplicado, false);
  assert.deepEqual(previa.resumen, { crear: 3, actualizar: 0, ajustar: 0, sin_cambios: 0, errores: 3 });
  assert.match(previa.filas[3].error, /nombre/);
  assert.match(previa.filas[4].error, /Precio inválido/);
  assert.match(previa.filas[5].error, /Repetido/);
  assert.equal((await call('GET', '/productos?todos=1', null, admin)).body.length, 0); // la vista previa no escribe nada

  const aplicada = (await call('POST', '/importar/productos', { texto, aplicar: true }, admin)).body;
  assert.equal(aplicada.aplicado, true);
  const prods = (await call('GET', '/productos?todos=1', null, admin)).body;
  assert.equal(prods.length, 3); // las filas con error se omiten
  const algusto = prods.find((p) => p.nombre === 'ALGUSTO GRANDE');
  assert.equal(algusto.precio, 2000);
  assert.equal(algusto.costo, 1400.5);
  assert.equal(algusto.stock_minimo, 10);
  assert.equal(prods.find((p) => p.nombre === 'ESTIBA JULYPAN').unidad, 'estiba');

  // reimportar lo mismo no cambia nada; cambiar un precio actualiza solo ese producto
  const igual = (await call('POST', '/importar/productos', { texto: texto.split('\n').slice(0, 4).join('\n') }, admin)).body;
  assert.deepEqual(igual.resumen, { crear: 0, actualizar: 0, ajustar: 0, sin_cambios: 3, errores: 0 });
  const cambio = (await call('POST', '/importar/productos', { texto: 'nombre;precio\njulypan grande;1.800', aplicar: true }, admin)).body;
  assert.equal(cambio.resumen.actualizar, 1);
  assert.match(cambio.filas[0].cambios[0], /precio: 1500 → 1800/);
  const jp = (await call('GET', '/productos?todos=1', null, admin)).body.find((p) => p.codigo === 'JP1');
  assert.equal(jp.precio, 1800);
  assert.equal(jp.costo, 1000); // lo que no venía en el archivo no se toca
  ctx.jp = jp.id; ctx.ag = algusto.id;
});

test('importar productos: errores de formato y permisos', async () => {
  const { admin } = ctx;
  assert.equal((await call('POST', '/importar/productos', { texto: '' }, admin)).status, 400);
  const sinNombre = await call('POST', '/importar/productos', { texto: 'precio;costo\n1;2' }, admin);
  assert.equal(sinNombre.status, 400);
  assert.match(sinNombre.body.error, /Falta la columna "nombre"/);
  // solo el administrador importa productos
  await call('POST', '/bodegas', { nombre: 'Occidente' }, admin);
  const bodegas = (await call('GET', '/bodegas', null, admin)).body;
  ctx.b1 = bodegas.find((b) => b.nombre !== 'Occidente').id;
  ctx.b2 = bodegas.find((b) => b.nombre === 'Occidente').id;
  await call('POST', '/usuarios', { nombre: 'Luis', usuario: 'luis', clave: 'secreto1', rol: 'bodeguero', bodega_id: ctx.b2 }, admin);
  ctx.luis = await login('luis', 'secreto1');
  assert.equal((await call('POST', '/importar/productos', { texto: 'nombre\nX' }, ctx.luis)).status, 403);
});

test('importar clientes con ruta, duplicados y alcance del encargado', async () => {
  const { admin, luis, b1, b2 } = ctx;
  const rNorte = (await call('POST', '/rutas', { nombre: 'Norte', bodega_id: b1 }, admin)).body.id;
  const rOcc = (await call('POST', '/rutas', { nombre: 'Ruta Occidente', bodega_id: b2 }, admin)).body.id;
  const texto = ['Cliente,Negocio,Celular,Dirección,Cédula,Ruta',
    'Marta Pérez,Tienda La Esquina,300 111 2233,Cra 5 # 10-20,123,Norte',
    'Pedro Gómez,Miscelánea El Sol,310 444 5566,Cl 8 # 3-15,,Ruta Norte',
    'Rosa Díaz,Tienda El Paso,315 777 8899,,,occidente',     // la ruta se reconoce sin "Ruta" y sin mayúsculas
    'Luis Soto,Tienda X,,,,Sur',                                // ruta inexistente
    'Marta P,Otro,3001112233,,,Norte'].join('\n');            // mismo celular que la primera
  const previa = (await call('POST', '/importar/clientes', { texto }, admin)).body;
  assert.deepEqual(previa.resumen, { crear: 3, actualizar: 0, ajustar: 0, sin_cambios: 0, errores: 2 });
  assert.match(previa.filas[3].error, /"Sur" no existe/);
  assert.match(previa.filas[4].error, /Repetido/);
  assert.equal((await call('POST', '/importar/clientes', { texto, aplicar: true }, admin)).status, 200);
  const todos = (await call('GET', '/clientes', null, admin)).body;
  assert.equal(todos.length, 3);
  assert.equal(todos.find((c) => c.nombre === 'Rosa Díaz').ruta_id, rOcc);
  assert.equal(todos.find((c) => c.nombre === 'Marta Pérez').ruta_id, rNorte);

  // el encargado de Occidente solo importa a rutas de su bodega
  const luisTexto = 'nombre;ruta\nCliente Nuevo;Occidente\nOtro;Norte';
  const r = (await call('POST', '/importar/clientes', { texto: luisTexto, aplicar: true }, luis)).body;
  assert.equal(r.resumen.crear, 1);
  assert.match(r.filas[1].error, /no es de tu bodega/);
  // actualizar un cliente existente por su celular
  const act = (await call('POST', '/importar/clientes', { texto: 'nombre;celular;direccion\nRosa Díaz;3157778899;Calle nueva 1', aplicar: true }, admin)).body;
  assert.equal(act.resumen.actualizar, 1);
  assert.equal((await call('GET', '/clientes', null, admin)).body.find((c) => c.nombre === 'Rosa Díaz').direccion, 'Calle nueva 1');
  // y el encargado no puede tocar clientes de otra bodega
  const ajeno = (await call('POST', '/importar/clientes', { texto: 'nombre;celular;direccion\nMarta Pérez;3001112233;Hackeo', aplicar: true }, luis)).body;
  assert.match(ajeno.filas[0].error, /otra bodega/);
});

test('importar el conteo de inventario de una bodega', async () => {
  const { admin, luis, b1, b2, jp, ag } = ctx;
  // el inventario de la bodega 1 parte vacío: el conteo lo deja igual al archivo
  const conteo = 'producto;cantidad\nJULYPAN GRANDE;25.898\nalgusto grande;2.287\nESTIBA JULYPAN;130\nNO EXISTE;5\nJULYPAN GRANDE;3';
  const previa = (await call('POST', '/importar/inventario', { texto: conteo, ub: `B${b1}` }, admin)).body;
  assert.deepEqual(previa.resumen, { crear: 0, actualizar: 0, ajustar: 3, sin_cambios: 0, errores: 2 });
  assert.match(previa.filas[3].error, /No existe el producto/);
  assert.match(previa.filas[4].error, /Repetido/);
  assert.equal((await call('GET', `/inventario?ub=B${b1}`, null, admin)).body.productos.find((p) => p.id === jp).cantidad, 0); // no escribe
  assert.equal((await call('POST', '/importar/inventario', { texto: conteo, ub: `B${b1}`, aplicar: true }, admin)).status, 200);
  const inv = (await call('GET', `/inventario?ub=B${b1}`, null, admin)).body.productos;
  assert.equal(inv.find((p) => p.id === jp).cantidad, 25898);
  assert.equal(inv.find((p) => p.id === ag).cantidad, 2287);
  // repetir el mismo conteo no mueve nada, y un conteo menor ajusta hacia abajo
  assert.equal((await call('POST', '/importar/inventario', { texto: conteo.split('\n').slice(0, 3).join('\n'), ub: `B${b1}` }, admin)).body.resumen.sin_cambios, 2);
  const baja = (await call('POST', '/importar/inventario', { texto: 'producto;cantidad\nJULYPAN GRANDE;25.000', ub: `B${b1}`, aplicar: true }, admin)).body;
  assert.equal(baja.filas[0].diferencia, -898);
  // queda en el kardex como ajuste importado
  const k = (await call('GET', `/inventario/kardex/${jp}?ub=B${b1}`, null, admin)).body;
  assert.ok(k.some((m) => m.tipo === 'ajuste' && m.referencia === 'IMP' && m.cantidad === 25898));
  // permisos: el encargado de otra bodega no puede contar la bodega 1, pero sí la suya
  assert.equal((await call('POST', '/importar/inventario', { texto: conteo, ub: `B${b1}` }, luis)).status, 403);
  assert.equal((await call('POST', '/importar/inventario', { texto: 'producto;cantidad\nJULYPAN GRANDE;10', ub: `B${b2}`, aplicar: true }, luis)).status, 200);
  assert.equal((await call('POST', '/importar/inventario', { texto: 'producto;cantidad\nJULYPAN GRANDE;10', ub: 'X1' }, admin)).status, 400);
});

test('plantilla de carga inicial: productos con mínimos y una columna de cantidad por lugar', async () => {
  const { admin, b1 } = ctx;
  const ruta = (await call('POST', '/rutas', { nombre: 'Carro 7', bodega_id: b1 }, admin)).body.id;
  // como la copia Excel: tabuladores, precios con formato de pesos y celdas vacías
  const hoja = ['Producto\tPrecio\tCosto\tMínimo bodega\tMínimo carro\tBodega\tCarro 7',
    'MANTECADAS X 14\t$ 16,000\t$ 11,200\t10\t3\t40\t6',
    'ROLLO X 10\t$ 11.500\t\t5\t2\t12\t'].join('\n');
  const prod = (await call('POST', '/importar/productos', { texto: hoja, aplicar: true }, admin)).body;
  assert.equal(prod.resumen.crear, 2);
  const lista = (await call('GET', '/productos?todos=1', null, admin)).body;
  const mant = lista.find((p) => p.nombre === 'MANTECADAS X 14');
  assert.deepEqual([mant.precio, mant.costo, mant.stock_minimo, mant.minimo_carro], [16000, 11200, 10, 3]);
  // bodega: columna automática por el nombre del lugar ("Bodega")
  const bod = (await call('POST', '/importar/inventario', { texto: hoja, ub: `B${b1}`, aplicar: true }, admin)).body;
  assert.equal(bod.columna, 'bodega');
  assert.equal(bod.resumen.ajustar, 2);
  // carro: columna elegida; la celda vacía queda "sin contar" (no se pone en cero)
  const carro = (await call('POST', '/importar/inventario', { texto: hoja, ub: `R${ruta}`, columna: 'Carro 7', aplicar: true }, admin)).body;
  assert.equal(carro.columna, 'carro 7');
  assert.deepEqual([carro.resumen.ajustar, carro.resumen.sin_contar, carro.resumen.errores], [1, 1, 0]);
  const inv = (await call('GET', `/inventario?ub=R${ruta}`, null, admin)).body.productos;
  assert.equal(inv.find((p) => p.id === mant.id).cantidad, 6);
  // una columna que no existe se explica
  assert.match((await call('POST', '/importar/inventario', { texto: hoja, ub: `R${ruta}`, columna: 'Carro 9' }, admin)).body.error, /Falta la columna/);
});
