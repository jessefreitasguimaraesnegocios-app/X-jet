import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import type { LocaleData } from "i18n-iso-countries";

countries.registerLocale(enLocale as LocaleData);

function alpha2ToFlagEmoji(alpha2: string): string {
  const c = alpha2.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  const cp = (ch: string) => 0x1f1e6 + (ch.charCodeAt(0) - 65);
  return String.fromCodePoint(cp(c[0]), cp(c[1]));
}

/** OpenSky-style origin country: English name, ISO alpha-2, or "—". */
export function flagEmojiForOriginCountry(originCountry: string): string {
  const raw = originCountry?.trim();
  if (!raw || raw === "—" || raw === "N/A") return "";
  if (/^[A-Za-z]{2}$/.test(raw)) {
    return alpha2ToFlagEmoji(raw);
  }
  const alpha2 = countries.getAlpha2Code(raw, "en");
  if (!alpha2) return "";
  return alpha2ToFlagEmoji(alpha2);
}

export function CountryWithFlag({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const flag = flagEmojiForOriginCountry(name);
  const classes = ["inline-flex items-center gap-1 align-middle", className]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes}>
      {flag ? (
        <span className="shrink-0 text-[1.05em] leading-none" aria-hidden>
          {flag}
        </span>
      ) : null}
      <span className="leading-none">{name}</span>
    </span>
  );
}
