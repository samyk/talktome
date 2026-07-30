import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "TalkToMe",
  description:
    "Read any webpage aloud with Edge Neural, Kokoro, Qwen3, MOSS, OmniVoice, EditX, or system TTS — sections, speeds, live highlighting.",
  // Chrome accepts a string; @types/chrome only models { email }.
  author: "Samy Kamkar" as unknown as { email: string },
  homepage_url: "https://sa.my",
  version: "0.0.8",
  action: {
    default_popup: "src/popup/popup.html",
    default_title: "TalkToMe",
    default_icon: {
      "16": "src/assets/icons/icon16.png",
      "32": "src/assets/icons/icon32.png",
      "48": "src/assets/icons/icon48.png",
      "128": "src/assets/icons/icon128.png",
    },
  },
  icons: {
    "16": "src/assets/icons/icon16.png",
    "32": "src/assets/icons/icon32.png",
    "48": "src/assets/icons/icon48.png",
    "128": "src/assets/icons/icon128.png",
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  options_ui: {
    page: "src/options/options.html",
    open_in_tab: true,
  },
  permissions: ["storage", "activeTab", "contextMenus", "scripting", "tabs"],
  host_permissions: ["http://127.0.0.1:8765/*", "http://localhost:8765/*", "<all_urls>"],
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/content/index.ts"],
      css: ["src/content/styles.css"],
      run_at: "document_idle",
    },
  ],
  commands: {
    "toggle-play": {
      suggested_key: { default: "Alt+Shift+P", mac: "Alt+Shift+P" },
      description: "Play / pause TalkToMe",
    },
    "read-selection": {
      suggested_key: { default: "Alt+Shift+S", mac: "Alt+Shift+S" },
      description: "Read current selection",
    },
    "read-page": {
      suggested_key: { default: "Alt+Shift+L", mac: "Alt+Shift+L" },
      description: "Read full page",
    },
  },
});
