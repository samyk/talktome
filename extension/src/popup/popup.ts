import {
  type ServerCatalog,
  engineOptionLabel,
  fetchCatalog,
  isFresh,
  readCatalog,
  voicesForEngine,
} from "../shared/catalog";
import { SPEED_OPTIONS, getSettings, saveSettings } from "../shared/settings";
import type { EngineId, ExtensionMessage, Settings } from "../shared/types";

const enginePill = document.getElementById("engine")!;
const statusEl = document.getElementById("status")!;
const speedEl = document.getElementById("speed") as HTMLSelectElement;
const voiceEl = document.getElementById("voice") as HTMLSelectElement;
const engineEl = document.getElementById("engine-select") as HTMLSelectElement;

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

function fillVoices(catalog: ServerCatalog, engine: string, selected: string) {
  const list = voicesForEngine(catalog.voices.voices, engine);
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

function render(catalog: ServerCatalog, settings: Settings, stale: boolean) {
  enginePill.textContent = catalog.health.engine;
  enginePill.classList.toggle("bad", !catalog.health.ok);
  statusEl.textContent = catalog.health.message || `Connected · ${catalog.health.platform}`;
  statusEl.classList.toggle("stale", stale);

  engineEl.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "auto";
  auto.textContent = "Auto (best available)";
  engineEl.appendChild(auto);
  for (const engine of catalog.engines.engines) {
    const opt = document.createElement("option");
    opt.value = engine.id;
    opt.textContent = engineOptionLabel(engine);
    opt.disabled = !engine.available && engine.id !== "edge";
    engineEl.appendChild(opt);
  }
  engineEl.value = settings.engine || "auto";

  fillVoices(catalog, engineEl.value, settings.voiceId);
  speedEl.value = String(settings.speed);
}

async function init() {
  const settings = await getSettings();
  speedEl.value = String(settings.speed);

  // Paint from cache first — three round trips to the server otherwise leave
  // the dropdowns empty for about a second every time the popup opens.
  const cached = await readCatalog();
  const serverUrl = settings.serverUrl.replace(/\/$/, "");
  const fresh = isFresh(cached, serverUrl);
  if (cached) render(cached, settings, !fresh);
  else statusEl.textContent = "Connecting to TalkToMe…";
  if (fresh) return;

  try {
    const catalog = await fetchCatalog(settings);
    let voiceId = settings.voiceId;
    const edgeOnline = catalog.engines.engines.find((e) => e.id === "edge")?.online;
    if (
      !voiceId ||
      voiceId === "system:Albert" ||
      voiceId === "default" ||
      (edgeOnline && voiceId.startsWith("kokoro:") && settings.engine === "auto")
    ) {
      voiceId = catalog.voices.default_voice_id || "edge:en-US-AriaNeural";
      await saveSettings({ voiceId, engine: settings.engine || "auto" });
    }
    render(catalog, { ...settings, voiceId }, false);
  } catch (err) {
    if (!cached) {
      enginePill.textContent = "offline";
      enginePill.classList.add("bad");
    }
    statusEl.textContent =
      err instanceof Error
        ? `${err.message}. Open the TalkToMe menu bar app and try again.`
        : "TalkToMe is offline";
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
  const catalog = await readCatalog();
  if (catalog) {
    fillVoices(catalog, engine, voiceEl.value);
    // Aria is the best default when Edge is in play.
    if (
      (engine === "edge" || engine === "auto") &&
      catalog.voices.voices.some((v) => v.id === "edge:en-US-AriaNeural")
    ) {
      voiceEl.value = "edge:en-US-AriaNeural";
    }
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
