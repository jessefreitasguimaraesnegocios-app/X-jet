/** Interpolação circular em graus (0–360). */
export function lerpAngleDeg(from: number, to: number, t: number): number {
  const d = ((((to - from) % 360) + 540) % 360) - 180;
  return (from + d * t + 360) % 360;
}

export type ParsedHeading = {
  heading: number;
  /** iOS: incerteza em graus (valores menores = mais preciso). */
  accuracyDeg?: number;
};

/**
 * Converte DeviceOrientation em rumo magnético aproximado (topo da tela = frente).
 * Prioriza webkitCompassHeading (iOS); depois orientação absoluta; por fim alpha.
 */
export function parseDeviceHeading(
  e: DeviceOrientationEvent
): ParsedHeading | null {
  const ext = e as unknown as {
    webkitCompassHeading?: number;
    webkitCompassAccuracy?: number;
  };

  if (
    typeof ext.webkitCompassHeading === "number" &&
    Number.isFinite(ext.webkitCompassHeading)
  ) {
    const h = ((ext.webkitCompassHeading % 360) + 360) % 360;
    const acc =
      typeof ext.webkitCompassAccuracy === "number" &&
      Number.isFinite(ext.webkitCompassAccuracy)
        ? Math.abs(ext.webkitCompassAccuracy)
        : undefined;
    return { heading: h, accuracyDeg: acc };
  }

  if (e.alpha != null && Number.isFinite(e.alpha)) {
    const h = ((360 - e.alpha) % 360) + 360;
    return { heading: h % 360 };
  }

  return null;
}
