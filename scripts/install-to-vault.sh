#!/usr/bin/env bash
# Install Atoms into the throwaway test vault and reload via Obsidian CLI when available.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# There is one throwaway vault on this machine and it lives in the MAIN checkout. Defaulting to
# `$ROOT` meant every worktree minted its own `test_vault/test vault` and installed into that,
# while the Obsidian CLI — which resolves by vault *name* — went on answering for the main one.
# The guard at the bottom has been catching that as "the CLI answered for a different vault"; the
# cause was this line. It also gave the #516 lock a different key per worktree, which would have
# made the lock useless for the exact contention it exists to stop.
GIT_COMMON="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")"
if [ -n "$GIT_COMMON" ]; then MAIN_CHECKOUT="$(dirname "$GIT_COMMON")"; else MAIN_CHECKOUT="$ROOT"; fi
VAULT="${1:-$MAIN_CHECKOUT/test_vault/test vault}"
DEST="$VAULT/.obsidian/plugins/atoms"
PLUGIN_ID="atoms"

# One writer at a time (#516). This is the destructive step: it replaces `main.js` in a vault that
# every agent session on this machine drives through the same running Obsidian, so this is where
# the lock belongs. It is taken when free and refused when another worktree holds it, rather than
# demanded up front, so an existing agent prompt that just runs this script keeps working.
#
# `ATOMS_SKIP_VAULT_LOCK=1` is for a human who knows they are alone with their own vault. It is
# not a way past a peer who is mid-pass.
LOCK_SH="$ROOT/scripts/qa-vault-lock.sh"
if [ "${ATOMS_SKIP_VAULT_LOCK:-}" != "1" ] && [ -x "$LOCK_SH" ]; then
  if ! "$LOCK_SH" acquire --vault "$VAULT" --note "install-to-vault"; then
    echo "" >&2
    echo "REFUSING to install: another session is driving this vault." >&2
    echo "Installing now would swap the build out from under its pass, which is the exact" >&2
    echo "failure this lock exists to stop. See docs/qa/README.md § Vault lock." >&2
    exit 3
  fi
fi

cd "$ROOT"
npm run build

mkdir -p "$DEST"
cp "$ROOT/main.js" "$ROOT/manifest.json" "$ROOT/styles.css" "$DEST/"
VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version)")
echo "Installed Atoms v${VERSION} → $DEST"

node -e '
const fs = require("fs");
const path = require("path");
const vault = process.argv[1];
const dest = process.argv[2];
const p = path.join(vault, ".obsidian", "community-plugins.json");
let arr = [];
try { arr = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
if (!Array.isArray(arr)) arr = [];
// Drop old plugin id if present
arr = arr.filter((id) => id !== "ai-linker");
if (!arr.includes("atoms")) arr.push("atoms");
fs.mkdirSync(path.dirname(p), { recursive: true });
fs.writeFileSync(p, JSON.stringify(arr, null, 2) + "\n");
console.log("enabled:", arr.join(", "));
console.log("installed →", dest);
' "$VAULT" "$DEST"

reload_plugin() {
  if ! command -v obsidian >/dev/null 2>&1; then
    echo "Obsidian CLI not on PATH — skip reload."
    echo "  Enable: Settings → General → Command line interface (needs installer 1.12+)."
    echo "  Docs: docs/dev-obsidian-cli.md"
    return 1
  fi

  # The CLI resolves a target by vault *name*, and otherwise by whichever Obsidian window is
  # focused. It does NOT resolve by working directory — an earlier version of this function
  # assumed it did, cd'd into the vault, and printed "Reloaded" after reloading a different
  # vault entirely. That failure is silent and expensive: the next QA run drives a stale build
  # and every conclusion it reaches is about the wrong binary.
  #
  # Vault names are not unique either. Each worktree can mint its own `test_vault/test vault`,
  # so on a machine with several checkouts the name is genuinely ambiguous. Hence: name the
  # target explicitly, then make the CLI tell us which vault answered, and refuse to claim
  # success unless it is the one we just wrote to.
  local name resolved want
  name="$(basename "$VAULT")"
  want="$(cd "$VAULT" && pwd -P)"

  if ! obsidian "vault=$name" plugin:reload "id=$PLUGIN_ID" >/dev/null 2>&1; then
    echo "CLI present but plugin:reload failed — is Obsidian open on the vault '$name'?"
    return 1
  fi

  # `plugin:reload` exits 0 even for a vault Obsidian has never opened, so its status is not
  # evidence of anything. Ask which vault actually answered instead.
  resolved="$(obsidian "vault=$name" eval 'code=app.vault.adapter.basePath' 2>/dev/null \
    | tail -1 | sed -e 's/^=> *//' -e 's/^"//' -e 's/"$//')"

  if [ -z "$resolved" ] || [ ! -d "$resolved" ]; then
    echo "REFUSING to report success — no open vault named '$name' answered the CLI."
    [ -n "$resolved" ] && echo "  CLI said: $resolved"
    echo "  installed to: $want"
    echo "  Open Obsidian on that vault, then re-run, or reload the plugin by hand."
    return 1
  fi

  resolved="$(cd "$resolved" && pwd -P)"
  if [ "$resolved" != "$want" ]; then
    echo "REFUSING to report success — the CLI answered for a different vault."
    echo "  installed to: $want"
    echo "  CLI reached:  $resolved"
    echo "  More than one vault is named '$name'. Rename one, or focus Obsidian on the intended vault."
    return 1
  fi

  echo "Reloaded plugin via CLI (vault=$name): $PLUGIN_ID"
  return 0
}

if reload_plugin; then
  exit 0
fi
exit 0
