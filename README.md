# Listen — local Speechify-style TTS

Browser extension (Chrome / Edge / Brave / Arc today, Firefox-ready Manifest V3) that reads websites aloud using **Step-Audio-EditX** on a local companion server. On machines without EditX/CUDA it falls back to macOS `say` (and later Windows SAPI).

## Architecture

```
┌─────────────────────┐     HTTP localhost:8765      ┌──────────────────────────┐
│  Browser extension  │ ───────────────────────────► │  Listen TTS server       │
│  (player + extract) │     POST /v1/tts             │  EditX  or  system TTS   │
└─────────────────────┘                              └──────────────────────────┘
```

The heavy model never runs in the browser. The extension extracts readable sections, highlights sentences/words, and streams chunked WAV audio from your machine.

## Features

- Play full page or selection (toolbar, context menu, floating **Listen** chip)
- Section list from headings (`H1–H6`) + prev/next section
- Speeds **0.5×–4.5×** (client `playbackRate`)
- Sentence / word highlighting + click a sentence to start there
- ±15s skip, scrubber, draggable dock (bottom / top / corner)
- EditX emotion + speaking-style controls
- Offline article library (local storage)
- Shortcuts: `⌥⇧L` page · `⌥⇧S` selection · `⌥⇧P` play/pause

## Quick start (macOS)

### Easiest: menu bar app (no terminal)

```bash
npm run menubar:build
```

Requires Xcode Command Line Tools (`xcode-select --install`) on the build machine only. Produces `dist-share/TalkToMe.app` and `dist-share/Install-TalkToMe.pkg` → installs to **`/Applications/TalkToMe.app`**. See [SHARE.md](SHARE.md).

Signed with **Developer ID Application/Installer: Samy Kamkar (729MKH4M8C)** and notarized via `listen-notary`. The pkg sets `BundleIsRelocatable=false` so Installer always targets `/Applications`.

Menu bar app: `macos-app/ListenTray/main.swift`. `Assets/IconSource.png` is the canonical full-resolution transparent speaker art. It generates `AppIcon.icns` for Finder/Dock/Cmd-Tab, the browser toolbar sizes, and monochrome template `MenuBarIcon*.png` masks that automatically follow the light/dark menu bar. Data: `~/Library/Application Support/TalkToMe/`. **Open at Login** is offered once on first launch (never auto-enabled by the installer); toggle anytime from the menu.

### Development: run the server directly (Kokoro neural — good quality on Mac, no CUDA)

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --host 127.0.0.1 --port 8765
```

First launch downloads ~300MB Kokoro ONNX weights into `~/.cache/listen-tts/kokoro/`.

### Development: build the extension

```bash
cd extension
npm install
python3 ../scripts/generate-assets.py
npm run build
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/dist`.

### Use it

Open any article → click the Listen icon → **Play page**, or highlight text and click the **Listen** chip.

## Engines & quality

| Engine | Quality | Needs |
|--------|---------|--------|
| **Edge** `en-US-AriaNeural` (default) | Best everyday — Microsoft neural | Internet |
| **Kokoro** | Strong local neural | CPU/Apple Silicon, ~300MB |
| **Qwen3-TTS** | High — Alibaba | GPU or remote URL |
| **MOSS-TTS** | High — OpenMOSS | GPU or remote URL |
| **OmniVoice** | High — multilingual clone | GPU + ref wav, or remote URL |
| **EditX** | Expressive clone/edit | NVIDIA CUDA |
| **System** | Robotic fallback | none |

`LISTEN_ENGINE=auto` tries Edge when online, then falls back to Kokoro (or whatever you set in `LISTEN_FALLBACK_ENGINE`).

Pick engine + voice + speed in the extension popup / settings.

EditX wants an **NVIDIA GPU (~12GB, AWQ ~6–8GB)**. Upstream is Linux-first. On a Mac without CUDA, run the server on a GPU box / Linux VM and point the extension at that host (or SSH tunnel `8765`).

1. Follow [stepfun-ai/Step-Audio-EditX](https://github.com/stepfun-ai/Step-Audio-EditX) install + model download.
2. Add a real zero-shot voice under `server/voices/<id>/`:

```text
server/voices/myvoice/
  voice.json      # id, name, prompt_text, prompt_audio
  prompt.wav      # 3–10s clean reference speech matching prompt_text
```

3. Configure env (see `server/.env.example`):

```bash
export LISTEN_ENGINE=editx
export LISTEN_EDITX_REPO=/path/to/Step-Audio-EditX
export LISTEN_EDITX_MODEL_PATH=/path/to/Step-Audio-EditX-AWQ-4bit
export LISTEN_EDITX_TOKENIZER_PATH=/path/to/Step-Audio-Tokenizer
export LISTEN_EDITX_QUANTIZATION=awq
export LISTEN_DEFAULT_VOICE_ID=myvoice
```

4. Restart the server. `/health` should report `engine: editx`.

## Windows (later)

- Extension: same MV3 build (Edge/Chrome).
- Server: `LISTEN_ENGINE=system` uses PowerShell SAPI today; EditX when you have a CUDA box.
- Packaging a tray companion + auto-start is the main follow-up.

## Firefox

```bash
cd extension && BROWSER=firefox npm run build
```

Load `extension/dist` as a temporary add-on. You may need to relax `host_permissions` / CSP quirks; Chromium is the primary target for v0.1.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Engine status |
| GET | `/v1/voices` | Voices + EditX emotions/styles |
| POST | `/v1/tts` | `{ text, voice_id?, emotion?, style? }` → `audio/wav` |

## Repo layout

```text
extension/   Manifest V3 + Vite (@crxjs)
server/      FastAPI companion
scripts/     Icon + placeholder wav generator
```

## Notes / limits

- EditX synthesis is chunked per sentence and prefetched (±2). Long pages take a while on first pass; audio is cached under `~/.cache/listen-tts`.
- Placeholder `voices/default/prompt.wav` is silence — replace before expecting good EditX clones.
- PDF / Google Docs deep integration is not in v0.1 (web articles + selection are).
