# Despliegue con HTTPS (VPS + Docker + Caddy)

Resultado: la app en `https://tu-dominio`, con certificado automático, reinicio automático y copia diaria de la base de datos.

## 0. Qué contratar (costos aproximados, verifica el precio vigente)
| Qué | Recomendación | Costo aprox. |
| --- | --- | --- |
| Servidor (VPS) | 1 vCPU, 1-2 GB RAM, Ubuntu 24.04, **en Miami o Nueva York** (más cerca de Colombia = la app responde más rápido). Ej.: DigitalOcean, Vultr, Linode/Akamai | USD 6-12 al mes |
| Dominio | Un `.com` o `.com.co` (ej. `ventas.tunegocio.com`). Opcional: sin dominio funciona con sslip.io | USD 12-40 al año |
| Copias fuera del servidor | Activa los "backups" automáticos del proveedor del VPS (además de la copia diaria de la app) | +20 % del VPS |
| WhatsApp | Ver WHATSAPP.md | Centavos de dólar al mes |

Para 1 bodega, 4 carros y hasta ~3 bodegas, el VPS más pequeño sobra: la base de datos de un año de ventas pesa decenas de MB.

## 1. Servidor
- Un VPS con Ubuntu 22.04/24.04 (1 GB de RAM alcanza), con IP pública.
- Abre los puertos **80 y 443** (y 22 para SSH) en el firewall del proveedor.
- Instala Docker: `curl -fsSL https://get.docker.com | sh`

## 2. Dominio
- **Con dominio propio**: crea un registro DNS tipo `A` (ej. `ruta.tunegocio.com`) apuntando a la IP del VPS.
- **Sin dominio**: usa `<IP con guiones>.sslip.io`. Para la IP `203.0.113.10` sería `203-0-113-10.sslip.io`. Es gratis y Let's Encrypt emite certificado válido.

## 3. Instalar
```bash
git clone https://github.com/pycconsultoriaintegral-ctrl/Dulceria.git && cd Dulceria
cp .env.example .env
nano .env   # APP_DOMAIN, JWT_SECRET (openssl rand -hex 32) y ADMIN_PASSWORD
docker compose up -d --build
```
La primera vez tarda ~1 minuto en emitir el certificado. Entra a `https://APP_DOMAIN` con usuario `admin` y la contraseña de `ADMIN_PASSWORD`.

## 4. Instalar en el celular
Abre la dirección en Chrome (Android) o Safari (iPhone) → menú → **Agregar a pantalla de inicio**. Quedará como una app.

## 5. Copias de seguridad
- El servicio `respaldo` guarda cada 24 h una copia en `./respaldos/` y conserva las últimas 14. Las fotos de los soportes de pago viven dentro de la base de datos, así que **entran en la copia** (cada foto pesa unos 150-300 KB).
- Descárgalas fuera del servidor con regularidad, por ejemplo desde tu computador:
  `scp -r usuario@IP:~/Dulceria/respaldos .`
- **Restaurar**: `docker compose stop app`, copia el respaldo sobre el volumen (`docker compose cp respaldos/dulceria-XXXX.db app:/data/dulceria.db`) y `docker compose start app`.

### Respaldo en Google Drive (todos los días, fuera del servidor)
Sube cada noche una copia a una carpeta de tu Google Drive y conserva los últimos 30 días. Usa **rclone**, configurado para
trabajar **solo dentro de esa carpeta** (`root_folder_id`): todo lo que sube y borra ocurre ahí.

> El permiso que entrega Google (`drive`) cubre todo el Drive de la cuenta, aunque rclone solo use la carpeta. Protege el
> acceso al servidor (la llave SSH) y, si algún día quieres revocarlo, hazlo en <https://myaccount.google.com/permissions>.

1. **Crea la carpeta** en Google Drive (ej. "Mi Pan Pos Respaldos") y copia su **ID**: es la parte final de la dirección
   `https://drive.google.com/drive/folders/ESTE_ES_EL_ID`.
2. **En el servidor**, instala rclone y pon la hora de Colombia:
   ```bash
   curl https://rclone.org/install.sh | sudo bash
   sudo timedatectl set-timezone America/Bogota
   ```
3. **Autoriza tu Google Drive** (una sola vez). En el servidor ejecuta `rclone config` y responde:
   - `n` (nuevo remoto) → nombre: `gdrive`
   - tipo de almacenamiento: escribe `drive`
   - `client_id` y `client_secret`: Enter (vacíos)
   - `scope`: elige **`drive`** (el primero, acceso completo; ver la nota de arriba)
   - `service_account_file`: Enter · `Edit advanced config?`: `n`
   - `Use web browser to automatically authenticate?`: **`n`** (el servidor no tiene navegador)
   - rclone muestra una línea `rclone authorize "drive" "…"`. Cópiala.
4. **En tu computador** (Windows): descarga rclone de <https://rclone.org/downloads/> (Windows, Intel/AMD 64 bits), descomprime el zip y,
   en Git Bash dentro de esa carpeta, pega la línea copiada empezando con `./rclone.exe authorize "drive" "…"`. Se abre el navegador:
   entra con tu cuenta de Google y acepta. Git Bash muestra un texto largo (el token): cópialo completo.
5. **De vuelta en el servidor**, pega el token donde dice `config_token>`, responde `n` a *shared drive* y `y` para guardar; luego `q`.
   Amarra rclone a la carpeta (cambia el ID por el tuyo) y comprueba:
   ```bash
   rclone config update gdrive root_folder_id ESTE_ES_EL_ID
   rclone lsd gdrive:
   ```
   `rclone lsd gdrive:` no debe dar error (la carpeta está vacía, así que no lista nada).
6. **Prueba el respaldo y prográmalo** a las 11:30 p. m.:
   ```bash
   ~/Dulceria/scripts/respaldo-drive.sh && tail -5 ~/respaldo-drive.log
   (crontab -l 2>/dev/null; echo "30 23 * * * $HOME/Dulceria/scripts/respaldo-drive.sh") | crontab -
   ```
   En la carpeta de Drive aparece el archivo `dulceria-AAAA-MM-DD-HH-MM.db`.

Si algún día falla, el motivo queda en `~/respaldo-drive.log`. Para cambiar los días que se conservan: `DRIVE_DIAS=60` antes del comando en `crontab -e`.

## 6. Actualizar
```bash
git pull && docker compose up -d --build
```
Los datos viven en el volumen `datos` y no se pierden al actualizar.

## Al actualizar desde una versión anterior
- La base de datos se **migra sola** al arrancar (no se pierde nada); haz una copia antes si quieres tranquilidad: `cp -r respaldos respaldos-antes`.
- Quienes tengan la sesión abierta en el celular tendrán que **ingresar de nuevo** una vez (las sesiones ahora se invalidan al cambiar la contraseña).
- Si alguien se bloquea por intentos fallidos, espera 15 minutos o reinicia el servicio: `docker compose restart app`.

## Comandos útiles
- Ver registros: `docker compose logs -f app`
- Estado: `docker compose ps`
- Cambiar contraseña de un usuario: desde la app (Más → Ajustes → Usuarios).
