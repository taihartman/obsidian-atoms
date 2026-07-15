#!/usr/bin/env bash
# Run U1 spike commands via official Obsidian CLI against the throwaway vault.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${1:-$ROOT/test_vault/test vault}"

if ! command -v obsidian >/dev/null 2>&1; then
  echo "error: obsidian CLI not found on PATH"
  echo "See docs/dev-obsidian-cli.md"
  exit 1
fi

run() {
  local id="$1"
  echo "——— command id=$id ———"
  (
    cd "$VAULT"
    obsidian command "id=$id" || obsidian "vault=$(basename "$VAULT")" command "id=$id"
  )
}

echo "Vault: $VAULT"
echo "Listing linker-related commands:"
(
  cd "$VAULT"
  obsidian commands filter=atoms 2>/dev/null \
    || obsidian commands filter=linker 2>/dev/null \
    || obsidian commands 2>/dev/null | grep -i linker || true
)

# IDs from src/main.ts addCommand({ id: ... }) → manifest id prefix
run "atoms:spike-secret-storage-probe"
run "atoms:spike-classify-hardcoded"
run "atoms:spike-cache-and-batch-fork"

echo "Done. Check Obsidian Notices + DevTools console for output."
