/**
 * GET /api/flight-route?icao24=abcdef
 */
import { parse as parseUrl } from "node:url";
import {
  lookupFlightRoute,
  normalizeIcao24,
  normalizeCallsign,
} from "./flightRouteLookup.mjs";

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
  const raw = first(query?.icao24);
  if (!raw || !normalizeIcao24(raw)) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "invalid_icao24" }));
    return;
  }

  const csRaw = first(query?.callsign);
  const callsign =
    typeof csRaw === "string" ? normalizeCallsign(csRaw) ?? undefined : undefined;

  try {
    const route = await lookupFlightRoute(raw, callsign);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(route));
  } catch (e) {
    console.error("flight-route:", e);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "server_error" }));
  }
}
