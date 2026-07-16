# Pre-community-publish security review — Atoms

**Date:** 2026-07-15  
**Scope:** Full tree under `src/` (v0.5.4), not a single PR diff  
**Goal:** Decide whether the plugin is safe enough to open-source and list in the Obsidian Community directory  
**Method:** Threat-model-driven static audit of live code (read-only). No external penetration test.

**Verdict (summary):** **Not ready to publish as-is**, but the core secrets design is sound. Fix a small set of pre-publish hardening items (P0/P1), document residual privacy risk for users, then re-scan with Obsidian’s automated Community review.

---

## Threat model

### Assets

| Asset | Sensitivity |
|---|---|
| Anthropic API key | High — billable, account access |
| Capture / daily-note text | High for user — personal thoughts |
| Full vault note titles + tags | Medium — graph of life/work |
| Person-hub titles | Medium — relationship graph |
| Atom files + markers | Integrity — wrong write is non-lossy but sticky |

### Trust boundaries

1. **User vault** → plugin (full read of markdown + metadata cache)
2. **Plugin** → **Anthropic** over HTTPS (`requestUrl` only; fixed host paths)
3. **Plugin** → vault writes (new/update atom files under configured folder; append-only markers on dailies)
4. **Settings / device storage** — SecretStorage vs `data.json` vs `loadLocalStorage` / `saveLocalStorage`
5. **Release channel** — GitHub source + release artifacts → Obsidian install

### Actors

| Actor | Goal |
|---|---|
| Benign user | File captures; keep key private |
| Curious friend / shared screen | Shoulder-surf console, settings, progress snippets |
| Malicious model output | Abuse title/tags/links to break YAML, paths, markers, or overwrite files |
| Malicious settings / synced vault | Poison `atomFolder`, model id, shortcut URL, secret id |
| Malicious plugin update (post-list) | Exfil key or vault (sandbox: same powers as this plugin) |
| Network observer | TLS to Anthropic / GitHub (baseline probe) |

### Out of scope for this pass

- Anthropic’s handling of prompt data (third-party privacy policy)
- Obsidian core SecretStorage implementation correctness
- Physical device compromise / debugger on Electron
- Social engineering of the user’s Anthropic account

---

## Architecture that already helps

These are load-bearing and should not be regressed:

1. **API key never in `data.json`** — only `apiKeySecretId` (name) syncs; value via SecretStorage or opt-in device-local storage (`settings.ts`, `types.ts`, `getApiKey` in `main.ts`).
2. **Network only via `requestUrl`** to fixed Anthropic URLs (`classify.ts`, `backfill.ts`, `connectivity.ts`) — no `fetch`, no user-controlled host for classify/backfill.
3. **Model never authors atom body** — capture text is verbatim; model surface is title / tags / links (`SYSTEM_PROMPT`, `formatAtomBody`).
4. **Write surface is narrow** — create/update under atom folder + insert marker after capture; capture lines not rewritten (`applyWrite`, `insertMarkerAfterCapture`).
5. **Today excluded by default** on auto-run and normal process (`daily.ts` / `includeToday` only on manual commands).
6. **Auto-run gated** by device-local enable + egress ack + per-launch cap (`autorun.ts`, `PER_LAUNCH_CAP = 15`).
7. **Backfill has an explicit cost gate** modal before batch submit (`backfill.ts`).
8. **Log-safety intent** — fingerprints (`fingerprintKey`), `sk-ant-` redaction on classify network errors, connectivity console dump omits key.
9. **Tags filtered** to Active ∪ structural before apply (`filterTagsToActive`).
10. **Dependency surface is tiny** — runtime: `obsidian-daily-notes-interface` only (+ Obsidian API).

---

## Findings

Severity: **P0** ship-blocker · **P1** fix before public list · **P2** should fix soon · **P3** residual / document.

### P1 — Model-controlled title can break paths, markers, and YAML-adjacent fields

**Where:** `render.ts` — `sanitizeFilename`, `markerLineForDecision`, `buildAtomMarkdown`, `atomPathForTitle`

**Issue:** Titles come from the model (untrusted). Current sanitization strips filesystem-illegal chars `/:\\?%*|"<>` and collapses `..` in the *filename* segment, but does **not**:

