#!/usr/bin/env bash
# Build TalkToMe.app — menu-bar companion, Developer ID signed + notarized.
set -euo pipefail
export COPYFILE_DISABLE=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/dist-share"
APP_NAME="TalkToMe"
APP_DIR="${OUT}/${APP_NAME}.app"
CONTENTS="${APP_DIR}/Contents"
MACOS="${CONTENTS}/MacOS"
RES="${CONTENTS}/Resources"
SWIFT_SRC="${ROOT}/macos-app/ListenTray/main.swift"
BIN_NAME="TalkToMe"
DEPLOY_TARGET="12.0"
BUNDLE_ID="com.talktome.app"
VERSION="0.0.9"
TEAM_ID="${LISTEN_TEAM_ID:-729MKH4M8C}"
NOTARY_PROFILE="${LISTEN_NOTARY_PROFILE:-listen-notary}"
PKG_OUT="${OUT}/Install-TalkToMe.pkg"

APP_IDENTITY="${LISTEN_APP_IDENTITY:-Developer ID Application: Samy Kamkar (${TEAM_ID})}"
INSTALLER_IDENTITY="${LISTEN_INSTALLER_IDENTITY:-Developer ID Installer: Samy Kamkar (${TEAM_ID})}"

command -v swiftc >/dev/null || {
  echo "error: swiftc not found. Install Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
}

pick_identity() {
  local want="$1"
  if security find-identity -v -p codesigning 2>/dev/null | grep -F "\"${want}\"" >/dev/null; then
    echo "${want}"; return
  fi
  if security find-identity -v 2>/dev/null | grep -F "\"${want}\"" >/dev/null; then
    echo "${want}"; return
  fi
  return 1
}

echo "▸ Building extension…"
cd "${ROOT}/extension"
[ -d node_modules ] || npm install
python3 "${ROOT}/scripts/generate-assets.py"
# Prefer the TalkToMe speaker art over the placeholder generator icons.
for sz in 16 32 48 128; do
  sips -z "$sz" "$sz" "${ROOT}/macos-app/ListenTray/Assets/AppIcon.png" \
    --out "${ROOT}/extension/src/assets/icons/icon${sz}.png" >/dev/null
done
npm run build

echo "▸ Assembling bundle…"
if [ -d "${APP_DIR}" ]; then
  STALE="${OUT}/${APP_NAME}.app.stale.$$"
  mv "${APP_DIR}" "${STALE}" 2>/dev/null || true
  rm -rf "${STALE}" 2>/dev/null || true
fi
rm -rf "${OUT}/Listen TTS.app" "${OUT}/Listen TTS.app.old" "${OUT}/Install Listen TTS.pkg" \
  "${OUT}/Install TalkToMe.pkg" 2>/dev/null || true

mkdir -p "${MACOS}" "${RES}"
rsync -a \
  --exclude '.venv' --exclude '__pycache__' --exclude '*.egg-info' --exclude '.env' \
  --exclude '._*' --exclude '.DS_Store' \
  "${ROOT}/server/" "${RES}/server/"
cp -R "${ROOT}/extension/dist/." "${RES}/extension/"
# App / Dock / Cmd-Tab icon + menu bar glyph
cp "${ROOT}/macos-app/ListenTray/Assets/AppIcon.icns" "${RES}/AppIcon.icns"
cp "${ROOT}/macos-app/ListenTray/Assets/AppIcon.png" "${RES}/AppIcon.png"
cp "${ROOT}/macos-app/ListenTray/Assets/MenuBarIcon.png" "${RES}/MenuBarIcon.png"
cp "${ROOT}/macos-app/ListenTray/Assets/MenuBarIcon@2x.png" "${RES}/MenuBarIcon@2x.png"
find "${RES}" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true

python3 - "${ROOT}/server/pyproject.toml" "${RES}/requirements.txt" << 'PY'
import sys, tomllib
from pathlib import Path
src, dst = Path(sys.argv[1]), Path(sys.argv[2])
deps = tomllib.loads(src.read_text())["project"]["dependencies"]
dst.write_text("\n".join(deps) + "\n")
print(f"  requirements.txt: {len(deps)} packages")
PY

