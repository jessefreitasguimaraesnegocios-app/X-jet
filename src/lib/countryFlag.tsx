import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import type { LocaleData } from "i18n-iso-countries";

countries.registerLocale(enLocale as LocaleData);

const CALLSIGN_PREFIX_TO_COUNTRY: Record<string, { alpha2: string; name: string }> = {
  AZU: { alpha2: "BR", name: "Brazil" },
  GLO: { alpha2: "BR", name: "Brazil" },
  TAM: { alpha2: "BR", name: "Brazil" },
};

/** OpenSky-style origin country: English name, ISO alpha-2, or "—". */
export function alpha2ForOriginCountry(originCountry: string): string {
  const raw = originCountry?.trim();
  if (!raw || raw === "—" || raw === "N/A") return "";
  if (/^[A-Za-z]{2}$/.test(raw)) {
    return raw.toUpperCase();
  }
  const alpha2 = countries.getAlpha2Code(raw, "en");
  if (!alpha2) return "";
  return alpha2.toUpperCase();
}

export function CountryWithFlag({
  name,
  callsign,
  className,
}: {
  name: string;
  callsign?: string;
  className?: string;
}) {
  const normalizedName = name?.trim() || "—";
  const callsignPrefix = (callsign ?? "").trim().toUpperCase().slice(0, 3);
  const inferred = CALLSIGN_PREFIX_TO_COUNTRY[callsignPrefix];
  const alpha2 = alpha2ForOriginCountry(normalizedName) || inferred?.alpha2 || "";
  const isUnknown = !alpha2;
  const displayName =
    normalizedName !== "—" && normalizedName !== "N/A"
      ? normalizedName
      : inferred?.name || "País desconhecido";
  const flagUrl = alpha2 ? `https://flagcdn.com/20x15/${alpha2.toLowerCase()}.png` : "";
  const classes = ["inline-flex items-center gap-1 align-middle", className]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes}>
      {flagUrl ? (
        <img
          src={flagUrl}
          alt={`Bandeira de ${normalizedName}`}
          loading="lazy"
          className="h-[12px] w-[16px] shrink-0 rounded-[2px] border border-black/15 object-cover"
        />
      ) : (
        <span className="shrink-0 text-[1.05em] leading-none" aria-hidden>
          🏳️
        </span>
      )}
      <span className="leading-none">{isUnknown ? "País desconhecido" : displayName}</span>
    </span>
  );
}
