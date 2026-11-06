#!/usr/bin/env bash
# Build "LaTeX Studio.app" (double-click to use) into ~/Applications. Re-run after updating the code.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$HOME/Applications}/LaTeX Studio.app"
cd "$ROOT"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -q -e .; }
(cd web && { [ -d node_modules ] || npm install --silent; } && npm run build >/dev/null)

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
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>LSMinimumSystemVersion</key><string>11.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>CFBundleDocumentTypes</key><array><dict><key>CFBundleTypeName</key><string>Folder</string><key>CFBundleTypeRole</key><string>Editor</string><key>LSItemContentTypes</key><array><string>public.folder</string></array></dict></array>
</dict></plist>
PL

cat > "$APP/Contents/MacOS/LaTeXStudio" <<LAUNCH
#!/bin/bash
# This process is the LaTeX Studio server (it quits by itself after 30 idle minutes); the window is opened once it answers.
ROOT="$ROOT"
PORT=8700
URL="http://127.0.0.1:\$PORT"
LOG="\$HOME/.latexstudio/server.log"
mkdir -p "\$HOME/.latexstudio"
export PATH="/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:\$PATH"
window() {
  if [ -d "/Applications/Google Chrome.app" ]; then open -na "Google Chrome" --args --app="\$URL" --user-data-dir="\$HOME/.latexstudio/window"
  elif [ -d "/Applications/Microsoft Edge.app" ]; then open -na "Microsoft Edge" --args --app="\$URL" --user-data-dir="\$HOME/.latexstudio/window"
  else open "\$URL"; fi
}
if curl -fs "\$URL/api/v1/status" >/dev/null 2>&1; then window; exit 0; fi      # already running: just another window
( for _ in \$(seq 1 80); do curl -fs "\$URL/api/v1/status" >/dev/null 2>&1 && break; sleep 0.25; done; window ) &
exec "\$ROOT/.venv/bin/python" -m latexstudio --no-browser --port \$PORT --idle-exit 30 >>"\$LOG" 2>&1
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
echo "Installed: $APP"
