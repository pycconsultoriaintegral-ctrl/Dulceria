# Resumen diario por WhatsApp (API oficial de Meta)

Todos los días, a la hora que elijas, el dueño recibe en su WhatsApp un resumen como este:

```
Resumen del día 8 nov 2026
Vendido: $1.250.000 (38 remisiones)
Efectivo cobrado: $820.000
Transferencias: $310.000
Gastos: $45.000
Cierres de caja: 4 de 5 (faltan Ruta Carro 3)
Por cobrar (cartera): $2.140.000
Pagos por aprobar: 1
```

Mientras se termina este trámite, el administrador puede enviar el mismo resumen con un toque en
**Más → Ajustes → Resumen diario por WhatsApp → Enviar ahora por WhatsApp**: no requiere nada de lo que sigue.

## Qué se necesita

| Qué | Para qué |
| --- | --- |
| Una **cuenta de Meta Business** (business.facebook.com) a nombre del negocio | Dueña del número que envía |
| Un **número de celular exclusivo** (una SIM prepago sirve) que **no** tenga WhatsApp instalado | Es el remitente del resumen. No puede ser el número personal del dueño |
| Un **medio de pago** (tarjeta) en el administrador de WhatsApp | Meta cobra cada mensaje de plantilla. Un resumen diario a 1 o 2 números cuesta centavos de dólar al mes (revisa la tarifa vigente de Colombia en la página de precios de Meta) |

## Paso a paso (una sola vez, ~30 minutos más la espera de aprobación)

1. **Crea la app**: entra a <https://developers.facebook.com/apps>, *Crear app* → tipo **Empresa** (Business) → elige la cuenta de Meta Business del negocio.
2. En la app, agrega el producto **WhatsApp** y sigue *Configuración de la API*.
3. **Agrega el número**: en *Configuración de la API → Agregar número de teléfono*, escribe el número exclusivo, el nombre que verá el dueño (ej. "Mi Pan POS") y verifícalo con el código por SMS o llamada.
4. Copia el **Identificador del número de teléfono** (Phone number ID). Ese es `WHATSAPP_PHONE_ID`.
5. **Token permanente** (el temporal dura 24 h y no sirve):
   - En business.facebook.com → *Configuración del negocio* → *Usuarios del sistema* → *Agregar*, rol **Administrador**.
   - *Asignar activos*: la app (control total) y la cuenta de WhatsApp (control total).
   - *Generar token* → elige la app → caducidad **Nunca** → permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
   - Copia el token. Ese es `WHATSAPP_TOKEN`. **Trátalo como una contraseña**: no lo envíes por chat ni lo subas a GitHub.
6. **Medio de pago**: en el *Administrador de WhatsApp* → *Configuración de la cuenta* → *Pagos*, agrega la tarjeta.
7. **Crea la plantilla**: *Administrador de WhatsApp* → *Plantillas de mensajes* → *Crear plantilla*:
   - Categoría: **Utilidad** · Nombre: **`resumen_diario`** · Idioma: **Español** (`es`)
   - Cuerpo (cópialo tal cual, con los saltos de línea):

     ```
     Resumen del día {{1}}
     Vendido: {{2}} ({{3}} remisiones)
     Efectivo cobrado: {{4}}
     Transferencias: {{5}}
     Gastos: {{6}}
     Cierres de caja: {{7}}
     Por cobrar (cartera): {{8}}
     Pagos por aprobar: {{9}}

     Mensaje automático de tu sistema de ventas.
     ```
   - Meta pide ejemplos para cada variable: `8 nov 2026`, `$1.250.000`, `38`, `$820.000`, `$310.000`, `$45.000`, `4 de 5`, `$2.140.000`, `1`.
   - Envíala a revisión. Suele aprobarse en minutos u horas. Si la rechazan, ajusta el texto fijo (no el orden de las variables) y, si cambias el nombre, ponlo en Ajustes.

## Conectar el servidor

En el servidor, edita el archivo `.env` (junto a `docker-compose.yml`) y agrega:

```
WHATSAPP_TOKEN=el-token-permanente
WHATSAPP_PHONE_ID=123456789012345
```

Aplica el cambio:

```bash
docker compose up -d
```

Luego, en la app, como administrador: **Más → Ajustes → Resumen diario por WhatsApp**:

1. Debe decir **✅ Conectado a la API oficial de WhatsApp**.
2. Escribe el WhatsApp del dueño (10 dígitos, ej. `3001234567`; varios separados por coma) y la hora (ej. `20:00`).
3. Marca **Enviar el resumen automáticamente todos los días** y guarda.
4. Toca **Probar envío automático**. Debe llegar el mensaje; abajo queda la lista de envíos con su estado.

## Si algo falla

El error exacto queda en *Últimos envíos*. Los más comunes:

| Mensaje | Qué hacer |
| --- | --- |
| *Template name does not exist* / plantilla no aprobada | La plantilla aún no está aprobada, o el nombre o idioma en Ajustes no coincide con el de Meta |
| *Number of parameters does not match* | El cuerpo de la plantilla no tiene exactamente las 9 variables `{{1}}`…`{{9}}` |
| *Invalid OAuth access token* | El token se copió mal o es el temporal de 24 h. Genera el permanente (paso 5) |
| *Payment method required* / cuenta sin pago | Falta la tarjeta (paso 6) |
| *Recipient phone number not in allowed list* | Estás usando el número de prueba de Meta: agrega tu propio número (paso 3) |

Si el servidor estaba apagado a la hora del envío, el resumen sale al encenderse (el mismo día). Si un envío falla, se reintenta cada 15 minutos, hasta 3 veces.
