import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {parse as parseUrl} from 'node:url';
import {defineConfig, loadEnv} from 'vite';

function parseBoundsFromQuery(q: Record<string, string | string[] | undefined>) {
  const n = (key: string) => {
    const v = Array.isArray(q[key]) ? q[key][0] : q[key];
    const x = Number(v);
    return Number.isFinite(x) ? x : NaN;
  };
  const lamin = n('lamin');
  const lomin = n('lomin');
  const lamax = n('lamax');
  const lomax = n('lomax');
  if ([lamin, lomin, lamax, lomax].some((x) => Number.isNaN(x))) return null;
  if (lamin >= lamax || lomin >= lomax) return null;
  return {lamin, lomin, lamax, lomax};
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const geminiKey =
    env.GEMINI_API_KEY ||
    env.VITE_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    '';
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'xjet-api-flights',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const raw = req.url ?? '';
            if (!raw.startsWith('/api/flights')) {
              next();
              return;
            }
            try {
              const {aggregateFlights} = await import('./api/flightAggregator.mjs');
              const parsed = parseUrl(raw, true);
              const bounds = parseBoundsFromQuery(parsed.query ?? {});
              if (!bounds) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({error: 'invalid_bounds'}));
                return;
              }
              const aircraft = await aggregateFlights(bounds);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({aircraft}));
            } catch (e) {
              console.error('[vite /api/flights]', e);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({error: 'server_error'}));
            }
          });
        },
      },
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(geminiKey),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
