import {
  TtsClient,
  type EnginesPayload,
  type HealthInfo,
  type VoiceInfo,
  type VoicesPayload,
} from "./audio-client";
import type { EngineId, Settings } from "./types";

const CACHE_KEY = "serverCatalog";

/** Cached catalogs older than this are refreshed, but still shown immediately. */
export const CATALOG_TTL_MS = 5 * 60 * 1000;

export const ENGINE_LABELS: Record<string, string> = {
  auto: "Auto (best available)",
  edge: "Microsoft Edge (online)",
  kokoro: "Kokoro (local)",
  qwen3: "Qwen3-TTS",
  moss: "MOSS-TTS",
  omnivoice: "OmniVoice",
  editx: "Step-Audio-EditX",
  system: "System TTS",
};

/**
 * Voices, engines and health in one blob. Cached so the popup and the in-page
 * player can render their dropdowns on the first frame instead of waiting on
 * three round trips to the local server.
 */
export interface ServerCatalog {
  serverUrl: string;
  fetchedAt: number;
  health: HealthInfo;
  voices: VoicesPayload;
  engines: EnginesPayload;
}

export function isFresh(catalog: ServerCatalog | null, serverUrl: string): boolean {
  if (!catalog || catalog.serverUrl !== serverUrl) return false;
  return Date.now() - catalog.fetchedAt < CATALOG_TTL_MS;
}

export async function readCatalog(): Promise<ServerCatalog | null> {
  try {
    const stored = await chrome.storage.local.get(CACHE_KEY);
    return (stored[CACHE_KEY] as ServerCatalog | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function fetchCatalog(settings: Settings): Promise<ServerCatalog> {
  const serverUrl = settings.serverUrl.replace(/\/$/, "");
  const client = new TtsClient(serverUrl);
  const [health, voices, engines] = await Promise.all([
    client.health(),
    client.voices(),
    client.engines(),
  ]);
  const catalog: ServerCatalog = { serverUrl, fetchedAt: Date.now(), health, voices, engines };
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: catalog });
  } catch {
    /* cache is an optimisation — a write failure must not break playback */
  }
  return catalog;
}

/** Cached copy first, refresh only when stale. */
export async function ensureCatalog(settings: Settings): Promise<ServerCatalog | null> {
  const serverUrl = settings.serverUrl.replace(/\/$/, "");
  const cached = await readCatalog();
  if (isFresh(cached, serverUrl)) return cached;
  try {
    return await fetchCatalog(settings);
  } catch {
    return cached;
  }
}

export function voicesForEngine(voices: VoiceInfo[], engine: EngineId | string): VoiceInfo[] {
  if (engine === "auto") return voices;
  const matches = voices.filter((v) => v.engine === engine || v.id.startsWith(`${engine}:`));
  return matches.length ? matches : voices;
}

export function engineOptionLabel(engine: EnginesPayload["engines"][number]): string {
  const base = ENGINE_LABELS[engine.id] ?? engine.label ?? engine.id;
  if (engine.online === false) return `${base} · offline`;
  if (!engine.available) return `${base} · unavailable`;
  return base;
}
