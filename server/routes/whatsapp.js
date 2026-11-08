// Resumen diario por WhatsApp: estado, vista previa y envío de prueba (solo el administrador)
import { Router } from 'express';
import { db, hoy } from '../db.js';
import { soloAdmin } from '../auth.js';
import { wrap } from '../util.js';
import { auditar } from '../auditoria.js';
import { ajustes, resumenDelDia, parametros, texto, enviarResumen } from '../whatsapp.js';

const router = Router();
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

router.get('/whatsapp', soloAdmin, wrap((req, res) => {
  const fecha = FECHA.test(req.query.fecha || '') ? req.query.fecha : hoy();
  const r = resumenDelDia(fecha);
  res.json({ ...ajustes(), fecha, texto: texto(r), parametros: parametros(r),
    envios: db.prepare('SELECT fecha, fecha_resumen, para, tipo, estado, detalle FROM envios_whatsapp ORDER BY id DESC LIMIT 20').all() });
}));

router.post('/whatsapp/probar', soloAdmin, wrap(async (req, res) => {
  const out = await enviarResumen(hoy(), 'prueba');
  auditar(req.user, 'probar resumen WhatsApp', 'config', null, out.map((x) => `${x.para || ''} ${x.ok ? 'enviado' : x.error}`).join(' · '));
  res.json({ resultados: out });
}));

export default router;
