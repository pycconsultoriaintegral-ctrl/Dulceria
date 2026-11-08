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
import exportar from './routes/exportar.js';
import auditoria from './routes/auditoria.js';
import aprobaciones from './routes/aprobaciones.js';
import cuadres from './routes/cuadres.js';
import whatsapp from './routes/whatsapp.js';

export function crearApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // Las rutas que reciben fotos de comprobantes admiten un cuerpo mayor, pero solo si la petición trae sesión
  // (la sesión se valida más adelante; esto solo evita aceptar cuerpos grandes de anónimos).
  const jsonNormal = express.json({ limit: '2mb' });
  const jsonConFotos = express.json({ limit: '6mb' });
  const llevaFotos = (req) => req.method === 'POST' && !!req.headers.authorization && /^\/api\/remisiones(\/\d+\/soportes)?$/.test(req.path);
  app.use((req, res, next) => (llevaFotos(req) ? jsonConFotos : jsonNormal)(req, res, next));

  // Encabezados de seguridad. La política de contenido solo permite lo que sirve la propia app
  // (el estilo en línea es necesario para los estilos de React; los trabajadores blob: para el visor de PDF).
  const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; "
    + "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', CSP);
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store'); // los datos nunca se guardan en cachés intermedias
    next();
  });

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
  api.use(aprobaciones);
  api.use(cuadres);
  api.use(whatsapp);
  api.use('/reportes', reportes);
  api.use('/importar', importar);
  api.use('/exportar', exportar);
  api.use('/auditoria', auditoria);

  // ---------- Frontend estático ----------
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');
  if (fs.existsSync(dist)) {
    // Los archivos con huella en el nombre (assets/*) son inmutables; el resto debe revalidarse para que las actualizaciones lleguen
    app.use(express.static(dist, {
      setHeaders: (res, archivo) => res.setHeader('Cache-Control', archivo.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    }));
    app.get(/^\/(?!api).*/, (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')); });
  }

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));
  app.use((err, _req, res, _next) => {
    if (!(err instanceof HttpError)) console.error(err);
    const status = err.status || 500;
    res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : err.message });
  });
  return app;
}
