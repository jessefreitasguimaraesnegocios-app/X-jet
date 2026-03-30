import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Crosshair,
  Mic,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  fetchFlights,
  boundsFromCenterRadiusKm,
  filterFlightsWithinRadiusKm,
} from "./services/flightService";
import {
  fetchFlightRoute,
  type FlightRouteInfo,
} from "./services/flightRouteService";
import { speakText } from "./services/ttsService";
import type { FlightState } from "./types";
import { cn } from "./lib/utils";
import { buildFlightSpeechBriefing } from "./lib/flightSpeech";
import { useLerpedLatLng } from "./hooks/useLerpedLatLng";

const Aircraft3DOverlay = lazy(
  () => import("./components/Aircraft3DOverlay")
);

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

function MapCenter({
  c,
  snapToUser,
}: {
  c: [number, number];
  snapToUser: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    if (!snapToUser) return;
    map.setView(c, map.getZoom());
  }, [c, map, snapToUser]);
  return null;
}

/** Centraliza suavemente no avião quando a posição alvo muda (novo dado ADS-B). */
function MapFollowPlane({
  pos,
  enabled,
}: {
  pos: [number, number] | null;
  enabled: boolean;
}) {
  const map = useMap();
  const prevRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!enabled) {
      prevRef.current = null;
      return;
    }
    if (!pos) return;
    const prev = prevRef.current;
    if (prev && prev[0] === pos[0] && prev[1] === pos[1]) return;
    prevRef.current = pos;
    map.panTo(pos, { animate: true, duration: 0.55 });
  }, [enabled, pos?.[0], pos?.[1], map]);

  return null;
}

function readStoredBool(key: string, defaultVal: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return defaultVal;
    return v === "1" || v === "true";
  } catch {
    return defaultVal;
  }
}

const LS_AUTO_VOICE = "xjet_auto_voice";
const LS_FOLLOW_PLANE = "xjet_follow_plane";

function useSheetHeights() {
  const [heights, setHeights] = useState({
    peek: 168,
    mid: 340,
    full: 520,
  });
  useEffect(() => {
    const upd = () => {
      const v =
        (typeof window !== "undefined" &&
          (window.visualViewport?.height ?? window.innerHeight)) ||
        640;
      setHeights({
        peek: Math.round(156 + 24),
        mid: Math.round(Math.min(v * 0.42, 420)),
        full: Math.round(Math.min(v * 0.85, 680)),
      });
    };
    upd();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", upd);
    window.addEventListener("resize", upd);
    return () => {
      vv?.removeEventListener("resize", upd);
      window.removeEventListener("resize", upd);
    };
  }, []);
  return heights;
}

const SP_FALLBACK: [number, number] = [-23.5505, -46.6333];
const POLL_MS_IDLE = 90_000;
const POLL_MS_PICKED = 12_000;
const TRAIL_MIN_DIST_DEG = 0.0008;

