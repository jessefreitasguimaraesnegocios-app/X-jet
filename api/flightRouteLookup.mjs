/**
 * Rota estimada: ADSBDB por indicativo (callsign) — funciona sem credenciais OpenSky.
 * A API anônima do OpenSky /flights/aircraft responde "You cannot access historical flights".
 */
const UA = "Mozilla/5.0 (compatible; X-Jet/2; +https://github.com/)";

export function normalizeIcao24(raw) {
  const hex = String(raw ?? "")
    .replace(/^~/, "")
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "");
  return hex.length === 6 ? hex : null;
}

/** Indicativo ADS-B costuma vir com espaços à direita; ADSBDB quer string compacta. */
export function normalizeCallsign(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s+/g, "").toUpperCase();
  if (!s || s === "N/A" || s === "N-A") return null;
  if (s.length < 2 || s.length > 12) return null;
  return s;
}

function cleanName(s) {
  if (s == null) return null;
  const t = String(s).trim();
  return t.length > 0 ? t : null;
}

/**
 * @returns {{
 *   departure: string | null,
 *   arrival: string | null,
 *   departureName: string | null,
 *   arrivalName: string | null,
 * }}
 */
async function lookupAdsbdbCallsign(callsign) {
  const url = `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`;
  const init = {
    headers: { Accept: "application/json", "User-Agent": UA },
  };
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
    init.signal = AbortSignal.timeout(18_000);
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      departure: null,
      arrival: null,
      departureName: null,
      arrivalName: null,
    };
  }

  const fr = data?.response?.flightroute;
  if (!fr || typeof fr !== "object") {
    return {
      departure: null,
      arrival: null,
      departureName: null,
      arrivalName: null,
    };
  }

  const dep = fr.origin?.icao_code ?? fr.origin?.iata_code;
  const arr = fr.destination?.icao_code ?? fr.destination?.iata_code;

  return {
    departure:
      dep && String(dep).trim()
        ? String(dep).trim().toUpperCase()
        : null,
    arrival:
      arr && String(arr).trim()
        ? String(arr).trim().toUpperCase()
        : null,
    departureName: cleanName(fr.origin?.name),
    arrivalName: cleanName(fr.destination?.name),
  };
}

/**
 * @param {string} icao24Raw
 * @param {string | null | undefined} callsignRaw
 * @returns {Promise<{
 *   departure: string | null,
 *   arrival: string | null,
 *   departureName: string | null,
 *   arrivalName: string | null,
 * }>}
 */
export async function lookupFlightRoute(icao24Raw, callsignRaw) {
  const empty = {
    departure: null,
    arrival: null,
    departureName: null,
    arrivalName: null,
  };
  if (!normalizeIcao24(icao24Raw)) {
    return empty;
  }

  const cs = normalizeCallsign(callsignRaw);
  if (cs) {
    try {
      const r = await lookupAdsbdbCallsign(cs);
      if (r.departure || r.arrival) return r;
    } catch {
      /* ignore */
    }
  }

  return empty;
}
