import type { AirportPoi } from "../types";

export type RouteAirportsResolved = {
  departure: AirportPoi | null;
  arrival: AirportPoi | null;
};

function parsePoi(v: unknown): AirportPoi | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.name !== "string" ||
    typeof o.lat !== "number" ||
    typeof o.lon !== "number"
  ) {
    return null;
  }
  const iata = typeof o.iata === "string" ? o.iata : undefined;
  const icao = typeof o.icao === "string" ? o.icao : undefined;
  return {
    id: o.id,
    name: o.name,
    lat: o.lat,
    lon: o.lon,
    ...(iata ? { iata } : {}),
    ...(icao ? { icao } : {}),
  };
}

export async function fetchRouteAirports(
  departureCode: string | null | undefined,
  arrivalCode: string | null | undefined,
  signal?: AbortSignal
): Promise<RouteAirportsResolved> {
  const dep = departureCode?.trim() || "";
  const arr = arrivalCode?.trim() || "";
  if (!dep && !arr) {
    return { departure: null, arrival: null };
  }
  const q = new URLSearchParams();
  if (dep) q.set("dep", dep);
  if (arr) q.set("arr", arr);
  try {
    const res = await fetch(`/api/airport-resolve?${q}`, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { departure: null, arrival: null };
    const data = (await res.json()) as {
      departure?: unknown;
      arrival?: unknown;
    };
    return {
      departure: parsePoi(data.departure),
      arrival: parsePoi(data.arrival),
    };
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { departure: null, arrival: null };
  }
}
