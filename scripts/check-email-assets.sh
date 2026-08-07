#!/usr/bin/env bash
# Confirm the illustrations a draft points at are actually what readers will see.
#
# Two checks, because two different caches can lie:
#   1. the URL is fingerprinted (foo.<hash>.png). A bare foo.png is a bug - Gmail
#      caches proxied images by URL, so subscribers keep seeing whichever version
#      it fetched first, forever, however many times you redeploy.
#   2. the live bytes match the local file. Cloudflare's edge pins /email/* for
#      4h and ignores query strings, so it can serve a stale body for a while.
#
# Usage: scripts/check-email-assets.sh docs/field-notes/drafts/<file>.json
set -euo pipefail

cd "$(dirname "$0")/.."
draft="${1:?usage: check-email-assets.sh <draft.json>}"

urls=$(grep -o 'https://tryatoms\.app/email/[A-Za-z0-9._-]*\.png' "$draft" | sort -u)
[ -n "$urls" ] || { echo "no tryatoms figures in $draft"; exit 0; }

fail=0
for url in $urls; do
  file=${url##*/}
  if ! printf '%s' "$file" | grep -Eq '\.[0-9a-f]{8}\.png$'; then
    printf '  %-34s NOT FINGERPRINTED\n' "$file"
    fail=1
    continue
  fi
  if [ ! -f "www/src/email/$file" ]; then
    printf '  %-34s MISSING LOCALLY\n' "$file"
    fail=1
    continue
  fi
  local_size=$(stat -f%z "www/src/email/$file")
  live=""
  for _ in 1 2 3 4 5; do
    live=$(curl -s -o /dev/null -w '%{size_download}' "$url")
    [ "$live" = "$local_size" ] && break
  done
  if [ "$live" = "$local_size" ]; then
    printf '  %-34s %s bytes  live\n' "$file" "$local_size"
  else
    printf '  %-34s local %s / live %s  STALE\n' "$file" "$local_size" "$live"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "Do not send. Re-render, deploy, and re-run." >&2
  exit 1
fi
echo "All figures fingerprinted and live. Safe to send."
