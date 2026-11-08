import { crearApp } from './app.js';
import { db } from './db.js';
import { asegurarAdmin } from './seed.js';
import { iniciarProgramacion } from './whatsapp.js';

asegurarAdmin();
const port = process.env.PORT || 3000;
crearApp().listen(port, () => console.log(`Dulcería Ruta escuchando en http://localhost:${port}`));
iniciarProgramacion(); // resumen diario por WhatsApp a la hora configurada
process.on('SIGTERM', () => { db.close(); process.exit(0); });
