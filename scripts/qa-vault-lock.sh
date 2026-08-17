#!/usr/bin/env bash
# One writer at a time for a shared QA vault (#516).
#
# Every agent session drives the same `test_vault/test vault` through the same running Obsidian,
# and `install-to-vault.sh` writes `main.js` into it. Two sessions doing that at once is not a
# theoretical race: on 2026-08-15 an install landed 0.8.0 at 09:19, was confirmed at 09:21, and had
# been replaced by another worktree's 0.7.12 by 09:23. The pass in between would have screenshotted
# the wrong build and called it a regression. Reading `manifest.json` back does not catch it,
# because both builds name a plausible version.
#
# The holder is a **worktree**, not a process. A session's subagents each get their own shell and
# their own pid, so a pid-keyed lock would lock them out of their own vault; they do share a
# checkout. `install-to-vault.sh` takes the lock when it is free and refuses when someone else has
# it, which is the ergonomic that keeps existing agent prompts working.
#
# Reads are deliberately unguarded. `obsidian eval` resolves by vault name with no isolation, so a
# probe from another session is noise; the write is what corrupts a pass.
set -euo pipefail

usage() {
  cat <<'USAGE'
usage: qa-vault-lock.sh <command> [options]

  status  [--vault PATH] [--json]     who holds it, or that it is free
  acquire [--vault PATH] [--note S] [--wait SECS] [--ttl SECS]
  release [--vault PATH] [--force]    release your own; --force takes someone else's
  path    [--vault PATH]              print the lock file path
  vault                               print the vault this resolves to by default

The lock defaults to the repo's throwaway vault. It lives outside both the repo and the vault,
since worktrees are separate checkouts and the vault gets wiped.

exit codes: 0 ok · 3 held by someone else · 4 not held (release) · 2 usage
USAGE
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The vault lives in the MAIN checkout, not in whichever worktree is running this. Keying it off
# `$ROOT` was the first bug this script had: every worktree resolved a different path, so every
# worktree took a different lock and the contention it exists to stop went on happening. The main
# checkout is the parent of the common git dir.
GIT_COMMON="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")"
if [ -n "$GIT_COMMON" ]; then
  MAIN_CHECKOUT="$(dirname "$GIT_COMMON")"
else
  MAIN_CHECKOUT="$ROOT"
fi
DEFAULT_VAULT="$MAIN_CHECKOUT/test_vault/test vault"
DEFAULT_TTL=2700 # 45 minutes; a pass that outlives this has probably been abandoned

CMD="${1:-}"
[ -n "$CMD" ] || { usage; exit 2; }
shift || true

VAULT="$DEFAULT_VAULT"
NOTE=""
WAIT_SECS=0
TTL="$DEFAULT_TTL"
FORCE=0
JSON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --vault) VAULT="${2:?--vault needs a path}"; shift 2 ;;
    --note)  NOTE="${2:?--note needs a string}"; shift 2 ;;
    --wait)  WAIT_SECS="${2:?--wait needs seconds}"; shift 2 ;;
    --ttl)   TTL="${2:?--ttl needs seconds}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --json)  JSON=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

# Key the lock by the vault's real path, so two different vaults never share one lock and the same
# vault reached by different spellings shares the one it should.
VAULT_REAL="$(cd "$VAULT" 2>/dev/null && pwd || echo "$VAULT")"
KEY="$(printf '%s' "$VAULT_REAL" | shasum -a 256 | cut -c1-12)"
LOCK_DIR="${TMPDIR:-/tmp}/atoms-qa-vault-locks"
LOCK="$LOCK_DIR/$KEY.lock"

# The holder identity: this worktree. `git rev-parse --show-toplevel` from the script's own
# directory, so it is the checkout the script lives in rather than wherever the caller happened
# to cd to.
HOLDER="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || echo "$ROOT")"
BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")"

read_field() { # read_field <file> <key>
  [ -f "$1" ] || return 1
  sed -n "s/^$2=//p" "$1" | head -1
}

now() { date +%s; }

lock_is_stale() {
  local at ttl age
  at="$(read_field "$LOCK" at || echo 0)"
  ttl="$(read_field "$LOCK" ttl || echo "$DEFAULT_TTL")"
  age=$(( $(now) - at ))
  [ "$age" -gt "$ttl" ]
}

