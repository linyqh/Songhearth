#!/usr/bin/env bash
# Builds the macOS .dmg locally and uploads it to GitHub Release v<version>, the same release
# the Windows CI job (.github/workflows/release-windows.yml) uploads its installer to.
#   scripts/release-macos.sh [--skip-build] [--publish]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_BUILD=0
PUBLISH=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --publish) PUBLISH=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
TAG="v$VERSION"

if ! git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null; then
  echo "tag $TAG is not on origin; run: git tag $TAG && git push origin $TAG" >&2
  exit 1
fi
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "$TAG^{commit}" 2>/dev/null)" ] || [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "warning: working tree differs from $TAG; the uploaded dmg will not match the tagged source" >&2
fi

# Sign with the Developer ID certificate in the login keychain (tauri build signs when
# APPLE_SIGNING_IDENTITY is set), then notarize with a notarytool keychain profile, created once via
# `xcrun notarytool store-credentials <name> --apple-id <id> --team-id <team>`.
if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  APPLE_SIGNING_IDENTITY="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: .*\)"$/\1/p' | head -n 1)"
fi
if [ -z "$APPLE_SIGNING_IDENTITY" ]; then
  echo "no Developer ID Application certificate in the keychain; set APPLE_SIGNING_IDENTITY" >&2
  exit 1
fi
export APPLE_SIGNING_IDENTITY
NOTARY_PROFILE="${NOTARY_PROFILE:-murmur-notary}"
echo "signing with: $APPLE_SIGNING_IDENTITY; notarizing with keychain profile: $NOTARY_PROFILE"
xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null

if [ "$SKIP_BUILD" = 0 ]; then
  npm ci
  npm run fetch-engine
  npm run tauri -- build
fi

shopt -s nullglob
DMGS=(src-tauri/target/release/bundle/dmg/Songhearth_"$VERSION"_*.dmg)
if [ ${#DMGS[@]} -eq 0 ]; then
  echo "no dmg for $VERSION under src-tauri/target/release/bundle/dmg/" >&2
  exit 1
fi

APP=src-tauri/target/release/bundle/macos/Songhearth.app
codesign --verify --deep --strict "$APP"
for f in "$APP" "${DMGS[@]}"; do
  if ! grep -qF "Authority=$APPLE_SIGNING_IDENTITY" <<<"$(codesign -dvv "$f" 2>&1)"; then
    echo "$f is not signed by $APPLE_SIGNING_IDENTITY" >&2
    exit 1
  fi
done

for dmg in "${DMGS[@]}"; do
  if ! xcrun stapler validate "$dmg" >/dev/null 2>&1; then
    xcrun notarytool submit "$dmg" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$dmg"
  fi
  spctl -a -vv -t open --context context:primary-signature "$dmg"
done

if ! gh release view "$TAG" >/dev/null 2>&1; then
  gh release create "$TAG" --draft --verify-tag --title "Songhearth $TAG" --generate-notes \
    || gh release view "$TAG" >/dev/null
fi
gh release upload "$TAG" "${DMGS[@]}" --clobber
if [ "$PUBLISH" = 1 ]; then
  gh release edit "$TAG" --draft=false
fi
gh release view "$TAG" --json url,isDraft,assets -q '"\(.url) draft=\(.isDraft)\n" + ([.assets[].name] | join("\n"))'
