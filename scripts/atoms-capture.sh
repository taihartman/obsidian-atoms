#!/bin/bash
# Atoms Capture — append "- $text" to today's daily in Remote Vault
set -euo pipefail
VAULT="${ATOMS_VAULT:-$HOME/Documents/Remote Vault}"
DAILY_FOLDER="${ATOMS_DAILY_FOLDER:-Quick Notes}"
TODAY=$(date +%Y-%m-%d)
FILE="$VAULT/$DAILY_FOLDER/$TODAY.md"
TEXT="${1:-}"
if [[ -z "$TEXT" ]]; then
  echo "Usage: atoms-capture.sh \"your capture text\"" >&2
  exit 1
fi
mkdir -p "$VAULT/$DAILY_FOLDER"
# Ensure trailing newline then append bullet
if [[ -f "$FILE" ]] && [[ -s "$FILE" ]] && [[ $(tail -c1 "$FILE" | wc -l) -eq 0 ]]; then
  printf '\n' >> "$FILE"
fi
printf '%s\n' "- $TEXT" >> "$FILE"
echo "Appended to $FILE"
