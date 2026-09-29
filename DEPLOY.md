# Despliegue con HTTPS (VPS + Docker + Caddy)

Resultado: la app en `https://tu-dominio`, con certificado automático, reinicio automático y copia diaria de la base de datos.

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
- El servicio `respaldo` guarda cada 24 h una copia en `./respaldos/` y conserva las últimas 14.
- Descárgalas fuera del servidor con regularidad, por ejemplo desde tu computador:
  `scp -r usuario@IP:~/Dulceria/respaldos .`
- **Restaurar**: `docker compose stop app`, copia el respaldo sobre el volumen (`docker compose cp respaldos/dulceria-XXXX.db app:/data/dulceria.db`) y `docker compose start app`.

## 6. Actualizar
```bash
git pull && docker compose up -d --build
```
Los datos viven en el volumen `datos` y no se pierden al actualizar.

## Comandos útiles
- Ver registros: `docker compose logs -f app`
- Estado: `docker compose ps`
- Cambiar contraseña de un usuario: desde la app (Más → Ajustes → Usuarios).
