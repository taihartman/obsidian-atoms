# #240 magic-link plan — doc-review findings

Round 1, 2026-08-05. Six reviewers, each in an independent context: coherence, feasibility, security-lens, scope-guardian, adversarial, design-lens. Reviewed against `docs/plans/2026-08-05-240-feat-magic-link-plugin-handoff-plan.md`.

**Not run:** product-lens (upstream Product Contract came from `ce-brainstorm`; the one live product decision was user-settled in session). Cross-model peer pass (configured to grok) did not run — no different-model corroboration exists for anything below.

Eight mechanical fixes were applied already and are not listed here. What follows is what still needs a decision.

---

## P0 — the convergent one

**F1. An unbound token gets a handoff it cannot complete; a bound token cannot use the fallback.** Four reviewers reached this from four directions.

Once the plugin always sends a verifier hash at mint, every plugin-requested link is bound. Three consequences the plan does not resolve:

- The fallback form POST presents no verifier, so U4 refuses it — the cross-device recovery KD3 exists to preserve is dead on arrival, and AE9 passes anyway because it only checks the field renders (feasibility, security-lens).
- Tokens minted by *older plugin builds* carry no verifier hash. U5 still renders them an `obsidian://` anchor their build cannot receive, while the same deploy removes the session block that was their only working path. BRAT-paced updates make that window indefinite (adversarial).
- An unbound token reaching a vault that never requested it would exchange and show an approvable confirmation — which R5 and AE7 declare impossible (coherence).

**Single fix that closes all three:** gate the `obsidian://` anchor on the token carrying a verifier hash; unbound tokens get the fallback block promoted instead. Then state explicitly in KD9 and U6 that the fallback POST skips the verifier check *by design*, and record the residual: until #286, the magic link stays a bearer credential redeemable by any holder.

**Consequence worth stating plainly:** the verifier binds *where a session lands*, not *who may obtain one*. It is wrong-vault routing safety this release, not anti-theft.

**F2. The landing page is asked to be three states at once, with no JavaScript.** R14 describes a state that exists "after handing off" and U5 calls the fallback "dismissible" — but KTD4 forbids script, so nothing can transition or dismiss. As written the page asserts the handoff succeeded and failed simultaneously, before the user taps. Fix: commit to one static pre-tap render, use a native `<details>` for troubleshooting, and amend R14 to drop the post-tap framing. (design-lens)

---

## P1 — behavior the plan currently gets wrong

**F3. Cancelling the confirmation signs the account out on every device.** Three reviewers; verified in code. `exchangeMagic` calls `revokeAllSessionsForEmail` before minting (`plus-service/src/store/memory.mjs:233`, `sqlite.mjs:312`, `postgres.mjs:371`), and KD4 exchanges before asking the user. So a tap-then-cancel destroys the desktop session and burns the link. R4 and AE2 describe cancel as inert. Fix: say so in R4/AE2, disclose it in U10's confirmation copy *before* the user chooses, and add a test pinning it.

**F4. The fallback's success page still says "Refresh status."** U6 reuses today's success HTML, which ends by telling the user to tap the button the Problem Frame calls a no-op by construction. U11 removes that copy from the plugin and nothing removes it from the web page. (design-lens)

**F5. `redact` never learns the magic-token shape.** AE8 promises no magic token reaches a log or error. U8 extends `redact` for the verifier only; the shipped helper covers `sess_`, `Bearer`, `sk-ant-`. This change is what first carries a magic token into the plugin. Recurrence of M1 from the fanout review. (security-lens)

**F6. The refusal renders an attacker-supplied vault name inside Obsidian.** Any web page can fire `obsidian://atoms-signin?vault=<anything>`. U9 renders that param as trusted in-app text with no cap, escaping, or sanitization — a phishing surface with the plugin's authority. Fix: prefer the locally recorded vault name; otherwise length-cap, strip control characters, render via `setText`. (security-lens)

**F7. R6's prefetch guarantee is false for the OAuth branch.** KTD12 deliberately keeps `GET` consuming when `pending` is present, so a scanner still burns those links. KTD12 claims to govern R6. Fix: scope R6 to the plugin sign-in link and name the OAuth hop as a known residual. (coherence, adversarial)

**F8. KD4's closing sentence is stale.** It still calls the device-local record "copy only." U7/U9 make it the only place the verifier lives — a hard precondition. An implementer reading KD4 literally could let an unbound handoff through and defeat R12 entirely. (coherence)

**F9. AE12's retry promise fails near the TTL.** U7 expires the pending record at the magic token's TTL, so a retry late in the window finds no verifier and is refused again — naming the vault the user is already in. Fix: retain the record until sign-in completes or the session is cleared. (adversarial)

**F10. AE7's "visible refusal" is unreachable on the device it describes.** On a device with no vault of that name, the probe found *no handler call and no signal at all* — nothing runs to render a refusal. The unit test can fake it and pass. Fix: scope R5/AE7 to a matching vault holding no usable verifier, and state that a device without the named vault gets no in-app signal, with R18's pre-tap naming as the only mitigation. (feasibility)

**F11. R8 sends a blocked-scheme user to the device they are already on.** F2's trigger list includes "the scheme blocked," but R8's remedy addresses device shape only — and mobile in-app browsers are the surface the plan calls least verified. (adversarial, design-lens)

