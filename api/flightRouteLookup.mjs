/**
 * Rota estimada via OpenSky /api/flights/aircraft (últimas 24h).
 * Nem todo voo tem aeroportos preenchidos — depende dos dados da rede.
 */
const UA =
  "Mozilla/5.0 (compatible; X-Jet/2; +https://opensky-network.org/)";

export function normalizeIcao24(raw) {
  const hex = String(raw ?? "")
    .replace(/^~/, "")
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "");
  return hex.length === 6 ? hex : null;
}

/**
 * @returns {{ departure: string | null, arrival: string | null }}
 */
export async function lookupFlightRoute(icao24Raw) {
  const hex = normalizeIcao24(icao24Raw);
  if (!hex) {
    return { departure: null, arrival: null };
  }

  try {
    const end = Math.floor(Date.now() / 1000);
    const begin = end - 86400;
    const url = `https://opensky-network.org/api/flights/aircraft?icao24=${hex}&begin=${begin}&end=${end}`;

    const init = { headers: { Accept: "application/json", "User-Agent": UA } };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      init.signal = AbortSignal.timeout(20000);
    }

    const res = await fetch(url, init);
    if (!res.ok) return { departure: null, arrival: null };

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { departure: null, arrival: null };
    }

    if (!Array.isArray(data) || data.length === 0) {
      return { departure: null, arrival: null };
    }

    const sorted = [...data].sort(
      (a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0)
    );
    const f = sorted[0];
    const dep = f.estDepartureAirport ?? f.estdepartureairport ?? null;
    const arr = f.estArrivalAirport ?? f.estarrivalairport ?? null;

    return {
      departure: dep && String(dep).trim() ? String(dep).trim().toUpperCase() : null,
      arrival: arr && String(arr).trim() ? String(arr).trim().toUpperCase() : null,
    };
  } catch {
    return { departure: null, arrival: null };
  }
}
