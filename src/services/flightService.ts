import { FlightState } from "../types";

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

/**
 * Sem retries em 429: cada nova tentativa piora o bloqueio da OpenSky (API anônima).
 */
export async function fetchFlights(bounds: {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}): Promise<FlightState[]> {
  let response: Response;
  try {
    response = await fetchOpenSkyResponse(bounds);
  } catch {
    throw new Error(
      "Sem conexão com a API de voos. Confira a internet e tente de novo."
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `OpenSky API Error: ${response.status} ${response.statusText}`,
      errorText
    );
    if (response.status === 429) {
      throw new Error(
        "OpenSky limitou as consultas. Aguarde alguns minutos sem atualizar e tente de novo (a API pública tem limite baixo)."
      );
    }
    throw new Error(
      `Não foi possível carregar os voos (${response.status}). Tente de novo em instantes.`
    );
  }

  const data = await response.json();
  return parseStatesPayload(data);
}
