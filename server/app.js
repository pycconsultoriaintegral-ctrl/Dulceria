import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HttpError } from './db.js';
import { requireAuth } from './auth.js';
import { publico, privado } from './routes/auth.js';
import catalogo from './routes/catalogo.js';
import compras from './routes/compras.js';
import inventario from './routes/inventario.js';
import traslados from './routes/traslados.js';
import clientes from './routes/clientes.js';
import ventas from './routes/ventas.js';
import reportes from './routes/reportes.js';
import importar from './routes/importar.js';

export function crearApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();
  app.use('/api', api);
  api.use(publico);
  api.use(requireAuth);
  api.use(privado);
  api.use(catalogo);
  api.use('/compras', compras);
  api.use(inventario);
  api.use('/traslados', traslados);
  api.use('/clientes', clientes);
  api.use(ventas);
  api.use('/reportes', reportes);
  api.use('/importar', importar);

  // ---------- Frontend estático ----------
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));
  app.use((err, _req, res, _next) => {
    if (!(err instanceof HttpError)) console.error(err);
    const status = err.status || 500;
    res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : err.message });
  });
  return app;
}
