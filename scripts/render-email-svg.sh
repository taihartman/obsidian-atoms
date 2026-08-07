#!/usr/bin/env bash
# Rasterize Field notes illustrations: www/src/email/*.svg -> matching *.png
#
# Chrome, not ImageMagick. `magick` falls back to its own MSVG renderer when
# librsvg is absent (it is, on this machine), which drops gradients and picks
# the wrong font metrics. Chrome renders the same engine the site does, with
# real SF Pro for system-ui, and honours transparency at the plate corners.
#
# Usage: scripts/render-email-svg.sh [file.svg ...]   (default: all fn-*.svg)
set -euo pipefail

cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME" >&2; exit 1; }

profile="$(mktemp -d)"
trap 'rm -rf "$profile"' EXIT

files=("$@")
[ ${#files[@]} -eq 0 ] && files=(www/src/email/fn-*.svg)

for svg in "${files[@]}"; do
  png="${svg%.svg}.png"
  # Canvas size comes from the SVG's own width/height so the PNG is 1:1.
  w=$(sed -n 's/.*<svg[^>]*[^-]width="\([0-9]*\)".*/\1/p' "$svg" | head -1)
  h=$(sed -n 's/.*<svg[^>]*[^-]height="\([0-9]*\)".*/\1/p' "$svg" | head -1)
  [ -n "$w" ] && [ -n "$h" ] || { echo "no width/height on <svg> in $svg" >&2; exit 1; }

  # Headless Chrome writes the screenshot and then does not exit here, so cap it
  # with an alarm; the PNG is already on disk by the time the alarm fires.
  perl -e 'alarm 25; exec @ARGV' \
    "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --user-data-dir="$profile" --force-device-scale-factor=1 \
    --default-background-color=00000000 --virtual-time-budget=3000 \
    --window-size="$w,$h" --screenshot="$png" "file://$PWD/$svg" \
    >/dev/null 2>&1 || true

  [ -s "$png" ] || { echo "render failed: $svg" >&2; exit 1; }
  echo "$png  ${w}x${h}"
done
