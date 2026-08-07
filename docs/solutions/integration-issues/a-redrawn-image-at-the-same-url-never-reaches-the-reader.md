---
title: A redrawn image at the same URL never reaches the reader
date: 2026-08-07
category: integration-issues
module: www/field-notes
problem_type: integration_issue
component: email_processing
symptoms:
  - "Test emails show illustrations from a previous session while the origin serves the new file correctly"
  - "Redeploying and resending changes nothing; four consecutive sends showed the same stale art"
  - "curl against the asset URL returns the new bytes, but the inbox does not"
root_cause: wrong_api
resolution_type: workflow_improvement
severity: high
tags: [email, gmail, image-cache, cloudflare-pages, field-notes, cache-busting]
---

# A redrawn image at the same URL never reaches the reader

## Problem

Field notes illustrations were redrawn three times and redeployed each time. Every test send still displayed art from a previous session. The origin was correct throughout, so every check the agent ran said the fix had shipped.

## Symptoms

- The letter renders an old version of an illustration that no longer exists in the repo
- `curl https://tryatoms.app/email/foo.png` returns the new byte count; the received email does not
- Redeploying, waiting, and resending does not change what the inbox shows

## What Didn't Work

- **Redeploy and resend.** Four times. The origin was already right; nothing about the delivery path was being changed.
- **`?v=<content-hash>` on the `src`.** Measured failing: a request to a brand-new `?v=` URL came back with the *previous* image, because Cloudflare ignores the query string in its cache key. The wrong conclusion was drawn from that — "query busting does not work" — and the query was removed, which deleted the one mechanism that would have fixed the actual problem.
- **Verifying live bytes before sending.** This was added and it did pass, correctly, on every send that the reader still saw as stale. It measures the origin and the CDN; it cannot see Gmail's cache at all.

## Solution

Put the content hash in the **filename**, not the query string, and reference that URL from the draft.

`scripts/render-email-svg.sh` writes a fingerprinted twin on every render and prints the URL to use:

```bash
hash=$(md5 -q "$png" | cut -c1-8)
cp "$png" "${png%.png}.${hash}.png"
echo "${w}x${h}  https://tryatoms.app/email/$(basename "${png%.png}.${hash}.png")"
```

`scripts/check-email-assets.sh` then refuses to bless a draft that still points at a bare `foo.png`, in addition to comparing live bytes against local.

Old paths are left in place, so mail already delivered keeps rendering.

## Why This Works

**Two caches sit between the repo and the reader, and they key differently.**

| Cache | Keys on | TTL |
|---|---|---|
| Cloudflare Pages edge | path, **query string ignored** | `max-age=14400` (4h) |
| Gmail image proxy (`googleusercontent`) | full URL | effectively permanent |

Gmail does not fetch images from the origin when a message is opened. It proxies them, and it caches by URL. Whatever version it fetched the *first* time any message referenced that URL is the version every later message referencing it will show — for every recipient, indefinitely. The origin being correct is irrelevant.

That is why the four redeploys were invisible, and why the earlier `?v=` experiment was misread: the query fixes Gmail's key but not Cloudflare's, and the Cloudflare staleness observed at that moment was the transient 4h kind that cleared on its own. A new **path** satisfies both keys at once.

The failure is silent and asymmetric in a way that matters: the poisoned entry lives in the *reviewer's* mailbox. Subscribers who never received an earlier version get the correct art, so this bug can survive an entire review cycle and reach production looking like it was verified.

## Prevention

- Never reference a bare `foo.png` from a draft. `scripts/check-email-assets.sh <draft>` fails the run on an un-fingerprinted URL — treat that failure as blocking, not advisory.
- **Verifying the origin is not verifying the delivery.** When a check passes and the human still sees the old thing, suspect a cache you are not measuring rather than repeating the deploy. The number of times a redeploy has failed to change the outcome is the signal.
- Do not generalize a measurement across caches. "Query busting failed" was true of Cloudflare and false of Gmail, and collapsing the two removed the fix.
- When a stale image must be confirmed as cache rather than content, request the deployment-specific `*.pages.dev` URL — it bypasses the apex domain's edge entry.

## Related Issues

- `docs/field-notes-email.md` — the fingerprint rule and the two-cache table
- `.agents/skills/field-notes/SKILL.md` — enforced in the send workflow
- `docs/solutions/documentation-gaps/screenshot-capture-races-and-viewer-lies.md` — same shape: the verification surface lies about what a human will see
