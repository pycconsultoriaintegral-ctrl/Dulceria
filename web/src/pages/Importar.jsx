import { useRef, useState } from 'react';
import { post, qty, useUbicaciones, can, conPrefijo } from '../lib.js';
import { Header, Cargando, useAccion, toast } from '../ui.jsx';

const TIPOS = {
  productos: {
    titulo: 'Productos', solo: 'admin',
    ayuda: 'Columnas: nombre (obligatoria), código, unidad, precio, costo, mínimo bodega y mínimo carro. Si el producto ya existe (por código o nombre) se actualiza solo lo que traiga el archivo: así editas todo de una vez (en Productos → «Excel para editar» descargas el catálogo actual). Los conceptos contables (cuentas por cobrar, gastos bancarios…) se omiten. Las demás columnas (por ejemplo, las cantidades) se ignoran.',
    plantilla: 'nombre;codigo;unidad;precio;costo;minimo\nJULYPAN GRANDE;JP1;und;1500;1000;20\nESTIBA JULYPAN;JP-E;estiba;300000;200000;2\n',
  },
  presentaciones: {
    titulo: 'Presentaciones', solo: 'admin',
    ayuda: 'Define cajas, estibas, etc. de productos que ya existen. Columnas: producto (o código), presentación, equivalencia (cuántas unidades trae) y precio (opcional). Una fila por presentación.',
    plantilla: 'producto;presentacion;equivalencia;precio\nJULYPAN GRANDE;caja;20;\nJULYPAN GRANDE;estiba;400;560000\n',
  },
  clientes: {
    titulo: 'Clientes',
    ayuda: 'Columnas: nombre (obligatoria), negocio, teléfono, dirección, cédula/NIT, ruta. La ruta debe existir (escríbela como "Norte" o "Ruta Norte"). Si el cliente ya existe (por cédula, teléfono o nombre y negocio) se actualiza.',
    plantilla: 'nombre;negocio;telefono;direccion;cedula;ruta\nMarta Pérez;Tienda La Esquina;3001112233;Cra 5 # 10-20;123456;Norte\n',
  },
  inventario: {
    titulo: 'Conteo de inventario',
    ayuda: 'Columnas: producto (o código) y la cantidad. Si tu hoja tiene una columna por lugar (Bodega, Carro 1, Carro 2…), pégala completa y elige abajo qué columna corresponde al lugar que estás cargando; repite con cada lugar. Las celdas vacías se toman como no contadas. El inventario del lugar queda igual al conteo y las diferencias quedan en el kardex como ajuste. Los productos deben existir.',
    plantilla: 'producto;cantidad;presentacion\nJULYPAN GRANDE;25898;und\nJULYPAN GRANDE;130;estiba\n',
  },
};

// Lee el archivo como UTF-8 y, si no lo es (Excel en español suele guardar en Windows-1252), como Windows-1252
async function leerArchivo(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}

const ETIQUETA = { crear: ['Nuevo', 'ok'], actualizar: ['Actualiza', ''], ajustar: ['Ajusta', ''], sin_cambios: ['Sin cambios', ''], sin_contar: ['No contado', ''], omitir: ['Se omite', ''] };
// títulos de la primera fila pegada (Excel separa con tabulador; un CSV, con ; o ,)
const titulosDe = (texto) => { const l = String(texto).split(/\r?\n/)[0] || ''; const sep = l.includes('\t') ? '\t' : l.includes(';') ? ';' : ','; return l.split(sep).map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean); };

