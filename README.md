# TalkToMe

Natural (not robotic) text-to-speech for the browser. A Chromium extension plus a macOS menu-bar companion that reads any page aloud with Edge Neural, Kokoro, Qwen3, MOSS, OmniVoice, Step-Audio-EditX, or system speech.

**Author:** [samy kamkar](https://sa.my) · **Version:** 0.0.9

## Architecture

```
┌─────────────────────┐     HTTP 127.0.0.1:8765      ┌──────────────────────────┐
│ TalkToMe extension  │ ───────────────────────────► │ TalkToMe TTS server      │
│  (player + extract) │     POST /v1/tts             │  Edge / Kokoro / …       │
└─────────────────────┘                              └──────────────────────────┘
```

The model never runs in the browser. The extension extracts readable text, highlights as it speaks, and plays audio from the local server supervised by **TalkToMe.app**.

## Features

- Play full page or selection (toolbar, context menu, shortcuts)
- Optional selection chip (**off by default** — Settings → Show TalkToMe chip when selecting text)
- In-page player with engine / voice / speed controls
- Chapters from headings (`H1–H6`) when the page has more than one
- Speeds **0.5×–4.5×** (server-baked for Edge/Kokoro; residual `playbackRate` elsewhere)
- Sentence / word highlighting; click a sentence to jump there
- ±15s skip, scrubber, dock (bottom / top / floating)
- Neumorphic popup, settings, and player (flat selection chip when enabled)
- Content-script TTS proxied through the service worker (fixes Chrome Private Network Access `Failed to fetch` on https pages)
- Cached engine/voice catalog so the popup paints instantly
- Offline article library (extension local storage)
- Shortcuts: `⌥⇧L` page · `⌥⇧S` selection · `⌥⇧P` play/pause

## Share / install (macOS)

Friend-facing steps live in **[SHARE.md](SHARE.md)**. Short version:

1. Send **`dist-share/Install-TalkToMe.pkg`**
2. Double-click → installs **`/Applications/TalkToMe.app`**, quits any old copy, launches the new one
3. Optional **Open at Login** prompt on first run
4. Menu bar → **Install Browser Extension…**
   - Opens Chrome/Edge/Brave/Arc extensions page
   - Copies the extension folder path to the clipboard
   - Highlights the folder in Finder
   - User: Developer mode → **Load unpacked** → `⌘V` → Enter
5. Open a page → TalkToMe → **Play page**

### Build the installer (developers)

```bash
npm run menubar:build
```

Needs Xcode CLT (`xcode-select --install`). Output:

| Artifact | Path |
|----------|------|
| App | `dist-share/TalkToMe.app` |
| Notarized pkg | `dist-share/Install-TalkToMe.pkg` → **`/Applications/TalkToMe.app`** |
| Unpacked extension (dev) | `dist-share/extension/` |

Signed with **Developer ID Application/Installer: Samy Kamkar (729MKH4M8C)**, notarized via keychain profile `listen-notary`. The pkg uses `BundleIsRelocatable=false`, so Installer always targets `/Applications`. Preinstall/postinstall quit running TalkToMe (and legacy Listen TTS), free port **8765**, then relaunch.

App data: `~/Library/Application Support/TalkToMe/`. Icons: `macos-app/ListenTray/Assets/` (`IconSource.png` → AppIcon / MenuBarIcon).

## Development

### Server

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --host 127.0.0.1 --port 8765
```

First Kokoro use downloads ~300MB ONNX weights into `~/.cache/listen-tts/kokoro/`.

### Extension

```bash
cd extension
npm install
python3 ../scripts/generate-assets.py
npm run build
```

Load unpacked from `extension/dist`, **or** use TalkToMe.app → **Install Browser Extension…** after a menubar build (points at the bundled copy under the app Resources).

Manifest metadata: name **TalkToMe**, author **Samy Kamkar**, homepage **https://sa.my**.

## Engines

| Engine | Quality | Needs |
|--------|---------|--------|
| **Edge** `en-US-AriaNeural` (default) | Best everyday neural | Internet |
| **Kokoro** | Strong local neural | CPU / Apple Silicon, ~300MB |
| **Qwen3-TTS** | High | GPU or remote OpenAI-compatible URL |
| **MOSS-TTS** | High | GPU or remote URL |
| **OmniVoice** | High, multilingual | GPU + ref wav, or remote URL |
| **EditX** | Expressive clone/edit | NVIDIA CUDA |
| **System** | Fallback (`say` / SAPI) | none |

`LISTEN_ENGINE=auto` prefers Edge when online, then `LISTEN_FALLBACK_ENGINE` (typically Kokoro). Pick engine / voice / speed in the popup, settings, or in-page player footer.

TTS responses expose `X-TalkToMe-Engine` / `X-TalkToMe-Speed` (CORS-exposed). The server also sets `allow_private_network` for Chrome preflights; content scripts still talk to localhost via the background worker so https pages cannot break speech.

Selection chip: Settings → **Show TalkToMe chip when selecting text** (default off). Otherwise use the toolbar, context menu, or shortcuts.

### EditX (optional GPU)

1. Follow [stepfun-ai/Step-Audio-EditX](https://github.com/stepfun-ai/Step-Audio-EditX).
2. Add a voice under `server/voices/<id>/` (`voice.json` + `prompt.wav`).
3. See `server/.env.example` for `LISTEN_EDITX_*` / `LISTEN_ENGINE=editx`.
4. `/health` should report `engine: editx`.

On a Mac without CUDA, run EditX on a GPU box and point the extension at that host (or SSH tunnel `8765`).

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Engine status |
| GET | `/v1/engines` | Available engines |
| GET | `/v1/voices` | Voices + EditX emotions/styles |
| POST | `/v1/tts` | `{ text, voice_id?, engine?, speed?, … }` → audio |

## Repo layout

```text
extension/     Manifest V3 + Vite (@crxjs/vite-plugin)
server/        FastAPI TTS companion
macos-app/     Swift menu-bar supervisor (TalkToMe.app)
scripts/       Assets + notarized pkg build
SHARE.md       Friend install instructions
```

## Windows / Firefox (later)

- **Windows:** same MV3 extension; server `LISTEN_ENGINE=system` (SAPI) today; tray packaging TBD.
- **Firefox:** `cd extension && BROWSER=firefox npm run build`, load `extension/dist` as a temporary add-on. Chromium is primary.

## Notes

- Keep this README current when product name, install flow, engines, version, or packaging change.
- Placeholder `voices/default/prompt.wav` is silence — replace before expecting good EditX clones.
- PDF / Google Docs deep integration is not in this version.
