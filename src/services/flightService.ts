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

  try {
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
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const msg = e instanceof Error ? e.message : "";
    if (/failed to fetch/i.test(msg) || /networkerror/i.test(msg)) {
      throw new Error("Sem conexão com o servidor de voos. Tente novamente.");
    }
    if (e instanceof Error) throw e;
    throw new Error("Não foi possível carregar os voos agora.");
  }
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

const EARTH_R_M = 6_371_000;

function toRad(d: number) {
  return (d * Math.PI) / 180;
}

/** Distância ao solo (Haversine), em metros. */
export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return EARTH_R_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Filtra voos já carregados para um raio menor (sem nova requisição). */
export function filterFlightsWithinRadiusKm(
  list: FlightState[],
  centerLat: number,
  centerLon: number,
  radiusKm: number
): FlightState[] {
  const maxM = radiusKm * 1000;
  return list.filter((f) => {
    if (f.latitude == null || f.longitude == null) return false;
    return (
      distanceMeters(centerLat, centerLon, f.latitude, f.longitude) <= maxM
    );
  });
}
