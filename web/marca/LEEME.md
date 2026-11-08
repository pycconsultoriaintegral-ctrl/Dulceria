# Marca de la app (Mi Pan POS)

- `logo.svg`: logo **provisional**. Cuando llegue el oficial de Panificadora Mi Pan Colombia SAS, guárdalo aquí
  (ojalá cuadrado, PNG de 1024×1024 o SVG) y genera los íconos:

  ```bash
  node web/marca/generar-iconos.mjs web/marca/logo-oficial.png "#ffffff"   # el segundo valor es el color de fondo del ícono
  ```

- Los íconos quedan en `web/public/` (Android, iPhone y navegador). Después: `npm run build` y, en el servidor, `git pull && docker compose up -d --build`.
- El nombre de la empresa que sale en remisiones y tirillas se cambia en la app: **Más → Ajustes → Datos que salen en la remisión**.