export function Importar({ user }) {
  const { bodegas } = useUbicaciones();
  const tipos = Object.entries(TIPOS).filter(([, t]) => t.solo !== 'admin' || can(user, 'productos'));
  const [tipo, setTipo] = useState(tipos[0][0]);
  const [texto, setTexto] = useState('');
  const [ub, setUb] = useState(user.alcance === 'bodega' ? `B${user.bodega_id}` : '');
  const [res, setRes] = useState(null);
  const [columna, setColumna] = useState(''); // columna de la cantidad (vacío = automática)
  const [ocupado, run] = useAccion();
  const archivo = useRef(null);
  const t = TIPOS[tipo];

  const enviar = (aplicar) => run(async () => {
    if (tipo === 'inventario' && !ub) throw new Error('Elige la bodega o ruta que contaste');
    const r = await post(`/importar/${tipo}`, { texto, aplicar, ub: tipo === 'inventario' ? ub : undefined, columna: tipo === 'inventario' && columna ? columna : undefined });
    setRes(r);
    if (aplicar) { toast(`Importación lista: ${r.resumen.crear + r.resumen.actualizar + r.resumen.ajustar} fila(s) aplicadas`); setTexto(''); }
  });
  const descargarPlantilla = () => {
    const blob = new Blob(['﻿' + t.plantilla], { type: 'text/csv;charset=utf-8' }); // con BOM para que Excel respete las tildes
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `plantilla-${tipo}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const validas = res ? res.resumen.crear + res.resumen.actualizar + res.resumen.ajustar : 0;

  return (
    <>
      <Header titulo="Importar desde Excel" atras="/mas" />
      <main>
        <div className="row wrap" style={{ marginBottom: 10 }}>
          {tipos.map(([k, v]) => <button key={k} className={'btn sm ' + (tipo === k ? '' : 'gris')} onClick={() => { setTipo(k); setRes(null); setTexto(''); setColumna(''); }}>{v.titulo}</button>)}
        </div>
        <div className="card">
          <p className="mut" style={{ marginTop: 0 }}>{t.ayuda}</p>
          <button className="btn sm sec" onClick={descargarPlantilla}>⬇ Descargar plantilla</button>
        </div>
        {tipo === 'inventario' && (
          <label className="f">Inventario que contaste
            <select value={ub} onChange={(e) => { setUb(e.target.value); setRes(null); }}>
              <option value="">— elegir —</option>
              {bodegas.filter((b) => b.activa).map((b) => (
                <optgroup key={b.id} label={b.nombre}>
                  <option value={`B${b.id}`}>{conPrefijo('Bodega', b.nombre)}</option>
                  {b.rutas.filter((r) => r.activa).map((r) => <option key={r.id} value={`R${r.id}`}>{conPrefijo('Ruta', r.nombre)}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        <div className="card">
          <h3>1. Pega las filas desde Excel</h3>
          <textarea className="q" rows={7} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }} placeholder={'Copia en Excel las celdas (con la fila de títulos) y pégalas aquí'}
            value={texto} onChange={(e) => { setTexto(e.target.value); setRes(null); }} />
          <div className="row">
            <button className="btn sm gris" onClick={() => archivo.current.click()}>📄 O sube un archivo CSV</button>
            <input ref={archivo} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" style={{ display: 'none' }}
              onChange={async (e) => { const f = e.target.files[0]; if (f) { setTexto(await leerArchivo(f)); setRes(null); } e.target.value = ''; }} />
            <span className="mut grow right">{texto ? `${texto.split(/\r?\n/).filter((l) => l.trim()).length - 1} fila(s)` : ''}</span>
          </div>
          {tipo === 'inventario' && titulosDe(texto).length > 2 && (
            <label className="f" style={{ marginTop: 10 }}>Columna con la cantidad de este lugar
              <select value={columna} onChange={(e) => { setColumna(e.target.value); setRes(null); }}>
                <option value="">Automática (cantidad o el nombre del lugar)</option>
                {titulosDe(texto).map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>)}
          <button className="btn block" style={{ marginTop: 10 }} disabled={ocupado || !texto.trim()} onClick={() => enviar(false)}>2. Ver vista previa</button>
        </div>
        {res && (
          <div className="card">
            <h3>{res.aplicado ? 'Resultado' : 'Vista previa (aún no se ha guardado nada)'}</h3>
            <div className="row wrap" style={{ marginBottom: 8 }}>
              {res.resumen.crear > 0 && <span className="tag ok">{res.resumen.crear} nuevos</span>}
              {res.resumen.actualizar > 0 && <span className="tag">{res.resumen.actualizar} se actualizan</span>}
              {res.resumen.ajustar > 0 && <span className="tag">{res.resumen.ajustar} se ajustan</span>}
              {res.resumen.sin_cambios > 0 && <span className="tag">{res.resumen.sin_cambios} sin cambios</span>}
              {res.resumen.omitir > 0 && <span className="tag">{res.resumen.omitir} no son productos (se omiten)</span>}
              {res.resumen.sin_contar > 0 && <span className="tag">{res.resumen.sin_contar} sin contar</span>}
              {res.columna && <span className="mut">Cantidades de la columna «{res.columna}»</span>}
              {res.resumen.errores > 0 && <span className="tag mal">{res.resumen.errores} con error</span>}
            </div>
            <div className="list" style={{ maxHeight: 360, overflow: 'auto' }}>
              {res.filas.slice(0, 300).map((f) => (
                <div key={f.linea} className="item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div className="bold">{f.nombre || f.producto || '(sin nombre)'}{f.presentacion ? ` · ${f.presentacion}` : ''}{f.negocio ? ` · ${f.negocio}` : ''}</div>
                    {f.error ? <div className="mal">Línea {f.linea}: {f.error}</div>
                      : f.diferencia !== undefined ? <div className="mut">Sistema {qty(f.actual)} → conteo {qty(f.conteo)} ({f.diferencia > 0 ? '+' : ''}{qty(f.diferencia)})</div>
                      : f.nota ? <div className="mut">{f.nota}</div>
                      : f.cambios?.length ? <div className="mut">{f.cambios.join(' · ')}</div> : null}
                  </div>
                  {!f.error && <span className={'tag ' + ETIQUETA[f.accion][1]}>{ETIQUETA[f.accion][0]}</span>}
                </div>
              ))}
              {res.filas.length > 300 && <div className="mut center">… y {res.filas.length - 300} fila(s) más</div>}
            </div>
            {!res.aplicado && (
              validas > 0 ? (
                <>
                  {res.resumen.errores > 0 && <p className="warn">Las {res.resumen.errores} fila(s) con error se omiten. Corrígelas en Excel y vuelve a importarlas si las necesitas.</p>}
                  <button className="btn block" disabled={ocupado} onClick={() => window.confirm(`¿Importar ${validas} fila(s)?`) && enviar(true)}>3. Importar {validas} fila(s)</button>
                </>
              ) : <p className="mut">No hay filas válidas para importar. Corrige los errores y vuelve a pegar.</p>
            )}
          </div>
        )}
      </main>
    </>
  );
}
