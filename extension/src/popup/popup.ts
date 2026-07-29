import { TtsClient } from "../shared/audio-client";
import { SPEED_OPTIONS, getSettings, saveSettings } from "../shared/settings";
import type { EngineId, ExtensionMessage } from "../shared/types";

const enginePill = document.getElementById("engine")!;
const statusEl = document.getElementById("status")!;
const speedEl = document.getElementById("speed") as HTMLSelectElement;
const voiceEl = document.getElementById("voice") as HTMLSelectElement;
const engineEl = document.getElementById("engine-select") as HTMLSelectElement;

const ENGINE_LABELS: Record<string, string> = {
  auto: "Auto (Edge → local fallback)",
  edge: "Microsoft Edge (online)",
  kokoro: "Kokoro (local)",
  qwen3: "Qwen3-TTS",
  moss: "MOSS-TTS",
  omnivoice: "OmniVoice",
  editx: "Step-Audio-EditX",
  system: "System TTS",
};

for (const s of SPEED_OPTIONS) {
  const opt = document.createElement("option");
  opt.value = String(s);
  opt.textContent = `${s}×`;
  speedEl.appendChild(opt);
}

async function send(message: ExtensionMessage) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, message);
}

function fillVoices(
  voices: { id: string; name: string; engine: string }[],
  engine: string,
  selected: string,
) {
  const filtered =
    engine === "auto" ? voices : voices.filter((v) => v.engine === engine || v.id.startsWith(`${engine}:`));
  const list = filtered.length ? filtered : voices;
  voiceEl.innerHTML = "";
  for (const v of list) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.name;
    voiceEl.appendChild(opt);
  }
  if (list.some((v) => v.id === selected)) voiceEl.value = selected;
  else if (list[0]) voiceEl.value = list[0].id;
}

async function init() {
  const settings = await getSettings();
  speedEl.value = String(settings.speed);

  try {
    const client = TtsClient.fromSettings(settings);
    const [health, voices, engines] = await Promise.all([
      client.health(),
      client.voices(),
      client.engines(),
    ]);

    enginePill.textContent = health.engine;
    enginePill.classList.toggle("bad", !health.ok);
    statusEl.textContent = health.message || `Connected · ${health.platform}`;

    engineEl.innerHTML = "";
    const autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = ENGINE_LABELS.auto;
    engineEl.appendChild(autoOpt);
    for (const e of engines.engines) {
      const opt = document.createElement("option");
      opt.value = e.id;
      const online =
        e.online === false ? " · offline" : e.online === true ? " · online" : e.available ? "" : " · unavailable";
      opt.textContent = `${e.label}${online}`;
      opt.disabled = !e.available && e.id !== "edge";
      engineEl.appendChild(opt);
    }
    engineEl.value = settings.engine || "auto";

    // Migrate old robotic / kokoro defaults toward Aria when Edge is up
    let voiceId = settings.voiceId;
    const edgeOnline = engines.engines.find((e) => e.id === "edge")?.online;
    if (
      !voiceId ||
      voiceId === "system:Albert" ||
      voiceId === "default" ||
      (edgeOnline && voiceId.startsWith("kokoro:") && settings.engine === "auto")
    ) {
      voiceId = voices.default_voice_id || "edge:en-US-AriaNeural";
      await saveSettings({ voiceId, engine: settings.engine || "auto" });
    }

    fillVoices(voices.voices, engineEl.value, voiceId);
  } catch (err) {
    enginePill.textContent = "offline";
    enginePill.classList.add("bad");
    statusEl.textContent =
      err instanceof Error
        ? `${err.message}. Start server: cd server && uvicorn app.main:app --port 8765`
        : "Server offline";
  }
}

document.getElementById("play-page")!.addEventListener("click", () => void send({ type: "PLAY_PAGE" }));
document.getElementById("play-selection")!.addEventListener("click", () => void send({ type: "PLAY_SELECTION" }));
document.getElementById("toggle")!.addEventListener("click", () => void send({ type: "TOGGLE_PLAY" }));

speedEl.addEventListener("change", async () => {
  const speed = Number(speedEl.value);
  const settings = await saveSettings({ speed });
  await send({ type: "SET_SPEED", speed });
  await send({ type: "SETTINGS_UPDATED", settings });
});

engineEl.addEventListener("change", async () => {
  const engine = engineEl.value as EngineId;
  const client = TtsClient.fromSettings(await getSettings());
  const voices = await client.voices();
  fillVoices(voices.voices, engine, voiceEl.value);
  // Prefer Aria when switching to edge/auto
  if ((engine === "edge" || engine === "auto") && voices.voices.some((v) => v.id === "edge:en-US-AriaNeural")) {
    voiceEl.value = "edge:en-US-AriaNeural";
  }
  const settings = await saveSettings({ engine, voiceId: voiceEl.value });
  await send({ type: "SETTINGS_UPDATED", settings });
});

voiceEl.addEventListener("change", async () => {
  const settings = await saveSettings({ voiceId: voiceEl.value });
  await send({ type: "SETTINGS_UPDATED", settings });
});

document.getElementById("options")!.addEventListener("click", (e) => {
  e.preventDefault();
  void chrome.runtime.openOptionsPage();
});

document.getElementById("library")!.addEventListener("click", (e) => {
  e.preventDefault();
  void chrome.runtime.openOptionsPage();
});

void init();
