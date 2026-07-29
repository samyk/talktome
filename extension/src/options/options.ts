import { TtsClient } from "../shared/audio-client";
import { SPEED_OPTIONS, getSettings, saveSettings } from "../shared/settings";
import type { EngineId, LibraryItem, Settings } from "../shared/types";

const els = {
  serverUrl: document.getElementById("serverUrl") as HTMLInputElement,
  engine: document.getElementById("engine") as HTMLSelectElement,
  voiceId: document.getElementById("voiceId") as HTMLSelectElement,
  emotion: document.getElementById("emotion") as HTMLSelectElement,
  style: document.getElementById("style") as HTMLSelectElement,
  speed: document.getElementById("speed") as HTMLSelectElement,
  highlightMode: document.getElementById("highlightMode") as HTMLSelectElement,
  autoScroll: document.getElementById("autoScroll") as HTMLInputElement,
  skipNavChrome: document.getElementById("skipNavChrome") as HTMLInputElement,
  playerDock: document.getElementById("playerDock") as HTMLSelectElement,
  serverStatus: document.getElementById("server-status")!,
  library: document.getElementById("library")!,
  saved: document.getElementById("saved")!,
};

for (const s of SPEED_OPTIONS) {
  const opt = document.createElement("option");
  opt.value = String(s);
  opt.textContent = `${s}×`;
  els.speed.appendChild(opt);
}

function fillSelect(select: HTMLSelectElement, values: string[], withEmpty = true) {
  const current = select.value;
  select.innerHTML = withEmpty ? `<option value="">None</option>` : "";
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  }
  select.value = current;
}

async function loadLibrary() {
  const stored = await chrome.storage.local.get("library");
  const library = (stored.library as LibraryItem[] | undefined) || [];
  els.library.innerHTML = "";
  if (!library.length) {
    els.library.innerHTML = `<p class="hint">No saved articles yet. Use the ⤓ button on the player.</p>`;
    return;
  }
  for (const item of library) {
    const div = document.createElement("div");
    div.className = "library-item";
    div.innerHTML = `
      <a href="${item.url}" target="_blank" rel="noreferrer">${item.title}</a>
      <p>${new Date(item.savedAt).toLocaleString()} · ${item.sections.length} sections</p>
      <p>${item.excerpt}</p>
    `;
    els.library.appendChild(div);
  }
}

async function hydrate() {
  const settings = await getSettings();
  els.serverUrl.value = settings.serverUrl;
  els.engine.value = settings.engine || "auto";
  els.speed.value = String(settings.speed);
  els.highlightMode.value = settings.highlightMode;
  els.autoScroll.checked = settings.autoScroll;
  els.skipNavChrome.checked = settings.skipNavChrome;
  els.playerDock.value = settings.playerDock;

  try {
    const client = TtsClient.fromSettings(settings);
    const voices = await client.voices();
    els.voiceId.innerHTML = "";
    for (const v of voices.voices) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = `${v.name} [${v.engine}]`;
      els.voiceId.appendChild(opt);
    }
    els.voiceId.value = settings.voiceId || voices.default_voice_id;
    fillSelect(els.emotion, voices.emotions);
    fillSelect(els.style, voices.styles);
    els.emotion.value = settings.emotion || "";
    els.style.value = settings.style || "";
    els.serverStatus.textContent = `Connected · default voice ${voices.default_voice_id}`;
  } catch (err) {
    els.serverStatus.textContent =
      err instanceof Error ? `Offline: ${err.message}` : "Offline";
  }

  await loadLibrary();
}

function readForm(): Partial<Settings> {
  return {
    serverUrl: els.serverUrl.value.trim() || "http://127.0.0.1:8765",
    engine: els.engine.value as EngineId,
    voiceId: els.voiceId.value,
    emotion: els.emotion.value || null,
    style: els.style.value || null,
    speed: Number(els.speed.value),
    highlightMode: els.highlightMode.value as Settings["highlightMode"],
    autoScroll: els.autoScroll.checked,
    skipNavChrome: els.skipNavChrome.checked,
    playerDock: els.playerDock.value as Settings["playerDock"],
  };
}

document.getElementById("save")!.addEventListener("click", async () => {
  const settings = await saveSettings(readForm());
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "SETTINGS_UPDATED", settings });
    } catch {
      /* ignore */
    }
  }
  els.saved.textContent = "Saved.";
  window.setTimeout(() => {
    els.saved.textContent = "";
  }, 1500);
});

document.getElementById("test-server")!.addEventListener("click", async () => {
  try {
    const health = await new TtsClient(els.serverUrl.value.replace(/\/$/, "")).health();
    els.serverStatus.textContent = `${health.message || "OK"} · engine=${health.engine} · ${health.engines_available.join(", ")}`;
  } catch (err) {
    els.serverStatus.textContent = err instanceof Error ? err.message : "Failed";
  }
});

document.getElementById("clear-library")!.addEventListener("click", async () => {
  await chrome.storage.local.set({ library: [] });
  await loadLibrary();
});

void hydrate();
