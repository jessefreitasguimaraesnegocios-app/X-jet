import type { FlightRouteInfo } from "../services/flightRouteService";
import type { FlightState } from "../types";

/** Texto para Web Speech: voo + rota + altitude + velocidade (+ solo). */
export function buildFlightSpeechBriefing(
  f: FlightState,
  route: FlightRouteInfo | null
): string {
  const bits: (string | null)[] = [
    `Voo ${f.callsign}`,
    f.originCountry && f.originCountry !== "—"
      ? `país ${f.originCountry}`
      : null,
    `transponder I C A O ${f.icao24}`,
    route?.departure
      ? `procedência estimada, aeroporto ${route.departure}`
      : null,
    route?.arrival
      ? `destino estimado, aeroporto ${route.arrival}`
      : null,
    !route?.departure && !route?.arrival
      ? "origem e destino não encontrados para este indicativo"
      : null,
    `altitude ${Math.round(f.baroAltitude ?? 0)} metros`,
    `velocidade ${Math.round((f.velocity ?? 0) * 3.6)} quilômetros por hora`,
    f.onGround ? "aeronave no solo" : null,
  ];
  return bits.filter(Boolean).join(". ") + ".";
}
