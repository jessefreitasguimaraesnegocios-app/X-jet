import { useEffect, useRef, useState } from "react";

/**
 * Interpola suavemente até [lat, lng] quando o alvo muda (mesmo `pickKey`).
 * Ao mudar `pickKey`, encaixa direto no novo alvo.
 */
export function useLerpedLatLng(
  target: [number, number] | null,
  pickKey: string | null,
  durationMs = 1200
): [number, number] | null {
  const [out, setOut] = useState<[number, number] | null>(null);
  const rafRef = useRef<number>(0);
  const pickKeyRef = useRef<string | null>(null);
  const outRef = useRef<[number, number] | null>(null);
  outRef.current = out;

  useEffect(() => {
    if (!target || !pickKey) {
      pickKeyRef.current = null;
      cancelAnimationFrame(rafRef.current);
      setOut(null);
      return;
    }

    if (pickKeyRef.current !== pickKey) {
      pickKeyRef.current = pickKey;
      cancelAnimationFrame(rafRef.current);
      setOut(target);
      return;
    }

    const cur = outRef.current;
    if (!cur) {
      setOut(target);
      return;
    }
    if (cur[0] === target[0] && cur[1] === target[1]) return;

    cancelAnimationFrame(rafRef.current);
    const from = cur;
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const e = 1 - (1 - t) ** 3;
      const lat = from[0] + (target[0] - from[0]) * e;
      const lon = from[1] + (target[1] - from[1]) * e;
      setOut([lat, lon]);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [target?.[0], target?.[1], pickKey, durationMs]);

  return out;
}
