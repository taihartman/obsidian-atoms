#!/bin/bash
# For Shortcuts "Run Shell Script" — Input: Shortcut Input as arguments OR stdin
set -euo pipefail
VAULT="${ATOMS_VAULT:-$HOME/Documents/Remote Vault}"
DAILY_FOLDER="${ATOMS_DAILY_FOLDER:-Quick Notes}"
TODAY=$(date +%Y-%m-%d)
FILE="$VAULT/$DAILY_FOLDER/$TODAY.md"

if [[ $# -gt 0 ]]; then
  TEXT="$*"
else
  TEXT=$(cat)
fi
TEXT=$(printf '%s' "$TEXT" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
if [[ -z "$TEXT" ]]; then
  echo "No text" >&2
  exit 1
fi
mkdir -p "$VAULT/$DAILY_FOLDER"
if [[ -f "$FILE" ]] && [[ -s "$FILE" ]] && [[ $(tail -c1 "$FILE" | wc -l) -eq 0 ]]; then
  printf '\n' >> "$FILE"
fi
printf '%s\n' "- $TEXT" >> "$FILE"
echo "Appended to $FILE"