echo "▸ Compiling Swift menu bar app…"
BUILD_TMP="$(mktemp -d)"
trap 'rm -rf "${BUILD_TMP}"' EXIT
SLICES=()
for arch in arm64 x86_64; do
  if swiftc -O -target "${arch}-apple-macos${DEPLOY_TARGET}" \
      -o "${BUILD_TMP}/${BIN_NAME}-${arch}" "${SWIFT_SRC}" 2>"${BUILD_TMP}/${arch}.err"; then
    SLICES+=("${BUILD_TMP}/${BIN_NAME}-${arch}")
    echo "  built ${arch}"
  else
    echo "  skipped ${arch}"
  fi
done
[ ${#SLICES[@]} -gt 0 ] || { echo "error: Swift build failed"; cat "${BUILD_TMP}"/*.err; exit 1; }
lipo -create "${SLICES[@]}" -output "${MACOS}/${BIN_NAME}"
chmod +x "${MACOS}/${BIN_NAME}"

cat > "${CONTENTS}/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleVersion</key><string>9</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleExecutable</key><string>${BIN_NAME}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>${DEPLOY_TARGET}</string>
</dict>
</plist>
PLIST

ENTITLEMENTS="${BUILD_TMP}/entitlements.plist"
cat > "${ENTITLEMENTS}" << 'ENTS'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.network.server</key><true/>
</dict>
</plist>
ENTS

xattr -cr "${APP_DIR}" 2>/dev/null || true

SIGN_ID=""
if SIGN_ID="$(pick_identity "${APP_IDENTITY}")"; then
  echo "▸ Signing app with ${SIGN_ID}…"
  codesign --force --deep --options runtime --timestamp \
    --entitlements "${ENTITLEMENTS}" --sign "${SIGN_ID}" "${APP_DIR}"
else
  codesign --force --deep --sign - "${APP_DIR}"
fi
codesign --verify --deep --strict "${APP_DIR}"
echo "  seal verified"

echo "▸ Building installer…"
# Stage outside the repo. If the component is relocatable (pkgbuild default),
# Installer "upgrades" whatever TalkToMe.app LaunchServices already knows —
# which was our dist-share build tree under Documents — and TCC then blocks
# the shove. BundleIsRelocatable=false forces /Applications.
PKG_ROOT="${BUILD_TMP}/root"
mkdir -p "${PKG_ROOT}"
ditto --norsrc --noextattr --noqtn "${APP_DIR}" "${PKG_ROOT}/${APP_NAME}.app"

COMPONENT_PLIST="${BUILD_TMP}/component.plist"
pkgbuild --analyze --root "${PKG_ROOT}" "${COMPONENT_PLIST}"
python3 - "${COMPONENT_PLIST}" << 'PY'
import plistlib, sys
from pathlib import Path
p = Path(sys.argv[1])
data = plistlib.loads(p.read_bytes())
for entry in data:
    entry["BundleIsRelocatable"] = False
    entry["BundleHasStrictIdentifier"] = True
    entry["BundleOverwriteAction"] = "upgrade"
p.write_bytes(plistlib.dumps(data))
print("  BundleIsRelocatable = false")
PY

PKG_SCRIPTS="${BUILD_TMP}/scripts"
mkdir -p "${PKG_SCRIPTS}"

# Quit running TalkToMe / Listen TTS so the bundle can be replaced cleanly and
# the new binary — not the still-running old one — ends up in the menu bar.
# Duplicated into preinstall + postinstall: pkgbuild packages those two names
# only, and a helper file alongside them is not guaranteed to be executable.
QUIT_OLD_FN=$(cat << 'QUIT'
console_user() {
  local u
  u="$(stat -f%Su /dev/console 2>/dev/null || true)"
  if [ -z "${u}" ] || [ "${u}" = "root" ]; then
    u="$(id -un 2>/dev/null || true)"
  fi
  [ "${u}" != "root" ] || return 1
  [ -n "${u}" ] || return 1
  printf '%s' "${u}"
}

talktome_running() {
  pgrep -x TalkToMe >/dev/null 2>&1 && return 0
  pgrep -x 'Listen TTS' >/dev/null 2>&1 && return 0
  pgrep -f '/Applications/TalkToMe\.app/Contents/MacOS/' >/dev/null 2>&1 && return 0
  pgrep -f '/Applications/Listen TTS\.app/Contents/MacOS/' >/dev/null 2>&1 && return 0
  return 1
}

quit_old_talktome() {
  local user uid home pid pidfile i
  user="$(console_user)" || return 0
  uid="$(id -u "${user}" 2>/dev/null || true)"
  home="$(dscl . -read "/Users/${user}" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
  [ -n "${home}" ] || home="/Users/${user}"

  if ! talktome_running; then
    echo "[talktome] no running instance"
  else
    echo "[talktome] quitting running instance"
    # Graceful first, so applicationWillTerminate stops the TTS server. Apple
    # events from the installer daemon are often blocked, hence the signals.
    if [ -n "${uid}" ]; then
      launchctl asuser "${uid}" sudo -u "${user}" \
        osascript -e 'tell application id "com.talktome.app" to quit' 2>/dev/null || true
      launchctl asuser "${uid}" sudo -u "${user}" \
        osascript -e 'tell application "Listen TTS" to quit' 2>/dev/null || true
    fi

    for i in 1 2 3 4 5 6 7 8 9 10; do
      talktome_running || break
      [ "${i}" -ne 3 ] || {
        pkill -TERM -x TalkToMe 2>/dev/null || true
        pkill -TERM -x 'Listen TTS' 2>/dev/null || true
        pkill -TERM -f '/Applications/TalkToMe\.app/Contents/MacOS/' 2>/dev/null || true
        pkill -TERM -f '/Applications/Listen TTS\.app/Contents/MacOS/' 2>/dev/null || true
      }
      sleep 0.4
    done

    if talktome_running; then
      echo "[talktome] force killing"
      pkill -KILL -x TalkToMe 2>/dev/null || true
      pkill -KILL -x 'Listen TTS' 2>/dev/null || true
      pkill -KILL -f '/Applications/TalkToMe\.app/Contents/MacOS/' 2>/dev/null || true
      pkill -KILL -f '/Applications/Listen TTS\.app/Contents/MacOS/' 2>/dev/null || true
      sleep 0.3
    fi
  fi

  # Orphaned uvicorn from a tray process we just killed: it holds port 8765 and
  # would make the new build report "running" against stale bundled sources.
  for pidfile in \
      "${home}/Library/Application Support/TalkToMe/server.pid" \
      "${home}/Library/Application Support/Listen TTS/server.pid"; do
    [ -f "${pidfile}" ] || continue
    pid="$(tr -d '[:space:]' < "${pidfile}" 2>/dev/null || true)"
    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
      echo "[talktome] stopping server pid ${pid}"
      kill -TERM "${pid}" 2>/dev/null || true
      sleep 0.5
      kill -KILL "${pid}" 2>/dev/null || true
    fi
    rm -f "${pidfile}" 2>/dev/null || true
  done

  # A tray killed earlier orphans uvicorn onto PID 1, losing server.pid — so
  # sweep the port too. Matched on the full argv, not just the port, so an
  # unrelated listener is never touched.
  for pid in $(lsof -ti "tcp:8765" -sTCP:LISTEN 2>/dev/null || true); do
    case "$(ps -o command= -p "${pid}" 2>/dev/null || true)" in
      *"uvicorn app.main:app"*)
        echo "[talktome] stopping stale server on port 8765 (pid ${pid})"
        kill -TERM "${pid}" 2>/dev/null || true
        sleep 0.5
        kill -KILL "${pid}" 2>/dev/null || true
        ;;
    esac
  done
}
QUIT
)

cat > "${PKG_SCRIPTS}/preinstall" << PRE
#!/bin/bash
set -uo pipefail
${QUIT_OLD_FN}
quit_old_talktome
exit 0
PRE
chmod +x "${PKG_SCRIPTS}/preinstall"

cat > "${PKG_SCRIPTS}/postinstall" << POST
#!/bin/bash
set -uo pipefail
APP="/Applications/${APP_NAME}.app"
${QUIT_OLD_FN}
# Belt and braces: preinstall already ran, but PackageKit shoves the bundle in
# between, and a login item can race back up while that happens.
quit_old_talktome

xattr -dr com.apple.quarantine "\${APP}" 2>/dev/null || true
rm -rf "/Applications/Listen TTS.app" 2>/dev/null || true

user="\$(console_user)" || exit 0
uid="\$(id -u "\${user}")"
home="\$(dscl . -read "/Users/\${user}" NFSHomeDirectory 2>/dev/null | awk '{print \$2}')"
[ -n "\${home}" ] || home="/Users/\${user}"

# Do not auto-enable Open at Login — the app asks on first launch.
# Clear only the legacy Listen TTS agent from earlier builds.
rm -f "\${home}/Library/LaunchAgents/com.listen.tts.tray.plist" 2>/dev/null || true
launchctl asuser "\${uid}" sudo -u "\${user}" \\
  launchctl bootout "gui/\${uid}/com.listen.tts.tray" 2>/dev/null || true

# LaunchServices still has the pre-shove bundle cached; register the new one so
# \`open\` starts the freshly installed binary.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \\
  -f "\${APP}" 2>/dev/null || true

echo "[talktome] launching \${APP}"
launchctl asuser "\${uid}" sudo -u "\${user}" open -a "\${APP}" 2>/dev/null \\
  || sudo -u "\${user}" open -a "\${APP}" 2>/dev/null \\
  || echo "[talktome] launch failed"
exit 0
POST
chmod +x "${PKG_SCRIPTS}/postinstall"

COMPONENT_PKG="${BUILD_TMP}/TalkToMe-component.pkg"
pkgbuild --quiet \
  --root "${PKG_ROOT}" \
  --component-plist "${COMPONENT_PLIST}" \
  --scripts "${PKG_SCRIPTS}" \
  --identifier "${BUNDLE_ID}.installer" \
  --version "${VERSION}" \
  --install-location /Applications \
  "${COMPONENT_PKG}"

UNSIGNED="${BUILD_TMP}/unsigned.pkg"
# Wrap so Developer ID Installer signing applies cleanly.
productbuild --quiet --package "${COMPONENT_PKG}" "${UNSIGNED}"

rm -f "${PKG_OUT}"
if INSTALLER_ID="$(pick_identity "${INSTALLER_IDENTITY}")"; then
  echo "  signing pkg with ${INSTALLER_ID}"
  productsign --sign "${INSTALLER_ID}" "${UNSIGNED}" "${PKG_OUT}" >/dev/null
else
  cp "${UNSIGNED}" "${PKG_OUT}"
fi

# Confirm PackageInfo says non-relocatable /Applications.
EXP="${BUILD_TMP}/check"
pkgutil --expand "${PKG_OUT}" "${EXP}"
if ! rg -q 'install-location="/Applications"|install-location="/Applications/"' "${EXP}"/*/PackageInfo "${EXP}"/*/*/PackageInfo 2>/dev/null; then
  # productbuild nests the component; find BundleIsRelocatable
  if rg -q 'BundleIsRelocatable"></true>|BundleIsRelocatable</key><true' "${EXP}" 2>/dev/null; then
    echo "error: package is still relocatable" >&2
    exit 1
  fi
fi
echo "  install-location locked to /Applications"

NOTARIZED=0
if [[ -n "${SIGN_ID}" ]] && xcrun notarytool history --keychain-profile "${NOTARY_PROFILE}" >/dev/null 2>&1; then
  echo "▸ Notarizing…"
  # Submit from /tmp — Documents paths can confuse tooling under TCC.
  cp "${PKG_OUT}" "/tmp/Install-TalkToMe.pkg"
  xcrun notarytool submit "/tmp/Install-TalkToMe.pkg" \
    --keychain-profile "${NOTARY_PROFILE}" --wait
  xcrun stapler staple "/tmp/Install-TalkToMe.pkg"
  xcrun stapler staple "${APP_DIR}" || true
  cp "/tmp/Install-TalkToMe.pkg" "${PKG_OUT}"
  NOTARIZED=1
  echo "  notarized + stapled"
fi

rm -rf "${OUT}/extension"
cp -R "${ROOT}/extension/dist" "${OUT}/extension"
pkgutil --forget com.listen.tts.tray.installer >/dev/null 2>&1 || true
pkgutil --forget com.talktome.app.installer >/dev/null 2>&1 || true

echo ""
echo "▸ App:        ${APP_DIR}"
echo "▸ Installs to: /Applications/${APP_NAME}.app"
echo "▸ Installer:  ${PKG_OUT}   ← send this"
if [[ "${NOTARIZED}" -eq 1 ]]; then
  echo "▸ Gatekeeper: notarized"
fi
