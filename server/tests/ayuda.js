// Utilidades de prueba: servidor en memoria y cliente HTTP mínimo
export async function iniciar() {
  process.env.DB_FILE ??= ':memory:';
  const { crearApp } = await import('../app.js');
  const { asegurarAdmin } = await import('../seed.js');
  asegurarAdmin();
  const server = crearApp().listen(0);
  const base = `http://localhost:${server.address().port}/api`;
  const call = async (method, url, body, token) => {
    const r = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const login = async (usuario, clave) => (await call('POST', '/auth/login', { usuario, clave })).body.token;
  return { server, call, login };
}
