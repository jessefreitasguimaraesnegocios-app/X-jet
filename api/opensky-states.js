/**
 * Proxy server-side para OpenSky (evita CORS e usa o IP da Vercel no limite anônimo).
 * Rota: GET /api/opensky-states?lamin=...&lomin=...&lamax=...&lomax=...
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }
  const raw = req.url || '';
  const q = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
  const target = `https://opensky-network.org/api/states/all${q}`;
  try {
    const upstream = await fetch(target, {
      headers: { Accept: 'application/json' },
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(text);
  } catch {
    res.status(502).json({ error: 'opensky_proxy_failed' });
  }
}
