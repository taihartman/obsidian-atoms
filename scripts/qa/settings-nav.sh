#!/bin/zsh
#
# settings-nav.sh "<row name>"   click the settings row with that exact name, then
#                                print the resulting row list
# settings-nav.sh --rows         print the current row list
# settings-nav.sh --first        print just the first row's name
# settings-nav.sh --home         click back until the main screen renders
# settings-nav.sh --close-sheet  dismiss any sheet over the settings tab
#
# Two things this exists to get right, both learned the hard way and both recorded
# in docs/qa/app-navigation-map.md:
#
#   * A back tap is not reliably one tap. Coming off the Account screen the first
#     click on the back row is routinely swallowed, so a scripted `back; back`
#     lands one screen short and everything after it drives the wrong surface.
#     `--home` loops until the screen it wants is the one rendering.
#   * A sheet's close button is absent on some sheets, so a single click can be a
#     silent no-op. `--close-sheet` clicks *and* sends Escape, then re-reads the
#     modal count rather than assuming.
#
# Prereqs: Obsidian open on the throwaway QA vault with the Atoms settings tab open.

# The QA vault lives in the main checkout. A linked worktree has none of its own, so
# resolve through the common git dir rather than this script's own tree.
MAIN_CHECKOUT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
VAULT="${ATOMS_QA_VAULT:-$MAIN_CHECKOUT/test_vault/test vault}"
cd "$VAULT"

ev() { obsidian eval "code=$1" 2>&1 | tail -1 | sed 's/^=> //' }

LIST='(()=>{const c=app.plugins.plugins.atoms.settingTab.containerEl;return JSON.stringify({scrollHeight:c.scrollHeight,client:c.clientHeight,items:[...c.querySelectorAll(".setting-item")].map(e=>(e.classList.contains("setting-item-heading")?"[H] ":"")+(e.querySelector(".setting-item-name")?.textContent||"").trim())})})()'
FIRST='(()=>{const c=app.plugins.plugins.atoms.settingTab.containerEl;return (c.querySelector(".setting-item .setting-item-name")?.textContent||"").trim()})()'
EXTRA='(()=>[...document.querySelectorAll(".modal-container .modal")].filter(m=>m!==app.setting.modalEl).length)()'

closeSheet() {
  for i in 1 2 3; do
    [[ "$(ev "$EXTRA" | tr -dc '0-9')" == "0" ]] && return 0
    ev '(()=>{const m=[...document.querySelectorAll(".modal-container .modal")].find(x=>x!==app.setting.modalEl);m?.closest(".modal-container")?.querySelector(".modal-close-button")?.click();document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}));return "dismiss"})()' >/dev/null
  done
  echo "sheet would not close"; return 1
}

click() {
  ev "(()=>{const c=app.plugins.plugins.atoms.settingTab.containerEl;const it=[...c.querySelectorAll('.setting-item')].find(e=>(e.querySelector('.setting-item-name')?.textContent||'').trim()===\"$1\");if(!it)return 'NOT FOUND';it.click();return 'clicked'})()"
  sleep 1
}

case "$1" in
  --rows)        ev "$LIST" ;;
  --first)       ev "$FIRST" ;;
  --close-sheet) closeSheet ;;
  --home)
    for i in 1 2 3 4 5; do
      f=$(ev "$FIRST")
      [[ "$f" == *Atoms* ]] && { echo "at main"; exit 0 }
      click "$f" >/dev/null
    done
    echo "could not get back to main (last: $(ev "$FIRST"))"; exit 1
    ;;
  "")            echo "usage: settings-nav.sh \"<row name>\" | --rows | --first | --home | --close-sheet" >&2; exit 2 ;;
  *)             click "$1"; ev "$LIST" ;;
esac
