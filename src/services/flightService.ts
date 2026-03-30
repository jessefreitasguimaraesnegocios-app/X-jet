import { FlightState } from "../types";

const FT_TO_M = 0.3048;
const KNOTS_TO_MS = 0.514444;
const FPM_TO_MS = 0.00508;

function boundsQuery(bounds: {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}): string {
  const { lamin, lomin, lamax, lomax } = bounds;
  return `lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
}

function directOpenSkyUrl(bounds: {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}): string {
  return `https://opensky-network.org/api/states/all?${boundsQuery(bounds)}`;
}

function isLocalHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

/**
 * Dev: proxy Vite. Localhost build/preview: só OpenSky direto.
 * Produção (ex.: Vercel): OpenSky direto primeiro (evita bloqueio de IP de datacenter);
 * `/api/opensky-states` só se a chamada direta falhar ou retornar erro HTTP.
 */
async function fetchOpenSkyResponse(bounds: {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}): Promise<Response> {
  const qs = boundsQuery(bounds);
  const direct = directOpenSkyUrl(bounds);
  const proxyUrl = `/api/opensky-states?${qs}`;

  if (import.meta.env.DEV) {
    return fetch(`/opensky-api/states/all?${qs}`);
  }

  if (isLocalHost()) {
    return fetch(direct);
  }

  try {
    const directRes = await fetch(direct);
    if (directRes.ok || directRes.status === 429) {
      return directRes;
    }
  } catch {
    /* rede/CORS: tenta proxy */
  }

  return fetch(proxyUrl);
}

/** Centro do bbox + raio em milhas náuticas (para APIs que usam círculo). */
function boundsToCenterAndRadiusNm(bounds: {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}): { lat: number; lon: number; radiusNm: number } {
  const lat = (bounds.lamin + bounds.lamax) / 2;
  const lon = (bounds.lomin + bounds.lomax) / 2;
  const halfLatKm = ((bounds.lamax - bounds.lamin) / 2) * 111;
  const halfLonKm =
    ((bounds.lomax - bounds.lomin) / 2) *
    111 *
    Math.cos((lat * Math.PI) / 180);
  const radiusKm = Math.max(Math.hypot(halfLatKm, halfLonKm), 5);
  const radiusNm = Math.min(Math.max(radiusKm * 0.539957, 5), 250);
  return { lat, lon, radiusNm };
}

function inBounds(
  f: FlightState,
  b: { lamin: number; lomin: number; lamax: number; lomax: number }
): boolean {
  if (f.latitude == null || f.longitude == null) return false;
  return (
    f.latitude >= b.lamin &&
    f.latitude <= b.lamax &&
    f.longitude >= b.lomin &&
    f.longitude <= b.lomax
  );
}

function mapAdsbAircraft(a: Record<string, unknown>): FlightState | null {
  if (typeof a.lat !== "number" || typeof a.lon !== "number") return null;
  const hex = String(a.hex ?? "").replace(/^~/, "");
  if (!hex) return null;
  const flight =
    typeof a.flight === "string" ? a.flight.trim() || "N/A" : "N/A";
  const alt = a.alt_baro;
  const onGround = alt === "ground";
  const baroM =
    typeof alt === "number"
      ? alt * FT_TO_M
      : onGround
        ? 0
        : null;
  const gs = typeof a.gs === "number" ? a.gs * KNOTS_TO_MS : null;
  const track =
    typeof a.track === "number"
      ? a.track
      : typeof a.true_heading === "number"
        ? a.true_heading
        : null;
  const baroRate = typeof a.baro_rate === "number" ? a.baro_rate * FPM_TO_MS : null;
  const geom =
    typeof a.alt_geom === "number" ? a.alt_geom * FT_TO_M : null;
  const sq = a.squawk;
  const squawk =
    typeof sq === "string" ? sq : typeof sq === "number" ? String(sq) : null;

  return {
    icao24: hex,
    callsign: flight,
    originCountry: "—",
    timePosition: null,
    lastContact: Math.floor(Date.now() / 1000),
    longitude: a.lon,
    latitude: a.lat,
    baroAltitude: baroM,
    onGround,
    velocity: gs,
    trueTrack: track,
    verticalRate: baroRate,
    geoAltitude: geom,
    squawk,
    positionSource: 0,
  };
}

