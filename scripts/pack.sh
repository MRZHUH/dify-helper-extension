#!/usr/bin/env bash
# Produce a zip ready for upload to the Chrome Web Store / Edge Add-ons.
# Only the files the extension actually needs at runtime are packed —
# README / PRIVACY / LICENSE / images / .git stay out so the package is
# as small and clean as possible. Keep those documents on GitHub instead.
#
# Usage:   ./scripts/pack.sh
# Output:  dist/dify-helper-<version>.zip

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
OUT_DIR="dist"
OUT="${OUT_DIR}/dify-helper-${VERSION}.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT"

zip "$OUT" \
  manifest.json \
  content.js \
  icons/icon-16.png \
  icons/icon-32.png \
  icons/icon-48.png \
  icons/icon-128.png \
  -x "*.DS_Store" \
  >/dev/null

echo "Built: $OUT"
echo "Size:  $(du -h "$OUT" | cut -f1)"
echo
echo "Contents:"
unzip -l "$OUT" | tail -n +2
