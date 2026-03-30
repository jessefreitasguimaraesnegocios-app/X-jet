export type FlightRouteInfo = {
  departure: string | null;
  arrival: string | null;
};

export async function fetchFlightRoute(
  icao24: string,
  callsign?: string | null,
  signal?: AbortSignal
): Promise<FlightRouteInfo> {
  const params = new URLSearchParams();
  params.set("icao24", icao24.replace(/^~/, ""));
  const cs = callsign?.trim();
  if (cs && cs.toUpperCase() !== "N/A") {
    params.set("callsign", cs);
  }
  const res = await fetch(`/api/flight-route?${params}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    return { departure: null, arrival: null };
  }
  const data = (await res.json()) as FlightRouteInfo;
  return {
    departure: data.departure ?? null,
    arrival: data.arrival ?? null,
  };
}
