/**
 * Aeroportos / aeródromos via OpenStreetMap (Overpass API).
 * @param {{ lamin: number; lomin: number; lamax: number; lomax: number }} bounds
 * @returns {Promise<Array<{ id: string; name: string; lat: number; lon: number; iata?: string; icao?: string }>>}
 */
export async function fetchAirportsFromOverpass(bounds) {
  const { lamin, lomin, lamax, lomax } = bounds;
  const south = lamin;
  const west = lomin;
  const north = lamax;
  const east = lomax;

  const query = `[out:json][timeout:45];
(
  node["aeroway"="aerodrome"](${south},${west},${north},${east});
  way["aeroway"="aerodrome"](${south},${west},${north},${east});
);
out center tags;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) {
    throw new Error(`overpass_${res.status}`);
  }

  const data = await res.json();
  const elements = Array.isArray(data.elements) ? data.elements : [];

  /** @type {Map<string, { id: string; name: string; lat: number; lon: number; iata?: string; icao?: string }>} */
  const byKey = new Map();

  for (const el of elements) {
    const tags = el.tags || {};
    if (tags.aeroway !== "aerodrome") continue;
    /** @type {number | undefined} */
    let lat;
    /** @type {number | undefined} */
    let lon;
    if (el.type === "node" && typeof el.lat === "number" && typeof el.lon === "number") {
      lat = el.lat;
      lon = el.lon;
    } else if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") {
      lat = el.center.lat;
      lon = el.center.lon;
    } else {
      continue;
    }

    const iata = typeof tags.iata === "string" ? tags.iata.trim().toUpperCase() : undefined;
    const icao = typeof tags.icao === "string" ? tags.icao.trim().toUpperCase() : undefined;
    const name =
      (typeof tags.name === "string" && tags.name.trim()) ||
      (typeof tags["name:pt"] === "string" && tags["name:pt"].trim()) ||
      (typeof tags["name:en"] === "string" && tags["name:en"].trim()) ||
      iata ||
      icao ||
      "Aeródromo";

    const id = `${el.type}-${el.id}`;
    const dedupeKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const existing = byKey.get(dedupeKey);
    const prefer =
      !existing ||
      (iata && !existing.iata) ||
      (name.length > existing.name.length && name !== "Aeródromo");

    if (prefer) {
      byKey.set(dedupeKey, {
        id,
        name,
        lat,
        lon,
        ...(iata ? { iata } : {}),
        ...(icao ? { icao } : {}),
      });
    }
  }

  return [...byKey.values()].slice(0, 140);
}

function elementToAerodromePoi(el) {
  const tags = el.tags || {};
  if (tags.aeroway !== "aerodrome") return null;
  let lat;
  let lon;
  if (el.type === "node" && typeof el.lat === "number" && typeof el.lon === "number") {
    lat = el.lat;
    lon = el.lon;
  } else if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") {
    lat = el.center.lat;
    lon = el.center.lon;
  } else {
    return null;
  }
  const iata = typeof tags.iata === "string" ? tags.iata.trim().toUpperCase() : undefined;
  const icao = typeof tags.icao === "string" ? tags.icao.trim().toUpperCase() : undefined;
  const name =
    (typeof tags.name === "string" && tags.name.trim()) ||
    (typeof tags["name:pt"] === "string" && tags["name:pt"].trim()) ||
    (typeof tags["name:en"] === "string" && tags["name:en"].trim()) ||
    iata ||
    icao ||
    "Aeródromo";
  return {
    id: `osm-${el.type}-${el.id}`,
    name,
    lat,
    lon,
    ...(iata ? { iata } : {}),
    ...(icao ? { icao } : {}),
  };
}

function normalizeAirportCode(raw) {
  const c = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (c.length === 3 || c.length === 4) return c;
  return null;
}

function poiMatchesCode(poi, code) {
  const I = (poi.iata || "").toUpperCase();
  const C = (poi.icao || "").toUpperCase();
  return I === code || C === code;
}

/**
 * Resolve IATA (3) ou ICAO (4) → coordenadas via Overpass (uma ida).
 * @param {(string|null|undefined)[]} codes
 * @returns {Promise<Record<string, { id: string, name: string, lat: number, lon: number, iata?: string, icao?: string } | null>>}
 */
export async function fetchAirportsByCodesOverpass(codes) {
  /** @type {string[]} */
  const uniq = [];
  const seen = new Set();
  for (const raw of codes) {
    const c = normalizeAirportCode(raw);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    uniq.push(c);
  }

  /** @type {Record<string, { id: string, name: string, lat: number, lon: number, iata?: string, icao?: string } | null>} */
  const out = Object.fromEntries(uniq.map((c) => [c, null]));

  if (uniq.length === 0) return out;

  const parts = [];
  for (const code of uniq) {
    if (code.length === 4) {
      parts.push(`node["aeroway"="aerodrome"]["icao"="${code}"]`);
      parts.push(`way["aeroway"="aerodrome"]["icao"="${code}"]`);
    } else {
      parts.push(`node["aeroway"="aerodrome"]["iata"="${code}"]`);
      parts.push(`way["aeroway"="aerodrome"]["iata"="${code}"]`);
    }
  }

  const query = `[out:json][timeout:55];
(
${parts.join(";\n")};
);
out center tags;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) {
    throw new Error(`overpass_${res.status}`);
  }

  const data = await res.json();
  const elements = Array.isArray(data.elements) ? data.elements : [];
  /** @type {Array<{ id: string, name: string, lat: number, lon: number, iata?: string, icao?: string }>} */
  const pois = [];
  for (const el of elements) {
    const poi = elementToAerodromePoi(el);
    if (poi) pois.push(poi);
  }

  for (const code of uniq) {
    const hit = pois.find((p) => poiMatchesCode(p, code));
    out[code] = hit ?? null;
  }

  return out;
}
