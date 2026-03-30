/**
 * TTS via Web Speech API (grátis no navegador, sem chave de API).
 * Chrome/Edge/Safari costumam ter voz pt-BR; no mobile depende do SO.
 */

function pickPortugueseVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  const norm = (l: string) => l.toLowerCase().replace(/_/g, "-");
  return (
    voices.find((v) => norm(v.lang) === "pt-br") ||
    voices.find((v) => norm(v.lang).startsWith("pt")) ||
    null
  );
}

/**
 * Lê o texto em voz alta. Chamadas seguidas cancelam a anterior.
 */
export function speakText(text: string): void {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    if (import.meta.env.DEV) {
      console.warn("[X-Jet] Web Speech API não disponível neste ambiente.");
    }
    return;
  }

  const trimmed = text.trim();
  if (!trimmed) return;

  const synth = window.speechSynthesis;

  const run = () => {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(trimmed);
    u.lang = "pt-BR";
    u.rate = 0.92;
    u.pitch = 1;
    const voice = pickPortugueseVoice(synth.getVoices());
    if (voice) u.voice = voice;
    synth.speak(u);
  };

  if (synth.getVoices().length > 0) {
    run();
    return;
  }

  synth.addEventListener("voiceschanged", run, { once: true });
  window.setTimeout(() => {
    if (synth.getVoices().length > 0) run();
  }, 400);
}

export function isSpeechSynthesisSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined"
  );
}
