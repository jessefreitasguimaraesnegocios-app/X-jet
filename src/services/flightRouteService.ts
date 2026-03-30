export type FlightRouteInfo = {
  departure: string | null;
  arrival: string | null;
  departureName: string | null;
  arrivalName: string | null;
};

const emptyRoute: FlightRouteInfo = {
  departure: null,
  arrival: null,
  departureName: null,
  arrivalName: null,
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
    return { ...emptyRoute };
  }
  const data = (await res.json()) as Partial<FlightRouteInfo>;
  return {
    departure: data.departure ?? null,
    arrival: data.arrival ?? null,
    departureName: data.departureName ?? null,
    arrivalName: data.arrivalName ?? null,
  };
}
