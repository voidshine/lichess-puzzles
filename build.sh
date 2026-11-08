#!/usr/bin/env bash
# Packages the plugin as out/lichess_puzzles.zip. The archive holds a single
# lichess_puzzles/ folder: extract it into /plugins (or /.crosspoint/plugins)
# on the SD card.
set -euo pipefail
cd "$(dirname "$0")"

NAME=lichess_puzzles
FILES=(manifest.json plugin.js README.md)

command -v zip >/dev/null || { echo "build.sh: zip is required" >&2; exit 1; }
if command -v node >/dev/null; then
  node --check src/plugin.js
  node -e 'JSON.parse(require("fs").readFileSync("src/manifest.json", "utf8"))'
fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/$NAME" out
for f in "${FILES[@]}"; do cp "src/$f" "$stage/$NAME/"; done

rm -f "out/$NAME.zip"
(cd "$stage" && zip -qr -X - "$NAME") > "out/$NAME.zip"
echo "out/$NAME.zip"
