import { ensureCatalog, readCatalog } from "../shared/catalog";
import { getSettings, saveSettings } from "../shared/settings";
import type { EngineId, ExtensionMessage, LibraryItem, Settings } from "../shared/types";
import { clearListenMarks, extractDocument, extractSelection } from "./extractor";
import { PlaybackController, PlayerUI } from "./player";

let settings: Settings;
let ui: PlayerUI | null = null;
let controller: PlaybackController | null = null;
let selectionChip: HTMLButtonElement | null = null;

async function ensurePlayer() {
  if (ui && controller) return { ui, controller };
  settings = await getSettings();
  controller = new PlaybackController((snapshot) => {
    ui?.update(snapshot);
    void chrome.runtime.sendMessage({ type: "PLAYER_STATE", snapshot } satisfies ExtensionMessage);
  });
  controller.configure(settings);

  ui = new PlayerUI({
    onPlayPause: () => void controller?.toggle(),
    onStop: () => {
      controller?.stop();
      clearListenMarks();
      ui?.destroy();
      ui = null;
      controller?.destroy();
      controller = null;
    },
    onSkip: (s) => void controller?.skip(s),
    onPrevSection: () => void controller?.prevSection(),
    onNextSection: () => void controller?.nextSection(),
    onSpeed: (speed) => {
      controller?.setSpeed(speed);
      void saveSettings({ speed });
      settings.speed = speed;
    },
    onEngine: (engine: EngineId) => {
      controller?.setEngine(engine);
      void saveSettings({ engine });
      settings.engine = engine;
    },
    onVoice: (voiceId: string) => {
      controller?.setVoice(voiceId);
      void saveSettings({ voiceId });
      settings.voiceId = voiceId;
    },
    onSection: (i) => void controller?.seekSection(i),
    onToggleSections: () => undefined,
    onSave: () => void saveCurrentToLibrary(),
  });
  ui.setDock(settings.playerDock);
  ui.root.addEventListener("listen-seek-ratio", ((e: CustomEvent<number>) => {
    void controller?.seekRatio(e.detail);
  }) as EventListener);

  void populatePlayerCatalog();

  return { ui, controller };
}

/**
 * Cached catalog first so the pickers are populated on the first frame, then a
 * refresh in case voices or engine availability changed.
 */
async function populatePlayerCatalog() {
  const cached = await readCatalog();
  if (cached && ui) ui.setCatalog(cached, settings);
  const fresh = await ensureCatalog(settings);
  if (fresh && fresh !== cached && ui) ui.setCatalog(fresh, settings);
}

async function playPage(startSentence = 0) {
  const { ui, controller } = await ensurePlayer();
  const doc = extractDocument({ skipChrome: settings.skipNavChrome });
  if (!doc.flatSentences.length) {
    ui.update({
      state: "error",
      speed: settings.speed,
      sectionIndex: 0,
      sentenceIndex: 0,
      progress: 0,
      error: "No readable text found on this page.",
      title: document.title,
    });
    return;
  }
  ui.setSections(doc, 0);
  await controller.load(doc, startSentence);
}

async function playSelection() {
  const doc = extractSelection();
  if (!doc) return;
  const { ui, controller } = await ensurePlayer();
  ui.setSections(doc, 0);
  await controller.load(doc, 0);
}

async function saveCurrentToLibrary() {
  const doc = extractDocument({ skipChrome: settings?.skipNavChrome ?? true });
  const item: LibraryItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: doc.title,
    url: doc.url,
    savedAt: Date.now(),
    excerpt: doc.flatSentences
      .slice(0, 3)
      .map((s) => s.text)
      .join(" "),
    text: doc.flatSentences.map((s) => s.text).join(" "),
    sections: doc.sections.map((s) => ({
      title: s.title,
      text: s.paragraphs.map((p) => p.text).join("\n\n"),
    })),
  };
  const stored = await chrome.storage.local.get("library");
  const library = (stored.library as LibraryItem[] | undefined) || [];
  library.unshift(item);
  await chrome.storage.local.set({ library: library.slice(0, 100) });
  const status = ui?.root.querySelector(".listen-status");
  if (status) status.textContent = "Saved to library";
}

function hideSelectionChip() {
  selectionChip?.remove();
  selectionChip = null;
}

function selectionTouchesListenUi(sel: Selection): boolean {
  for (let i = 0; i < sel.rangeCount; i++) {
    const range = sel.getRangeAt(i);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (el?.closest?.("#listen-root, .listen-selection-chip")) return true;
  }
  return false;
}

