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

  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updateFlights = useCallback(async (loc: [number, number], r: number) => {
    try {
      // Approx bounding box for radius in km
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
    } catch (err: any) {
      console.error("Erro ao atualizar voos:", err);
      setError("Limite de requisições atingido. Aguarde um momento antes de tentar novamente.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          setUserLocation(loc);
          updateFlights(loc, radius);
        },
        (err) => {
          console.error("Erro ao obter localização:", err);
          // Fallback location (São Paulo)
          const fallback: [number, number] = [-23.5505, -46.6333];
          setUserLocation(fallback);
          updateFlights(fallback, radius);
        }
      );
    }

    const interval = setInterval(() => {
      if (userLocation && !loading) {
        updateFlights(userLocation, radius);
      }
    }, 30000); // Increased to 30s to avoid 429

    return () => clearInterval(interval);
  }, [radius, updateFlights, userLocation, loading]);

  const handleManualRefresh = () => {
    if (userLocation && !loading) {
      setLoading(true);
      updateFlights(userLocation, radius);
    }
  };

  useEffect(() => {
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
  }, []);

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
    <div className="relative w-full h-screen bg-neutral-950 text-white font-sans overflow-hidden">
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 z-[1000] p-4 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Plane className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">AeroTrack BR</h1>
            <p className="text-xs text-blue-400 font-mono uppercase tracking-widest">Tempo Real</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={handleManualRefresh}
            disabled={loading}
            className="p-3 rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 transition-all"
            title="Atualizar Voos"
          >
            <Loader2 className={cn("w-5 h-5", loading && "animate-spin")} />
          </button>
          <div className="hidden md:flex flex-col items-end">
            <span className="text-[10px] text-neutral-400 uppercase font-bold">Última Atualização</span>
            <span className="text-xs font-mono">{lastUpdate.toLocaleTimeString()}</span>
          </div>
          <button 
            onClick={() => setIsARMode(!isARMode)}
            className={cn(
              "p-3 rounded-full transition-all duration-300",
              isARMode ? "bg-red-600 text-white shadow-lg shadow-red-500/40" : "bg-white/10 text-white hover:bg-white/20"
            )}
          >
            {isARMode ? <MapIcon className="w-5 h-5" /> : <Compass className="w-5 h-5" />}
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
            className="absolute top-20 left-1/2 -translate-x-1/2 z-[1100] bg-red-600/90 backdrop-blur-md px-4 py-2 rounded-full border border-red-400/50 flex items-center gap-2 shadow-lg"
          >
            <Info className="w-4 h-4" />
            <span className="text-xs font-bold">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Map */}
      <div className="w-full h-full">
        {userLocation && (
          <MapContainer 
            center={userLocation} 
            zoom={8} 
            className="w-full h-full grayscale-[0.2] brightness-[0.8] contrast-[1.2]"
            zoomControl={false}
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
              f.latitude && f.longitude && (
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
        <div className="absolute inset-0 z-[2000] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
          <h2 className="text-xl font-light tracking-widest uppercase">Localizando Aeronaves...</h2>
        </div>
      )}

      {/* Flight Details Panel */}
      <AnimatePresence>
        {selectedFlight && (
          <motion.div 
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            className="absolute bottom-0 left-0 right-0 z-[1001] bg-neutral-900/95 backdrop-blur-xl border-t border-white/10 p-6 rounded-t-3xl shadow-2xl"
          >
            <div className="max-w-2xl mx-auto">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-3xl font-black tracking-tighter text-white">{selectedFlight.callsign}</h2>
                  <p className="text-blue-400 font-mono text-sm uppercase">{selectedFlight.originCountry}</p>
                </div>
                <button 
                  onClick={() => setSelectedFlight(null)}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mb-8">
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

              <div className="flex gap-3">
                <button 
                  onClick={() => speakText(`Voo ${selectedFlight.callsign}. Altitude ${Math.round(selectedFlight.baroAltitude || 0)} metros. Velocidade ${Math.round((selectedFlight.velocity || 0) * 3.6)} quilômetros por hora.`)}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
                >
                  <Speaker className="w-5 h-5" /> Ouvir Detalhes
                </button>
                <button className="flex-1 bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95">
                  <Info className="w-5 h-5" /> Mais Info
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
            className="absolute inset-0 z-[1500] bg-black/40 backdrop-blur-[2px] pointer-events-none flex flex-col items-center justify-center"
          >
            {/* Compass Ring */}
            <div className="relative w-80 h-80 border-2 border-white/20 rounded-full flex items-center justify-center">
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

      {/* Radius Control */}
      <div className="absolute bottom-8 left-8 z-[1000] hidden md:block">
        <div className="bg-neutral-900/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 w-48">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] text-neutral-500 uppercase font-bold">Raio de Busca</span>
            <span className="text-xs font-mono text-blue-400">{radius}km</span>
          </div>
          <input 
            type="range" 
            min="10" 
            max="500" 
            value={radius} 
            onChange={(e) => setRadius(parseInt(e.target.value))}
            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
        </div>
      </div>
    </div>
  );
}
