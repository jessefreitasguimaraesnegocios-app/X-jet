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

function primaryFlightsUrl(bounds: {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}): string {
  const qs = boundsQuery(bounds);

  if (import.meta.env.DEV) {
    return `/opensky-api/states/all?${qs}`;
  }

  const host =
    typeof window !== "undefined" ? window.location.hostname : "";
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (isLocal) {
    return directOpenSkyUrl(bounds);
  }

  return `/api/opensky-states?${qs}`;
}

function shouldTryDirectAfterProxyFailure(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
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

export async function fetchFlights(
  bounds: {
    lamin: number;
    lomin: number;
    lamax: number;
    lomax: number;
  },
  retries = 5,
  delay = 2000
): Promise<FlightState[]> {
  const primary = primaryFlightsUrl(bounds);

  let response: Response;
  try {
    response = await fetch(primary);
  } catch {
    if (!primary.includes("opensky-network.org")) {
      try {
        response = await fetch(directOpenSkyUrl(bounds));
      } catch {
        throw new Error(
          "Sem conexão com a API de voos. Confira a internet e tente de novo."
        );
      }
    } else {
      throw new Error(
        "Sem conexão com a API de voos. Confira a internet e tente de novo."
      );
    }
  }

  if (
    !response.ok &&
    shouldTryDirectAfterProxyFailure(response.status) &&
    !primary.includes("opensky-network.org")
  ) {
    try {
      const fallback = await fetch(directOpenSkyUrl(bounds));
      if (fallback.ok) {
        response = fallback;
      }
    } catch {
      /* segue para tratamento do response original */
    }
  }

  if (!response.ok) {
    if (response.status === 429 && retries > 0) {
      const jitter = Math.random() * 1500;
      const nextDelay = delay + jitter;
      console.warn(
        `OpenSky rate limit. Nova tentativa em ${Math.round(nextDelay)}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, nextDelay));
      return fetchFlights(bounds, retries - 1, delay * 1.5);
    }
    const errorText = await response.text();
    console.error(
      `OpenSky API Error: ${response.status} ${response.statusText}`,
      errorText
    );
    if (response.status === 429) {
      throw new Error(
        "OpenSky limitou as consultas (muitas requisições). Aguarde 1–2 minutos e toque em atualizar."
      );
    }
    throw new Error(
      `Não foi possível carregar os voos (${response.status}). Tente de novo em instantes.`
    );
  }

  const data = await response.json();
  return parseStatesPayload(data);
}
