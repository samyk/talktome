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
  ): Promise<{ buffer: ArrayBuffer; engine: string; format: string }> {
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
    return {
      buffer: await res.arrayBuffer(),
      engine: res.headers.get("X-Listen-Engine") || "unknown",
      format: res.headers.get("X-Listen-Format") || "wav",
    };
  }
}
