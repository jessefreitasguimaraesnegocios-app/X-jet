/** Categoria para escala / fallback quando não há GLB específico por tipo. */
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

function publicAsset(path: string): string {
  const base = import.meta.env.BASE_URL;
  const p = path.startsWith("/") ? path.slice(1) : path;
  return base.endsWith("/") ? `${base}${p}` : `${base}/${p}`;
}

/** GLB empacotado em `public/` (Cesium Air — ver ATTRIBUTION.md). */
export const AIRCRAFT_GLB_URL = publicAsset("models/aircraft/cesium-air.glb");

export function aircraftModelScale(variant: "narrow" | "wide" | "regional"): number {
  switch (variant) {
    case "wide":
      return 1.28;
    case "regional":
      return 0.74;
    default:
      return 1;
  }
}

/** Rotação [x,y,z] em radianos para alinhar com a câmera/orbit. */
export function aircraftModelRotation(): [number, number, number] {
  return [0, Math.PI, 0];
}
