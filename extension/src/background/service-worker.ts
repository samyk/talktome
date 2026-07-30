import { TtsClient } from "../shared/audio-client";
import { fetchCatalog } from "../shared/catalog";
import { getSettings } from "../shared/settings";
import type { ExtensionMessage } from "../shared/types";

async function sendToActiveTab(message: ExtensionMessage) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // Content script may not be injected yet (e.g. chrome:// pages)
  }
}

/** Populate the voice/engine cache so the first popup open paints instantly. */
async function warmCatalog() {
  try {
    await fetchCatalog(await getSettings());
  } catch {
    // Server not up yet; the popup falls back to whatever is cached.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "listen-selection",
    title: "TalkToMe: read selection",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "listen-page",
    title: "TalkToMe: read page",
    contexts: ["page"],
  });
  void warmCatalog();
});

chrome.runtime.onStartup.addListener(() => void warmCatalog());

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "listen-selection") void sendToActiveTab({ type: "PLAY_SELECTION" });
  if (info.menuItemId === "listen-page") void sendToActiveTab({ type: "PLAY_PAGE" });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-play") void sendToActiveTab({ type: "TOGGLE_PLAY" });
  if (command === "read-selection") void sendToActiveTab({ type: "PLAY_SELECTION" });
  if (command === "read-page") void sendToActiveTab({ type: "PLAY_PAGE" });
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  void (async () => {
    if (message.type === "SERVER_STATUS") {
      try {
        const settings = await getSettings();
        const health = await TtsClient.fromSettings(settings).health();
        sendResponse({ ok: true, health });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
    if (message.type === "PLAYER_STATE") {
      // Could update badge here
      sendResponse({ ok: true });
      return;
    }
  })();
  return true;
});

chrome.action.onClicked.addListener(() => {
  // Popup handles UI; this is a fallback if popup is disabled
  void sendToActiveTab({ type: "TOGGLE_PLAY" });
});
