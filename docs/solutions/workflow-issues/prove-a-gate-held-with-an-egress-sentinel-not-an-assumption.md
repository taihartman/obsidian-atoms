---
title: "Prove a gate held with an egress sentinel, not an assumption"
date: 2026-08-07
category: workflow-issues
module: qa/consent-gates
problem_type: verification_gap
component: world-class-qa
symptoms:
  - "A QA report claims a consent gate blocked egress, but the only evidence is that the toggle looked off"
  - "A privacy pass cannot run against a real vault because signing in would send real data somewhere"
  - "'No requests were made' is indistinguishable from 'the probe was broken and would never have seen one'"
root_cause: absence_treated_as_evidence
resolution_type: technique
severity: medium
tags:
  - qa
  - consent
  - ask-mirror
  - egress
  - evidence
  - world-class-qa
---

# Prove a gate held with an egress sentinel, not an assumption

## The problem

PR #340 bumped `ASK_PRIVACY_ACK_VERSION`, so every existing device has to re-accept before the Ask
mirror resumes. The load-bearing claim was not "the sheet appears" — it was **"nothing leaves the
device until it does."** That claim is a negative, and a negative is exactly what a QA pass is worst
at proving. You can watch a toggle sit in the off position all day and learn nothing about whether
a background sync fired.

The obvious ways to check are both bad. Signing into a real Plus account to watch real traffic
means putting real vault bodies on a real server to test a privacy gate. Reading the code and
concluding the gate must hold is `staff-engineer-review` wearing a QA hat — it is the substitution
the QA doctrine names as its first hard gate.

## The technique

Point the client at a **sentinel** on localhost — a ~20-line HTTP server that records every request
(method, path, byte count, never bodies) and answers 503 — and drive the real UI against it.

```bash
node scripts/qa-egress-sentinel.mjs /tmp/atoms-egress.log
# Settings → Atoms → Advanced → Plus service URL override = http://127.0.0.1:8787
```

Three properties make this work where the alternatives fail:

1. **Containment.** Nothing reaches the internet, so a privacy gate can be tested with a real vault
   and a synthetic session without ever risking the thing you are testing for.
2. **Attempts, not outcomes.** The server refuses everything, so what you record is what the client
   *tried* to do. A logged `OPTIONS … bytes=0` is a refused preflight — proof the request body never
   went anywhere, which is stronger than a 200 you then have to reason about.
3. **The log is admissible.** "Zero bytes shipped" stops being a summary of what you believe and
   becomes a file you can paste into the report.

## The part that is easy to skip, and the whole point

**An empty log is worthless without a positive control.** A sentinel that is misconfigured, on the
wrong port, or shadowed by a stale override produces exactly the same empty file as a gate that
held perfectly. Absence of evidence is only evidence of absence once you have shown the instrument
can detect presence.

So every "nothing was sent" window in the #340 report is paired with a window where something
*was*: the same button, the same session, after accepting the ack, produced
`OPTIONS /v1/ask/mirror/upsert` 207 ms after the stamp. That pairing is what upgrades the empty
windows from an assumption to a measurement.

Concretely, the pass recorded: empty across the upgrade boot with `askEnabled:true` and a stale ack;
empty across all three decline paths (Cancel, Escape, click-outside); empty across
`Sync everything now` under a stale ack; and non-empty immediately after consent. Total bytes
shipped without a current ack: zero — stated as a fact because the instrument was shown to work.

## Where else this applies

Any claim shaped "X does not happen unless Y". Auto-run gates, the device-local egress ack, outbox
writes under a stale write ack, and Wipe's promise about what it removes are all the same shape, and
all currently rest on reading the code. The sentinel generalises: swap the base URL, drive the
surface, pair every empty window with a positive control.

Where it stops: it proves what the **client** attempted. It says nothing about what the server does
with data it already holds — that is the separate accepted risk in
[`a-consent-version-only-the-client-checks-does-not-gate-the-server`](../security/a-consent-version-only-the-client-checks-does-not-gate-the-server.md).

## See also

- `scripts/qa-egress-sentinel.mjs` — the sentinel
- `docs/qa/2026-08-07-340-ask-expand-world-class-qa.md` § Evidence — the worked example
- `docs/qa/app-navigation-map.md` § Settings → Atoms — the phone-mode driving idioms this pass
  depends on (Settings is a modal in the main document at phone width; `dev:screenshot` cannot
  capture the desktop popout)