- Strip control characters / newlines / tabs from titles
- Strip or escape `]]` / `[[` before embedding in markers and YAML
- Bound title length

Evidence:

```ts
// markerLineForDecision
return `\t↳ [[${t}]] <!--linker-->`;

// buildAtomMarkdown
fm.push(`source: "[[${sourceName}]]"`);  // sourceName is daily basename (user-controlled file name)
// tags:
for (const t of tags) fm.push(`  - ${t}`);  // tags constrained, but title/alias path less so
```

**Impact:**

- Broken markers → reprocess loops or silent “already marked” confusion
- Pathological atom paths if Obsidian accepts odd basenames
- Alias uses `JSON.stringify` (good); title/filename and marker do not get the same care

**Fix direction:** Single `sanitizeTitleForAtom(title)` used for filename **and** display:

- Reject/replace `\n\r\0` and other Cc controls
- Strip or replace `[[` / `]]` in titles used inside wikilinks
- Max length (e.g. 120)
- Keep existing illegal-filename map
- Unit tests for adversarial titles

---

### P1 — `atomFolder` setting is not path-normalized (vault write root)

**Where:** `settings.ts` (free text), `render.ts` `atomPathForTitle` / `listAtomPaths` / `applyWrite`

**Issue:** User (or a synced malicious `data.json`) can set `atomFolder` to values like `../…`, absolute-looking segments, or nested paths outside the intended flat folder. Code only does `replace(/\/$/, "")`.

```ts
const folder = atomFolder.replace(/\/$/, "") || "Atoms";
return `${folder}/${filename}.md`;
```

**Impact:** Depends on Obsidian vault path rules (often sandboxed to vault root). Worst case: writes or collision scans outside the intended `Atoms/` tree; folder create via `createFolder` for nested paths.

**Fix direction:**

- Normalize: reject `..`, absolute paths, empty segments, leading `/`
- Allow only single-segment folder **or** a short allowlist of relative segments
- Default `Atoms`; clamp on load as well as on settings change
- Tests for `../x`, `foo/../../bar`, empty, multi-segment policy

---

### P1 — Same-title collision **overwrites** existing atom content

**Where:** `render.ts` `planWrite` → `update_atom`; `applyWrite` `vault.modify`

**Issue:** Product policy is “never a second file for the same title — update in place.” That means a later classification (or backfill) with a colliding title **replaces the entire atom file**, including any human edits to the body or links.

**Impact:** Integrity, not confidentiality. User-edited second brain notes can be clobbered by reprocess/backfill. For a community plugin this is a trust failure mode (“it deleted my edits”).

**Fix direction (pick one and document):**

1. **Prefer create-only + collision skip** (old KTD8 skip) when file already exists and content differs, or  
2. **Update only frontmatter/links**, never replace body if `generated-by: linker` body hash / marker matches, or  
3. Keep overwrite but **require explicit “allow overwrite on collision”** setting default off for public builds

Recommend (2) or (1) for community safety; current default overwrite is aggressive.

---

### P1 — Shortcut install URL is not allowlisted

**Where:** `captureShortcut.ts` `openShortcutInstallUrl` → `window.open(u, "_blank")`; settings free-text `captureShortcutInstallUrl` (syncs via `data.json`)

**Issue:** Any string in settings is opened. Synced vault poison or typo can open `javascript:` / phishing HTTPS / non-iCloud URLs on the user’s device.

**Fix direction:**

- Allow only `https://www.icloud.com/shortcuts/…` (and optionally empty → built-in constant)
- Reject other schemes/hosts with a Notice
- Unit tests for `javascript:`, `http://`, wrong host

---

### P2 — Device-local API key fallback is plaintext + password field prefilled

**Where:** `settings.ts` device-local key; `LOCAL_STORAGE_API_KEY`; `getApiKey`

**Issue:** Fallback is intentional when SecretStorage fails, but:

- Value lives in Obsidian device local storage (not OS keychain)
- Settings UI loads the raw key into a password input via `setValue` (DOM-accessible to other plugins / DevTools)
- Toggle-off clears storage (good)

**Impact:** Residual risk on shared machines and plugin-to-plugin read of localStorage (Obsidian threat model: plugins are powerful). Acceptable as **contingency** if documented; not equal to SecretStorage.

**Fix direction:**

