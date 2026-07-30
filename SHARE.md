# TalkToMe — share / install (macOS)

Send: **`Install-TalkToMe.pkg`** (from `dist-share/` after `npm run menubar:build`)

## Install

1. Double-click **Install-TalkToMe.pkg** → Install
2. Lands in **`/Applications/TalkToMe.app`** and launches (any old TalkToMe is quit first)
3. On first run, choose whether to **Open at Login** (optional — change later from the menu)
4. Look for the **speaker** icon in the menu bar (no Dock icon)
5. First launch installs Python deps (~1 min): status `TalkToMe v…: installing…` → `running`
6. Menu bar → **Install Browser Extension…**
   - Opens your Chromium browser’s extensions page (Chrome / Edge / Brave / Arc)
   - Puts the extension folder path on the clipboard
   - Highlights the folder in Finder
   - Turn on **Developer mode** → **Load unpacked** → press **⌘V** → **Enter**
7. Open a page → TalkToMe toolbar icon → **Play page**

## Open at Login

First launch asks. After that: menu bar → **Open at Login** (checkmark = on).

## Requirements

- macOS 12+ (Intel or Apple Silicon)
- Python 3.11+ from [python.org/downloads](https://www.python.org/downloads/) — if missing: menu says `Python 3.11+ required`, then **Advanced → Repair Install** after installing Python
- Internet for first setup + default Edge voice (offline → Kokoro)

## Uninstall

1. Uncheck **Open at Login** (or `rm ~/Library/LaunchAgents/com.talktome.app.plist`)
2. **Quit TalkToMe**
3. Delete `/Applications/TalkToMe.app`
4. Optional: `rm -rf ~/Library/Application\ Support/TalkToMe`
5. Optional: remove the unpacked extension from `chrome://extensions`

## Paths

```text
/Applications/TalkToMe.app
/Applications/TalkToMe.app/Contents/Resources/extension/   # Load unpacked from here
~/Library/LaunchAgents/com.talktome.app.plist              # only if Open at Login is on
~/Library/Application Support/TalkToMe/
```
