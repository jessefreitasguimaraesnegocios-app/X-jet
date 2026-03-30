import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function speakText(text: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Diga de forma clara e informativa: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      const binary = atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: "audio/pcm;rate=24000" });
      
      // Since it's raw PCM 24kHz, we need to handle it properly.
      // For simplicity in a web app, we can use AudioContext.
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const buffer = audioCtx.createBuffer(1, bytes.length / 2, 24000);
      const channelData = buffer.getChannelData(0);
      
      // PCM 16-bit is 2 bytes per sample
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < channelData.length; i++) {
        channelData[i] = view.getInt16(i * 2, true) / 32768;
      }
      
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start();
    }
  } catch (error) {
    console.error("Erro no TTS:", error);
  }
}