describe_holder() {
  local h b n at age
  h="$(read_field "$LOCK" holder || echo '?')"
  b="$(read_field "$LOCK" branch || echo '?')"
  n="$(read_field "$LOCK" note || echo '')"
  at="$(read_field "$LOCK" at || echo 0)"
  age=$(( ($(now) - at) / 60 ))
  echo "held by $(basename "$h") (branch $b) for ${age}m${n:+, note: $n}"
  echo "  worktree: $h"
}

cmd_status() {
  if [ ! -f "$LOCK" ]; then
    [ "$JSON" = 1 ] && echo '{"state":"free"}' || echo "free — $VAULT_REAL"
    return 0
  fi
  if lock_is_stale; then
    [ "$JSON" = 1 ] && echo '{"state":"stale"}' || { echo "STALE, take it with acquire:"; describe_holder; }
    return 0
  fi
  if [ "$(read_field "$LOCK" holder)" = "$HOLDER" ]; then
    [ "$JSON" = 1 ] && echo '{"state":"mine"}' || { echo "yours:"; describe_holder; }
    return 0
  fi
  [ "$JSON" = 1 ] && echo '{"state":"held"}' || describe_holder
  return 3
}

write_lock() {
  mkdir -p "$LOCK_DIR"
  cat > "$LOCK.$$" <<EOF
holder=$HOLDER
branch=$BRANCH
note=$NOTE
at=$(now)
ttl=$TTL
vault=$VAULT_REAL
EOF
  mv "$LOCK.$$" "$LOCK"
}

cmd_acquire() {
  local deadline=$(( $(now) + WAIT_SECS ))
  # Without this the very first `mkdir "$LOCK.d"` fails for want of a parent, and the loop reports
  # a phantom holder read out of a file that does not exist. Second bug this script had.
  mkdir -p "$LOCK_DIR"
  while :; do
    # mkdir is the atomic primitive here: two sessions racing cannot both win it, where a
    # test-then-write on the lock file could interleave between the test and the write.
    if mkdir "$LOCK.d" 2>/dev/null; then
      if [ -f "$LOCK" ] && ! lock_is_stale && [ "$(read_field "$LOCK" holder)" != "$HOLDER" ]; then
        rmdir "$LOCK.d"
      else
        write_lock
        rmdir "$LOCK.d"
        echo "locked $VAULT_REAL for $(basename "$HOLDER") (branch $BRANCH)${NOTE:+ — $NOTE}"
        return 0
      fi
    fi
    if [ "$(now)" -ge "$deadline" ]; then
      echo "cannot lock $VAULT_REAL:" >&2
      if [ -f "$LOCK" ]; then
        describe_holder >&2
      else
        # No lock file, so the mutex itself is what we lost. Say that rather than inventing a
        # holder out of an absent file, which is what the first version did.
        echo "  another process holds $LOCK.d — retry in a moment" >&2
      fi
      echo "  wait for it:  $0 acquire --wait 600" >&2
      echo "  or drive a different vault with --vault" >&2
      return 3
    fi
    sleep 5
  done
}

cmd_release() {
  [ -f "$LOCK" ] || { echo "already free"; return 0; }
  if [ "$(read_field "$LOCK" holder)" != "$HOLDER" ] && [ "$FORCE" != 1 ]; then
    echo "not yours to release:" >&2
    describe_holder >&2
    echo "  take it anyway with --force only if that session is definitely gone" >&2
    return 4
  fi
  rm -f "$LOCK"
  echo "released $VAULT_REAL"
}

case "$CMD" in
  status)  cmd_status ;;
  acquire) cmd_acquire ;;
  release) cmd_release ;;
  path)    echo "$LOCK" ;;
  # Exists so the default-vault resolution is testable on its own. It is the thing that broke
  # first and most quietly: resolved per worktree, every session takes a different lock for the
  # same vault and the feature is decoration.
  vault)   echo "$VAULT_REAL" ;;
  *) echo "unknown command: $CMD" >&2; usage; exit 2 ;;
esac
