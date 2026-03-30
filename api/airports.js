/**
 * GET /api/airports?lamin=&lomin=&lamax=&lomax=
 * Aeroportos na área (OpenStreetMap / Overpass).
 */
import { parse as parseUrl } from "node:url";
import { fetchAirportsFromOverpass } from "./airportsOverpass.mjs";

function first(v) {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function parseBounds(q) {
  const n = (key) => {
    const v = Number(first(q[key]));
    return Number.isFinite(v) ? v : NaN;
  };
  const lamin = n("lamin");
  const lomin = n("lomin");
  const lamax = n("lamax");
  const lomax = n("lomax");
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
    const airports = await fetchAirportsFromOverpass(bounds);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ airports }));
  } catch (e) {
    console.error("fetchAirportsFromOverpass:", e);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "server_error" }));
  }
}
