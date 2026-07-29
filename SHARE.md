# TalkToMe — share / install (macOS)

Send: **`Install-TalkToMe.pkg`**

## Install

1. Double-click **Install-TalkToMe.pkg** → Install
2. Lands in **`/Applications/TalkToMe.app`** and launches
3. On first run, choose whether to **Open at Login** (optional — you can change later)
4. Look for the **speaker** icon in the menu bar (no Dock icon by default)
5. First launch also installs Python deps (~1 min): status `TalkToMe v…: installing…` → `running`
6. Menu bar → **Install Browser Extension…** → Chrome `chrome://extensions` → Developer mode → Load unpacked → pick the folder it reveals
7. Open a page → extension → **Play page**

## Open at Login

First launch asks. After that: menu bar → **Open at Login** (checkmark = on).

## Requirements

- macOS 12+ (Intel or Apple Silicon)
- Python 3.11+ from [python.org/downloads](https://www.python.org/downloads/) — if missing: menu says `Python 3.11+ required`, then **Repair Install** after installing Python
- Internet for first setup + default Edge voice (offline → Kokoro)

## Uninstall

1. Uncheck **Open at Login** (or `rm ~/Library/LaunchAgents/com.talktome.app.plist`)
2. **Quit TalkToMe**
3. Delete `/Applications/TalkToMe.app`
4. Optional: `rm -rf ~/Library/Application\ Support/TalkToMe`

## Paths

```text
/Applications/TalkToMe.app
~/Library/LaunchAgents/com.talktome.app.plist   # only if Open at Login is on
~/Library/Application Support/TalkToMe/
```
