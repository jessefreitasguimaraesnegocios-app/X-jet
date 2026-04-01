/**
 * GET /api/airport-resolve?dep=SBGR&arr=KJFK
 * Resolve códigos IATA/ICAO para coordenadas (OSM Overpass).
 */
import { parse as parseUrl } from "node:url";
import { fetchAirportsByCodesOverpass } from "./airportsOverpass.mjs";

function first(v) {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  const { query } = parseUrl(req.url || "", true);
  const dep = first(query?.dep);
  const arr = first(query?.arr);
  const depStr = typeof dep === "string" ? dep.trim() : "";
  const arrStr = typeof arr === "string" ? arr.trim() : "";

  if (!depStr && !arrStr) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "missing_codes" }));
    return;
  }

  try {
    const map = await fetchAirportsByCodesOverpass([depStr, arrStr]);
    const depU = depStr.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const arrU = arrStr.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const body = {
      departure: depU && map[depU] != null ? map[depU] : null,
      arrival: arrU && map[arrU] != null ? map[arrU] : null,
    };
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  } catch (e) {
    console.error("airport-resolve:", e);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "server_error" }));
  }
}
