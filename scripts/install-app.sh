#!/usr/bin/env bash
# Build "LaTeX Studio.app" (double-click to use) into ~/Applications. Re-run after updating the code.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$HOME/Applications}/LaTeX Studio.app"
cd "$ROOT"
(cd web && { [ -d node_modules ] || npm install --silent; } && npm run build >/dev/null)

# The app runs from a private copy in Application Support: macOS blocks apps started from Finder from reading
# Desktop/Documents/Downloads, so it must not depend on this source folder.
RT="$HOME/Library/Application Support/LatexStudio/runtime"
rm -rf "$RT/latexstudio" "$RT/web"; mkdir -p "$RT/web"
cp -R latexstudio pyproject.toml "$RT/"; cp -R web/dist "$RT/web/dist"
[ -x "$RT/.venv/bin/python" ] || python3 -m venv "$RT/.venv"
"$RT/.venv/bin/pip" install -q "$RT"

rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cat > "$APP/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>LaTeX Studio</string>
<key>CFBundleDisplayName</key><string>LaTeX Studio</string>
<key>CFBundleIdentifier</key><string>app.latexstudio</string>
<key>CFBundleExecutable</key><string>LaTeXStudio</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>CFBundleDocumentTypes</key><array><dict><key>CFBundleTypeName</key><string>Folder</string><key>CFBundleTypeRole</key><string>Editor</string><key>LSItemContentTypes</key><array><string>public.folder</string></array></dict></array>
</dict></plist>
PL

cat > "$APP/Contents/MacOS/LaTeXStudio" <<LAUNCH
#!/bin/bash
# This process is the LaTeX Studio server (it quits by itself after 30 idle minutes); the window is opened once it answers.
RT="$RT"
PORT=8700
URL="http://127.0.0.1:\$PORT"
LOG="\$HOME/.latexstudio/server.log"
mkdir -p "\$HOME/.latexstudio"
export PATH="/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:\$PATH"
export LATEXSTUDIO_WEB="\$RT/web/dist"
window() {   # window [path]
  local u="\$URL\$1"
  if [ -d "/Applications/Google Chrome.app" ]; then open -na "Google Chrome" --args --app="\$u" --user-data-dir="\$HOME/.latexstudio/window"
  elif [ -d "/Applications/Microsoft Edge.app" ]; then open -na "Microsoft Edge" --args --app="\$u" --user-data-dir="\$HOME/.latexstudio/window"
  else open "\$u"; fi
}
ready() { curl -fs "\$URL/api/v1/status" >/dev/null 2>&1; }
# the system file chooser first (a .tex file, an Overleaf .zip or a folder), then the window on that project
choose_and_open() {
  local picked id
  picked=\$(osascript -e 'tell application "System Events" to activate' -e 'POSIX path of (choose file with prompt "Choose your main .tex file or an Overleaf .zip (Cancel to pick a folder)" of type {"tex", "public.plain-text", "zip", "public.zip-archive"})' 2>/dev/null)
  if [ -z "\$picked" ]; then
    picked=\$(osascript -e 'tell application "System Events" to activate' -e 'POSIX path of (choose folder with prompt "Choose the folder of your LaTeX project")' 2>/dev/null)
  fi
  for _ in \$(seq 1 80); do ready && break; sleep 0.25; done
  if ! ready; then osascript -e 'display alert "LaTeX Studio could not start" message "See ~/.latexstudio/server.log" as critical' >/dev/null 2>&1; return; fi
  if [ -z "\$picked" ]; then window "/"; return; fi
  id=\$(curl -fs -X POST -H 'Content-Type: application/json' -d "{\\"path\\": \\"\$(printf '%s' "\$picked" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')\\"}" "\$URL/api/v1/projects/open-path" | "\$RT/.venv/bin/python" -c 'import json,sys;print(json.load(sys.stdin)["id"])' 2>/dev/null)
  if [ -n "\$id" ]; then window "/p/\$id"
  else osascript -e 'display alert "That could not be opened" message "Choose a .tex file, an Overleaf .zip or a folder that contains a .tex file." as warning' >/dev/null 2>&1; window "/"; fi
}
if ready; then choose_and_open; exit 0; fi      # already running: just another window
choose_and_open &
exec "\$RT/.venv/bin/python" -m latexstudio --no-browser --port \$PORT --idle-exit 30 >>"\$LOG" 2>&1
LAUNCH
chmod +x "$APP/Contents/MacOS/LaTeXStudio"

# icon: the favicon drawn to PNGs with PyMuPDF, packed with iconutil
SET="$(mktemp -d)/AppIcon.iconset"; mkdir -p "$SET"
.venv/bin/python - "$SET" <<'PY'
import sys, pymupdf
svg = open("web/public/favicon.svg", "rb").read()
doc = pymupdf.open(stream=svg, filetype="svg")
for base in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        px = base * scale
        page = doc[0]
        pix = page.get_pixmap(matrix=pymupdf.Matrix(px / page.rect.width, px / page.rect.height), alpha=True)
        pix.save(f"{sys.argv[1]}/icon_{base}x{base}{'@2x' if scale == 2 else ''}.png")
PY
iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns"
touch "$APP"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
xattr -cr "$APP" 2>/dev/null || true
echo "Installed: $APP"
