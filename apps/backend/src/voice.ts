/**
 * Reader TTS via ElevenLabs — server-only synthesis.
 * Pattern adapted from the peer wrapper voiceSynthesisPort.
 */

export type ReaderVoicePack = "default" | "narrative" | "noir" | "soft";

export type SynthesizedSpeech = Readonly<{
  audioBase64: string;
  mimeType: string;
}>;

export type VoiceSynthesisPort = Readonly<{
  synthesize(
    text: string,
    pack?: ReaderVoicePack
  ): Promise<SynthesizedSpeech | null>;
}>;

export const DEFAULT_VOICE_IDS: Readonly<Record<ReaderVoicePack, string>> = {
  default: "EXAVITQu4vr4xnSDxMaL",
  narrative: "pNInz6obpgDQGcFmaJgB",
  noir: "VR6AewLTigWG4xSOukaG",
  soft: "jBpfuIE2acCO8z3wKNLl"
};

type FetchResponseLike = Readonly<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

type FetchLike = (
  url: string,
  init: Readonly<{
    method: string;
    headers: Record<string, string>;
    body: string;
  }>
) => Promise<FetchResponseLike>;

export type ElevenLabsVoicePortOptions = Readonly<{
  model?: string;
  maxChars?: number;
  fetchFn?: FetchLike;
  env?: NodeJS.ProcessEnv;
}>;

const DEFAULT_MODEL = "eleven_turbo_v2_5";
const DEFAULT_MAX_CHARS = 2_400;
const API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const MIME = "audio/mpeg";

export function toReaderVoicePack(hint?: string): ReaderVoicePack {
  return hint === "narrative" || hint === "noir" || hint === "soft"
    ? hint
    : "default";
}

export function resolveVoiceId(
  pack: ReaderVoicePack = "default",
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env[`ELEVENLABS_VOICE_${pack.toUpperCase()}`];
  return (override && override.trim()) || DEFAULT_VOICE_IDS[pack];
}

export class ElevenLabsVoicePort implements VoiceSynthesisPort {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxChars: number;
  private readonly fetchFn: FetchLike;
  private readonly env: NodeJS.ProcessEnv;

  constructor(apiKey: string, options: ElevenLabsVoicePortOptions = {}) {
    this.apiKey = apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    this.fetchFn = options.fetchFn ?? (fetch as unknown as FetchLike);
    this.env = options.env ?? process.env;
  }

  static fromEnvOrUndefined(
    options: ElevenLabsVoicePortOptions = {}
  ): ElevenLabsVoicePort | undefined {
    const env = options.env ?? process.env;
    const apiKey = env.ELEVENLABS_API_KEY;
    return apiKey
      ? new ElevenLabsVoicePort(apiKey, { ...options, env })
      : undefined;
  }

  async synthesize(
    text: string,
    pack: ReaderVoicePack = "default"
  ): Promise<SynthesizedSpeech | null> {
    const clean = text.trim().slice(0, this.maxChars);
    if (clean.length === 0) return null;
    const voiceId = resolveVoiceId(pack, this.env);
    try {
      const response = await this.fetchFn(
        `${API_BASE}/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": this.apiKey,
            "Content-Type": "application/json",
            Accept: MIME
          },
          body: JSON.stringify({
            text: clean,
            model_id: this.model,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
          })
        }
      );
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) return null;
      return { audioBase64: buffer.toString("base64"), mimeType: MIME };
    } catch {
      return null;
    }
  }
}
