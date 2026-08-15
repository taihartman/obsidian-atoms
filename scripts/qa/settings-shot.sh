#!/bin/zsh
#
# settings-shot.sh <dest-path> [sheet]
#
# Capture one Obsidian frame into <dest-path>, refusing anything that is not
# demonstrably the screen you meant. Pass `sheet` for a frame that is supposed to
# show a modal sheet over the settings tab.
#
# Four guards, each added after a reviewer found the frames it would have caught.
# `dev:screenshot` never errors, so without them a capture run reports success
# while filing evidence that is wrong in a way only a human eye catches:
#
#   1. two consecutive shots must agree      — the first shot after any scroll or
#                                               navigation is routinely the frame
#                                               from *before* the re-render
#   2. they must differ from the last frame  — a stale pair is perfectly stable,
#      this script wrote                       so agreement alone proves nothing
#   3. the modal count must match             — a sheet left open greys the whole
#                                               page, and a JS click still changes
#                                               routes underneath its scrim, so the
#                                               run keeps "working" with a modal in
#                                               every frame (this cost 14 of 16
#                                               frames once)
#   4. the caller asserts the route           — see settings-nav.sh; stability says
#                                               nothing about *which* screen settled
#
# Prereqs: Obsidian open on the throwaway QA vault, CLI enabled
# (Settings -> General -> Advanced -> Command line interface).
# Background: docs/qa/app-navigation-map.md, docs/qa/learnings.md.

set -e

# The QA vault lives in the main checkout. A linked worktree has none of its own, so
# resolve through the common git dir rather than this script's own tree.
MAIN_CHECKOUT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
VAULT="${ATOMS_QA_VAULT:-$MAIN_CHECKOUT/test_vault/test vault}"
DEST="$1"
WANT_SHEET="$2"
PREV_FILE="${TMPDIR:-/tmp}/atoms-shot-prev-md5"

if [[ -z "$DEST" ]]; then
  echo "usage: settings-shot.sh <dest-path> [sheet]" >&2
  exit 2
fi
cd "$VAULT"

# Guard 3 — modal count.
EXTRA=$(obsidian eval 'code=(()=>[...document.querySelectorAll(".modal-container .modal")].filter(m=>m!==app.setting.modalEl).length)()' 2>&1 | tail -1 | tr -dc '0-9')
if [[ "$WANT_SHEET" == "sheet" && "$EXTRA" != "1" ]]; then
  echo "NO SHEET $DEST — expected the sheet open, found $EXTRA extra modal(s)"; exit 1
fi
if [[ "$WANT_SHEET" != "sheet" && "$EXTRA" != "0" ]]; then
  echo "MODAL OPEN $DEST — $EXTRA unexpected modal(s) over the page"; exit 1
fi

# Guards 1 and 2 — settled, and not the previous state.
PREV=$(cat "$PREV_FILE" 2>/dev/null)
HA=""; HB=""; FAIL=""
for i in 1 2 3 4 5; do
  A=$(obsidian dev:screenshot 2>&1 | tail -1)
  sleep 1
  B=$(obsidian dev:screenshot 2>&1 | tail -1)
  HA=$(md5 -q "$A"); HB=$(md5 -q "$B")
  if [[ "$HA" == "$HB" && "$HB" != "$PREV" ]]; then break; fi
  # Why this pass failed, kept for the message after the loop. Clearing HB is what ends the
  # loop in a failed state, so without remembering the reason first, a settled-but-stale pair
  # would be reported as "never agreed" — the opposite of what it is, and the harder bug to find.
  if [[ "$HA" == "$HB" ]]; then
    echo "  (still the previous state, pass $i: $HB)"
    FAIL=stale
  else
    echo "  (unsettled pass $i: $HA vs $HB)"
    FAIL=unsettled
  fi
  rm -f "$A" "$B"; HB=""
  sleep 1
done

if [[ -z "$HB" || "$HA" != "$HB" ]]; then
  rm -f "$A" "$B"
  if [[ "$FAIL" == "stale" ]]; then
    echo "STALE $DEST — settled, but identical to the previous state's frame ($PREV)"; exit 1
  fi
  echo "UNSTABLE $DEST — two shots never agreed"; exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp "$B" "$DEST"
rm -f "$A" "$B"
print -r -- "$HB" > "$PREV_FILE"
echo "OK $(basename "$DEST") md5=$HB size=$(stat -f%z "$DEST")"
