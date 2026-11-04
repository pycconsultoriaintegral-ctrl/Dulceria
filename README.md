# Dulcería Ruta

App web móvil (PWA) para controlar **compras, inventario y ventas por ruta** de un negocio de mecato/dulces. Como no hay facturación electrónica, cada venta genera una **remisión** en PDF que se comparte por WhatsApp.

## Qué incluye

- **Varias bodegas y rutas**: cada ruta pertenece a una bodega que la despacha. Una bodega recibe compras, vende directo en su **mostrador**, carga y recibe las devoluciones de sus rutas y hace **traslados a otras bodegas** (con estado *en camino* / *recibido* y registro de faltantes).
- **Ventas por ruta**: el vendedor elige cliente y productos, contado o crédito, y genera la remisión (consecutivo automático, ticket PDF de 80 mm, compartir por WhatsApp). Puede anularla el mismo día.
- **Sin señal**: las ventas y abonos hechos sin conexión se guardan en el celular y se envían solos al volver internet (sin duplicarse).
- **Inventario** por bodega y por ruta, resumen general, ajustes por conteo físico y kardex.
- **Compras**: proveedores, costo promedio ponderado, deuda con proveedores y pagos; cada compra llega a una bodega.
- **Importar desde Excel**: productos, clientes y el conteo de inventario de una bodega o ruta, pegando las filas copiadas de Excel o subiendo un CSV. Siempre hay una **vista previa** (nuevos, actualizaciones, errores por fila) antes de guardar; entiende los números colombianos (`$ 1.200`, `1.200,50`).
- **Cartera**: saldo por cliente dentro del alcance de cada usuario, abonos aplicados a las remisiones más antiguas, recordatorio por WhatsApp.
- **Cierre diario por punto** (cada ruta y cada mostrador): vendido, cobrado, gastos, efectivo a entregar y diferencia.
- **Reportes**: ventas, utilidad, márgenes, productos top, ventas por bodega/ruta/mostrador, alertas de stock bajo **por bodega**, cartera e inventario valorizado. El administrador puede filtrar por bodega.

### Roles

| Rol | Qué ve y hace |
| --- | --- |
| **Administrador** | Todo: bodegas, rutas, usuarios, productos, compras de cualquier bodega, traslados, reportes y ajustes. |
| **Encargado de bodega** | Solo su bodega y las rutas que despacha: inventario, compras, cargue/devolución, ajustes de conteo, ventas de mostrador, enviar/recibir traslados, cartera, cierres y reportes de su bodega. No ve costos de otras bodegas. |
| **Vendedor de ruta** | Solo su ruta: vender, cobrar, clientes, cartera y cierre de su ruta. No ve costos. |

Los **traslados entre bodegas** funcionan en dos pasos: al enviar, la mercancía sale de la bodega de origen y queda *en camino*; la bodega de destino cuenta lo que llegó y confirma. Si llega menos, el faltante queda registrado.

> Si ya tenías una base de datos de una versión anterior (una sola bodega), se **migra sola** al abrirla: todo el inventario y las rutas quedan en la "Bodega principal" y no se pierde ningún dato.

## Ejecutar

Requiere Node.js >= 22.13.

```bash
npm install
npm run build        # compila la interfaz (web/dist)
npm run seed         # (opcional) datos de demostración
npm start            # http://localhost:3000
```

Primer ingreso: usuario `admin`, contraseña `admin123` (o la de `ADMIN_PASSWORD`). **Cámbiala en Más → Cambiar contraseña.** Con `npm run seed` también se crean datos de ejemplo: el vendedor `freddy / freddy123` y el encargado de bodega `luis / luis123`.

Variables de entorno: `PORT`, `DB_FILE` (por defecto `data/dulceria.db`), `JWT_SECRET`, `ADMIN_PASSWORD`, `TZ_NEGOCIO` (por defecto `America/Bogota`).

Para publicarla con HTTPS en un servidor propio (Docker + Caddy, con copias diarias) sigue [DEPLOY.md](DEPLOY.md).

## Flujo de trabajo típico

1. Admin: en Más → Ajustes crea las **bodegas**, las **rutas** (cada una con su bodega) y los **usuarios** (vendedores, encargados de bodega); en Productos registra el catálogo.
2. Encargado (o admin): registra la **compra** al proveedor en su bodega y, si hace falta, **traslada** mercancía de una bodega a otra (la otra bodega la recibe y confirma).
3. Encargado: **carga la ruta** (Inventario → ruta → Cargar ruta) antes de salir.
4. Vendedor: vende y cobra; comparte la remisión.
5. Al regresar: el encargado recibe la **devolución** y el vendedor hace el **cierre del día**.

## Desarrollo

```bash
npm run dev                # API en :3000
npm --prefix web run dev   # interfaz con recarga en :5173
npm test                   # prueba de flujo completo de la API
```

Nota: la remisión es un documento comercial interno, sin validez de factura electrónica DIAN.