- Prefer SecretStorage-only on desktop when available; hide fallback behind “Advanced”
- Never prefill the full key in the field — show “Key set on this device” + Replace / Clear
- Community README: residual risk of fallback

---

### P2 — Console can dump capture bodies (privacy / support paste hazard)

**Where:**

- `main.ts` dry-run: `console.log("[atoms] dry-run markdown\n" + md)` — full preview includes capture text
- Fixture write: `entries: report.entries` (includes `captureText` slices / full planned content paths)
- Progress UI shows `snippetCapture` (72 chars) — intentional UX, lower risk
- Context spike: `head: prefix.slice(0, 400)` of title list

**Impact:** User pastes DevTools log into Discord/GitHub → personal captures leak. Not network exfil beyond designed Anthropic path.

**Fix direction:**

- Gate full markdown dumps behind a `devVerboseLogging` flag default **false** for release
- Always log counts / verdicts / titles only in production paths
- Keep redaction on all error paths (see next)

---

### P2 — Some error logs do not redact key-shaped strings

**Where:** `main.ts` auto-run / write-path catch blocks log `e.message` without the `sk-ant-` scrub used in `classify.ts` / `connectivity.ts`.

```ts
console.log("[atoms] auto-run error", {
  name: e instanceof Error ? e.name : "Error",
  message: e instanceof Error ? e.message : "unknown",
});
```

**Impact:** Low probability (Obsidian/Electron rarely echo the key in Error.message), but inconsistent with project log-safety rules.

**Fix direction:** Shared `safeErrorMessage(err)` used everywhere (classify already nearly has this).

---

### P2 — Spike / fixture commands ship in the production command palette

**Where:** `main.ts` `registerCommands` — `spike-classify-hardcoded`, `spike-cache-and-batch-fork`, `spike-secret-storage-probe`, `process-fixture-sample`, etc.

**Issue:** Not a secret leak by themselves, but they:

- Burn API quota on accidental invoke
- Confuse end users in Community installs
- Expand surface for “what does this button do to my vault?”

**Fix direction:** Register spikes only when `process.env.NODE_ENV !== "production"` **or** a settings “Developer commands” toggle default off. Keep CLI-friendly ids behind the same gate if possible.

---

### P2 — `JSON.parse` of model text is uncaught (KTD4)

**Where:** `classify.ts` post-response; `backfill.ts` batch line parse

**Issue:** Intentional “trust structured output schema.” If the API returns non-JSON text, the throw aborts the run. Partial markers/atoms may already have been written earlier in the loop.

**Impact:** Integrity / partial run; not key leak. Idempotent markers help, but user sees failed Notice.

**Fix direction:** Catch parse errors → `reason: "invariant"` / `"unknown"`, continue to next capture (do not crash whole run). Does not violate “no rewrite body.”

---

### P3 — Privacy egress is real and must stay user-visible

**By design**, every classify sends:

- System prompt
- Active vocabulary, vault tags, **all note titles**, person-hub titles
- The capture text

Settings and auto-run ack describe this. Manual Process does not re-show a blocking privacy modal every time (reasonable after key setup).

**For Community listing:**

- Label plugin **Optional payments** (Anthropic usage)
- README + first-run / settings: plain language that vault titles + captures leave the device
- No claim of “fully private / on-device AI”

---

### P3 — Free-form model id

**Where:** settings `model` string → Anthropic request body

**Impact:** Cost / unexpected model, not SSRF (host is fixed). Unknown model fails API-side.

**Fix direction:** Optional allowlist dropdown + “custom” advanced field for power users.

---

### P3 — Supply chain / release

| Item | Status |
|---|---|
| Runtime deps | Minimal (`obsidian-daily-notes-interface`) |
| `main.js` gitignored | Good — ship via GitHub Release assets |
| `data.json` / `.env` gitignored | Good |
| `LICENSE` file | **Missing** (package.json claims MIT) — required for open-source + Community |
| Repo visibility | Private — must be public for new Community submissions |
| Release attestation | Not set up — add checksums / pinned release workflow before list |

---

## What we did **not** find

- API key written into `data.json` or atom frontmatter
- User-controlled URL host for classify/backfill (fixed Anthropic endpoints)
- Use of `fetch` (CORS-unsafe path) for API
- Shell / `eval` / dynamic `Function` execution
- Marker path that rewrites existing capture bullet lines
- Auto-run processing today’s daily (default path)
- Logging of `x-api-key` headers or full request bodies in classify success path
- Network call that uploads entire vault file bodies (titles + one capture per request only)