**F12. The exchange has no in-progress state and no network-failure outcome.** U8 produces a network error code; U9 routes only success, refusal, and expiry. On a slow phone the user taps and sees nothing — the exact symptom this issue exists to remove. (design-lens)

**F13. The refusal is a toast; the confirmation is a modal.** R5 demands a visible refusal, but a Notice auto-dismisses just as the user switches back from mail. Fix: reuse U10's modal shape as a dismiss-only acknowledgement. (design-lens)

**F14. U11 leaves a "Refresh status" pointer in the panel.** The paste-field description reads "Only if Refresh status does not work after the sign-in link" (`src/settings/settings.ts:556`), and U11 explicitly leaves that block alone. R15 is not met; the AE11 test only checks the sign-in-link row. (design-lens)

**F15. KTD10's rate limit has no owning unit.** Three reviewers. U4 and U6 each claim one; U5, where the non-consuming check actually runs, has no step, scenario, or done-clause. A declared control nobody owns does not ship. (coherence, security-lens, scope-guardian)

---

## P2 — correctness and hygiene

**F16. Expired magic tokens would never be deleted.** `exchangeMagic` was the sole delete path; peek never deletes and U5 renders the expired message from the peek. Rows holding email, vault name, and verifier hash accumulate forever — contradicting KD7's claim the vault name "dies with the token." Fix: sweep expired rows on mint, keeping peek read-only. (security-lens)

**F17. M9's disposition is unrecorded while U1 enriches the plaintext row.** The plan records M10 as staying open but says nothing about M9. U1 is already rewriting `magic_tokens`, and sessions are already stored as `hashToken(...)`, so keying magic tokens the same way is cheap now. (security-lens)

**F18. R13/AE10 contradict the probe.** The probe found a closed vault *is* opened by the link and the handler then fires — so the sign-in completes rather than producing AE10's "open this vault" message. R13 was written before that result. (feasibility)

**F19. The fallback form POST has no route and no urlencoded parsing.** `readBody` is JSON-only and throws on anything else; a scriptless form sends `application/x-www-form-urlencoded`. Reusing `POST /v1/auth/exchange` would break the plugin. Fix: name a dedicated HTML-rendering route reading via `readRawBody` + `URLSearchParams`. (feasibility)

**F20. `main.ts:229` is not synchronous in `onload`.** `onload()` awaits `loadSettings()` at `:217`, so anything beside `registerCommands()` runs a tick later — exactly the cold-open race KTD8 exists to close. Registration needs no settings; move it above the first `await`. (feasibility)

**F21. `crypto.subtle` on Obsidian mobile is asserted, never probed.** If it is unavailable in the iOS/Android webview, R12's binding fails — and it surfaces at the human-only gate, after both surfaces have shipped. The plugin has never used WebCrypto; the only hashing in `src/` is a hand-rolled FNV-1a at `src/platform/askMirror.ts:177`. (feasibility)

**F22. Custom-scheme interception is missing from the threat model.** Any installed app may claim `obsidian://` and receive the magic token — the threat PKCE exists to answer. The plan borrows PKCE's shape without naming what it is borrowed for. (security-lens)

**F23. Settings copy: static vs pending state is left to the implementer.** R15 scopes its change to "after a link is requested," U11 implements an unconditional rewrite. The pending record makes the conditional version cheap. (design-lens)

**F24. The handoff anchor has no touch-target specification.** The whole feature funnels through one tap in a mail client's in-app browser, specified as an inline text link. CSP already allows inline styles. (design-lens)

---

## Reviewer disagreement — needs a call

**F25. `dev-exchange`: delete or branch?** Three reviewers agree the current branch-or-delete wording is unacceptable, and disagree on the resolution. Coherence and scope-guardian say delete (zero callers, zero tests, 404 in production). Feasibility says apply the same branch, to keep the two GET bodies in parity with no doc churn. Either is defensible; leaving it as an either/or is the #230 one-branch-only shape the plan itself cites.

---

## P3 — optional

- **F26.** KD9 should state the verifier's retained benefit this release is wrong-vault routing safety, not bearer resistance. (scope-guardian)
- **F27.** `pkce.ts`'s injectable randomness/digest has one consumer and buys no testability — SHA-256 is deterministic and "two calls differ" needs real randomness. (scope-guardian)
- **F28.** R13 restates R5 + R16 without distinct behavior; annotate rather than delete. (scope-guardian)
- **F29.** F5's actor list omits A4, whose surface the final step uses. (coherence)

---

## Open questions the reviewers raised and did not resolve

- If the physical iOS/Android gate fails, what ships — the POST fallback promoted on mobile, or a block until #286?
- Should the Definition of Done gate the BRAT release explicitly on the human device result, so "recorded as outstanding" cannot be read as "shippable"?
- Which rate-limit key shape and ceiling for the landing-page check, given scanners hit it before the human — and does sharing a key let a scanner's 429 block the human's deliberate POST?
- Should the fallback POST require re-entering the account email, so a link holder alone cannot mint a session before #286?
- Does `registerObsidianProtocolHandler` deliver params to more than one registered plugin in the same vault?
