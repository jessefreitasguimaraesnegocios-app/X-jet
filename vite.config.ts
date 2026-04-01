import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {parse as parseUrl} from 'node:url';
import {defineConfig} from 'vite';

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

export default defineConfig({
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'xjet-api-flights',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const raw = req.url ?? '';
            const pathname = raw.split('?')[0] ?? '';

            if (pathname === '/api/flight-route') {
              try {
                const {
                  lookupFlightRoute,
                  normalizeIcao24,
                  normalizeCallsign,
                } = await import('./api/flightRouteLookup.mjs');
                const parsed = parseUrl(raw, true);
                const q = parsed.query ?? {};
                const v = Array.isArray(q.icao24) ? q.icao24[0] : q.icao24;
                if (!v || !normalizeIcao24(v)) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({error: 'invalid_icao24'}));
                  return;
                }
                const csRaw = Array.isArray(q.callsign) ? q.callsign[0] : q.callsign;
                const callsign =
                  typeof csRaw === 'string' ? normalizeCallsign(csRaw) ?? undefined : undefined;
                const route = await lookupFlightRoute(v, callsign);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(route));
              } catch (e) {
                console.error('[vite /api/flight-route]', e);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({error: 'server_error'}));
              }
              return;
            }

            if (pathname === '/api/flights') {
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
              return;
            }

            if (pathname === '/api/airports') {
              try {
                const {fetchAirportsFromOverpass} = await import('./api/airportsOverpass.mjs');
                const parsed = parseUrl(raw, true);
                const bounds = parseBoundsFromQuery(parsed.query ?? {});
                if (!bounds) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({error: 'invalid_bounds'}));
                  return;
                }
                const airports = await fetchAirportsFromOverpass(bounds);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({airports}));
              } catch (e) {
                console.error('[vite /api/airports]', e);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({error: 'server_error'}));
              }
              return;
            }

            if (pathname === '/api/airport-resolve') {
              try {
                const {fetchAirportsByCodesOverpass} = await import('./api/airportsOverpass.mjs');
                const parsed = parseUrl(raw, true);
                const q = parsed.query ?? {};
                const first = (v: string | string[] | undefined) =>
                  Array.isArray(v) ? v[0] : v;
                const depRaw = first(q.dep);
                const arrRaw = first(q.arr);
                const depStr = typeof depRaw === 'string' ? depRaw.trim() : '';
                const arrStr = typeof arrRaw === 'string' ? arrRaw.trim() : '';
                if (!depStr && !arrStr) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({error: 'missing_codes'}));
                  return;
                }
                const map = await fetchAirportsByCodesOverpass([depStr, arrStr]);
                const depU = depStr.toUpperCase().replace(/[^A-Z0-9]/g, '');
                const arrU = arrStr.toUpperCase().replace(/[^A-Z0-9]/g, '');
                const body = {
                  departure: depU && map[depU] != null ? map[depU] : null,
                  arrival: arrU && map[arrU] != null ? map[arrU] : null,
                };
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(body));
              } catch (e) {
                console.error('[vite /api/airport-resolve]', e);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({error: 'server_error'}));
              }
              return;
            }

            next();
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
});
