import type { Bounds } from "./flightService";
import { distanceMeters } from "./flightService";
import type { AirportPoi } from "../types";

export async function fetchAirports(
  bounds: Bounds,
  signal?: AbortSignal
): Promise<AirportPoi[]> {
  const q = new URLSearchParams({
    lamin: String(bounds.lamin),
    lomin: String(bounds.lomin),
    lamax: String(bounds.lamax),
    lomax: String(bounds.lomax),
  });

  const res = await fetch(`/api/airports?${q}`, {
    signal,
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(
      res.status === 429
        ? "Muitas requisições. Aguarde um pouco."
        : `Aeroportos indisponíveis (${res.status}). ${t.slice(0, 80)}`
    );
  }

  const data = (await res.json()) as { airports?: AirportPoi[] };
  if (!Array.isArray(data.airports)) return [];
  return data.airports.filter(
    (a) =>
      a &&
      typeof a.id === "string" &&
      typeof a.name === "string" &&
      typeof a.lat === "number" &&
      typeof a.lon === "number"
  );
}

export function filterAirportsWithinRadiusKm(
  list: AirportPoi[],
  centerLat: number,
  centerLon: number,
  radiusKm: number
): AirportPoi[] {
  const maxM = radiusKm * 1000;
  return list.filter(
    (a) => distanceMeters(centerLat, centerLon, a.lat, a.lon) <= maxM
  );
}
