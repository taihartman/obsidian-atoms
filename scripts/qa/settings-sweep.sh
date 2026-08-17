#!/bin/zsh
#
# settings-sweep.sh <suffix> <out-dir>
#   e.g. settings-sweep.sh 390x844 docs/qa/screenshots/settings-ux-redesign
#
# Capture every settings route at the current viewport. Asserts the expected first
# row before each frame — settings-shot.sh proves the renderer settled, this proves
# it settled on the screen you meant. A route that does not match aborts the run
# rather than filing a frame under the wrong name.
#
# Set the viewport first; this script does not touch it. To reach a real device
# class (the window resize alone is not enough — the renderer stays pinned to its
# previous emulated metrics):
#
#   obsidian eval 'code=(()=>{require("@electron/remote").getCurrentWindow().setContentSize(390,844);app.emulateMobile(false);return "off"})()'
#   sleep 8
#   obsidian eval 'code=(()=>{app.emulateMobile(true);return "on"})()'
#   sleep 8
#   obsidian eval 'code=JSON.stringify([...document.body.classList].filter(c=>/phone|tablet/.test(c)))'
#
# Assert `is-phone` at 390x844 and `is-tablet` at 768x1024 before trusting a frame.
# Note that `is-tablet` keeps the settings nav sidebar, so a group there is ~410px
# wide inside a 768px window — see docs/qa/app-navigation-map.md.

set -e

SFX="$1"
OUT="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
SHOT="$HERE/settings-shot.sh"
NAV="$HERE/settings-nav.sh"
# The QA vault lives in the main checkout. A linked worktree has none of its own, so
# resolve through the common git dir rather than this script's own tree.
MAIN_CHECKOUT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
VAULT="${ATOMS_QA_VAULT:-$MAIN_CHECKOUT/test_vault/test vault}"

if [[ -z "$SFX" || -z "$OUT" ]]; then
  echo "usage: settings-sweep.sh <suffix> <out-dir>" >&2
  exit 2
fi

ev() { cd "$VAULT"; obsidian eval "code=$1" 2>&1 | tail -1 | sed 's/^=> //' }
scroll() { ev "(()=>{const c=app.plugins.plugins.atoms.settingTab.containerEl;c.scrollTop=$1;return Math.round(c.scrollTop)})()" >/dev/null }
at() {
  local got=$("$NAV" --first)
  [[ "$got" == *"$1"* ]] || { echo "WRONG SCREEN: wanted '$1', on '$got'"; return 1 }
  echo "  on: $got"
}

"$NAV" --close-sheet >/dev/null
"$NAV" --home >/dev/null
scroll 0
at "Atoms"

"$SHOT" "$OUT/u3-root-top-$SFX.png"
scroll 700;    "$SHOT" "$OUT/u3-root-mid-$SFX.png"
scroll 999999; "$SHOT" "$OUT/u5-root-bottom-$SFX.png"
scroll 0

"$NAV" "Who does the filing" >/dev/null; at "Who does the filing"
"$SHOT" "$OUT/u4-engine-$SFX.png"
scroll 999999; "$SHOT" "$OUT/u4-engine-bottom-$SFX.png"; scroll 0

"$NAV" "Set up automatic filing" >/dev/null; at "Account"
"$SHOT" "$OUT/u8-account-signedout-top-$SFX.png"
scroll 999999; "$SHOT" "$OUT/u8-account-signedout-bottom-$SFX.png"; scroll 0
"$NAV" --home >/dev/null

"$NAV" "Privacy and consents" >/dev/null; at "Privacy and consents"
"$SHOT" "$OUT/u6-privacy-$SFX.png"
"$NAV" --home >/dev/null

"$NAV" "Advanced" >/dev/null; at "Advanced"
"$SHOT" "$OUT/u7-advanced-top-$SFX.png"
scroll 999999; "$SHOT" "$OUT/u7-advanced-bottom-$SFX.png"; scroll 0
"$NAV" --home >/dev/null

"$NAV" "Capture on your phone" >/dev/null
ev '(()=>{const m=[...document.querySelectorAll(".modal-container .modal")].find(x=>x!==app.setting.modalEl);return JSON.stringify({sheet:!!m,steps:m?m.querySelectorAll(".atoms-capture-steps li").length:0})})()'
"$SHOT" "$OUT/u9-capture-sheet-$SFX.png" sheet
"$NAV" --close-sheet >/dev/null

echo "DONE — now LOOK at the frames. Every guard here was added after a reviewer"
echo "found bad evidence that the guards in place at the time had passed."
