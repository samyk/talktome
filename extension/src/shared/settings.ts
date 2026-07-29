import { DEFAULT_SETTINGS, type Settings } from "./types";

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

export function clampSpeed(speed: number): number {
  const steps = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.5];
  let best = steps[0];
  let dist = Math.abs(speed - best);
  for (const s of steps) {
    const d = Math.abs(speed - s);
    if (d < dist) {
      best = s;
      dist = d;
    }
  }
  return best;
}

export const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.5] as const;
