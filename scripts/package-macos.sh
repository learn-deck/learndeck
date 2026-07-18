#!/bin/bash
# Build a local, double-clickable LearnDeck.app for macOS.
#
# This is developer tooling for trying LearnDeck as an app on your own
# machine. It is not signed, not notarized, and not a distribution channel;
# the supported install for v0.1 remains cloning the repository.
#
# What it produces: dist/LearnDeck.app
#   Contents/Resources/learndeck/   compiled server + public/ courses/ references/
#   Launch: starts the server on a free port and opens your browser.
#   Quit (Dock icon > Quit): stops the server.
#
# Data lives outside the app so rebuilds never touch progress:
#   ~/Library/Application Support/LearnDeck/progress.db and course-cache/
#
# Known limitation: connecting an AI guide from the app writes an MCP entry
# pointing at THIS repository checkout (it needs src/mcp.ts plus installed
# dependencies), so keep the repo where it is or reconnect after moving it.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$REPO/dist"
APP="$DIST/LearnDeck.app"
PAYLOAD_STAGE="$DIST/.macos-payload"

command -v osacompile >/dev/null || { echo "osacompile not found (macOS required)"; exit 1; }
command -v bun >/dev/null || { echo "bun not found"; exit 1; }

echo "==> Compiling server binary"
rm -rf "$PAYLOAD_STAGE"
mkdir -p "$PAYLOAD_STAGE"
(cd "$REPO" && bun build ./src/server.ts --compile --outfile "$PAYLOAD_STAGE/learndeck-server")

echo "==> Staging payload"
cp -R "$REPO/public" "$PAYLOAD_STAGE/public"
cp -R "$REPO/courses" "$PAYLOAD_STAGE/courses"
cp -R "$REPO/references" "$PAYLOAD_STAGE/references"

cat > "$PAYLOAD_STAGE/launch.sh" <<LAUNCH
#!/bin/bash
set -euo pipefail
HERE="\$(cd "\$(dirname "\$0")" && pwd)"
DATA="\$HOME/Library/Application Support/LearnDeck"
mkdir -p "\$DATA"

PORT=3030
while lsof -nP -iTCP:\$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=\$((PORT+1)); done

export LEARNDECK_PUBLIC_DIR="\$HERE/public"
export LEARNDECK_COURSES_DIR="\$HERE/courses"
export LEARNDECK_DB_PATH="\$DATA/progress.db"
export LEARNDECK_COURSE_CACHE_DIR="\$DATA/course-cache"
export LEARNDECK_ROOT="$REPO"
export PORT

nohup "\$HERE/learndeck-server" >> "\$DATA/server.log" 2>&1 &
echo \$! > "\$DATA/server.pid"
echo \$PORT > "\$DATA/server.port"

for _ in \$(seq 1 40); do
  if curl -s -o /dev/null "http://127.0.0.1:\$PORT/"; then break; fi
  sleep 0.25
done
open "http://127.0.0.1:\$PORT/"
LAUNCH
chmod +x "$PAYLOAD_STAGE/launch.sh"

echo "==> Building app bundle"
rm -rf "$APP"
APPLET_SRC="$DIST/.learndeck-applet.applescript"
cat > "$APPLET_SRC" <<'APPLET'
on run
	set resourceRoot to POSIX path of (path to resource "learndeck")
	do shell script quoted form of (resourceRoot & "/launch.sh")
end run

on idle
	return 3600
end idle

on quit
	set dataDir to POSIX path of (path to application support folder from user domain) & "LearnDeck"
	try
		do shell script "kill $(cat " & quoted form of (dataDir & "/server.pid") & ") 2>/dev/null; rm -f " & quoted form of (dataDir & "/server.pid")
	end try
	continue quit
end quit
APPLET
osacompile -s -o "$APP" "$APPLET_SRC"
rm -f "$APPLET_SRC"

mv "$PAYLOAD_STAGE" "$APP/Contents/Resources/learndeck"
/usr/libexec/PlistBuddy -c "Set :CFBundleName LearnDeck" "$APP/Contents/Info.plist" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c "Add :CFBundleName string LearnDeck" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string dev.learndeck.local" "$APP/Contents/Info.plist" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier dev.learndeck.local" "$APP/Contents/Info.plist"

echo "==> Done: $APP"
echo "    open \"$APP\""
