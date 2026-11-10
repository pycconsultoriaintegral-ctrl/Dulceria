#!/bin/sh
# Respaldo diario a Google Drive (ver DEPLOY.md, "Respaldo en Google Drive").
# Lo ejecuta cron en el servidor: hace una copia fresca de la base, la sube a la carpeta de Drive
# y borra de esa carpeta las copias de más de N días. El registro queda en ~/respaldo-drive.log.
set -eu
cd "$(dirname "$0")/.."
DESTINO="${DRIVE_DESTINO:-gdrive:}" # la raíz del remoto es la carpeta de respaldos (root_folder_id)
DIAS="${DRIVE_DIAS:-30}"
LOG="${HOME:-/tmp}/respaldo-drive.log"
{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S')"
  docker compose exec -T respaldo node server/backup.js
  ULTIMO=$(ls -t respaldos/dulceria-*.db | head -1)
  rclone copy "$ULTIMO" "$DESTINO"
  rclone delete "$DESTINO" --min-age "${DIAS}d" --include "dulceria-*.db"
  echo "OK: $ULTIMO subido a $DESTINO (se conservan $DIAS días)"
} >>"$LOG" 2>&1
