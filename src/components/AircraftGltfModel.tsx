import React, { Suspense, useMemo } from "react";
import { Center, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import {
  AIRCRAFT_GLB_URL,
  aircraftModelRotation,
  aircraftModelScale,
  classifyAircraftType,
} from "../lib/aircraftModel";
import type { ReactNode } from "react";

useGLTF.preload(AIRCRAFT_GLB_URL);

function CesiumAirInner({
  scale,
  rotation,
}: {
  scale: number;
  rotation: [number, number, number];
}) {
  const { scene } = useGLTF(AIRCRAFT_GLB_URL);
  const clone = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return c;
  }, [scene]);

  return (
    <Center>
      <primitive object={clone} scale={scale} rotation={rotation} />
    </Center>
  );
}

export class AircraftGltfErrorBoundary extends React.Component<
  { children: ReactNode; fallback: ReactNode },
  { err: boolean }
> {
  state = { err: false };

  static getDerivedStateFromError(): { err: boolean } {
    return { err: true };
  }

  render() {
    if (this.state.err) return this.props.fallback;
    return this.props.children;
  }
}

type Props = {
  aircraftType: string | null | undefined;
  fallback: ReactNode;
};

/**
 * Modelo GLB real (Cesium Air) com escala por categoria ICAO.
 */
export function AircraftGltfModel({ aircraftType, fallback }: Props) {
  const variant = classifyAircraftType(aircraftType);
  const scale = aircraftModelScale(variant);
  const rotation = aircraftModelRotation();

  return (
    <AircraftGltfErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <CesiumAirInner scale={scale} rotation={rotation} />
      </Suspense>
    </AircraftGltfErrorBoundary>
  );
}
