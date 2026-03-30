import { FlightState } from "../types";

const OPENSKY_URL = "https://opensky-network.org/api/states/all";

export async function fetchFlights(bounds: {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}, retries = 2, delay = 1000): Promise<FlightState[]> {
  const { lamin, lomin, lamax, lomax } = bounds;
  const url = `${OPENSKY_URL}?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 429 && retries > 0) {
        const jitter = Math.random() * 1000;
        const nextDelay = delay + jitter;
        console.warn(`OpenSky Rate Limited. Retrying in ${Math.round(nextDelay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, nextDelay));
        return fetchFlights(bounds, retries - 1, delay * 2);
      }
      const errorText = await response.text();
      console.error(`OpenSky API Error: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Falha ao buscar dados de voo: ${response.status}`);
    }
    const data = await response.json();

    if (!data.states) return [];

    return data.states.map((s: any) => ({
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
  } catch (error) {
    console.error("Erro no FlightService:", error);
    return [];
  }
}
