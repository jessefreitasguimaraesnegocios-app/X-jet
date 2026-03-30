/**
 * GET /api/flights?lamin=&lomin=&lamax=&lomax=
 */
import { parse as parseUrl } from "node:url";
import { aggregateFlights } from "./flightAggregator.mjs";

function parseBounds(q) {
  const n = (x) => {
    const v = Number(x);
    return Number.isFinite(v) ? v : NaN;
  };
  const lamin = n(q.lamin);
  const lomin = n(q.lomin);
  const lamax = n(q.lamax);
  const lomax = n(q.lomax);
  if ([lamin, lomin, lamax, lomax].some((x) => Number.isNaN(x))) return null;
  if (lamin >= lamax || lomin >= lomax) return null;
  return { lamin, lomin, lamax, lomax };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  const { query } = parseUrl(req.url || "", true);
  const bounds = parseBounds(query || {});
  if (!bounds) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "invalid_bounds" }));
    return;
  }
  try {
    const aircraft = await aggregateFlights(bounds);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ aircraft }));
  } catch (e) {
    console.error("aggregateFlights:", e);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "server_error" }));
  }
}
