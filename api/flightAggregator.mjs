/**
 * Agregação server-side: OpenSky → adsb.lol → airplanes.live.
 * Usado pela rota /api/flights (Vercel) e pelo middleware do Vite em dev.
 */
const UA =
  "Mozilla/5.0 (compatible; X-Jet/2; research; +https://opensky-network.org/)";
const FT_TO_M = 0.3048;
const KNOTS_TO_MS = 0.514444;
const FPM_TO_MS = 0.00508;

function boundsToCenterNm(bounds) {
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

function inBounds(p, b) {
  if (p.latitude == null || p.longitude == null) return false;
  return (
    p.latitude >= b.lamin &&
    p.latitude <= b.lamax &&
    p.longitude >= b.lomin &&
    p.longitude <= b.lomax
  );
}

function mapOpenSkyState(s) {
  if (!Array.isArray(s) || s.length < 9) return null;
  return {
    icao24: s[0] != null ? String(s[0]) : "",
    callsign: (s[1] && String(s[1]).trim()) || "N/A",
    originCountry: s[2] || "—",
    timePosition: s[3],
    lastContact: s[4],
    longitude: s[5],
    latitude: s[6],
    baroAltitude: s[7],
    onGround: Boolean(s[8]),
    velocity: s[9],
    trueTrack: s[10],
    verticalRate: s[11],
    geoAltitude: s[13],
    squawk: s[14],
    positionSource: s[16] ?? 0,
  };
}

function mapAdsb(a) {
  if (typeof a.lat !== "number" || typeof a.lon !== "number") return null;
  const hex = String(a.hex ?? "").replace(/^~/, "");
  if (!hex) return null;
  const flight =
    typeof a.flight === "string" ? a.flight.trim() || "N/A" : "N/A";
  const alt = a.alt_baro;
  const onGround = alt === "ground";
  const baroM =
    typeof alt === "number" ? alt * FT_TO_M : onGround ? 0 : null;
  const gs = typeof a.gs === "number" ? a.gs * KNOTS_TO_MS : null;
  const track =
    typeof a.track === "number"
      ? a.track
      : typeof a.true_heading === "number"
        ? a.true_heading
        : null;
  const acType =
    typeof a.type === "string" && a.type.trim()
      ? String(a.type).trim().toUpperCase()
      : null;
  return {
    icao24: hex,
    callsign: flight,
    aircraftType: acType,
    originCountry: "—",
    timePosition: null,
    lastContact: Math.floor(Date.now() / 1000),
    longitude: a.lon,
    latitude: a.lat,
    baroAltitude: baroM,
    onGround,
    velocity: gs,
    trueTrack: track,
    verticalRate:
      typeof a.baro_rate === "number" ? a.baro_rate * FPM_TO_MS : null,
    geoAltitude:
      typeof a.alt_geom === "number" ? a.alt_geom * FT_TO_M : null,
    squawk:
      typeof a.squawk === "string"
        ? a.squawk
        : typeof a.squawk === "number"
          ? String(a.squawk)
          : null,
    positionSource: 0,
  };
}

function mapAirplanes(a) {
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
    typeof alt === "number" ? alt * FT_TO_M : onGround ? 0 : null;
  const gs = typeof a.gs === "number" ? a.gs * KNOTS_TO_MS : null;
  const acType =
    typeof a.type === "string" && a.type.trim()
      ? String(a.type).trim().toUpperCase()
      : null;
  return {
    icao24: hex,
    callsign: flight,
    aircraftType: acType,
    originCountry: "—",
    timePosition: null,
    lastContact: Math.floor(Date.now() / 1000),
    longitude: a.lon,
    latitude: a.lat,
    baroAltitude: baroM,
    onGround,
    velocity: gs,
    trueTrack: typeof a.track === "number" ? a.track : null,
    verticalRate:
      typeof a.baro_rate === "number" ? a.baro_rate * FPM_TO_MS : null,
    geoAltitude:
      typeof a.alt_geom === "number" ? a.alt_geom * FT_TO_M : null,
    squawk:
      typeof a.squawk === "string"
        ? a.squawk
        : typeof a.squawk === "number"
          ? String(a.squawk)
          : null,
    positionSource: 0,
  };
}

async function fetchOpenSky(bounds) {
  try {
    const q = new URLSearchParams({
      lamin: String(bounds.lamin),
      lomin: String(bounds.lomin),
      lamax: String(bounds.lamax),
      lomax: String(bounds.lomax),
    });
    const url = `https://opensky-network.org/api/states/all?${q}`;
    const init = {
      headers: { Accept: "application/json", "User-Agent": UA },
    };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      init.signal = AbortSignal.timeout(28000);
    }
    const res = await fetch(url, init);
    if (!res.ok) return [];
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return [];
    }
    if (!data.states || !Array.isArray(data.states)) return [];
    return data.states
      .map(mapOpenSkyState)
      .filter((p) => p != null && p.icao24);
  } catch {
    return [];
  }
}

async function fetchAdsb(bounds) {
  const { lat, lon, radiusNm } = boundsToCenterNm(bounds);
  const dist = Math.min(Math.max(Math.round(radiusNm), 5), 250);
  const url = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
    if (!res.ok) return [];
    const j = await res.json();
    if (!Array.isArray(j.ac)) return [];
    return j.ac.map(mapAdsb).filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchAirplanes(bounds) {
  const { lat, lon, radiusNm } = boundsToCenterNm(bounds);
  const nm = Math.min(Math.max(Math.round(radiusNm), 5), 250);
  const url = `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
    if (!res.ok) return [];
    const j = await res.json();
    if (!Array.isArray(j.aircraft)) return [];
    return j.aircraft.map(mapAirplanes).filter(Boolean);
  } catch {
    return [];
  }
}

function filterBox(list, bounds) {
  const boxed = list.filter((p) => inBounds(p, bounds));
  return boxed.length > 0 ? boxed : list;
}

/**
 * @param {{ lamin: number, lomin: number, lamax: number, lomax: number }} bounds
 */
export async function aggregateFlights(bounds) {
  try {
    let list = await fetchOpenSky(bounds);
    list = list.filter(
      (p) => p.latitude != null && p.longitude != null
    );

    if (list.length === 0) {
      list = filterBox(await fetchAdsb(bounds), bounds);
    }
    if (list.length === 0) {
      list = filterBox(await fetchAirplanes(bounds), bounds);
    }

    return list;
  } catch (e) {
    console.error("aggregateFlights:", e);
    return [];
  }
}
