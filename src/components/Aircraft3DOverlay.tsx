import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { motion } from "motion/react";
import { X } from "lucide-react";

export function classifyAircraftType(
  t: string | null | undefined
): "narrow" | "wide" | "regional" {
  if (!t) return "narrow";
  const u = t.toUpperCase();
  if (/A388|A35|A346|A343|B744|B748|B77|B78|A330|A332|A333/i.test(u))
    return "wide";
  if (/E1[45]|CRJ|DH8|AT7|B717|E70|E75|SF3/i.test(u)) return "regional";
  return "narrow";
}

function AircraftMesh({ variant }: { variant: "narrow" | "wide" | "regional" }) {
  const { wing, fuse, len, tailW } = useMemo(() => {
    if (variant === "wide")
      return { wing: 2.85, fuse: 0.3, len: 2.25, tailW: 0.95 };
    if (variant === "regional")
      return { wing: 1.65, fuse: 0.14, len: 1.35, tailW: 0.55 };
    return { wing: 2.25, fuse: 0.2, len: 1.85, tailW: 0.75 };
  }, [variant]);

  const body = "#9cbbdf";
  const wingC = "#6b93c9";

  return (
    <group rotation={[0, Math.PI * 0.5, 0]}>
      <mesh position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[fuse * 0.88, fuse, len, 22]} />
        <meshStandardMaterial
          color={body}
          metalness={0.62}
          roughness={0.34}
        />
      </mesh>
      <mesh position={[0, 0, len * 0.06]} castShadow>
        <boxGeometry args={[wing, 0.032, fuse * 2.1]} />
        <meshStandardMaterial
          color={wingC}
          metalness={0.48}
          roughness={0.42}
        />
      </mesh>
      <mesh
        position={[0, fuse * 0.65, -len * 0.44]}
        castShadow
        rotation={[0.55, 0, 0]}
      >
        <boxGeometry args={[tailW, 0.05, 0.2]} />
        <meshStandardMaterial
          color={body}
          metalness={0.58}
          roughness={0.36}
        />
      </mesh>
      <mesh position={[0, 0, len * 0.48]} castShadow>
        <coneGeometry args={[fuse * 0.75, 0.35, 12]} />
        <meshStandardMaterial
          color={wingC}
          metalness={0.55}
          roughness={0.38}
        />
      </mesh>
    </group>
  );
}

type Props = {
  aircraftType: string | null | undefined;
  callsign: string;
  onClose: () => void;
};

/**
 * Vista 3D estilizada (não é scan do avião real). Escala aproximada por categoria ICAO.
 */
export default function Aircraft3DOverlay({
  aircraftType,
  callsign,
  onClose,
}: Props) {
  const variant = classifyAircraftType(aircraftType);

  return (
    <div className="pointer-events-none absolute inset-0 z-[985] flex items-center justify-center px-3">
      <motion.div
        drag
        dragMomentum={false}
        dragElastic={0.12}
        dragConstraints={{ left: -160, right: 160, top: -220, bottom: 220 }}
        whileDrag={{ scale: 1.01 }}
        className="pointer-events-auto relative mt-[-min(18dvh,7rem)] w-[min(92vw,340px)] h-[min(88vw,300px)] sm:h-[min(88vw,320px)] rounded-2xl border border-white/15 bg-black/50 backdrop-blur-md shadow-[0_0_40px_rgba(59,130,246,0.12)] overflow-hidden"
        style={{ touchAction: "none" }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 z-20 w-8 h-8 rounded-full bg-black/55 border border-white/15 flex items-center justify-center text-white active:scale-95"
          aria-label="Fechar modelo 3D"
        >
          <X className="w-4 h-4" />
        </button>
        <Canvas
          shadows
          camera={{ position: [2.65, 1.45, 3.05], fov: 42 }}
          gl={{ alpha: false, antialias: true }}
        >
          <color attach="background" args={["#0a0f18"]} />
          <ambientLight intensity={0.42} />
          <directionalLight
            position={[5, 8, 5]}
            intensity={1.05}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          <spotLight position={[-4, 4, 2]} intensity={0.32} angle={0.45} />
          <Suspense fallback={null}>
            <AircraftMesh variant={variant} />
            <ContactShadows
              position={[0, -0.92, 0]}
              opacity={0.45}
              scale={14}
              blur={2.4}
              far={5}
            />
          </Suspense>
          <OrbitControls
            enablePan={false}
            minPolarAngle={0.35}
            maxPolarAngle={Math.PI - 0.35}
            minDistance={2.1}
            maxDistance={6.5}
            enableDamping
            dampingFactor={0.08}
          />
        </Canvas>
        <div className="absolute bottom-2 left-0 right-0 px-2 text-center space-y-0.5 pointer-events-none">
          <p className="text-[10px] text-neutral-500 uppercase tracking-widest">
            Arraste para girar · 360°
          </p>
          <p className="text-xs font-mono text-blue-300/90 truncate">{callsign}</p>
          {aircraftType ? (
            <p className="text-[10px] text-amber-200/80 font-mono">
              Tipo {aircraftType.toUpperCase()}
            </p>
          ) : (
            <p className="text-[10px] text-neutral-500">
              Modelo genérico (sem tipo ADS-B)
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
