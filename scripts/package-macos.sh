#!/bin/bash
# Build a local, double-clickable LearnDeck.app for macOS.
#
# This is developer tooling for trying LearnDeck as an app on your own
# machine. It is not signed, not notarized, and not a distribution channel;
# the supported install for v0.1 remains cloning the repository.
#
# What it produces: dist/LearnDeck.app
#   Contents/Resources/learndeck/   compiled server + public/ courses/ references/
#   Contents/MacOS/LearnDeck        native AppKit/WKWebView executable
#   Launch: starts the server on a free port and opens a native app window.
#   Quit (Cmd+Q or Dock icon > Quit): stops the server.
#
# Data lives outside the app so rebuilds never touch progress:
#   ~/Library/Application Support/LearnDeck/progress.db and course-cache/
#
# Known limitation: connecting an AI guide from the app writes an MCP entry
# pointing at THIS repository checkout (LearnDeckRoot is baked into
# Contents/Info.plist; it needs src/mcp.ts plus installed dependencies), so
# keep the repo where it is or reconnect after moving it.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$REPO/dist"
APP="$DIST/LearnDeck.app"
PAYLOAD_STAGE="$DIST/.macos-payload"
SWIFT_MODULE_CACHE_PATH="${TMPDIR:-/tmp}/learndeck-swift-module-cache"

command -v swiftc >/dev/null || { echo "swiftc not found (macOS required)"; exit 1; }
command -v bun >/dev/null || { echo "bun not found"; exit 1; }
mkdir -p "$SWIFT_MODULE_CACHE_PATH"

echo "==> Compiling server binary"
rm -rf "$PAYLOAD_STAGE"
mkdir -p "$PAYLOAD_STAGE"
(cd "$REPO" && bun build ./src/server.ts --compile --outfile "$PAYLOAD_STAGE/learndeck-server")

echo "==> Staging payload"
cp -R "$REPO/public" "$PAYLOAD_STAGE/public"
cp -R "$REPO/courses" "$PAYLOAD_STAGE/courses"
cp -R "$REPO/references" "$PAYLOAD_STAGE/references"

echo "==> Building app bundle"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# LearnDeckRoot is the one package-time value the native shell cannot derive
# after the app is moved. The Swift app reads it from this hand-written plist
# and computes all other paths at launch.
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>LearnDeck</string>
	<key>CFBundleDisplayName</key>
	<string>LearnDeck</string>
	<key>CFBundleIdentifier</key>
	<string>dev.learndeck.local</string>
	<key>CFBundleExecutable</key>
	<string>LearnDeck</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>0.4.0</string>
	<key>CFBundleVersion</key>
	<string>0.4.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>LSMinimumSystemVersion</key>
	<string>12.0</string>
	<key>LearnDeckRoot</key>
	<string>$REPO</string>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsLocalNetworking</key>
		<true/>
	</dict>
</dict>
</plist>
PLIST

(cd "$REPO" && CLANG_MODULE_CACHE_PATH="$SWIFT_MODULE_CACHE_PATH" swiftc -O -parse-as-library native/macos/LearnDeckApp.swift \
  -o "$APP/Contents/MacOS/LearnDeck" \
  -framework AppKit -framework WebKit)

mv "$PAYLOAD_STAGE" "$APP/Contents/Resources/learndeck"

echo "==> Done: $APP"
echo "    open \"$APP\""
