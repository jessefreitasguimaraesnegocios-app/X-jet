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
  Sun,
  Moon,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  fetchFlights,
  boundsFromCenterRadiusKm,
  filterFlightsWithinRadiusKm,
} from "./services/flightService";
import {
  fetchAirports,
  filterAirportsWithinRadiusKm,
} from "./services/airportService";
import { CountryWithFlag } from "./lib/countryFlag";
import {
  fetchFlightRoute,
  type FlightRouteInfo,
} from "./services/flightRouteService";
import { speakText } from "./services/ttsService";
import type { AirportPoi, FlightState } from "./types";
import { cn } from "./lib/utils";
import { buildFlightSpeechBriefing } from "./lib/flightSpeech";
import {
  lerpAngleDeg,
  parseDeviceHeading,
} from "./lib/deviceCompass";
import { useLerpedLatLng } from "./hooks/useLerpedLatLng";
import { CompassHud } from "./components/CompassHud";

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

function planeIcon(deg: number, selected: boolean, isLight: boolean) {
  const base = isLight ? "#0369a1" : "#3b82f6";
  const sel = "#dc2626";
  const c = selected ? sel : base;
  return L.divIcon({
    html: `<div style="transform:rotate(${deg}deg);color:${c};width:32px;height:32px">${PLANE_SVG}</div>`,
    className: "custom-plane-icon",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

const AIRPORT_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;

function airportMapIcon(isLight: boolean) {
  const bg = isLight
    ? "linear-gradient(155deg,#fffdfb 0%,#fde8d4 40%,#fbbf77 100%)"
    : "linear-gradient(155deg,#292524 0%,#78350f 50%,#b45309 100%)";
  const border = isLight ? "rgba(146,64,14,0.4)" : "rgba(251,191,36,0.5)";
  const fg = isLight ? "#9a3412" : "#fef3c7";
  return L.divIcon({
    html: `<div style="width:28px;height:28px;border-radius:10px;background:${bg};border:2px solid ${border};box-shadow:0 4px 14px rgba(0,0,0,0.2),inset 0 1px 0 rgba(255,255,255,0.35);display:flex;align-items:center;justify-content:center;color:${fg}">${AIRPORT_PIN_SVG}</div>`,
    className: "xjet-airport-icon",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function userPositionIcon(isLight: boolean) {
  const fill = isLight ? "#0284c7" : "#3b82f6";
  return L.divIcon({
    html: `<div style="width:12px;height:12px;background:${fill};border-radius:9999px;border:2px solid #fff;box-shadow:0 0 14px ${fill}99"></div>`,
    className: "",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
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
const LS_THEME = "xjet_theme";

function readStoredLight(): boolean {
  try {
    const v = localStorage.getItem(LS_THEME);
    if (v === null) return false;
    return v === "light";
  } catch {
    return false;
  }
}

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
const COMPASS_SMOOTH = 0.22;
/** Janela para distinguir 1 clique (só seguir) de 2 cliques (detalhes + 3D). */
const PLANE_CLICK_DOUBLE_MS = 280;

export default function App() {
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radiusKm, setRadiusKm] = useState(100);
  const [flightsPool, setFlightsPool] = useState<FlightState[]>([]);
  /** Voo com folha de detalhes / rota (duplo clique). */
  const [pick, setPick] = useState<FlightState | null>(null);
  /** ICAO24 em seguimento (1 clique); vários ao mesmo tempo, ordem = prioridade visual. */
  const [trackedIcao24s, setTrackedIcao24s] = useState<string[]>([]);
  const [trailsByIcao, setTrailsByIcao] = useState<
    Record<string, [number, number][]>
  >({});
  /** Avião que o mapa centraliza quando “Seguir” está ligado. */
  const [primaryFollowIcao24, setPrimaryFollowIcao24] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState(() => new Date());
  const [ar, setAr] = useState(false);
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const [compassAccuracy, setCompassAccuracy] = useState<number | null>(null);
  const compassSmoothRef = useRef<number | null>(null);
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
  /** Folha inferior, rota e 3D só após duplo clique no avião. */
  const [pickDetailOpen, setPickDetailOpen] = useState(false);
  const [sheetSnap, setSheetSnap] = useState<0 | 1 | 2>(1);
  const [isLight, setIsLight] = useState(() => readStoredLight());
  const [airportsPool, setAirportsPool] = useState<AirportPoi[]>([]);
  const sheetHeights = useSheetHeights();

  const centerRef = useRef(center);
  const abortRef = useRef<AbortController | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const trackedIcao24sRef = useRef<string[]>([]);
  const loadedRadiusRef = useRef(0);
  const flightsPoolRef = useRef<FlightState[]>([]);
  const radiusKmRef = useRef(radiusKm);
  const flightCacheCenterKeyRef = useRef<string | null>(null);
  const planeClickPendingRef = useRef<{
    timer: number;
    flight: FlightState;
  } | null>(null);

  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  useEffect(() => {
    radiusKmRef.current = radiusKm;
  }, [radiusKm]);

  useEffect(() => {
    flightsPoolRef.current = flightsPool;
  }, [flightsPool]);

  useEffect(() => {
    trackedIcao24sRef.current = trackedIcao24s;
  }, [trackedIcao24s]);

  const trackedSet = useMemo(
    () => new Set(trackedIcao24s),
    [trackedIcao24s]
  );

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

  const displayAirports = useMemo(() => {
    if (!center) return [];
    return filterAirportsWithinRadiusKm(
      airportsPool,
      center[0],
      center[1],
      radiusKm
    );
  }, [airportsPool, center, radiusKm]);

  const hasTrackedInsideRadius = useMemo(
    () => displayFlights.some((f) => trackedSet.has(f.icao24)),
    [displayFlights, trackedSet]
  );

  const autoVoiceRef = useRef(autoVoice);
  autoVoiceRef.current = autoVoice;

  const pickLive = useMemo(() => {
    if (!pick) return null;
    return flightsPool.find((x) => x.icao24 === pick.icao24) ?? pick;
  }, [pick, flightsPool]);

  const primaryFollowFlight = useMemo(() => {
    if (!primaryFollowIcao24) return null;
    return (
      flightsPool.find((x) => x.icao24 === primaryFollowIcao24) ?? null
    );
  }, [primaryFollowIcao24, flightsPool]);

  const pickTargetPos: [number, number] | null =
    primaryFollowFlight?.latitude != null &&
    primaryFollowFlight?.longitude != null
      ? [primaryFollowFlight.latitude, primaryFollowFlight.longitude]
      : null;

  const primaryAnimPos = useLerpedLatLng(
    pickTargetPos,
    primaryFollowIcao24,
    1100
  );

  const compassTargetFlight = useMemo(() => {
    if (pickDetailOpen && pickLive) return pickLive;
    return primaryFollowFlight;
  }, [pickDetailOpen, pickLive, primaryFollowFlight]);

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
    if (pick?.icao24 && pickDetailOpen) setSheetSnap(1);
  }, [pick?.icao24, pickDetailOpen]);

  useEffect(() => {
    return () => {
      const p = planeClickPendingRef.current;
      if (p) clearTimeout(p.timer);
    };
  }, []);

  useEffect(() => {
    if (trackedIcao24s.length === 0) {
      setTrailsByIcao({});
      return;
    }
    setTrailsByIcao((prev) => {
      const next: Record<string, [number, number][]> = {};
      for (const icao of trackedIcao24s) {
        const fl = flightsPool.find((x) => x.icao24 === icao);
        const past = prev[icao];
        if (!fl || fl.latitude == null || fl.longitude == null) {
          if (past?.length) next[icao] = past;
          continue;
        }
        const lat = fl.latitude;
        const lon = fl.longitude;
        if (!past || past.length === 0) {
          next[icao] = [[lat, lon]];
          continue;
        }
        const last = past[past.length - 1];
        const dLat = lat - last[0];
        const dLon = lon - last[1];
        if (
          dLat * dLat + dLon * dLon <
          TRAIL_MIN_DIST_DEG * TRAIL_MIN_DIST_DEG
        ) {
          next[icao] = past;
        } else {
          next[icao] = [...past, [lat, lon] as [number, number]].slice(-160);
        }
      }
      return next;
    });
  }, [flightsPool, trackedIcao24s]);

  useEffect(() => {
    setPrimaryFollowIcao24((cur) => {
      if (trackedIcao24s.length === 0) return null;
      if (cur != null && trackedIcao24s.includes(cur)) return cur;
      return trackedIcao24s[trackedIcao24s.length - 1] ?? null;
    });
  }, [trackedIcao24s]);

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
        void fetchAirports(b, ac.signal)
          .then((ap) => {
            if (!ac.signal.aborted) setAirportsPool(ap);
          })
          .catch(() => {
            if (!ac.signal.aborted) setAirportsPool([]);
          });
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
    setAirportsPool([]);
  }, [centerKey]);

  useEffect(() => {
    if (!centerKey) return;
    void loadFlights({ mode: "expand" });
  }, [centerKey, radiusKm, loadFlights]);

  useEffect(() => {
    const ms =
      trackedIcao24sRef.current.length > 0 || pick
        ? POLL_MS_PICKED
        : POLL_MS_IDLE;
    const id = window.setInterval(
      () => void loadFlights({ silent: true, mode: "poll" }),
      ms
    );
    return () => window.clearInterval(id);
  }, [loadFlights, pick, trackedIcao24s.length]);

  useEffect(() => {
    if (!ar) {
      compassSmoothRef.current = null;
      setCompassHeading(null);
      setCompassAccuracy(null);
      return;
    }
    const onOri = (e: DeviceOrientationEvent) => {
      const parsed = parseDeviceHeading(e);
      if (!parsed) return;
      const prev = compassSmoothRef.current;
      const next =
        prev == null
          ? parsed.heading
          : lerpAngleDeg(prev, parsed.heading, COMPASS_SMOOTH);
      compassSmoothRef.current = next;
      setCompassHeading(next);
      if (
        parsed.accuracyDeg !== undefined &&
        Number.isFinite(parsed.accuracyDeg)
      ) {
        setCompassAccuracy(parsed.accuracyDeg);
      }
    };
    window.addEventListener("deviceorientationabsolute", onOri, true);
    window.addEventListener("deviceorientation", onOri, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", onOri, true);
      window.removeEventListener("deviceorientation", onOri, true);
      compassSmoothRef.current = null;
    };
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

  const onPlaneSingleClick = useCallback(
    (f: FlightState) => {
      const current = trackedIcao24sRef.current;
      const already = current.includes(f.icao24);
      if (already) {
        setTrackedIcao24s((prev) => prev.filter((x) => x !== f.icao24));
        setTrailsByIcao((t) => {
          const n = { ...t };
          delete n[f.icao24];
          return n;
        });
        if (pick?.icao24 === f.icao24) {
          routeAbortRef.current?.abort();
          setPick(null);
          setPickDetailOpen(false);
          setShow3D(false);
          setRouteInfo(null);
          setRouteLoading(false);
        }
        return;
      }

      setTrackedIcao24s((prev) => [...prev, f.icao24]);
      setPrimaryFollowIcao24(f.icao24);
      setFollowPlane(true);
      try {
        localStorage.setItem(LS_FOLLOW_PLANE, "true");
      } catch {
        /* ignore */
      }
      if (f.latitude != null && f.longitude != null) {
        setTrailsByIcao((t) => ({
          ...t,
          [f.icao24]: t[f.icao24] ?? [[f.latitude, f.longitude]],
        }));
      }
      void loadFlights({ silent: true, mode: "poll" });
    },
    [pick?.icao24, loadFlights]
  );

  const onOpenFlightDetail = useCallback(
    (f: FlightState) => {
      routeAbortRef.current?.abort();
      const ac = new AbortController();
      routeAbortRef.current = ac;

      setTrackedIcao24s((prev) =>
        prev.includes(f.icao24) ? prev : [...prev, f.icao24]
      );
      setPrimaryFollowIcao24(f.icao24);
      setPick(f);
      setPickDetailOpen(true);
      setShow3D(true);
      setFollowPlane(true);
      try {
        localStorage.setItem(LS_FOLLOW_PLANE, "true");
      } catch {
        /* ignore */
      }
      setRouteInfo(null);
      setRouteLoading(true);
      if (f.latitude != null && f.longitude != null) {
        setTrailsByIcao((t) => ({
          ...t,
          [f.icao24]: t[f.icao24] ?? [[f.latitude, f.longitude]],
        }));
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
    },
    [loadFlights]
  );

  const handlePlaneMarkerClick = useCallback(
    (f: FlightState) => {
      const pending = planeClickPendingRef.current;
      if (pending) {
        clearTimeout(pending.timer);
        if (pending.flight.icao24 === f.icao24) {
          planeClickPendingRef.current = null;
          onOpenFlightDetail(f);
          return;
        }
        onPlaneSingleClick(pending.flight);
      }
      planeClickPendingRef.current = {
        timer: window.setTimeout(() => {
          planeClickPendingRef.current = null;
          onPlaneSingleClick(f);
        }, PLANE_CLICK_DOUBLE_MS),
        flight: f,
      };
    },
    [onPlaneSingleClick, onOpenFlightDetail]
  );

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

  const selectedBearing =
    compassTargetFlight &&
    center &&
    compassTargetFlight.latitude != null &&
    compassTargetFlight.longitude != null
      ? bearing(compassTargetFlight)
      : null;

  return (
    <div
      className={cn(
        "relative xjet-app w-full min-h-[100dvh] h-[100dvh] overflow-hidden font-sans antialiased",
        isLight
          ? "xjet-app--light bg-[linear-gradient(165deg,#faf8f5_0%,#efe9e1_42%,#e3dbd0_100%)] text-stone-900"
          : "bg-neutral-950 text-white"
      )}
    >
      <header
        className={cn(
          "absolute top-0 inset-x-0 z-[1000] flex items-center justify-between px-3 gap-2",
          isLight
            ? "bg-gradient-to-b from-[#fffdf9]/95 via-stone-100/80 to-transparent border-b border-stone-400/25 shadow-[inset_0_-1px_0_rgba(255,255,255,0.65)]"
            : "bg-gradient-to-b from-black/90 to-transparent"
        )}
        style={{ paddingTop: "max(0.6rem, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "shrink-0 w-10 h-10 rounded-full flex items-center justify-center shadow-lg text-white",
              isLight
                ? "bg-gradient-to-br from-sky-500 via-sky-600 to-sky-800 shadow-sky-600/35"
                : "bg-blue-600 shadow-blue-500/30"
            )}
          >
            <Plane className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold truncate tracking-tight">X-Jet</h1>
            <p
              className={cn(
                "text-[10px] font-mono uppercase",
                isLight ? "text-sky-700" : "text-blue-400"
              )}
            >
              Tempo real
            </p>
            {center && (
              <p
                className={cn(
                  "flex items-center gap-1.5 mt-0.5 text-[10px] font-mono tabular-nums",
                  isLight ? "text-emerald-800" : "text-emerald-400/95"
                )}
              >
                <span
                  className={cn(
                    "uppercase tracking-wide font-bold",
                    isLight ? "text-stone-500" : "text-neutral-500"
                  )}
                >
                  Total
                </span>
                <Plane className="w-3.5 h-3.5 shrink-0" aria-hidden />
                <span>{displayFlights.length}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div
            className={cn(
              "flex flex-col items-end text-[9px] mr-1 max-w-[4.5rem]",
              isLight ? "text-stone-500" : "text-neutral-400"
            )}
          >
            <span className="uppercase font-bold">Atualizado</span>
            <span
              className={cn(
                "font-mono text-[10px]",
                isLight ? "text-stone-800" : "text-white"
              )}
            >
              {updated.toLocaleTimeString()}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setIsLight((v) => {
                const n = !v;
                try {
                  localStorage.setItem(LS_THEME, n ? "light" : "dark");
                } catch {
                  /* ignore */
                }
                return n;
              });
            }}
            className={cn(
              "min-h-11 min-w-11 rounded-full flex items-center justify-center active:scale-95 touch-manipulation border",
              isLight
                ? "bg-amber-100/95 text-amber-900 border-amber-300/55 shadow-sm"
                : "bg-white/10 text-amber-300 border-white/15"
            )}
            title={isLight ? "Modo escuro" : "Modo claro"}
            aria-label={isLight ? "Ativar modo escuro" : "Ativar modo claro"}
          >
            {isLight ? (
              <Moon className="w-5 h-5" strokeWidth={2.25} />
            ) : (
              <Sun className="w-5 h-5" strokeWidth={2.25} />
            )}
          </button>
          <button
            type="button"
            onClick={() => requestCurrentLocation()}
            disabled={geoLoading}
            className={cn(
              "min-h-9 min-w-9 sm:min-h-11 sm:min-w-11 rounded-full flex items-center justify-center active:scale-95 disabled:opacity-50 touch-manipulation border",
              isLight
                ? "bg-emerald-100/90 text-emerald-800 border-emerald-300/50 shadow-sm"
                : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
            )}
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
            className={cn(
              "min-h-11 min-w-11 rounded-full flex items-center justify-center active:scale-95 disabled:opacity-40 touch-manipulation border",
              isLight
                ? "bg-white/85 text-stone-700 border-stone-300/60 shadow-sm"
                : "bg-white/10 border-transparent"
            )}
            aria-label="Atualizar"
          >
            <Loader2 className={cn("w-5 h-5", loading && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={() => void toggleAr()}
            className={cn(
              "min-h-11 min-w-11 rounded-full flex items-center justify-center active:scale-95 touch-manipulation border transition-all duration-200",
              ar
                ? "bg-gradient-to-br from-rose-600 via-amber-600 to-amber-700 text-white border-amber-400/50 shadow-lg shadow-rose-900/35 ring-2 ring-amber-300/35"
                : isLight
                  ? "bg-gradient-to-br from-amber-50 via-stone-50 to-stone-200/95 text-amber-950 border-amber-300/55 shadow-md shadow-amber-900/10"
                  : "bg-gradient-to-br from-slate-700/90 to-slate-900 text-amber-200 border-amber-500/25 shadow-md shadow-black/40"
            )}
            title={ar ? "Fechar bússola" : "Bússola e direção do voo"}
            aria-label={ar ? "Fechar modo bússola" : "Abrir modo bússola"}
            aria-pressed={ar}
          >
            {ar ? (
              <MapIcon className="w-5 h-5 drop-shadow" strokeWidth={2.25} />
            ) : (
              <Compass className="w-5 h-5" strokeWidth={2.25} />
            )}
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
            className={cn(
              "absolute left-1/2 -translate-x-1/2 z-[1100] max-w-[calc(100vw-1.5rem)] px-3 py-2 rounded-xl text-[11px] font-semibold leading-snug text-center",
              isLight
                ? "bg-red-600 text-white shadow-md"
                : "bg-red-600/95"
            )}
          >
            {err}
          </motion.div>
        )}
      </AnimatePresence>

      {!center && (
        <div
          className={cn(
            "absolute inset-0 z-[500] flex flex-col items-center justify-center gap-3",
            isLight ? "bg-[#ebe6df]" : "bg-neutral-950"
          )}
        >
          <Loader2
            className={cn(
              "w-10 h-10 animate-spin",
              isLight ? "text-sky-600" : "text-blue-500"
            )}
          />
          <p
            className={cn(
              "text-xs uppercase tracking-widest",
              isLight ? "text-stone-500" : "text-neutral-500"
            )}
          >
            Obtendo posição…
          </p>
        </div>
      )}

      <div className="absolute inset-0">
        {center && (
          <MapContainer
            center={center}
            zoom={8}
            className={cn(
              "w-full h-full",
              isLight
                ? "brightness-[1.02] contrast-[1.02] saturate-[0.92]"
                : "grayscale-[0.15] brightness-[0.85] contrast-[1.15]"
            )}
            zoomControl={false}
            scrollWheelZoom
            dragging
            touchZoom
          >
            <TileLayer
              attribution={
                isLight ? "&copy; OSM &copy; CARTO Voyager" : "&copy; OSM &copy; CARTO"
              }
              url={
                isLight
                  ? "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                  : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              }
            />
            <MapCenter
              c={center}
              snapToUser={!(followPlane && primaryFollowIcao24)}
            />
            <MapFollowPlane
              pos={pickTargetPos}
              enabled={Boolean(
                followPlane && primaryFollowIcao24 && pickTargetPos
              )}
            />
            <Marker position={center} icon={userPositionIcon(isLight)}>
              <Popup>Você</Popup>
            </Marker>
            <Circle
              center={center}
              radius={radiusKm * 1000}
              pathOptions={
                isLight
                  ? {
                      color: "#0284c7",
                      weight: 2,
                      fillColor: "#0ea5e9",
                      fillOpacity: 0.09,
                    }
                  : {
                      color: "#3b82f6",
                      weight: 1,
                      fillColor: "#3b82f6",
                      fillOpacity: 0.06,
                    }
              }
            />
            {displayAirports.map((a) => (
              <Marker
                key={a.id}
                position={[a.lat, a.lon]}
                icon={airportMapIcon(isLight)}
              >
                <Popup>
                  <div className="xjet-popup-inner p-1 min-w-[8rem]">
                    <p className="font-bold leading-tight">{a.name}</p>
                    {(a.iata || a.icao) && (
                      <p className="text-xs opacity-80 font-mono mt-1">
                        {[a.iata, a.icao].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <p className="text-[10px] opacity-70 mt-1">Aeroporto (OSM)</p>
                  </div>
                </Popup>
              </Marker>
            ))}
            {displayFlights.map(
              (f) =>
                f.latitude != null &&
                f.longitude != null && (
                  <Marker
                    key={f.icao24}
                    position={
                      f.icao24 === primaryFollowIcao24
                        ? (primaryAnimPos ?? [f.latitude, f.longitude])
                        : [f.latitude, f.longitude]
                    }
                    icon={planeIcon(
                      f.trueTrack ?? 0,
                      trackedSet.has(f.icao24),
                      isLight
                    )}
                    eventHandlers={{
                      click: () => handlePlaneMarkerClick(f),
                      dblclick: (e) => {
                        L.DomEvent.stopPropagation(e);
                      },
                    }}
                  >
                    <Popup>
                      <div className="p-1 min-w-[6rem]">
                        <p className="font-bold">{f.callsign}</p>
                        <p className="text-xs opacity-75">
                          <CountryWithFlag
                            name={f.originCountry}
                            callsign={f.callsign}
                            className="inline-flex items-center"
                          />
                        </p>
                      </div>
                    </Popup>
                  </Marker>
                )
            )}
            {trackedIcao24s.map((icao) => {
              const pts = trailsByIcao[icao];
              if (!pts || pts.length < 2) return null;
              return (
                <Polyline
                  key={`trail-${icao}`}
                  positions={pts}
                  pathOptions={{ color: "#ef4444", weight: 3, opacity: 0.85 }}
                />
              );
            })}
          </MapContainer>
        )}
      </div>

      {pick && pickDetailOpen && show3D && (
        <Suspense fallback={null}>
          <Aircraft3DOverlay
            aircraftType={pickLive?.aircraftType ?? pick.aircraftType}
            callsign={pickLive?.callsign ?? pick.callsign}
            onClose={() => setShow3D(false)}
          />
        </Suspense>
      )}

      {loading && (
        <div
          className={cn(
            "absolute inset-0 z-[2000] flex flex-col items-center justify-center gap-3",
            isLight ? "bg-stone-900/35 backdrop-blur-[2px]" : "bg-black/75"
          )}
        >
          <Loader2
            className={cn(
              "w-11 h-11 animate-spin",
              isLight ? "text-sky-600" : "text-blue-500"
            )}
          />
          <p
            className={cn(
              "text-sm tracking-widest uppercase",
              isLight ? "text-stone-700" : "text-neutral-300"
            )}
          >
            Carregando voos…
          </p>
        </div>
      )}

      <AnimatePresence>
        {pick && pickDetailOpen && (
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
              className={cn(
                "pointer-events-auto flex flex-col min-h-0 rounded-t-3xl border-t shadow-2xl overflow-hidden w-full box-border",
                isLight
                  ? "bg-[#faf7f2]/[0.97] border-stone-300/50 text-stone-900"
                  : "bg-neutral-900/97 border-white/10"
              )}
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
                <div
                  className={cn(
                    "w-12 h-1.5 rounded-full mb-1",
                    isLight ? "bg-stone-400/45" : "bg-white/35"
                  )}
                />
                <p
                  className={cn(
                    "text-[9px] uppercase tracking-widest",
                    isLight ? "text-stone-500" : "text-neutral-500"
                  )}
                >
                  Arraste ou toque ·{" "}
                  {sheetSnap === 0 ? "Mínimo" : sheetSnap === 1 ? "Médio" : "Cheio"}
                </p>
              </motion.div>

              <div
                className={cn(
                  "shrink-0 flex justify-between gap-3 px-4 pb-2 border-b",
                  isLight ? "border-stone-200/80" : "border-white/5"
                )}
              >
                <div className="min-w-0">
                  <h2 className="text-xl sm:text-2xl font-black truncate">
                    {pickLive?.callsign ?? pick.callsign}
                  </h2>
                  <p
                    className={cn(
                      "text-[11px] font-mono uppercase truncate",
                      isLight ? "text-sky-700" : "text-blue-400"
                    )}
                  >
                    <CountryWithFlag
                      name={pickLive?.originCountry ?? pick.originCountry}
                      callsign={pickLive?.callsign ?? pick.callsign}
                      className="inline-flex items-center"
                    />
                    {(pickLive?.aircraftType ?? pick.aircraftType) && (
                      <span
                        className={cn(
                          "ml-2",
                          isLight ? "text-stone-500" : "text-neutral-500"
                        )}
                      >
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
                    setPickDetailOpen(false);
                    setShow3D(false);
                    setRouteInfo(null);
                    setRouteLoading(false);
                  }}
                  className={cn(
                    "shrink-0 w-11 h-11 rounded-full flex items-center justify-center active:scale-95 border",
                    isLight
                      ? "bg-stone-200/80 border-stone-300/60 text-stone-800"
                      : "bg-white/10 border-transparent"
                  )}
                  aria-label="Fechar"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="overflow-y-auto overscroll-contain px-4 pt-3 flex-1 min-h-0">
              <div
                className={cn(
                  "rounded-xl border mb-4 divide-y",
                  isLight
                    ? "bg-white/60 border-stone-300/50 divide-stone-200/90"
                    : "bg-white/5 border-white/10 divide-white/10"
                )}
              >
                <label className="flex items-center justify-between gap-3 px-3 py-3 cursor-pointer touch-manipulation">
                  <span className="flex items-center gap-2 text-sm min-w-0">
                    <Crosshair
                      className={cn(
                        "w-4 h-4 shrink-0",
                        isLight ? "text-emerald-700" : "text-emerald-400"
                      )}
                      strokeWidth={2.25}
                    />
                    <span className="leading-tight">
                      Seguir avião no mapa
                      <span
                        className={cn(
                          "block text-[10px] font-normal",
                          isLight ? "text-stone-500" : "text-neutral-500"
                        )}
                      >
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
                      followPlane
                        ? "bg-emerald-600"
                        : isLight
                          ? "bg-stone-300/80"
                          : "bg-white/20"
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
                      className={cn(
                        "w-4 h-4 shrink-0",
                        isLight ? "text-sky-600" : "text-blue-400"
                      )}
                      strokeWidth={2.25}
                    />
                    <span className="leading-tight">
                      Narração ao tocar
                      <span
                        className={cn(
                          "block text-[10px] font-normal",
                          isLight ? "text-stone-500" : "text-neutral-500"
                        )}
                      >
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
                      autoVoice
                        ? "bg-blue-600"
                        : isLight
                          ? "bg-stone-300/80"
                          : "bg-white/20"
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
                      className={cn(
                        "w-4 h-4 shrink-0",
                        isLight ? "text-cyan-700" : "text-cyan-300"
                      )}
                      strokeWidth={2.25}
                    />
                    <span className="leading-tight">
                      Modelo 3D no mapa
                      <span
                        className={cn(
                          "block text-[10px] font-normal",
                          isLight ? "text-stone-500" : "text-neutral-500"
                        )}
                      >
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
                      show3D
                        ? "bg-cyan-600"
                        : isLight
                          ? "bg-stone-300/80"
                          : "bg-white/20"
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

              <div
                className={cn(
                  "rounded-xl border p-3 mb-4",
                  isLight
                    ? "bg-white/55 border-stone-300/50"
                    : "bg-white/5 border-white/10"
                )}
              >
                <p
                  className={cn(
                    "text-[10px] uppercase font-bold mb-2",
                    isLight ? "text-stone-500" : "text-neutral-500"
                  )}
                >
                  Rota (ADSBDB pelo indicativo)
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span
                      className={cn(
                        "text-[10px] uppercase font-bold",
                        isLight ? "text-stone-500" : "text-neutral-500"
                      )}
                    >
                      De
                    </span>
                    <p
                      className={cn(
                        "font-mono flex items-center gap-1 min-h-[1.25rem]",
                        isLight ? "text-amber-900" : "text-amber-200/95"
                      )}
                    >
                      {routeLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                      ) : (
                        routeInfo?.departure ?? "—"
                      )}
                    </p>
                    {!routeLoading && routeInfo?.departureName && (
                      <p
                        className={cn(
                          "text-[11px] leading-snug mt-0.5 line-clamp-2",
                          isLight ? "text-stone-600" : "text-neutral-400"
                        )}
                      >
                        {routeInfo.departureName}
                      </p>
                    )}
                  </div>
                  <div>
                    <span
                      className={cn(
                        "text-[10px] uppercase font-bold",
                        isLight ? "text-stone-500" : "text-neutral-500"
                      )}
                    >
                      Para
                    </span>
                    <p
                      className={cn(
                        "font-mono flex items-center gap-1 min-h-[1.25rem]",
                        isLight ? "text-emerald-900" : "text-emerald-200/95"
                      )}
                    >
                      {routeLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                      ) : (
                        routeInfo?.arrival ?? "—"
                      )}
                    </p>
                    {!routeLoading && routeInfo?.arrivalName && (
                      <p
                        className={cn(
                          "text-[11px] leading-snug mt-0.5 line-clamp-2",
                          isLight ? "text-stone-600" : "text-neutral-400"
                        )}
                      >
                        {routeInfo.arrivalName}
                      </p>
                    )}
                  </div>
                </div>
                <p
                  className={cn(
                    "text-[9px] mt-2 leading-snug",
                    isLight ? "text-stone-500" : "text-neutral-500"
                  )}
                >
                  Origem e destino vêm da base ADSBDB quando o indicativo do voo é reconhecido.
                  Voos sem cadastro ou indicativo genérico podem aparecer como “—”.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div>
                  <span
                    className={cn(
                      "text-[10px] uppercase font-bold",
                      isLight ? "text-stone-500" : "text-neutral-500"
                    )}
                  >
                    Altitude
                  </span>
                  <p>
                    {Math.round((pickLive ?? pick).baroAltitude ?? 0)} m
                  </p>
                </div>
                <div>
                  <span
                    className={cn(
                      "text-[10px] uppercase font-bold",
                      isLight ? "text-stone-500" : "text-neutral-500"
                    )}
                  >
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
            key="compass-shell"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="absolute inset-0 z-[1500] pointer-events-none"
          >
            <CompassHud
              isLight={isLight}
              pick={compassTargetFlight}
              headingDeg={compassHeading}
              targetBearingDeg={selectedBearing}
              accuracyDeg={compassAccuracy}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {(trackedIcao24s.length === 0 || !hasTrackedInsideRadius) && (
        <div
          className="absolute left-0 right-0 z-[1000] bottom-[max(0.6rem,env(safe-area-inset-bottom))] md:left-6 md:right-auto md:bottom-6 md:w-52"
        >
          <div
            className={cn(
              "mx-3 md:mx-0 rounded-2xl border px-4 py-3 backdrop-blur-md shadow-lg",
              isLight
                ? "border-stone-300/60 bg-[#fffcf7]/90 shadow-stone-400/15"
                : "border-white/10 bg-neutral-900/95"
            )}
          >
            <div
              className={cn(
                "flex justify-between text-[10px] uppercase font-bold mb-1",
                isLight ? "text-stone-500" : "text-neutral-500"
              )}
            >
              <span>Raio</span>
              <span
                className={cn(
                  "font-mono",
                  isLight ? "text-sky-700" : "text-blue-400"
                )}
              >
                {radiusKm} km
              </span>
            </div>
            <div
              className={cn(
                "flex items-center gap-1.5 mb-2 text-[10px] font-mono tabular-nums",
                isLight ? "text-emerald-800" : "text-emerald-400"
              )}
            >
              <span
                className={cn(
                  "uppercase tracking-wide font-bold",
                  isLight ? "text-stone-500" : "text-neutral-500"
                )}
              >
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
              className={cn(
                "w-full h-2 touch-manipulation xjet-range",
                isLight ? "accent-sky-600" : "accent-blue-500"
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}
