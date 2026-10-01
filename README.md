# Dulcería Ruta

App web móvil (PWA) para controlar **compras, inventario y ventas por ruta** de un negocio de mecato/dulces. Como no hay facturación electrónica, cada venta genera una **remisión** en PDF que se comparte por WhatsApp.

## Qué incluye

- **Ventas por ruta**: el vendedor elige cliente y productos, contado o crédito, y genera la remisión (consecutivo automático, PDF, compartir por WhatsApp). Puede anularla el mismo día.
- **Sin señal**: las ventas y abonos hechos sin conexión se guardan en el celular y se envían solos al volver internet (sin duplicarse).
- **Inventario**: bodega central + inventario por ruta, cargue de la ruta al salir, devolución al regresar, ajustes por conteo físico y kardex.
- **Compras**: proveedores, costo promedio ponderado, deuda con proveedores y pagos.
- **Cartera**: saldo por cliente, abonos aplicados a las remisiones más antiguas, recordatorio por WhatsApp.
- **Cierre diario por ruta**: vendido, cobrado, gastos, efectivo a entregar y diferencia.
- **Reportes** (admin): ventas, utilidad, márgenes, productos top, stock bajo, cartera, inventario valorizado.
- **Varias rutas y usuarios**: rol *administrador* (todo) y *vendedor* (solo su ruta; no ve costos).

## Ejecutar

Requiere Node.js >= 22.13.

```bash
npm install
npm run build        # compila la interfaz (web/dist)
npm run seed         # (opcional) datos de demostración
npm start            # http://localhost:3000
```

Primer ingreso: usuario `admin`, contraseña `admin123` (o la de `ADMIN_PASSWORD`). **Cámbiala en Más → Cambiar contraseña.** Con `npm run seed` también se crea el vendedor `freddy / freddy123`.

Variables de entorno: `PORT`, `DB_FILE` (por defecto `data/dulceria.db`), `JWT_SECRET`, `ADMIN_PASSWORD`, `TZ_NEGOCIO` (por defecto `America/Bogota`).

Para publicarla con HTTPS en un servidor propio (Docker + Caddy, con copias diarias) sigue [DEPLOY.md](DEPLOY.md).

## Flujo de trabajo típico

1. Admin: crea productos, rutas y usuarios (Más → Ajustes) y registra la **compra** al proveedor.
2. Admin: **carga la ruta** (Inventario → ruta → Cargar) antes de salir.
3. Vendedor: vende y cobra; comparte la remisión.
4. Al regresar: admin recibe la **devolución** y el vendedor hace el **cierre del día**.

## Desarrollo

```bash
npm run dev                # API en :3000
npm --prefix web run dev   # interfaz con recarga en :5173
npm test                   # prueba de flujo completo de la API
```

Nota: la remisión es un documento comercial interno, sin validez de factura electrónica DIAN.
