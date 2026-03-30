import type { FlightState } from "../types";

export type Bounds = {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
};

/** Sempre via `/api/flights` (servidor dev ou Vercel) — uma chamada, sem CORS nas APIs ADS-B. */
export async function fetchFlights(
  bounds: Bounds,
  signal?: AbortSignal
): Promise<FlightState[]> {
  const q = new URLSearchParams({
    lamin: String(bounds.lamin),
    lomin: String(bounds.lomin),
    lamax: String(bounds.lamax),
    lomax: String(bounds.lomax),
  });

  const res = await fetch(`/api/flights?${q}`, {
    signal,
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(
      res.status === 429
        ? "Muitas requisições. Aguarde um pouco."
        : `Voos indisponíveis (${res.status}). ${t.slice(0, 80)}`
    );
  }

  const data = (await res.json()) as { aircraft?: FlightState[] };
  if (!Array.isArray(data.aircraft)) return [];
  return data.aircraft;
}

export function boundsFromCenterRadiusKm(
  lat: number,
  lon: number,
  radiusKm: number
): Bounds {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return {
    lamin: lat - latDelta,
    lomin: lon - lonDelta,
    lamax: lat + latDelta,
    lomax: lon + lonDelta,
  };
}
