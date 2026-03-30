export interface FlightState {
  icao24: string;
  callsign: string;
  /** Código tipo ICAO (ex. B738) quando a fonte ADS-B envia. */
  aircraftType?: string | null;
  originCountry: string;
  timePosition: number | null;
  lastContact: number;
  longitude: number | null;
  latitude: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  geoAltitude: number | null;
  squawk: string | null;
  positionSource: number;
}

export interface FlightDetails {
  icao24: string;
  model?: string;
  operator?: string;
  capacity?: number;
  origin?: string;
  destination?: string;
  route?: [number, number][];
}
