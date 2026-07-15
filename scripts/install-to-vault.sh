#!/usr/bin/env bash
# Install Atoms into the throwaway test vault and reload via Obsidian CLI when available.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${1:-$ROOT/test_vault/test vault}"
DEST="$VAULT/.obsidian/plugins/atoms"
PLUGIN_ID="atoms"

cd "$ROOT"
npm run build

mkdir -p "$DEST"
cp "$ROOT/main.js" "$ROOT/manifest.json" "$ROOT/styles.css" "$DEST/"

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

  # Prefer cwd = vault so the CLI targets this vault by default.
  (
    cd "$VAULT"
    if obsidian plugin:reload "id=$PLUGIN_ID" 2>/dev/null; then
      echo "Reloaded plugin via CLI: $PLUGIN_ID"
      return 0
    fi
    # Fallback: vault name parameter (name as in vault switcher)
    local name
    name="$(basename "$VAULT")"
    if obsidian "vault=$name" plugin:reload "id=$PLUGIN_ID" 2>/dev/null; then
      echo "Reloaded plugin via CLI (vault=$name): $PLUGIN_ID"
      return 0
    fi
    echo "CLI present but plugin:reload failed — is Obsidian open on this vault?"
    return 1
  )
}

if reload_plugin; then
  exit 0
fi
exit 0