function isSelectAllIsh(sel: Selection): boolean {
  const text = sel.toString();
  // Don't show chip for Cmd+A / huge page selections — use Play page instead
  if (text.length > 2500) return true;
  const bodyText = (document.body?.innerText || "").trim();
  if (bodyText && text.length > bodyText.length * 0.85) return true;
  return false;
}

function showSelectionChip() {
  if (!settings?.selectionChip) {
    hideSelectionChip();
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) {
    hideSelectionChip();
    return;
  }
  if (selectionTouchesListenUi(sel) || isSelectAllIsh(sel)) {
    hideSelectionChip();
    return;
  }

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    hideSelectionChip();
    return;
  }

  // Clamp to viewport so the chip never sits above/below the page
  const x = Math.min(Math.max(rect.left + rect.width / 2, 48), window.innerWidth - 48);
  const y = Math.min(Math.max(rect.top, 48), window.innerHeight - 24);

  if (!selectionChip) {
    selectionChip = document.createElement("button");
    selectionChip.className = "listen-selection-chip";
    selectionChip.type = "button";
    selectionChip.textContent = "TalkToMe";
    selectionChip.setAttribute("contenteditable", "false");
    selectionChip.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    selectionChip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideSelectionChip();
      void playSelection();
    });
    document.documentElement.appendChild(selectionChip);
  }
  selectionChip.style.left = `${x}px`;
  selectionChip.style.top = `${y}px`;
}

// Prefer mouseup — selectionchange fires during Cmd+A and fights the user
document.addEventListener("mouseup", () => {
  window.setTimeout(showSelectionChip, 0);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideSelectionChip();
});
document.addEventListener("keyup", (e) => {
  if (e.key === "Escape") return;
  if (e.key === "Shift" || e.key.startsWith("Arrow")) {
    window.setTimeout(showSelectionChip, 0);
  }
});
document.addEventListener("selectionchange", () => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || isSelectAllIsh(sel) || selectionTouchesListenUi(sel)) {
    hideSelectionChip();
  }
});
document.addEventListener("scroll", hideSelectionChip, true);

document.addEventListener(
  "click",
  (e) => {
    const target = e.target as HTMLElement;
    const sentence = target.closest?.("[data-listen-sentence]") as HTMLElement | null;
    if (!sentence || !controller) return;
    const id = sentence.dataset.listenSentence;
    const all = Array.from(document.querySelectorAll("[data-listen-sentence]"));
    const idx = all.findIndex((el) => (el as HTMLElement).dataset.listenSentence === id);
    if (idx >= 0) void controller.seekSentence(idx);
  },
  true,
);

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  void (async () => {
    switch (message.type) {
      case "PING":
        sendResponse({ ok: true });
        break;
      case "PLAY_PAGE":
        await playPage();
        sendResponse({ ok: true });
        break;
      case "PLAY_SELECTION":
        await playSelection();
        sendResponse({ ok: true });
        break;
      case "TOGGLE_PLAY":
        if (!controller) await playPage();
        else await controller.toggle();
        sendResponse({ ok: true });
        break;
      case "PAUSE":
        controller?.pause();
        sendResponse({ ok: true });
        break;
      case "RESUME":
        await controller?.resume();
        sendResponse({ ok: true });
        break;
      case "STOP":
        controller?.stop();
        sendResponse({ ok: true });
        break;
      case "SET_SPEED":
        controller?.setSpeed(message.speed);
        settings = await saveSettings({ speed: message.speed });
        sendResponse({ ok: true });
        break;
      case "NEXT_SECTION":
        await controller?.nextSection();
        sendResponse({ ok: true });
        break;
      case "PREV_SECTION":
        await controller?.prevSection();
        sendResponse({ ok: true });
        break;
      case "SKIP":
        await controller?.skip(message.seconds);
        sendResponse({ ok: true });
        break;
      case "SEEK_SENTENCE":
        await controller?.seekSentence(message.sentenceIndex);
        sendResponse({ ok: true });
        break;
      case "GET_PLAYER_STATE":
        sendResponse(controller?.snapshot() || null);
        break;
      case "SAVE_TO_LIBRARY":
        await saveCurrentToLibrary();
        sendResponse({ ok: true });
        break;
      case "SETTINGS_UPDATED":
        settings = message.settings;
        controller?.configure(settings);
        ui?.setDock(settings.playerDock);
        if (!settings.selectionChip) hideSelectionChip();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false });
    }
  })();
  return true;
});

void getSettings().then((s) => {
  settings = s;
});