export default function App() {
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radiusKm, setRadiusKm] = useState(100);
  const [flightsPool, setFlightsPool] = useState<FlightState[]>([]);
  const [pick, setPick] = useState<FlightState | null>(null);
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState(() => new Date());
  const [ar, setAr] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoBanner, setGeoBanner] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<FlightRouteInfo | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [autoVoice, setAutoVoice] = useState(() =>
    readStoredBool(LS_AUTO_VOICE, true)
  );
  const [followPlane, setFollowPlane] = useState(() =>
    readStoredBool(LS_FOLLOW_PLANE, true)
  );
  const [show3D, setShow3D] = useState(true);
  const [sheetSnap, setSheetSnap] = useState<0 | 1 | 2>(1);
  const sheetHeights = useSheetHeights();

  const centerRef = useRef(center);
  const abortRef = useRef<AbortController | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const trailPickRef = useRef<string | null>(null);
  const loadedRadiusRef = useRef(0);
  const flightsPoolRef = useRef<FlightState[]>([]);
  const radiusKmRef = useRef(radiusKm);
  const flightCacheCenterKeyRef = useRef<string | null>(null);

  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  useEffect(() => {
    radiusKmRef.current = radiusKm;
  }, [radiusKm]);

  useEffect(() => {
    flightsPoolRef.current = flightsPool;
  }, [flightsPool]);

  const centerKey = useMemo(
    () =>
      center
        ? `${center[0].toFixed(4)},${center[1].toFixed(4)}`
        : null,
    [center]
  );

  const displayFlights = useMemo(() => {
    if (!center) return [];
    return filterFlightsWithinRadiusKm(
      flightsPool,
      center[0],
      center[1],
      radiusKm
    );
  }, [flightsPool, center, radiusKm]);

  const autoVoiceRef = useRef(autoVoice);
  autoVoiceRef.current = autoVoice;

  const pickLive = useMemo(() => {
    if (!pick) return null;
    return flightsPool.find((x) => x.icao24 === pick.icao24) ?? pick;
  }, [pick, flightsPool]);

  const pickTargetPos: [number, number] | null =
    pickLive?.latitude != null && pickLive?.longitude != null
      ? [pickLive.latitude, pickLive.longitude]
      : null;

  const pickAnimPos = useLerpedLatLng(
    pickTargetPos,
    pick?.icao24 ?? null,
    1100
  );

  useEffect(() => {
    if (!pick) return;
    setPick((p) => {
      if (!p) return p;
      const u = flightsPool.find((x) => x.icao24 === p.icao24);
      if (!u) return p;
      if (
        p.latitude === u.latitude &&
        p.longitude === u.longitude &&
        p.baroAltitude === u.baroAltitude &&
        p.velocity === u.velocity &&
        p.trueTrack === u.trueTrack &&
        p.onGround === u.onGround &&
        p.aircraftType === u.aircraftType
      ) {
        return p;
      }
      return u;
    });
  }, [flightsPool, pick?.icao24]);

  useEffect(() => {
    if (pick?.icao24) setSheetSnap(1);
  }, [pick?.icao24]);

  useEffect(() => {
    if (!pickLive || pickLive.latitude == null || pickLive.longitude == null) {
      if (!pick) {
        setTrail([]);
        trailPickRef.current = null;
      }
      return;
    }
    const { icao24 } = pickLive;
    const lat = pickLive.latitude;
    const lon = pickLive.longitude;

    if (trailPickRef.current !== icao24) {
      trailPickRef.current = icao24;
      setTrail([[lat, lon]]);
      return;
    }

    setTrail((prev) => {
      const last = prev[prev.length - 1];
      if (last) {
        const dLat = lat - last[0];
        const dLon = lon - last[1];
        if (dLat * dLat + dLon * dLon < TRAIL_MIN_DIST_DEG * TRAIL_MIN_DIST_DEG) {
          return prev;
        }
      }
      return [...prev, [lat, lon] as [number, number]].slice(-160);
    });
  }, [
    pick,
    pickLive?.icao24,
    pickLive?.latitude,
    pickLive?.longitude,
  ]);

  const loadFlights = useCallback(
    async (opts?: {
      silent?: boolean;
      mode?: "expand" | "poll" | "refresh";
    }) => {
      const pos = centerRef.current;
      if (!pos) return;

      const mode = opts?.mode ?? "expand";
      const rUser = radiusKmRef.current;
      const rLoaded = loadedRadiusRef.current;
      const pool = flightsPoolRef.current;

      if (mode === "expand") {
        if (rLoaded > 0 && rUser <= rLoaded && pool.length > 0) {
          return;
        }
      }

      let fetchR: number;
      if (mode === "refresh") {
        fetchR = rUser;
      } else if (mode === "poll") {
        fetchR = rLoaded === 0 ? rUser : Math.max(rUser, rLoaded);
      } else {
        fetchR = Math.max(rUser, rLoaded);
      }

      const silentExplicit = opts?.silent;
      const silent =
        silentExplicit === true ||
        (silentExplicit !== false &&
          mode !== "refresh" &&
          pool.length > 0);

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      if (!silent) {
        setLoading(true);
        setErr(null);
      }

      try {
        const b = boundsFromCenterRadiusKm(pos[0], pos[1], fetchR);
        const list = await fetchFlights(b, ac.signal);
        if (ac.signal.aborted) return;
        setFlightsPool(list);
        loadedRadiusRef.current = fetchR;
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
    []
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
        setGeoBanner(null);
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
    let cancelled = false;

    const secure =
      typeof window !== "undefined" &&
      (window.isSecureContext ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1");

    if (!secure) {
      setGeoBanner(
        "Use HTTPS (ou localhost) para o navegador liberar o GPS no mapa."
      );
      setCenter(SP_FALLBACK);
      return () => {
        cancelled = true;
      };
    }

    if (!("geolocation" in navigator)) {
      setGeoBanner("Este navegador não suporta geolocalização.");
      setCenter(SP_FALLBACK);
      return () => {
        cancelled = true;
      };
    }

    const readPosition = (options: PositionOptions) =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
      });

    void (async () => {
      try {
        const p = await readPosition({
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 18_000,
        });
        if (!cancelled) {
          setCenter([p.coords.latitude, p.coords.longitude]);
          setGeoBanner(null);
        }
        return;
      } catch {
        /* tenta de novo com modo mais permissivo */
      }
      try {
        const p = await readPosition({
          enableHighAccuracy: false,
          maximumAge: 0,
          timeout: 14_000,
        });
        if (!cancelled) {
          setCenter([p.coords.latitude, p.coords.longitude]);
          setGeoBanner(null);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        setCenter(SP_FALLBACK);
        const pe = e as GeolocationPositionError;
        if (pe?.code === 1) {
          setGeoBanner(
            "Localização negada ou bloqueada. Toque no ícone verde e permita o acesso ao GPS."
          );
        } else {
          setGeoBanner(
            "Não detectamos sua posição (GPS fraco ou timeout). Toque no ícone verde para tentar de novo ao ar livre."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!centerKey) return;
    if (flightCacheCenterKeyRef.current === centerKey) return;
    flightCacheCenterKeyRef.current = centerKey;
    loadedRadiusRef.current = 0;
    flightsPoolRef.current = [];
    setFlightsPool([]);
  }, [centerKey]);

  useEffect(() => {
    if (!centerKey) return;
    void loadFlights({ mode: "expand" });
  }, [centerKey, radiusKm, loadFlights]);

  useEffect(() => {
    const ms = pick ? POLL_MS_PICKED : POLL_MS_IDLE;
    const id = window.setInterval(
      () => void loadFlights({ silent: true, mode: "poll" }),
      ms
    );
    return () => window.clearInterval(id);
  }, [loadFlights, pick]);

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
    if (pick?.icao24 === f.icao24) {
      const next = !followPlane;
      setFollowPlane(next);
      try {
        localStorage.setItem(LS_FOLLOW_PLANE, next ? "true" : "false");
      } catch {
        /* ignore */
      }
      return;
    }

    routeAbortRef.current?.abort();
    const ac = new AbortController();
    routeAbortRef.current = ac;

    setPick(f);
    setShow3D(true);
    setFollowPlane(true);
    try {
      localStorage.setItem(LS_FOLLOW_PLANE, "true");
    } catch {
      /* ignore */
    }
    setRouteInfo(null);
    setRouteLoading(true);
    trailPickRef.current = null;
    if (f.latitude != null && f.longitude != null) {
      setTrail([[f.latitude, f.longitude]]);
      trailPickRef.current = f.icao24;
    } else {
      setTrail([]);
    }

    void loadFlights({ silent: true, mode: "poll" });

    void fetchFlightRoute(f.icao24, f.callsign, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return;
        setRouteInfo(r);
        if (!autoVoiceRef.current) return;
        const fresh =
          flightsPoolRef.current.find((x) => x.icao24 === f.icao24) ?? f;
        speakText(buildFlightSpeechBriefing(fresh, r));
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        if (e instanceof Error && e.name === "AbortError") return;
        setRouteInfo({
          departure: null,
          arrival: null,
          departureName: null,
          arrivalName: null,
        });
        if (!autoVoiceRef.current) return;
        const fresh =
          flightsPoolRef.current.find((x) => x.icao24 === f.icao24) ?? f;
        speakText(buildFlightSpeechBriefing(fresh, null));
      })
      .finally(() => {
        if (!ac.signal.aborted) setRouteLoading(false);
      });
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

  const selectedBearing = pickLive ? bearing(pickLive) : null;
  const northIndicatorDeg = heading != null ? -heading : 0;
  const targetIndicatorDeg =
    heading != null && selectedBearing != null
      ? ((selectedBearing - heading + 540) % 360) - 180
      : 0;

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
            {center && (
              <p className="flex items-center gap-1.5 mt-0.5 text-[10px] font-mono tabular-nums text-emerald-400/95">
                <span className="uppercase tracking-wide text-neutral-500 font-bold">
                  Total
                </span>
                <Plane className="w-3.5 h-3.5 shrink-0" aria-hidden />
                <span>{displayFlights.length}</span>
              </p>
            )}
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
            onClick={() => void loadFlights({ mode: "refresh" })}
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
        {geoBanner && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{ top: "max(4.5rem, env(safe-area-inset-top) + 3rem)" }}
            className="absolute left-1/2 -translate-x-1/2 z-[1100] max-w-[calc(100vw-1.5rem)] px-3 py-2 rounded-xl bg-amber-600/95 text-[11px] font-semibold leading-snug text-center text-neutral-950"
          >
            {geoBanner}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {err && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              top: geoBanner
                ? "max(8.5rem, env(safe-area-inset-top) + 6.5rem)"
                : "max(4.5rem, env(safe-area-inset-top) + 3rem)",
            }}
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
            <MapCenter
              c={center}
              snapToUser={!(followPlane && pick)}
            />
            <MapFollowPlane
              pos={pickTargetPos}
              enabled={Boolean(followPlane && pick && pickTargetPos)}
            />
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
            {displayFlights
              .filter((f) => f.icao24 !== pick?.icao24)
              .map(
                (f) =>
                  f.latitude != null &&
                  f.longitude != null && (
                    <Marker
                      key={f.icao24}
                      position={[f.latitude, f.longitude]}
                      icon={planeIcon(f.trueTrack ?? 0, false)}
                      eventHandlers={{ click: () => onPick(f) }}
                    >
                      <Popup>
                        <div className="text-neutral-900 p-1">
                          <p className="font-bold">{f.callsign}</p>
                          <p className="text-xs text-neutral-500">
                            {f.originCountry}
                          </p>
                        </div>
                      </Popup>
                    </Marker>
                  )
              )}
            {pick &&
              pickTargetPos &&
              pickLive?.latitude != null &&
              pickLive?.longitude != null && (
                <Marker
                  key={`pick-${pick.icao24}`}
                  position={pickAnimPos ?? pickTargetPos}
                  icon={planeIcon(
                    pickLive.trueTrack ?? 0,
                    true
                  )}
                  eventHandlers={{
                    click: () => onPick(pickLive),
                  }}
                >
                  <Popup>
                    <div className="text-neutral-900 p-1">
                      <p className="font-bold">{pickLive.callsign}</p>
                      <p className="text-xs text-neutral-500">
                        {pickLive.originCountry}
                      </p>
                    </div>
                  </Popup>
                </Marker>
              )}
            {trail.length >= 2 && (
              <Polyline
                positions={trail}
                pathOptions={{ color: "#ef4444", weight: 3, opacity: 0.85 }}
              />
            )}
          </MapContainer>
        )}
      </div>

      {pick && show3D && (
        <Suspense fallback={null}>
          <Aircraft3DOverlay
            aircraftType={pickLive?.aircraftType ?? pick.aircraftType}
            callsign={pickLive?.callsign ?? pick.callsign}
            onClose={() => setShow3D(false)}
          />
        </Suspense>
      )}

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
            key="flight-sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 340 }}
            className="absolute inset-x-0 bottom-0 z-[1001] flex flex-col justify-end pointer-events-none"
          >
            <motion.div
              animate={{
                height:
                  sheetSnap === 0
                    ? sheetHeights.peek
                    : sheetSnap === 1
                      ? sheetHeights.mid
                      : sheetHeights.full,
              }}
              transition={{ type: "spring", damping: 36, stiffness: 420 }}
              className="pointer-events-auto flex flex-col min-h-0 rounded-t-3xl bg-neutral-900/97 border-t border-white/10 shadow-2xl overflow-hidden w-full box-border"
              style={{
                paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
              }}
            >
              <motion.div
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={0.18}
                dragMomentum={false}
                onTap={() =>
                  setSheetSnap((s) => (((s + 1) % 3) as 0 | 1 | 2))
                }
                onDragEnd={(_, info) => {
                  const dy = info.offset.y;
                  const vy = info.velocity.y;
                  if (vy > 420 || dy > 56) {
                    setSheetSnap((s) =>
                      s > 0 ? ((s - 1) as 0 | 1 | 2) : 0
                    );
                  } else if (vy < -420 || dy < -56) {
                    setSheetSnap((s) =>
                      s < 2 ? ((s + 1) as 0 | 1 | 2) : 2
                    );
                  }
                }}
                className="shrink-0 flex flex-col items-center pt-2 pb-1 cursor-grab active:cursor-grabbing touch-manipulation select-none"
                style={{ touchAction: "none" }}
              >
                <div className="w-12 h-1.5 rounded-full bg-white/35 mb-1" />
                <p className="text-[9px] text-neutral-500 uppercase tracking-widest">
                  Arraste ou toque ·{" "}
                  {sheetSnap === 0 ? "Mínimo" : sheetSnap === 1 ? "Médio" : "Cheio"}
                </p>
              </motion.div>

              <div className="shrink-0 flex justify-between gap-3 px-4 pb-2 border-b border-white/5">
                <div className="min-w-0">
                  <h2 className="text-xl sm:text-2xl font-black truncate">
                    {pickLive?.callsign ?? pick.callsign}
                  </h2>
                  <p className="text-blue-400 text-[11px] font-mono uppercase truncate">
                    {pickLive?.originCountry ?? pick.originCountry}
                    {(pickLive?.aircraftType ?? pick.aircraftType) && (
                      <span className="text-neutral-500 ml-2">
                        · {pickLive?.aircraftType ?? pick.aircraftType}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    routeAbortRef.current?.abort();
                    setPick(null);
                    setRouteInfo(null);
                    setTrail([]);
                    trailPickRef.current = null;
                  }}
                  className="shrink-0 w-11 h-11 rounded-full bg-white/10 flex items-center justify-center active:scale-95"
                  aria-label="Fechar"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="overflow-y-auto overscroll-contain px-4 pt-3 flex-1 min-h-0">
              <div className="rounded-xl bg-white/5 border border-white/10 divide-y divide-white/10 mb-4">
                <label className="flex items-center justify-between gap-3 px-3 py-3 cursor-pointer touch-manipulation">
                  <span className="flex items-center gap-2 text-sm min-w-0">
                    <Crosshair
                      className="w-4 h-4 shrink-0 text-emerald-400"
                      strokeWidth={2.25}
                    />
                    <span className="leading-tight">
                      Seguir avião no mapa
                      <span className="block text-[10px] text-neutral-500 font-normal">
                        Centraliza quando chegam novas posições
                      </span>
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={followPlane}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setFollowPlane(v);
                      try {
                        localStorage.setItem(LS_FOLLOW_PLANE, v ? "true" : "false");
                      } catch {
                        /* ignore */
                      }
                    }}
                    className="sr-only"
                  />
                  <span
                    className={cn(
                      "shrink-0 w-11 h-6 rounded-full relative transition-colors pointer-events-none",
                      followPlane ? "bg-emerald-600" : "bg-white/20"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
                        followPlane && "translate-x-5"
                      )}
                    />
                  </span>
                </label>
                <label className="flex items-center justify-between gap-3 px-3 py-3 cursor-pointer touch-manipulation">
                  <span className="flex items-center gap-2 text-sm min-w-0">
                    <Mic
                      className="w-4 h-4 shrink-0 text-blue-400"
                      strokeWidth={2.25}
                    />
                    <span className="leading-tight">
                      Narração ao tocar
                      <span className="block text-[10px] text-neutral-500 font-normal">
                        Ouvir continua disponível abaixo
                      </span>
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={autoVoice}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setAutoVoice(v);
                      try {
                        localStorage.setItem(LS_AUTO_VOICE, v ? "true" : "false");
                      } catch {
                        /* ignore */
                      }
                    }}
                    className="sr-only"
                  />
                  <span
                    className={cn(
                      "shrink-0 w-11 h-6 rounded-full relative transition-colors pointer-events-none",
                      autoVoice ? "bg-blue-600" : "bg-white/20"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
                        autoVoice && "translate-x-5"
                      )}
                    />
                  </span>
                </label>
                <label className="flex items-center justify-between gap-3 px-3 py-3 cursor-pointer touch-manipulation">
                  <span className="flex items-center gap-2 text-sm min-w-0">
                    <Plane
                      className="w-4 h-4 shrink-0 text-cyan-300"
                      strokeWidth={2.25}
                    />
                    <span className="leading-tight">
                      Modelo 3D no mapa
                      <span className="block text-[10px] text-neutral-500 font-normal">
                        Arraste a janela e feche quando quiser
                      </span>
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={show3D}
                    onChange={(e) => setShow3D(e.target.checked)}
                    className="sr-only"
                  />
                  <span
                    className={cn(
                      "shrink-0 w-11 h-6 rounded-full relative transition-colors pointer-events-none",
                      show3D ? "bg-cyan-600" : "bg-white/20"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
                        show3D && "translate-x-5"
                      )}
                    />
                  </span>
                </label>
              </div>

              <div className="rounded-xl bg-white/5 border border-white/10 p-3 mb-4">
                <p className="text-[10px] text-neutral-500 uppercase font-bold mb-2">
                  Rota (ADSBDB pelo indicativo)
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-[10px] text-neutral-500 uppercase font-bold">
                      De
                    </span>
                    <p className="font-mono text-amber-200/95 flex items-center gap-1 min-h-[1.25rem]">
                      {routeLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                      ) : (
                        routeInfo?.departure ?? "—"
                      )}
                    </p>
                    {!routeLoading && routeInfo?.departureName && (
                      <p className="text-[11px] text-neutral-400 leading-snug mt-0.5 line-clamp-2">
                        {routeInfo.departureName}
                      </p>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] text-neutral-500 uppercase font-bold">
                      Para
                    </span>
                    <p className="font-mono text-emerald-200/95 flex items-center gap-1 min-h-[1.25rem]">
                      {routeLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                      ) : (
                        routeInfo?.arrival ?? "—"
                      )}
                    </p>
                    {!routeLoading && routeInfo?.arrivalName && (
                      <p className="text-[11px] text-neutral-400 leading-snug mt-0.5 line-clamp-2">
                        {routeInfo.arrivalName}
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-[9px] text-neutral-500 mt-2 leading-snug">
                  Origem e destino vêm da base ADSBDB quando o indicativo do voo é reconhecido.
                  Voos sem cadastro ou indicativo genérico podem aparecer como “—”.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase font-bold">
                    Altitude
                  </span>
                  <p>
                    {Math.round((pickLive ?? pick).baroAltitude ?? 0)} m
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase font-bold">
                    Velocidade
                  </span>
                  <p>
                    {Math.round(((pickLive ?? pick).velocity ?? 0) * 3.6)} km/h
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const f = pickLive ?? pick;
                  void speakText(buildFlightSpeechBriefing(f, routeInfo));
                }}
                className="w-full min-h-12 rounded-xl bg-blue-600 font-bold flex items-center justify-center gap-2 active:scale-[0.99] mb-2"
              >
                <Speaker className="w-5 h-5" /> Ouvir
              </button>
              </div>
            </motion.div>
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
              <span className="absolute top-1 left-1/2 -translate-x-1/2 text-red-500 font-black text-sm">
                N
              </span>
              {!pick ? (
                <div
                  className="absolute inset-0 transition-transform duration-100"
                  style={{ transform: `rotate(${northIndicatorDeg}deg)` }}
                >
                  <div className="absolute inset-0 flex justify-center">
                    <div className="w-1 h-16 mt-3 rounded-full bg-gradient-to-t from-transparent via-blue-500 to-cyan-300" />
                  </div>
                </div>
              ) : (
                <div
                  className="absolute inset-0 transition-transform duration-100"
                  style={{ transform: `rotate(${targetIndicatorDeg}deg)` }}
                >
                  <div className="absolute inset-0 flex justify-center">
                    <div className="w-1.5 h-20 mt-2 rounded-full bg-gradient-to-t from-transparent via-emerald-400 to-red-500" />
                  </div>
                </div>
              )}
              <div className="w-0.5 h-16 bg-gradient-to-t from-transparent to-red-500 rounded-full" />
            </div>
            <p className="mt-6 text-lg font-bold">
              {pick ? `Apontando para ${pick.callsign}` : "Apontando para o Norte"}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {!pick && (
        <div
          className="absolute left-0 right-0 z-[1000] bottom-[max(0.6rem,env(safe-area-inset-bottom))] md:left-6 md:right-auto md:bottom-6 md:w-52"
        >
          <div className="mx-3 md:mx-0 rounded-2xl border border-white/10 bg-neutral-900/95 px-4 py-3 backdrop-blur-md">
            <div className="flex justify-between text-[10px] uppercase font-bold text-neutral-500 mb-1">
              <span>Raio</span>
              <span className="text-blue-400 font-mono">{radiusKm} km</span>
            </div>
            <div className="flex items-center gap-1.5 mb-2 text-[10px] font-mono tabular-nums text-emerald-400">
              <span className="uppercase tracking-wide text-neutral-500 font-bold">
                Total
              </span>
              <Plane className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span>{displayFlights.length}</span>
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
