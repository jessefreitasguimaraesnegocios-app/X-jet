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
