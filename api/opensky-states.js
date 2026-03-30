/**
 * Proxy server-side para OpenSky.
 * GET /api/opensky-states?lamin=&lomin=&lamax=&lomax=
 */
import { parse as parseUrl } from 'node:url';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }

  const { query } = parseUrl(req.url || '', true);
  const q = query || {};
  const lamin = q.lamin;
  const lomin = q.lomin;
  const lamax = q.lamax;
  const lomax = q.lomax;

  if (
    lamin === undefined ||
    lomin === undefined ||
    lamax === undefined ||
    lomax === undefined ||
    lamin === '' ||
    lomin === '' ||
    lamax === '' ||
    lomax === ''
  ) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'missing_bounds' }));
    return;
  }

  const upstreamQuery = new URLSearchParams({
    lamin: String(lamin),
    lomin: String(lomin),
    lamax: String(lamax),
    lomax: String(lomax),
  }).toString();

  const target = `https://opensky-network.org/api/states/all?${upstreamQuery}`;

  try {
    const upstream = await fetch(target, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (compatible; X-Jet/1.0; +https://opensky-network.org/)',
      },
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(text);
  } catch (err) {
    console.error('OpenSky proxy fetch failed:', err);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'opensky_proxy_failed' }));
  }
}
