import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  Polyline,
  Circle,
} from "react-leaflet";
import L from "leaflet";
import {
  Plane,
  X,
  Compass,
  Map as MapIcon,
  Speaker,
  Loader2,
  LocateFixed,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  fetchFlights,
  boundsFromCenterRadiusKm,
} from "./services/flightService";
import { speakText } from "./services/ttsService";
import type { FlightState, FlightDetails } from "./types";
import { cn } from "./lib/utils";

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const PLANE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;

function planeIcon(deg: number, selected: boolean) {
  return L.divIcon({
    html: `<div style="transform:rotate(${deg}deg);color:${selected ? "#ef4444" : "#3b82f6"};width:32px;height:32px">${PLANE_SVG}</div>`,
    className: "custom-plane-icon",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function MapCenter({ c }: { c: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(c, map.getZoom());
  }, [c, map]);
  return null;
}

const SP_FALLBACK: [number, number] = [-23.5505, -46.6333];
const POLL_MS = 90_000;

export default function App() {
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radiusKm, setRadiusKm] = useState(100);
  const [flights, setFlights] = useState<FlightState[]>([]);
  const [pick, setPick] = useState<FlightState | null>(null);
  const [details, setDetails] = useState<FlightDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState(() => new Date());
  const [ar, setAr] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);

  const centerRef = useRef(center);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const pos = centerRef.current;
      if (!pos) return;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const silent = opts?.silent === true;
      if (!silent) setLoading(true);
      setErr(null);

      try {
        const b = boundsFromCenterRadiusKm(pos[0], pos[1], radiusKm);
        const list = await fetchFlights(b, ac.signal);
        if (ac.signal.aborted) return;
        setFlights(list);
        setUpdated(new Date());
      } catch (e: unknown) {
        if (ac.signal.aborted) return;
        const msg =
          e instanceof Error ? e.message : "Não foi possível carregar os voos.";
        setErr(msg);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [radiusKm]
  );

  const requestCurrentLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setErr("Geolocalização não disponível neste aparelho.");
      return;
    }
    setGeoLoading(true);
    setErr(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeoLoading(false);
        setCenter([p.coords.latitude, p.coords.longitude]);
      },
      (e) => {
        setGeoLoading(false);
        if (e.code === e.PERMISSION_DENIED) {
          setErr("Permissão de localização negada.");
        } else if (e.code === e.POSITION_UNAVAILABLE) {
          setErr("Posição indisponível. Tente de novo ao ar livre.");
        } else {
          setErr("Não foi possível obter sua localização.");
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20_000,
      }
    );
  }, []);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setCenter(SP_FALLBACK);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCenter([p.coords.latitude, p.coords.longitude]);
      },
      () => setCenter(SP_FALLBACK),
      {
        enableHighAccuracy: false,
        maximumAge: 300_000,
        timeout: 12_000,
      }
    );
  }, []);

  useEffect(() => {
    if (!center) return;
    void load();
  }, [center, load]);

  useEffect(() => {
    const id = window.setInterval(() => void load({ silent: true }), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const prevR = useRef(radiusKm);
  useEffect(() => {
    if (!center) return;
    if (prevR.current === radiusKm) return;
    prevR.current = radiusKm;
    const t = window.setTimeout(() => void load({ silent: true }), 500);
    return () => window.clearTimeout(t);
  }, [radiusKm, center, load]);

  useEffect(() => {
    if (!ar) return;
    const onOri = (e: DeviceOrientationEvent) => {
      const w = (e as unknown as { webkitCompassHeading?: number })
        .webkitCompassHeading;
      if (w != null) setHeading(w);
      else if (e.alpha != null) setHeading(360 - e.alpha);
    };
    window.addEventListener("deviceorientation", onOri, true);
    return () => window.removeEventListener("deviceorientation", onOri, true);
  }, [ar]);

  const toggleAr = async () => {
    if (ar) {
      setAr(false);
      return;
    }
    const DO = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DO.requestPermission === "function") {
      try {
        const s = await DO.requestPermission();
        if (s !== "granted") return;
      } catch {
        return;
      }
    }
    setAr(true);
  };

  const onPick = (f: FlightState) => {
    setPick(f);
    setDetails({
      icao24: f.icao24,
      model: "—",
      operator: "—",
      capacity: 0,
      origin: "—",
      destination: "—",
      route: f.latitude != null &&
        f.longitude != null && [
          [f.latitude + 0.5, f.longitude - 0.5],
          [f.latitude, f.longitude],
          [f.latitude - 0.5, f.longitude + 0.5],
        ],
    });
    void speakText(`Voo ${f.callsign} selecionado.`);
  };

  const bearing = (f: FlightState) => {
    if (!center || f.latitude == null || f.longitude == null) return 0;
    const φ1 = (center[0] * Math.PI) / 180;
    const φ2 = (f.latitude * Math.PI) / 180;
    const Δλ = ((f.longitude - center[1]) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x =
      Math.cos(φ1) * Math.sin(φ2) -
      Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  };

  return (
    <div className="relative w-full min-h-[100dvh] h-[100dvh] bg-neutral-950 text-white overflow-hidden font-sans">
      <header
        className="absolute top-0 inset-x-0 z-[1000] flex items-center justify-between px-3 gap-2 bg-gradient-to-b from-black/90 to-transparent"
        style={{ paddingTop: "max(0.6rem, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="shrink-0 w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <Plane className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold truncate">X-Jet</h1>
            <p className="text-[10px] text-blue-400 font-mono uppercase">
              Tempo real
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex flex-col items-end text-[9px] text-neutral-400 mr-1 max-w-[4.5rem]">
            <span className="uppercase font-bold">Atualizado</span>
            <span className="font-mono text-white text-[10px]">
              {updated.toLocaleTimeString()}
            </span>
          </div>
          <button
            type="button"
            onClick={() => requestCurrentLocation()}
            disabled={geoLoading}
            className="min-h-9 min-w-9 sm:min-h-11 sm:min-w-11 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center active:scale-95 disabled:opacity-50 touch-manipulation border border-emerald-500/30"
            title="Onde estou agora"
            aria-label="Atualizar minha localização no mapa"
          >
            {geoLoading ? (
              <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
            ) : (
              <LocateFixed className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={2.25} />
            )}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || !center}
            className="min-h-11 min-w-11 rounded-full bg-white/10 flex items-center justify-center active:scale-95 disabled:opacity-40 touch-manipulation"
            aria-label="Atualizar"
          >
            <Loader2 className={cn("w-5 h-5", loading && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={() => void toggleAr()}
            className={cn(
              "min-h-11 min-w-11 rounded-full flex items-center justify-center active:scale-95 touch-manipulation",
              ar ? "bg-red-600" : "bg-white/10"
            )}
            aria-label="Bússola"
          >
            {ar ? <MapIcon className="w-5 h-5" /> : <Compass className="w-5 h-5" />}
          </button>
        </div>
      </header>

      <AnimatePresence>
        {err && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{ top: "max(4.5rem, env(safe-area-inset-top) + 3rem)" }}
            className="absolute left-1/2 -translate-x-1/2 z-[1100] max-w-[calc(100vw-1.5rem)] px-3 py-2 rounded-xl bg-red-600/95 text-[11px] font-semibold leading-snug text-center"
          >
            {err}
          </motion.div>
        )}
      </AnimatePresence>

      {!center && (
        <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center bg-neutral-950 gap-3">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
          <p className="text-xs text-neutral-500 uppercase tracking-widest">
            Obtendo posição…
          </p>
        </div>
      )}

      <div className="absolute inset-0">
        {center && (
          <MapContainer
            center={center}
            zoom={8}
            className="w-full h-full grayscale-[0.15] brightness-[0.85] contrast-[1.15]"
            zoomControl={false}
            scrollWheelZoom
            dragging
            touchZoom
          >
            <TileLayer
              attribution='&copy; OSM &copy; CARTO'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            <MapCenter c={center} />
            <Marker
              position={center}
              icon={L.divIcon({
                html: `<div class="w-3 h-3 bg-blue-500 rounded-full border-2 border-white shadow-[0_0_12px_#3b82f6]"></div>`,
                className: "",
                iconSize: [12, 12],
                iconAnchor: [6, 6],
              })}
            >
              <Popup>Você</Popup>
            </Marker>
            <Circle
              center={center}
              radius={radiusKm * 1000}
              pathOptions={{
                color: "#3b82f6",
                weight: 1,
                fillColor: "#3b82f6",
                fillOpacity: 0.06,
              }}
            />
            {flights.map(
              (f) =>
                f.latitude != null &&
                f.longitude != null && (
                  <Marker
                    key={f.icao24}
                    position={[f.latitude, f.longitude]}
                    icon={planeIcon(f.trueTrack ?? 0, pick?.icao24 === f.icao24)}
                    eventHandlers={{ click: () => onPick(f) }}
                  >
                    <Popup>
                      <div className="text-neutral-900 p-1">
                        <p className="font-bold">{f.callsign}</p>
                        <p className="text-xs text-neutral-500">{f.originCountry}</p>
                      </div>
                    </Popup>
                  </Marker>
                )
            )}
            {pick && details?.route && (
              <Polyline
                positions={details.route}
                pathOptions={{ color: "#ef4444", weight: 2, dashArray: "5 8" }}
              />
            )}
          </MapContainer>
        )}
      </div>

      {loading && (
        <div className="absolute inset-0 z-[2000] bg-black/75 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-11 h-11 text-blue-500 animate-spin" />
          <p className="text-sm tracking-widest uppercase text-neutral-300">
            Carregando voos…
          </p>
        </div>
      )}

      <AnimatePresence>
        {pick && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
            className="absolute inset-x-0 bottom-0 z-[1001] max-h-[min(72dvh,28rem)] flex flex-col rounded-t-3xl bg-neutral-900/97 border-t border-white/10 shadow-2xl"
            style={{
              paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
            }}
          >
            <div className="w-9 h-1 rounded-full bg-white/25 mx-auto mt-3 shrink-0 md:hidden" />
            <div className="overflow-y-auto overscroll-contain px-4 pt-4 flex-1 min-h-0">
              <div className="flex justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <h2 className="text-2xl font-black truncate">{pick.callsign}</h2>
                  <p className="text-blue-400 text-xs font-mono uppercase">
                    {pick.originCountry}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPick(null)}
                  className="shrink-0 w-11 h-11 rounded-full bg-white/10 flex items-center justify-center active:scale-95"
                  aria-label="Fechar"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase font-bold">
                    Altitude
                  </span>
                  <p>{Math.round(pick.baroAltitude ?? 0)} m</p>
                </div>
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase font-bold">
                    Velocidade
                  </span>
                  <p>{Math.round((pick.velocity ?? 0) * 3.6)} km/h</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  speakText(
                    `Voo ${pick.callsign}, altitude ${Math.round(pick.baroAltitude ?? 0)} metros, velocidade ${Math.round((pick.velocity ?? 0) * 3.6)} quilômetros por hora.`
                  )
                }
                className="w-full min-h-12 rounded-xl bg-blue-600 font-bold flex items-center justify-center gap-2 active:scale-[0.99] mb-2"
              >
                <Speaker className="w-5 h-5" /> Ouvir
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {ar && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[1500] bg-black/50 pointer-events-none flex flex-col items-center justify-center px-4"
            style={{
              paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
            }}
          >
            <div
              className="relative rounded-full border-2 border-white/25 flex items-center justify-center w-[min(17rem,82vw)] h-[min(17rem,82vw)] md:w-72 md:h-72"
            >
              <div
                className="absolute inset-0 transition-transform duration-100"
                style={{ transform: `rotate(${-(heading ?? 0)}deg)` }}
              >
                <span className="absolute top-1 left-1/2 -translate-x-1/2 text-red-500 font-black text-sm">
                  N
                </span>
                {flights.map((f) => (
                  <div
                    key={f.icao24}
                    className="absolute inset-0 flex justify-center"
                    style={{ transform: `rotate(${bearing(f)}deg)` }}
                  >
                    <div
                      className={cn(
                        "w-0.5 h-6 mt-3 rounded-full",
                        pick?.icao24 === f.icao24 ? "bg-red-500" : "bg-blue-400"
                      )}
                    />
                  </div>
                ))}
              </div>
              <div className="w-0.5 h-16 bg-gradient-to-t from-transparent to-red-500 rounded-full" />
            </div>
            {pick && (
              <p className="mt-6 text-lg font-bold">{pick.callsign}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!pick && (
        <div
          className="absolute left-0 right-0 z-[1000] bottom-[max(0.6rem,env(safe-area-inset-bottom))] md:left-6 md:right-auto md:bottom-6 md:w-52"
        >
          <div className="mx-3 md:mx-0 rounded-2xl border border-white/10 bg-neutral-900/95 px-4 py-3 backdrop-blur-md">
            <div className="flex justify-between text-[10px] uppercase font-bold text-neutral-500 mb-2">
              <span>Raio</span>
              <span className="text-blue-400 font-mono">{radiusKm} km</span>
            </div>
            <input
              type="range"
              min={10}
              max={500}
              value={radiusKm}
              onChange={(e) => setRadiusKm(+e.target.value)}
              className="w-full h-2 accent-blue-500 touch-manipulation"
            />
          </div>
        </div>
      )}
    </div>
  );
}
