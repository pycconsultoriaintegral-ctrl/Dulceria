# Mi Pan POS

App de ventas por ruta, inventario y remisiones de **Panificadora Mi Pan Colombia SAS**. Marca e íconos: ver [web/marca/LEEME.md](web/marca/LEEME.md).

App web móvil (PWA) para controlar **compras, inventario y ventas por ruta** de un negocio de mecato/dulces. Como no hay facturación electrónica, cada venta genera una **remisión** en PDF que se comparte por WhatsApp.

## Qué incluye

- **Varias bodegas y rutas**: cada ruta pertenece a una bodega que la despacha. Una bodega recibe compras, vende directo en su **mostrador**, carga y recibe las devoluciones de sus rutas y hace **traslados a otras bodegas** (con estado *en camino* / *recibido* y registro de faltantes).
- **Ventas por ruta**: el vendedor elige cliente y productos, contado o crédito, y genera la remisión (consecutivo automático, ticket PDF de 80 mm, compartir por WhatsApp). Puede anularla el mismo día.
- **Pago anticipado con soporte**: el encargado o el administrador marcan a un cliente como **"paga antes"**. Sus ventas quedan **pendientes**: el PDF sale marcado *PENDIENTE DE PAGO · NO VÁLIDA*, no se descuenta inventario ni cuenta como venta o cartera. El vendedor adjunta la **foto de la transferencia** (se comprime en el celular) y el encargado de la bodega o el administrador la revisan y **aprueban o rechazan**. Al aprobar sale el inventario, el pago queda como transferencia y la remisión pasa a válida; al rechazar, queda anulada con el motivo. Nadie aprueba su propia venta (salvo el administrador) y se avisa si la misma imagen ya se usó en otra remisión. Cualquier remisión puede llevar además un soporte opcional.
- **Tirilla en impresora térmica**: la remisión se imprime en la impresora Bluetooth del carro (58 u 80 mm, ESC/POS), igual que una tirilla de punto de venta. En Android se imprime directo con la app gratuita RawBT; también por Bluetooth LE desde el navegador. Sin señal se imprime una tirilla provisional. Cada celular configura su impresora en *Más → Impresora de tirillas*, con impresión de prueba.
- **Cuadre semanal (sábado)**: por carro y por mostrador, el efectivo de la semana contra lo entregado en los cierres, las transferencias marcadas como verificadas en el banco, la cartera, los gastos y el **conteo físico del inventario** contra el sistema (valorizado al costo, con ajuste opcional). El cuadre queda guardado.
- **Resumen diario por WhatsApp** al dueño, automático a la hora que elijas, con la API oficial de WhatsApp (ver [WHATSAPP.md](WHATSAPP.md)). Mientras se aprueba, se envía con un toque desde Ajustes.
- **Sin señal**: las ventas y abonos hechos sin conexión se guardan en el celular y se envían solos al volver internet (sin duplicarse).
- **Inventario** por bodega y por ruta, resumen general, ajustes por conteo físico y kardex.
- **Compras**: proveedores, costo promedio ponderado, deuda con proveedores y pagos; cada compra llega a una bodega.
- **Presentaciones**: un producto puede tener unidad, caja, estiba, etc., cada una con su equivalencia (ej. 1 estiba = 20 cajas = 400 unidades) y su precio. Se puede comprar, trasladar, cargar, contar y vender en cualquier presentación; el inventario siempre se lleva en la unidad base y se muestra desglosado ("13 caja + 16 und").
- **Control de precios**: el vendedor puede negociar el precio, pero cada línea guarda el precio de lista y los reportes muestran lo vendido por debajo de la lista, por vendedor, junto con los descuentos.
- **Importar desde Excel**: productos, presentaciones, clientes y el conteo de inventario de una bodega o ruta, pegando las filas copiadas de Excel o subiendo un CSV. Siempre hay una **vista previa** (nuevos, actualizaciones, errores por fila) antes de guardar; entiende los números colombianos (`$ 1.200`, `1.200,50`).
- **Informes en Excel (.xlsx)** de **vendedores** (ventas, clientes atendidos, venta promedio, contado/crédito, descuentos, vendido bajo lista, utilidad, margen y diferencias en cierres), **productos** (unidades, ventas, costo, utilidad, margen, inventario, más y menos vendidos) y **clientes** (compras, última compra, cada cuántos días compra, deuda y quiénes dejaron de comprar), todos **comparados con el periodo anterior** de los mismos días, con totales, filtros y formato de pesos. Desde *Más → Reportes*.
- **Alertas de inventario**: productos en o bajo el mínimo en cada **bodega** y en cada **carro** (dos mínimos por producto) y productos **sin movimiento** hace N días (riesgo de vencimiento). Se ven en Inicio y en *Más → Alertas de inventario*, y van en el resumen diario de WhatsApp.
- **Exportar a Excel**: ventas por producto, cierres, inventario, movimientos de inventario, cartera y clientes en CSV (separador `;`, tildes y decimales con coma, listo para Excel en español). Cada usuario descarga solo lo de su alcance, y los textos que podrían abrirse como fórmula se neutralizan.
- **Registro de actividad** (administrador): quién cambió precios o costos, creó o editó usuarios, anuló remisiones, compras o traslados, recibió traslados con faltante, cerró con diferencia o importó datos, y cuándo.
- **Cartera**: saldo por cliente dentro del alcance de cada usuario, abonos aplicados a las remisiones más antiguas, recordatorio por WhatsApp.
- **Cierre diario por punto** (cada ruta y cada mostrador): vendido, cobrado, gastos, efectivo a entregar y diferencia.
- **Reportes**: ventas, utilidad, márgenes, productos top, ventas por bodega/ruta/mostrador, alertas de stock bajo **por bodega**, cartera e inventario valorizado. El administrador puede filtrar por bodega.

### Seguridad

- Las contraseñas se guardan con `scrypt` y nunca en claro; el ingreso se **bloquea 15 minutos** tras 5 intentos fallidos por usuario (y 30 por dirección IP).
- **Cambiar o restablecer una contraseña cierra las sesiones abiertas** de esa cuenta en otros celulares; desactivar al usuario también la cierra.
- Cada acción se valida **en el servidor** según el rol (administrador, encargado de bodega, vendedor); ocultar un botón en la pantalla nunca es la única barrera.
- Encabezados de seguridad (política de contenido, sin incrustación en otros sitios), datos de la API sin caché y CSV protegidos contra inyección de fórmulas.
- Las pruebas automáticas (`npm test`) corren también en GitHub en cada cambio.

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

**Clientes que pagan antes:** en Clientes → editar, marca *Paga antes de recibir*. El vendedor hace la venta y adjunta la foto de la transferencia; el encargado (o admin) la ve en Inicio → *por aprobar*, confirma en el banco que entró el dinero y aprueba. Solo entonces el vendedor entrega la mercancía.

## Desarrollo

```bash
npm run dev                # API en :3000
npm --prefix web run dev   # interfaz con recarga en :5173
npm test                   # prueba de flujo completo de la API
```

Nota: la remisión es un documento comercial interno, sin validez de factura electrónica DIAN.
