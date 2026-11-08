// Alertas de inventario (cada usuario ve las de su alcance)
import { Router } from 'express';
import { wrap } from '../util.js';
import { alertasInventario } from '../alertas.js';

const router = Router();
router.get('/alertas/inventario', wrap((req, res) => res.json(alertasInventario(req.user))));
export default router;
