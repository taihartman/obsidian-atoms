#!/usr/bin/env bash
# Confirm the illustrations a draft points at are actually live, before sending.
#
# Cloudflare's edge pins /email/*.png for 4h AND ignores the query string in its
# cache key, so ?v=<hash> does NOT bust it - a brand new query URL was measured
# serving the previous image. The only reliable check is comparing bytes, and
# retrying: the stale entry clears after a revalidation pass or two.
#
# Usage: scripts/check-email-assets.sh docs/field-notes/drafts/<file>.json
set -euo pipefail

cd "$(dirname "$0")/.."
draft="${1:?usage: check-email-assets.sh <draft.json>}"

names=$(grep -o 'https://tryatoms\.app/email/[a-z0-9-]*\.png' "$draft" \
        | sed 's|.*/||; s|\.png$||' | sort -u)
[ -n "$names" ] || { echo "no tryatoms figures in $draft"; exit 0; }

fail=0
for name in $names; do
  local_size=$(stat -f%z "www/src/email/$name.png")
  live=""
  for _ in 1 2 3 4 5; do
    live=$(curl -s -o /dev/null -w '%{size_download}' "https://tryatoms.app/email/$name.png")
    [ "$live" = "$local_size" ] && break
  done
  if [ "$live" = "$local_size" ]; then
    printf '  %-20s %s bytes  live\n' "$name" "$local_size"
  else
    printf '  %-20s local %s / live %s  STALE\n' "$name" "$local_size" "$live"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "Edge still serving old art. Deploy, wait, re-run - do not send yet." >&2
  exit 1
fi
echo "All figures current. Safe to send."
