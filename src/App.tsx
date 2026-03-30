import React, { useState, useEffect, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline, Circle } from "react-leaflet";
import L from "leaflet";
import { Plane, Navigation, Info, X, Compass, Map as MapIcon, Speaker, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { fetchFlights } from "./services/flightService";
import { speakText } from "./services/ttsService";
import { FlightState, FlightDetails } from "./types";
import { cn } from "./lib/utils";

// Fix Leaflet marker icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const PLANE_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
</svg>
`;

const createPlaneIcon = (rotation: number, isSelected: boolean) => {
  return L.divIcon({
    html: `<div style="transform: rotate(${rotation}deg); color: ${isSelected ? '#ef4444' : '#3b82f6'}; width: 32px; height: 32px;">${PLANE_ICON_SVG}</div>`,
    className: "custom-plane-icon",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

const MapUpdater = ({ center }: { center: [number, number] }) => {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
};

export default function App() {
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [flights, setFlights] = useState<FlightState[]>([]);
  const [selectedFlight, setSelectedFlight] = useState<FlightState | null>(null);
  const [flightDetails, setFlightDetails] = useState<FlightDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const [isARMode, setIsARMode] = useState(false);
  const [radius, setRadius] = useState(100); // km
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);

  const locationRef = useRef<[number, number] | null>(null);
  const radiusRef = useRef(radius);
  const prevRadiusRef = useRef(radius);
  const fetchInFlightRef = useRef(false);

  useEffect(() => {
    radiusRef.current = radius;
  }, [radius]);

  /** Uma requisição por vez; evita rajadas que disparam 429 na OpenSky. */
  const updateFlights = useCallback(async (opts?: { silent?: boolean }) => {
    const loc = locationRef.current;
    if (!loc) return;
    if (fetchInFlightRef.current) return;

    fetchInFlightRef.current = true;
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
    }

    const r = radiusRef.current;
    try {
      const latDelta = r / 111;
      const lonDelta = r / (111 * Math.cos(loc[0] * (Math.PI / 180)));

      const bounds = {
        lamin: loc[0] - latDelta,
        lomin: loc[1] - lonDelta,
        lamax: loc[0] + latDelta,
        lomax: loc[1] + lonDelta,
      };

      const data = await fetchFlights(bounds);
      setFlights(data);
      setLastUpdate(new Date());
      setError(null);
    } catch (err: unknown) {
      console.error("Erro ao atualizar voos:", err);
      const msg =
        err instanceof Error
          ? err.message
          : "Não foi possível atualizar os voos. Verifique a conexão.";
      setError(msg);
    } finally {
      fetchInFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const fallbackLoc: [number, number] = [-23.5505, -46.6333];

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          locationRef.current = loc;
          setUserLocation(loc);
          void updateFlights();
        },
        (err) => {
          if (import.meta.env.DEV) {
            console.warn("Geolocalização indisponível, usando São Paulo:", err.code, err.message);
          }
          locationRef.current = fallbackLoc;
          setUserLocation(fallbackLoc);
          void updateFlights();
        },
        {
          enableHighAccuracy: false,
          maximumAge: 300_000,
          timeout: 12_000,
        }
      );
    } else {
      locationRef.current = fallbackLoc;
      setUserLocation(fallbackLoc);
      void updateFlights();
    }
  }, [updateFlights]);

  useEffect(() => {
    const POLL_MS = 120_000;
    const id = window.setInterval(() => {
      if (locationRef.current) {
        void updateFlights({ silent: true });
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [updateFlights]);

  useEffect(() => {
    if (!locationRef.current) return;
    if (prevRadiusRef.current === radius) return;
    prevRadiusRef.current = radius;
    const t = window.setTimeout(() => {
      void updateFlights({ silent: true });
    }, 700);
    return () => window.clearTimeout(t);
  }, [radius, updateFlights]);

  const handleManualRefresh = () => {
    if (locationRef.current) {
      void updateFlights({ silent: false });
    }
  };

  useEffect(() => {
    if (!isARMode) return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const webkitHeading = (e as any).webkitCompassHeading;
      if (webkitHeading !== undefined) {
        setCompassHeading(webkitHeading);
      } else if (e.alpha !== null) {
        setCompassHeading(360 - e.alpha);
      }
    };

    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => window.removeEventListener("deviceorientation", handleOrientation);
  }, [isARMode]);

  const toggleARMode = useCallback(async () => {
    if (isARMode) {
      setIsARMode(false);
      return;
    }
    const DO = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<PermissionState>;
    };
    if (typeof DO.requestPermission === "function") {
      try {
        const state = await DO.requestPermission();
        if (state !== "granted") return;
      } catch {
        return;
      }
    }
    setIsARMode(true);
  }, [isARMode]);

  const handleFlightSelect = (flight: FlightState) => {
    setSelectedFlight(flight);
    // Mock details for demo (OpenSky doesn't provide these easily)
    setFlightDetails({
      icao24: flight.icao24,
      model: "Boeing 737-800",
      operator: "Companhia Aérea Exemplo",
      capacity: 189,
      origin: "São Paulo (GRU)",
      destination: "Rio de Janeiro (GIG)",
      route: [
        [flight.latitude! + 1, flight.longitude! - 1],
        [flight.latitude!, flight.longitude!],
        [flight.latitude! - 1, flight.longitude! + 1],
      ]
    });
    
    speakText(`Voo ${flight.callsign} selecionado. Modelo Boeing 737-800, operado por Companhia Aérea Exemplo.`);
  };

  const getBearingToFlight = (flight: FlightState) => {
    if (!userLocation || !flight.latitude || !flight.longitude) return 0;
    const lat1 = userLocation[0] * (Math.PI / 180);
    const lon1 = userLocation[1] * (Math.PI / 180);
    const lat2 = flight.latitude * (Math.PI / 180);
    const lon2 = flight.longitude * (Math.PI / 180);
    
    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    const bearing = (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
    return bearing;
  };

  return (
    <div className="relative w-full min-h-[100dvh] h-[100dvh] bg-neutral-950 text-white font-sans overflow-hidden">
      {/* Header */}
      <header
        className="absolute top-0 left-0 right-0 z-[1000] flex justify-between items-center bg-gradient-to-b from-black/85 to-transparent px-3 sm:px-4"
        style={{
          paddingTop: "max(0.75rem, env(safe-area-inset-top))",
          paddingBottom: "0.5rem",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="shrink-0 w-10 h-10 sm:w-11 sm:h-11 bg-blue-600 rounded-full flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Plane className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold tracking-tight truncate">X-Jet</h1>
            <p className="text-[10px] sm:text-xs text-blue-400 font-mono uppercase tracking-widest truncate">
              Tempo real
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <div className="flex flex-col items-end pr-0.5 md:pr-0">
            <span className="text-[8px] sm:text-[10px] text-neutral-400 uppercase font-bold leading-tight">
              Atualizado
            </span>
            <span className="text-[10px] sm:text-xs font-mono tabular-nums">
              {lastUpdate.toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={loading}
            className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95 disabled:opacity-50 transition-all touch-manipulation"
            title="Atualizar voos"
            aria-label="Atualizar voos"
          >
            <Loader2 className={cn("w-5 h-5 mx-auto", loading && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={() => void toggleARMode()}
            className={cn(
              "min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 p-3 rounded-full transition-all duration-300 touch-manipulation active:scale-95",
              isARMode
                ? "bg-red-600 text-white shadow-lg shadow-red-500/40"
                : "bg-white/10 text-white hover:bg-white/20"
            )}
            title={isARMode ? "Ver mapa" : "Modo bússola"}
            aria-label={isARMode ? "Ver mapa" : "Modo bússola"}
          >
            {isARMode ? <MapIcon className="w-5 h-5 mx-auto" /> : <Compass className="w-5 h-5 mx-auto" />}
          </button>
        </div>
      </header>

      {/* Error Banner */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{ top: "max(5rem, calc(env(safe-area-inset-top) + 3.5rem))" }}
            className="absolute left-1/2 -translate-x-1/2 z-[1100] max-w-[min(100vw-1.5rem,24rem)] bg-red-600/90 backdrop-blur-md px-3 py-2.5 rounded-2xl border border-red-400/50 flex items-start gap-2 shadow-lg"
          >
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="text-[11px] sm:text-xs font-bold leading-snug text-left">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Map */}
      <div className="w-full h-full">
        {userLocation && (
          <MapContainer
            center={userLocation}
            zoom={8}
            className="w-full h-full grayscale-[0.2] brightness-[0.8] contrast-[1.2] touch-pan-x touch-pan-y"
            zoomControl={false}
            scrollWheelZoom={true}
            dragging={true}
            touchZoom={true}
            doubleClickZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            <MapUpdater center={userLocation} />
            
            {/* User Location */}
            <Marker position={userLocation} icon={L.divIcon({
              html: `<div class="w-4 h-4 bg-blue-500 rounded-full border-2 border-white animate-pulse shadow-[0_0_15px_rgba(59,130,246,0.8)]"></div>`,
              className: "user-location-icon",
              iconSize: [16, 16],
              iconAnchor: [8, 8]
            })}>
              <Popup>Você está aqui</Popup>
            </Marker>

            <Circle 
              center={userLocation} 
              radius={radius * 1000} 
              pathOptions={{ color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.05 }} 
            />

            {/* Flights */}
            {flights.map((f) => (
              f.latitude != null &&
              f.longitude != null && (
                <Marker 
                  key={f.icao24} 
                  position={[f.latitude, f.longitude]} 
                  icon={createPlaneIcon(f.trueTrack || 0, selectedFlight?.icao24 === f.icao24)}
                  eventHandlers={{
                    click: () => handleFlightSelect(f)
                  }}
                >
                  <Popup className="bg-neutral-900 border-none rounded-lg overflow-hidden">
                    <div className="p-2 text-neutral-900">
                      <p className="font-bold text-lg">{f.callsign}</p>
                      <p className="text-xs text-neutral-500">{f.originCountry}</p>
                    </div>
                  </Popup>
                </Marker>
              )
            ))}

            {/* Trajectory */}
            {selectedFlight && flightDetails?.route && (
              <Polyline 
                positions={flightDetails.route} 
                pathOptions={{ color: '#ef4444', weight: 2, dashArray: '5, 10' }} 
              />
            )}
          </MapContainer>
        )}
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-[2000] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center px-6 text-center">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
          <h2 className="text-base sm:text-xl font-light tracking-widest uppercase">
            Localizando aeronaves…
          </h2>
        </div>
      )}

      {/* Flight Details Panel */}
      <AnimatePresence>
        {selectedFlight && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="absolute bottom-0 left-0 right-0 z-[1001] bg-neutral-900/95 backdrop-blur-xl border-t border-white/10 px-4 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6 rounded-t-3xl shadow-2xl max-h-[min(78dvh,32rem)] flex flex-col"
          >
            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-4 shrink-0 md:hidden" aria-hidden />
            <div className="max-w-2xl mx-auto w-full overflow-y-auto overscroll-contain min-h-0 flex-1">
              <div className="flex justify-between items-start mb-4 sm:mb-6 gap-3">
                <div className="min-w-0">
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tighter text-white truncate">
                    {selectedFlight.callsign}
                  </h2>
                  <p className="text-blue-400 font-mono text-sm uppercase">{selectedFlight.originCountry}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedFlight(null)}
                  className="shrink-0 min-h-11 min-w-11 flex items-center justify-center bg-white/5 hover:bg-white/10 active:scale-95 rounded-full transition-colors touch-manipulation"
                  aria-label="Fechar"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
                <div className="space-y-1">
                  <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Modelo</span>
                  <p className="text-sm font-medium">{flightDetails?.model || "Desconhecido"}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Altitude</span>
                  <p className="text-sm font-medium">{Math.round(selectedFlight.baroAltitude || 0)} m</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Velocidade</span>
                  <p className="text-sm font-medium">{Math.round((selectedFlight.velocity || 0) * 3.6)} km/h</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Capacidade</span>
                  <p className="text-sm font-medium">{flightDetails?.capacity || "--"} passageiros</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Origem</span>
                  <p className="text-sm font-medium">{flightDetails?.origin || "N/A"}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Destino</span>
                  <p className="text-sm font-medium">{flightDetails?.destination || "N/A"}</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() =>
                    speakText(
                      `Voo ${selectedFlight.callsign}. Altitude ${Math.round(selectedFlight.baroAltitude || 0)} metros. Velocidade ${Math.round((selectedFlight.velocity || 0) * 3.6)} quilômetros por hora.`
                    )
                  }
                  className="flex-1 min-h-12 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] touch-manipulation"
                >
                  <Speaker className="w-5 h-5 shrink-0" /> Ouvir detalhes
                </button>
                <button
                  type="button"
                  className="flex-1 min-h-12 bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] touch-manipulation"
                >
                  <Info className="w-5 h-5 shrink-0" /> Mais info
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AR / Compass Overlay */}
      <AnimatePresence>
        {isARMode && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[1500] bg-black/40 backdrop-blur-[2px] pointer-events-none flex flex-col items-center justify-center px-4"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            {/* Compass Ring — escala no mobile */}
            <div className="relative w-[min(17.5rem,88vw)] h-[min(17.5rem,88vw)] sm:w-72 sm:h-72 md:w-80 md:h-80 border-2 border-white/20 rounded-full flex items-center justify-center">
              <div 
                className="absolute inset-0 transition-transform duration-100"
                style={{ transform: `rotate(${- (compassHeading || 0)}deg)` }}
              >
                <div className="absolute top-2 left-1/2 -translate-x-1/2 text-red-500 font-black">N</div>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white/50 font-bold">S</div>
                <div className="absolute left-2 top-1/2 -translate-y-1/2 text-white/50 font-bold">W</div>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50 font-bold">E</div>
                
                {/* Markers for nearby flights */}
                {flights.map(f => {
                  const bearing = getBearingToFlight(f);
                  return (
                    <div 
                      key={f.icao24}
                      className="absolute inset-0 flex items-start justify-center"
                      style={{ transform: `rotate(${bearing}deg)` }}
                    >
                      <div className={cn(
                        "w-1 h-8 mt-4 rounded-full",
                        selectedFlight?.icao24 === f.icao24 ? "bg-red-500 shadow-[0_0_10px_red]" : "bg-blue-400"
                      )} />
                    </div>
                  );
                })}
              </div>
              
              {/* Center Indicator */}
              <div className="w-1 h-20 bg-gradient-to-t from-transparent to-red-500 rounded-full animate-pulse" />
              
              <div className="absolute -bottom-20 text-center">
                <p className="text-2xl font-mono font-bold">{Math.round(compassHeading || 0)}°</p>
                <p className="text-[10px] uppercase tracking-widest text-neutral-400">Rumo Atual</p>
              </div>
            </div>

            {/* Selected Flight Pointer */}
            {selectedFlight && (
              <div className="mt-32 text-center">
                <p className="text-sm text-red-400 font-bold uppercase tracking-widest mb-1">Alvo Selecionado</p>
                <p className="text-3xl font-black">{selectedFlight.callsign}</p>
                <p className="text-xs text-neutral-400">Aponte seu dispositivo para o marcador vermelho</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Raio: barra full-width no mobile (acima da home indicator), card no desktop */}
      {!selectedFlight && (
        <div className="absolute left-0 right-0 z-[1000] bottom-[max(0.75rem,env(safe-area-inset-bottom))] md:left-8 md:right-auto md:bottom-8 md:w-48">
          <div className="mx-3 md:mx-0 bg-neutral-900/92 backdrop-blur-md px-4 py-3 md:p-4 rounded-2xl border border-white/10 shadow-lg">
            <div className="flex justify-between items-center mb-2 gap-2">
              <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wide">
                Raio de busca
              </span>
              <span className="text-xs font-mono text-blue-400 tabular-nums">{radius} km</span>
            </div>
            <input
              type="range"
              min={10}
              max={500}
              value={radius}
              onChange={(e) => setRadius(parseInt(e.target.value, 10))}
              className="w-full h-2 md:h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500 touch-manipulation"
            />
          </div>
        </div>
      )}
    </div>
  );
}
