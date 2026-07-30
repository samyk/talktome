import type { EngineId, Settings } from "./types";

export interface VoiceInfo {
  id: string;
  name: string;
  language: string;
  engine: Exclude<EngineId, "auto">;
  style_hint?: string | null;
  has_prompt?: boolean;
}

export interface HealthInfo {
  ok: boolean;
  version: string;
  engine: string;
  engines_available: string[];
  platform: string;
  message?: string | null;
}

export interface VoicesPayload {
  voices: VoiceInfo[];
  default_voice_id: string;
  emotions: string[];
  styles: string[];
}

export interface EnginesPayload {
  engines: {
    id: string;
    available: boolean;
    online: boolean | null;
    label: string;
  }[];
  preferred: string;
  fallback: string;
  default_voice_id: string;
}

/** Engines that bake the speed multiplier into the audio they return. */
const SERVER_SIDE_SPEED_ENGINES = new Set(["edge", "kokoro"]);

export interface SynthesisResult {
  buffer: ArrayBuffer;
  engine: string;
  format: string;
  /** Speed already present in the audio; residual goes to playbackRate. */
  speedApplied: number;
}

export class TtsClient {
  constructor(private serverUrl: string) {}

  static fromSettings(settings: Settings) {
    return new TtsClient(settings.serverUrl.replace(/\/$/, ""));
  }

  async health(): Promise<HealthInfo> {
    const res = await fetch(`${this.serverUrl}/health`);
    if (!res.ok) throw new Error(`Server health failed (${res.status})`);
    return res.json();
  }

  async voices(): Promise<VoicesPayload> {
    const res = await fetch(`${this.serverUrl}/v1/voices`);
    if (!res.ok) throw new Error(`Voices failed (${res.status})`);
    return res.json();
  }

  async engines(): Promise<EnginesPayload> {
    const res = await fetch(`${this.serverUrl}/v1/engines`);
    if (!res.ok) throw new Error(`Engines failed (${res.status})`);
    return res.json();
  }

  async synthesize(
    text: string,
    opts: {
      voiceId?: string;
      engine?: EngineId;
      emotion?: string | null;
      style?: string | null;
      speed?: number;
    } = {},
  ): Promise<SynthesisResult> {
    const res = await fetch(`${this.serverUrl}/v1/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voice_id: opts.voiceId || undefined,
        engine: opts.engine && opts.engine !== "auto" ? opts.engine : undefined,
        emotion: opts.emotion || undefined,
        style: opts.style || undefined,
        speed: opts.speed,
        format: "wav",
      }),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail || detail;
      } catch {
        /* ignore */
      }
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    const header = (name: string) =>
      res.headers.get(`X-TalkToMe-${name}`) ?? res.headers.get(`X-Listen-${name}`);

    const engineHeader = header("Engine");
    const engine = engineHeader || "unknown";
    const requested = opts.speed ?? 1;
    const reported = res.headers.get("X-TalkToMe-Speed");

    // Guessing wrong here is audible, so bias toward "already applied": that
    // caps playback at the requested speed, where the opposite mistake
    // multiplies it. Headers go missing entirely when the server omits
    // Access-Control-Expose-Headers.
    let speedApplied: number;
    if (reported !== null) {
      speedApplied = Number(reported) || 1;
    } else if (engineHeader === null || SERVER_SIDE_SPEED_ENGINES.has(engine)) {
      speedApplied = requested;
    } else {
      speedApplied = 1;
    }

    return {
      buffer: await res.arrayBuffer(),
      engine,
      format: header("Format") || "wav",
      speedApplied,
    };
  }
}