/** airplanes.live — campos semelhantes ao readsb / adsb.lol */
function mapAirplanesAircraft(a: Record<string, unknown>): FlightState | null {
  if (typeof a.lat !== "number" || typeof a.lon !== "number") return null;
  const hex = String(a.hex ?? "").replace(/^~/, "");
  if (!hex) return null;
  const flight =
    typeof a.flight === "string"
      ? a.flight.trim() || "N/A"
      : typeof a.callsign === "string"
        ? a.callsign.trim() || "N/A"
        : "N/A";
  const alt = a.alt_baro;
  const onGround = alt === "ground";
  const baroM =
    typeof alt === "number"
      ? alt * FT_TO_M
      : onGround
        ? 0
        : null;
  const gs = typeof a.gs === "number" ? a.gs * KNOTS_TO_MS : null;
  const track = typeof a.track === "number" ? a.track : null;
  const baroRate =
    typeof a.baro_rate === "number" ? a.baro_rate * FPM_TO_MS : null;
  const geom =
    typeof a.alt_geom === "number" ? a.alt_geom * FT_TO_M : null;
  const sq = a.squawk;
  const squawk =
    typeof sq === "string" ? sq : typeof sq === "number" ? String(sq) : null;

  return {
    icao24: hex,
    callsign: flight,
    originCountry: "—",
    timePosition: null,
    lastContact: Math.floor(Date.now() / 1000),
    longitude: a.lon,
    latitude: a.lat,
    baroAltitude: baroM,
    onGround,
    velocity: gs,
    trueTrack: track,
    verticalRate: baroRate,
    geoAltitude: geom,
    squawk,
    positionSource: 0,
  };
}

async function fetchAdsbLolFallback(
  lat: number,
  lon: number,
  radiusNm: number
): Promise<FlightState[]> {
  const dist = Math.min(Math.max(Math.round(radiusNm), 5), 250);
  const url = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = (await r.json()) as { ac?: unknown };
    const ac = j.ac;
    if (!Array.isArray(ac)) return [];
    return ac
      .map((x) => mapAdsbAircraft(x as Record<string, unknown>))
      .filter((x): x is FlightState => x !== null);
  } catch {
    return [];
  }
}

async function fetchAirplanesLiveFallback(
  lat: number,
  lon: number,
  radiusNm: number
): Promise<FlightState[]> {
  const nm = Math.min(Math.max(Math.round(radiusNm), 5), 250);
  const url = `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = (await r.json()) as { aircraft?: unknown; msg?: string };
    if (typeof j.msg === "string" && j.msg.toLowerCase().includes("error")) {
      return [];
    }
    const list = j.aircraft;
    if (!Array.isArray(list)) return [];
    return list
      .map((x) => mapAirplanesAircraft(x as Record<string, unknown>))
      .filter((x): x is FlightState => x !== null);
  } catch {
    return [];
  }
}

function parseStatesPayload(data: { states?: unknown }): FlightState[] {
  if (!data.states) return [];

  return (data.states as any[]).map((s: any) => ({
    icao24: s[0],
    callsign: s[1]?.trim() || "N/A",
    originCountry: s[2],
    timePosition: s[3],
    lastContact: s[4],
    longitude: s[5],
    latitude: s[6],
    baroAltitude: s[7],
    onGround: s[8],
    velocity: s[9],
    trueTrack: s[10],
    verticalRate: s[11],
    geoAltitude: s[13],
    squawk: s[14],
    positionSource: s[16],
  }));
}

const OPENSKY_FALLBACK_STATUSES = [429, 502, 503, 504, 403];

/**
 * OpenSky primeiro; se limite/erro transitório ou falha de rede, tenta adsb.lol e airplanes.live (uso não comercial, limites próprios).
 */
export async function fetchFlights(bounds: {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}): Promise<FlightState[]> {
  let response: Response | undefined;
  try {
    response = await fetchOpenSkyResponse(bounds);
  } catch {
    response = undefined;
  }

  if (response?.ok) {
    const data = await response.json();
    return parseStatesPayload(data);
  }

  const tryAlternates =
    response == null ||
    OPENSKY_FALLBACK_STATUSES.includes(response.status);

  if (tryAlternates) {
    const { lat, lon, radiusNm } = boundsToCenterAndRadiusNm(bounds);

    const fromAdsb = await fetchAdsbLolFallback(lat, lon, radiusNm);
    const boxedAdsb = fromAdsb.filter((f) => inBounds(f, bounds));
    const useAdsb = boxedAdsb.length > 0 ? boxedAdsb : fromAdsb;
    if (useAdsb.length > 0) {
      console.info(
        "[X-Jet] Dados via adsb.lol (fallback — OpenSky indisponível ou limitada)."
      );
      return useAdsb;
    }

    const fromAp = await fetchAirplanesLiveFallback(lat, lon, radiusNm);
    const boxedAp = fromAp.filter((f) => inBounds(f, bounds));
    const useAp = boxedAp.length > 0 ? boxedAp : fromAp;
    if (useAp.length > 0) {
      console.info(
        "[X-Jet] Dados via airplanes.live (fallback — OpenSky indisponível ou limitada)."
      );
      return useAp;
    }
  }

  if (!response) {
    throw new Error(
      "Sem conexão com a API de voos. Confira a internet e tente de novo."
    );
  }

  const errorText = await response.text();
  console.error(
    `OpenSky API Error: ${response.status} ${response.statusText}`,
    errorText
  );
  if (response.status === 429) {
    throw new Error(
      "Limite de consultas (OpenSky e fallbacks sem dados agora). Aguarde alguns minutos e tente de novo."
    );
  }
  throw new Error(
    `Não foi possível carregar os voos (${response.status}). Tente de novo em instantes.`
  );
}
