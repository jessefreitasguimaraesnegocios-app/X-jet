import { Navigation } from "lucide-react";
import { cn } from "../lib/utils";
import type { FlightState } from "../types";

type Props = {
  isLight: boolean;
  pick: FlightState | null;
  /** Rumo suavizado (graus), ou null se o sensor ainda não enviou. */
  headingDeg: number | null;
  /** Rumo absoluto do usuário até o alvo (graus), se houver voo selecionado. */
  targetBearingDeg: number | null;
  /** Precisão da bússola (iOS), em graus; null se desconhecida. */
  accuracyDeg: number | null;
};

const TICKS = Array.from({ length: 36 }, (_, i) => i * 10);

export function CompassHud({
  isLight,
  pick,
  headingDeg,
  targetBearingDeg,
  accuracyDeg,
}: Props) {
  const roseRotate =
    headingDeg == null ? 0 : -headingDeg;
  const showTarget =
    pick != null &&
    headingDeg != null &&
    targetBearingDeg != null;
  const targetNeedleRotate =
    showTarget
      ? ((targetBearingDeg! - headingDeg! + 540) % 360) - 180
      : 0;

  const degLabel =
    headingDeg != null ? `${Math.round(headingDeg)}°` : "—°";
  const needsCalibration =
    accuracyDeg != null && accuracyDeg > 22;

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center px-4 pointer-events-none",
        isLight
          ? "bg-gradient-to-b from-stone-200/40 via-amber-50/25 to-stone-300/35"
          : "bg-gradient-to-b from-black/55 via-slate-950/45 to-black/60"
      )}
      style={{
        paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
      }}
    >
      <div
        className={cn(
          "relative flex items-center justify-center rounded-full p-1 shadow-2xl",
          isLight
            ? "bg-gradient-to-br from-[#fffefb] via-stone-100 to-stone-300/90 ring-2 ring-amber-200/60 ring-offset-2 ring-offset-stone-100/80"
            : "bg-gradient-to-br from-slate-800 via-slate-900 to-black ring-2 ring-cyan-500/25 ring-offset-2 ring-offset-black/40"
        )}
        style={{
          width: "min(19rem, 88vw)",
          height: "min(19rem, 88vw)",
          maxWidth: "19rem",
          maxHeight: "19rem",
        }}
      >
        {/* Rosa dos ventos (alinhada ao norte magnético aproximado) */}
        <div
          className="absolute inset-[7%] rounded-full transition-transform duration-150 ease-out will-change-transform"
          style={{ transform: `rotate(${roseRotate}deg)` }}
        >
          <svg
            viewBox="0 0 200 200"
            className={cn(
              "h-full w-full",
              isLight ? "text-stone-700" : "text-stone-200"
            )}
            aria-hidden
          >
            <circle
              cx="100"
              cy="100"
              r="92"
              fill="none"
              stroke="currentColor"
              strokeOpacity={isLight ? 0.35 : 0.45}
              strokeWidth="1.5"
            />
            {TICKS.map((deg) => {
              const rad = ((deg - 90) * Math.PI) / 180;
              const major = deg % 30 === 0;
              const r1 = major ? 78 : 84;
              const r2 = 92;
              const x1 = 100 + r1 * Math.cos(rad);
              const y1 = 100 + r1 * Math.sin(rad);
              const x2 = 100 + r2 * Math.cos(rad);
              const y2 = 100 + r2 * Math.sin(rad);
              return (
                <line
                  key={deg}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="currentColor"
                  strokeWidth={major ? 2.2 : 1}
                  strokeOpacity={major ? 0.85 : 0.45}
                />
              );
            })}
            <text
              x="100"
              y="34"
              textAnchor="middle"
              className="fill-red-500 font-black"
              style={{ fontSize: "17px" }}
            >
              N
            </text>
            <text
              x="166"
              y="106"
              textAnchor="middle"
              fill="currentColor"
              className="font-bold"
              style={{ fontSize: "13px", opacity: 0.75 }}
            >
              E
            </text>
            <text
              x="100"
              y="178"
              textAnchor="middle"
              fill="currentColor"
              className="font-bold"
              style={{ fontSize: "13px", opacity: 0.75 }}
            >
              S
            </text>
            <text
              x="34"
              y="106"
              textAnchor="middle"
              fill="currentColor"
              className="font-bold"
              style={{ fontSize: "13px", opacity: 0.75 }}
            >
              W
            </text>
          </svg>
        </div>

        {/* Agulha do alvo (voo selecionado) */}
        {showTarget && (
          <div
            className="absolute inset-0 z-[5] flex justify-center pt-[9%] transition-transform duration-150 ease-out will-change-transform"
            style={{ transform: `rotate(${targetNeedleRotate}deg)` }}
          >
            <div className="flex flex-col items-center">
              <div className="mb-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500 shadow-md ring-2 ring-white/60" />
              <div
                className={cn(
                  "h-[7.25rem] w-1.5 shrink-0 rounded-full bg-gradient-to-b from-emerald-300 via-amber-300 to-rose-500 shadow-lg",
                  isLight ? "shadow-rose-400/40" : "shadow-rose-900/50"
                )}
              />
            </div>
          </div>
        )}

        {/* Referência de proa: topo do aparelho = frente */}
        <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-px drop-shadow-md">
          <div
            className="h-0 w-0 border-x-[13px] border-x-transparent border-b-[20px] border-b-red-600"
            style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))" }}
          />
        </div>

        <div
          className={cn(
            "absolute left-1/2 top-1/2 z-[4] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-md",
            isLight
              ? "border-white bg-stone-800 shadow-stone-400/50"
              : "border-white/90 bg-stone-900"
          )}
        />

        <div
          className={cn(
            "absolute bottom-[10%] left-0 right-0 z-[6] text-center font-mono text-[10px] uppercase tracking-[0.2em]",
            isLight ? "text-stone-500" : "text-neutral-400"
          )}
        >
          Topo = frente
        </div>
      </div>

      <div className="mt-5 flex max-w-sm flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-2">
          <Navigation
            className={cn(
              "h-5 w-5 shrink-0",
              isLight ? "text-sky-700" : "text-sky-400"
            )}
            strokeWidth={2.25}
          />
          <p
            className={cn(
              "font-mono text-3xl font-bold tabular-nums tracking-tight",
              isLight ? "text-stone-900" : "text-white"
            )}
          >
            {degLabel}
          </p>
        </div>
        <p
          className={cn(
            "text-base font-semibold leading-snug",
            isLight ? "text-stone-800" : "text-white"
          )}
        >
          {pick
            ? `Aponte o topo do celular na direção de ${(pick.callsign?.trim() || "—")}`
            : "Gire até o N vermelho alinhar à seta (topo = frente)"}
        </p>
        {headingDeg == null && (
          <p
            className={cn(
              "text-xs",
              isLight ? "text-amber-800" : "text-amber-200/90"
            )}
          >
            Aguardando sensor de orientação…
          </p>
        )}
        {needsCalibration && (
          <p
            className={cn(
              "rounded-lg px-3 py-1.5 text-[11px] font-medium leading-snug",
              isLight
                ? "bg-amber-100/95 text-amber-950 border border-amber-300/60"
                : "bg-amber-950/90 text-amber-100 border border-amber-600/40"
            )}
          >
            Precisão baixa: mova o aparelho em forma de <strong>8</strong> para
            calibrar a bússola.
          </p>
        )}
      </div>
    </div>
  );
}
