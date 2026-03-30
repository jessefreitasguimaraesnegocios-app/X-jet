/**
 * Proxy server-side para OpenSky (Node https — evita falhas de fetch/undici na Vercel).
 * GET /api/opensky-states?lamin=&lomin=&lamax=&lomax=
 */
import https from 'node:https';
import { parse as parseUrl } from 'node:url';

const UPSTREAM_TIMEOUT_MS = 25000;

function fetchOpenSkyHttps(targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const opts = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    };

    const req = https.request(opts, (upstreamRes) => {
      const chunks = [];
      upstreamRes.on('data', (c) => chunks.push(c));
      upstreamRes.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: upstreamRes.statusCode || 500,
          body,
        });
      });
    });

    req.on('error', (e) => reject(e));
    req.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('OpenSky upstream timeout'));
    });
    req.end();
  });
}

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
    const { statusCode, body } = await fetchOpenSkyHttps(target);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(body);
  } catch (err) {
    console.error('OpenSky proxy failed:', err?.message || err);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'opensky_proxy_failed' }));
  }
}
