import { useEffect, useRef, useState } from "react";
import type { FlightState } from "../types";

const M_PER_DEG_LAT = 111_320;
const CORRECTION_MS = 480;
const MIN_VELOCITY_MS = 4;
const MAX_FRAME_DT_SEC = 0.22;
const STATE_UPDATE_MS = 1000 / 30;

function extrapolateStep(
  lat: number,
  lon: number,
  velocityMs: number,
  trackDeg: number,
  dtSec: number
): [number, number] {
  const tr = (trackDeg * Math.PI) / 180;
  const north = velocityMs * Math.cos(tr) * dtSec;
  const east = velocityMs * Math.sin(tr) * dtSec;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLat = north / M_PER_DEG_LAT;
  const dLon = east / (M_PER_DEG_LAT * Math.max(0.05, Math.abs(cosLat)));
  return [lat + dLat, lon + dLon];
}

type Correction = {
  from: [number, number];
  to: [number, number];
  start: number;
};

/**
 * Posições suaves por ICAO24: correção curta a cada fix ADS-B + movimento contínuo
 * por velocidade/rumo entre atualizações.
 */
export function useSmoothedFlightPositionsMap(
  flights: FlightState[]
): ReadonlyMap<string, [number, number]> {
  const [positions, setPositions] = useState(
    () => new Map<string, [number, number]>()
  );
  const flightsRef = useRef(flights);
  flightsRef.current = flights;

  const displayRef = useRef(new Map<string, [number, number]>());
  const lastServerKeyRef = useRef(new Map<string, string>());
  const correctionRef = useRef(new Map<string, Correction>());
  const nonEmptyRef = useRef(false);

  useEffect(() => {
    let raf = 0;
    let lastFrame = performance.now();
    let lastSetState = 0;

    const tick = (now: number) => {
      const list = flightsRef.current;
      const dt = Math.min(
        MAX_FRAME_DT_SEC,
        Math.max(0, (now - lastFrame) / 1000)
      );
      lastFrame = now;

      const display = displayRef.current;
      const lastServerKey = lastServerKeyRef.current;
      const correction = correctionRef.current;
      const active = new Set<string>();
      const byIcao = new Map<string, FlightState>();

      for (const f of list) {
        if (f.latitude == null || f.longitude == null) continue;
        byIcao.set(f.icao24, f);
        const icao = f.icao24;
        active.add(icao);
        const serverKey = `${f.latitude},${f.longitude}`;
        if (lastServerKey.get(icao) !== serverKey) {
          lastServerKey.set(icao, serverKey);
          const to: [number, number] = [f.latitude, f.longitude];
          const from = display.get(icao) ?? to;
          if (from[0] !== to[0] || from[1] !== to[1]) {
            correction.set(icao, { from, to, start: now });
          } else {
            display.set(icao, to);
          }
        }
      }

      for (const icao of [...display.keys()]) {
        if (!active.has(icao)) {
          display.delete(icao);
          lastServerKey.delete(icao);
          correction.delete(icao);
        }
      }

      const next = new Map<string, [number, number]>();

      for (const icao of active) {
        const f = byIcao.get(icao);
        if (!f || f.latitude == null || f.longitude == null) continue;

        let p = display.get(icao);
        const corr = correction.get(icao);

        if (corr) {
          const t = Math.min(1, (now - corr.start) / CORRECTION_MS);
          const e = 1 - (1 - t) ** 3;
          p = [
            corr.from[0] + (corr.to[0] - corr.from[0]) * e,
            corr.from[1] + (corr.to[1] - corr.from[1]) * e,
          ];
          if (t >= 1) correction.delete(icao);
        } else {
          if (!p) p = [f.latitude, f.longitude];
          else if (
            !f.onGround &&
            f.velocity != null &&
            f.velocity >= MIN_VELOCITY_MS &&
            f.trueTrack != null
          ) {
            p = extrapolateStep(p[0], p[1], f.velocity, f.trueTrack, dt);
          } else {
            p = [f.latitude, f.longitude];
          }
        }

        display.set(icao, p);
        next.set(icao, p);
      }

      if (next.size === 0) {
        if (nonEmptyRef.current) {
          nonEmptyRef.current = false;
          setPositions(new Map());
        }
      } else {
        const wasEmpty = !nonEmptyRef.current;
        nonEmptyRef.current = true;
        if (wasEmpty || now - lastSetState >= STATE_UPDATE_MS) {
          lastSetState = now;
          setPositions(new Map(next));
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return positions;
}
