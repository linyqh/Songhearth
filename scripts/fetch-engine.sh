#!/usr/bin/env bash
# Downloads the audio.cpp release for macOS and stages the files the app
# bundles (CLI, model specs, licence) into src-tauri/resources/engine.
set -euo pipefail

VERSION="${AUDIOCPP_VERSION:-0.9.4}"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) PKG_ARCH=arm64 ;;
  x86_64) PKG_ARCH=x64 ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/resources/engine"
URL="https://github.com/0xShug0/audio.cpp/releases/download/v${VERSION}/audio-v${VERSION}-bin-macos-${PKG_ARCH}-metal.tar.gz"

if [[ -x "$DEST/audiocpp_cli" ]] && "$DEST/audiocpp_cli" --version 2>/dev/null | grep -q "audio.cpp ${VERSION}"; then
  echo "audio.cpp ${VERSION} already staged in $DEST"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "Downloading $URL"
curl -fL --progress-bar -o "$TMP/engine.tar.gz" "$URL"
tar -xzf "$TMP/engine.tar.gz" -C "$TMP" audiocpp_cli LICENSE model_specs

find "$DEST" -mindepth 1 ! -name .gitkeep -exec rm -rf {} +
mkdir -p "$DEST"
mv "$TMP/audiocpp_cli" "$TMP/LICENSE" "$TMP/model_specs" "$DEST/"
"$DEST/audiocpp_cli" --version | head -1
echo "Staged into $DEST"
