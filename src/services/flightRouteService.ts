export type FlightRouteInfo = {
  departure: string | null;
  arrival: string | null;
};

export async function fetchFlightRoute(icao24: string): Promise<FlightRouteInfo> {
  const q = encodeURIComponent(icao24.replace(/^~/, ""));
  const res = await fetch(`/api/flight-route?icao24=${q}`, {
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
