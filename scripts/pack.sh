#!/usr/bin/env bash
# Produce a zip ready for upload to Chrome Web Store / Edge Add-ons.
# Usage:   ./scripts/pack.sh
# Output:  dify-helper-<version>.zip in the repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
OUT="dify-helper-${VERSION}.zip"

rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  content.js \
  icons/icon-16.png \
  icons/icon-32.png \
  icons/icon-48.png \
  icons/icon-128.png \
  icons/icon.svg \
  LICENSE \
  PRIVACY.md \
  README.md \
  -x "*.DS_Store" \
  >/dev/null

echo "Built: $OUT"
unzip -l "$OUT"