---

## Residual risk (accept after harden)

| Risk | Why accepted |
|---|---|
| Captures + titles go to Anthropic | Product purpose; user-provided key; disclose |
| Device-local key weaker than SecretStorage | Contingency only; document |
| Any installed Obsidian plugin can often reach vault + sometimes storage | Platform model; not unique to Atoms |
| Malicious future update of this plugin | Same as any Community plugin; pin versions; review releases |
| Model quality / wrong links | Not a security exploit; integrity via dry-run + markers |

---

## Pre-publish checklist

### Must fix (before public repo + Community submit)

- [x] **P1** Harden title / marker / path sanitization + tests — done 2026-07-15 (v0.6.0)
- [x] **P1** Normalize/clamp `atomFolder` — done 2026-07-15
- [x] **P1** Safe collision policy (protect existing; no overwrite) — done 2026-07-15
- [x] **P1** Allowlist capture shortcut install URL — done 2026-07-15
- [x] Add root **`LICENSE`** (MIT to match `package.json`) — done 2026-07-15
- [x] Strip or gate **spike/fixture** commands for production builds — done 2026-07-15 (`ATOMS_DEV_COMMANDS`)
- [x] Privacy + **Optional payments** copy in README / settings — done 2026-07-15
- [ ] GitHub **public** repo + Release with `main.js`, `manifest.json`, `styles.css`
- [ ] Run Obsidian Community **preview scan** / eslint-obsidian rules; fix failures

### Should fix (same release train if possible)

- [ ] **P2** Shared safe error logging; no full dry-run body dumps by default
- [ ] **P2** Device-local key UX: set/clear without prefilling secret
- [ ] **P2** Catch `JSON.parse` failures per capture
- [ ] Confirm iOS SecretStorage vs fallback on a real device once more before marketing “phone-ready”

### Nice to have

- [ ] Model id allowlist
- [ ] `docs/security/` linked from README
- [ ] Dependabot / pinned lockfile policy for the one runtime dep
- [ ] Re-run this review after fixes; archive as `docs/security/YYYY-MM-DD-…-followup.md`

---

## Suggested fix order (implementation)

1. Pure sanitizers + tests (`render.ts`, `atomFolder` clamp) — no product behavior debate  
2. Shortcut URL allowlist + tests  
3. Collision policy decision (product) → implement  
4. Log / spike gating for release builds  
5. LICENSE + README privacy/payments  
6. Public release packaging  
7. Community preview scan  

---

## How to re-audit after fixes

1. Re-read this file’s checklist; mark items done with date.  
2. Optional: `/ce-code-review depth:full base:<pre-fix-sha>` so CE’s `security-reviewer` + `adversarial-reviewer` hit the fix PR.  
3. Run unit tests for new sanitizers + `npm run build`.  
4. Manual: set dummy key, dry-run, process, auto-run off path, backfill estimate cancel, shortcut open with bad URL.  
5. Obsidian Community dashboard preview scan.

---

## File map (security-relevant)

| Area | Primary files |
|---|---|
| Secrets | `settings.ts`, `main.ts` `getApiKey`, `types.ts` |
| Network | `classify.ts`, `backfill.ts`, `connectivity.ts` |
| Write / path | `render.ts`, `write.ts`, `daily.ts` |
| Auto-run | `autorun.ts`, `main.ts` `maybeAutoRun` |
| Privacy UX | `settings.ts`, `atomsHomeView.ts` enable modal |
| External open | `captureShortcut.ts` |
| Context egress | `context.ts`, `classify.ts` `buildContextUserMessage` |

---

## Appendix — severity calibration notes

- No **P0** (remote code execution, unauthenticated vault wipe, key written to synced `data.json`) was confirmed in this pass.  
- P1 items are **trust / integrity / poison** issues that would look bad under Community automated review or first-week user reports.  
- Publishing without P1 fixes is a product risk more than a classic CVE; still treat as blockers for a public list.

**Reviewer:** agent security audit (static), 2026-07-15.  
**Next human decision:** Approve fix plan (especially collision policy) → implement → re-audit.
