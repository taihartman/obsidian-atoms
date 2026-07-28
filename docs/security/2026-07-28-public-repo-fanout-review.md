# Security review — public repo fan-out (2026-07-28)

**Repo:** `taihartman/obsidian-atoms` (public)  
**Method:** Six parallel static audits (secrets, plus-service, plugin client, supply-chain/CI, privacy/LLM, prior security docs cross-check)  
**Scope:** Tracked source under `src/`, `plus-service/`, `scripts/`, docs, GitHub settings  
**Not in scope:** Live penetration of production Fly, full git-blob gitleaks history, dynamic browser XSS PoC  
**Verdict:** No live credentials in git. Plugin path safety and server tenant isolation are strong. **Two Critical plus-service bugs** (soft-start session fixation, global classify idempotency) need fixing before treating hosted Plus as safe for real multi-tenant vault content. Public-repo GitHub security defaults and release integrity are weak.

---

## Executive summary

| Area | Grade | Notes |
|------|-------|--------|
| Committed secrets | **Pass** | No live keys/tokens/PEMs in tracked tree |
| Plugin FS / DOM / RCE | **Strong** | No eval/shell/innerHTML; path clamps; body sacred; create-only outbox |
| Plus multi-tenant isolation | **Mixed** | Email-from-session + path allowlist good; **C1/C2 break trust** |
| Secrets at rest (design) | **Strong** | SecretStorage / hashed sessions / prod fail-closed |
| Privacy honesty (docs vs code) | **Fail** | Ask ack says “Atoms/ only”; hubs upload full bodies |
| Supply chain / CI / releases | **Weak** | No CI, secret scanning off, unsigned BRAT assets |
| Dependency CVEs | **OK / watch** | Plugin audit clean; plus-service moderate MCP transitive |

### Fix first (ordered)

1. **C1** Soft-start session → full account after victim upgrades  
2. **C2** Classify idempotency key not scoped by tenant  
3. **H1** XSS on magic-link exchange HTML (`sess_` in page)  
4. **H2** Unbounded request body (DoS)  
5. Enable GitHub secret scanning + push protection + Dependabot  
6. Allowlist / don’t sync `plusBaseUrl`; fix Ask privacy copy (hubs)  
7. CI (test+build+audit) + required checks; CI-built signed/checksummed releases  
8. Unify client secret redaction; scrub personal email from docs  

---

## Critical

### C1 — Soft-start session fixation / account takeover

| | |
|--|--|
| **Surface** | `plus-service` |
| **Evidence** | `plus-service/src/server.mjs` `POST /v1/auth/start`; `store/*/startWithEmail` mints long-lived `sess_` without email proof; magic-link / Stripe grant does **not** revoke prior sessions; default TTL ~60d |
| **PoC** | Confirmed local: attacker `startWithEmail(victim@…)` → hold `sess_`; victim later pays → attacker session becomes fully entitled |
| **Impact** | Classify meter, mirror upsert/delete/wipe/outbox, promo redeem, billing hooks for victim email |
| **Fix** | Never mint privileged `sess_` without magic-link (or equivalent) proof; or mark `verified:false` and gate all sensitive routes; **revoke all sessions** (or all unverified) on magic-link exchange and entitlement upgrade; rate-limit + CAPTCHA soft start |

### C2 — Cross-tenant classify response leak via global idempotency key

| | |
|--|--|
| **Surface** | `plus-service` |
| **Evidence** | `usage_events.idempotency_key` PRIMARY KEY only; replay returns `response_json` with **no** `row.email === session.email` check (`postgres.mjs`, memory store same) |
| **PoC** | Confirmed local: User A classify with key K → User B same key gets A’s cached classify JSON without consuming B’s filings |
| **Impact** | Cross-tenant disclosure of capture-derived titles/tags/links; free classify / block victim key |
| **Fix** | Scope lookup `(email, idempotency_key)` or always `WHERE key=? AND email=?`; refuse foreign replay; regression test two entitled users same key |

---

## High

### H1 — XSS on magic-link exchange HTML leaks session

- **Evidence:** `plus-service/src/server.mjs` `renderExchangeHtml` interpolates email/session without `esc()` (OAuth path uses `esc()` correctly). Email validation is only `includes("@")`.
- **Attack:** Crafted email local-part → script on exchange page → exfil `sess_` from Advanced block.
- **Fix:** Escape all dynamic HTML; CSP `script-src 'none'`; prefer not embedding session in HTML.

### H2 — Unbounded request body → memory DoS

- **Evidence:** `readRawBody` concatenates all chunks with no size cap (`server.mjs`).
- **Attack:** Multi-GB POST → OOM on small Fly VM.
- **Fix:** Abort at 1–2MB (higher only if Stripe needs it); 413; edge limit too.

### H3 — Soft-start enables promo / billing abuse (amplifies C1)

- **Evidence:** `POST /v1/promo`, checkout use session email without verified-email gate.
- **Fix:** Verified session only for promo, checkout, portal, mirror, classify (falls out of C1).

### H4 — MCP read path: no rate limit; full-mirror decrypt per search

- **Evidence:** `mcp/handler.mjs` — write tools rate-limited; search loads/decrypts all rows for email.
- **Attack:** Stolen `mcp_` → CPU/memory cost amplification.
- **Fix:** Per-token/email limits on `/mcp`; paginate/index; avoid full decrypt scan.

### H5 — `plusBaseUrl` in synced `data.json` can steal session + vault content

- **Evidence:** `src/settings/settings.ts`, `plusClient.ts`, `types.ts` — override syncs with vault.
- **Attack:** Malicious settings paste / compromised Sync peer points plugin at evil host → Bearer `sess_` + classify/Ask payloads.
- **Fix:** Allowlist prod + explicit loopback; device-local “I trust this host”; never sync override in shipping builds.

### H6 — Ask privacy copy says “only Atoms/”; code uploads linked hub **bodies**

- **Evidence:** `settings.ts` ack vs `main.ts` hub resolve + `askMirror.ts` full body upsert.
- **Impact:** Consent integrity failure; person hubs / project notes leave device.
- **Fix:** Honest ack + README; optional hub-mirror toggle; title-only hubs default.

### H7 — GitHub secret scanning & push protection disabled

- **Evidence:** `gh api …/security_and_analysis` — secret scanning, push protection, Dependabot security updates **disabled**.
- **Fix:** Enable all three + validity checks; add `SECURITY.md`.

### H8 — No CI; branch protection requires 0 reviews / no status checks

- **Evidence:** No `.github/workflows`; `required_approving_review_count: 0`.
- **Fix:** `npm ci && test && build` (+ plus-service); require checks on `master`; ≥1 review.

### H9 — BRAT/Release path: manual unsigned assets, no published checksums

- **Evidence:** Releases ship `main.js` from maintainer laptop; no SHA256SUMS in UX; no cosign.
- **Impact:** Account/release hijack → malicious plugin to all BRAT users.
- **Fix:** CI-built artifacts only; publish checksums; optional signing; protect tags/releases.

---

## Medium

| ID | Title | Surface | Fix sketch |
|----|-------|---------|------------|
| M1 | Incomplete client redaction (`sess_`/`mt_`/`mcp_` missing on classify/connectivity; settings Notice unredacted) | plugin | Shared `redactSecrets`; tests |
| M2 | Personal email in public docs (`tai.piplup@gmail.com`) | docs | Placeholder emails |
| M3 | Device-local API key prefilled in settings DOM | plugin | “Key on file · Replace…” |
| M4 | Billing `window.open(url)` without allowlist | plugin | Stripe/Plus host allowlist like capture shortcut |
| M5 | Model link `note`/`reason` not sanitized on Process path (outbox path stronger) | plugin | Sanitize like `askOutbox`; strip URLs/newlines |
| M6 | Ask outbox unbounded body size client-side | plugin | Cap KB; reject |
| M7 | Latent YAML injection in `relation:` (currently unwired) | plugin | Allowlist + quote before wiring |
| M8 | In-process rate limit / XFF spoof / multi-instance | plus | Shared limiter; trust Fly hop only |
| M9 | Magic tokens plaintext in DB; links in non-prod logs | plus | Hash at rest; never log full link in prod |
| M10 | Session in browser HTML + magic token in URL | plus | POST exchange; no token dump; Referrer-Policy |
| M11 | OAuth scope `atoms:read` but write-via-outbox tools | plus | Split scopes; enforce at tools |
| M12 | Reconcile staging Map in-memory only | plus | Postgres-backed staging |
| M13 | CORS `*` with Bearer tokens | plus | Acceptable for Obsidian; don’t put tokens in web pages (ties to H1) |
| M14 | `obsidian: "latest"` devDep | supply | Pin version |
| M15 | plus-service moderate CVE via MCP SDK → hono node-server | supply | Bump SDK / override |
| M16 | Adhoc-signed `Atoms Capture.app` binary in repo | supply | Ship source only or CI-build |
| M17 | `npx --yes tsx` in `verify.sh` | supply | Pin tsx devDep |
| M18 | Docker runs as root | plus | `USER node` |
| M19 | Full vault title graph on every classify | privacy | Document; BM25 shortlist later |
| M20 | Stolen `sess_` = full cloud brain admin | privacy/plus | Short TTL, re-auth wipe, device bind |
| M21 | README privacy block is BYOK-centric; Plus/Ask under-documented | docs | Three-plane privacy section |

---

## Low / Info

- Fingerprint last-4 of BYOK key in dev logs only (`ATOMS_DEV_COMMANDS=false` in prod).
- Magic-link full URL logged non-prod.
- E2E script machine temp paths + session prefix logging.
- Upstream Anthropic error body forwarded to Plus clients (redact).
- `.gitignore` solid; optional root `.remember/`, `.claude/`.
- Person hub path sanitizer weaker than `sanitizeFilename`.
- Tags weakly normalized → unquoted YAML.
- Ask watcher hardcodes `Atoms/` vs `clampAtomFolder`.
- Missing security headers on HTML routes.
- PKCE compare not constant-time.
- Operator-controlled `ANTHROPIC_MESSAGES_URL` (env SSRF if env compromised).
- Preview cache stores classification **results** (not full captures) in localStorage.
- No product telemetry (privacy-positive).
- Ask encryption is host-decryptable, not ZK (by design).

---

## Data egress map (privacy)

```
Classify (Process / auto-run / backfill)
  → capture text + ALL vault titles (+ aliases) + tags + person hub titles/H2
  → BYOK: api.anthropic.com  |  Plus: plus.tryatoms.app → Anthropic (server-owned prompt)
  NOT: full daily bodies, attachments, unrelated note bodies

Ask mirror (opt-in ack)
  → flat Atoms/*.md full bodies + linked hub note full bodies
  → Plus DB (AES-GCM if ATOMS_ASK_MIRROR_KEY) → MCP tool results → Claude/ChatGPT

Ask outbox (separate write ack)
  → remote enqueue → plugin creates new Atoms/*.md only (no overwrite)

No analytics / Sentry / crash reporters found.
```

**Prompt injection residual:** integrity/phishing (junk atoms, malicious link prose URLs), not arbitrary vault path RCE — path clamps + no-overwrite + create-only outbox hold.

---

## GOOD practices (keep)

1. API key never in `data.json` — SecretStorage / opt-in device-local only  
2. Plus `sess_` device-local; server sessions **hashed** at rest  
3. Production fail-closed gate (`prodGate.mjs`)  
4. `sanitizeFilename` / `clampAtomFolder` / body sacred / collision non-overwrite  
5. DOM via `text:` / `setText` — no `innerHTML`  
6. Plus classify ignores client `messagesRequest` (server-owned)  
7. Audience split `sess_` vs `mcp_` with hard rejects + tests  
8. Mirror path allowlist; tenant email from session not body  
9. Stripe HMAC + price allowlist + email mismatch fail-closed  
10. `main.js` gitignored; lockfiles with integrity; no npm lifecycle scripts  
11. Capture shortcut URL allowlist; dual Ask acks  
12. Prior security docs culture (`docs/security/pre-community-publish-review.md`)  
13. Redaction tests for `sk-ant-` shapes on connectivity path  

---

## Suggested workstreams (not claimed)

| Stream | Scope | Lane |
|--------|-------|------|
| **A — Plus auth/meter hotfix** | C1, C2, H1, H2, H3 | Full — security surface |
| **B — Privacy honesty** | H6, M21, hub toggle | Light / amend |
| **C — Plugin trust boundaries** | H5, M1, M3–M7 | Light |
| **D — Public repo hygiene** | H7–H9, M2, M14–M18 | Light (ops + docs) |
| **E — Security contract bootstrap** | Access matrix for Plus routes (`sess_`/`mcp_`/Stripe/mirror) | Full — use security-contract-framework bootstrap into `docs/security/` |

No hard claim / PR opened by this review. Chat is not a ticket — claim before implementing.

---

## Residual accepted product tradeoffs

- Classify must send capture text + (today) full title graph  
- Third-party LLM (Anthropic) sees prompts  
- Ask mirror is not zero-knowledge  
- Outbox can create atoms when write-ack on  
- Auto-run unattended egress after one-time ack (past-only, capped)  
- Self-host operator is root of their stack  

---

## Agent coverage

| Agent | Focus |
|-------|--------|
| 1 | Secrets & credential leakage |
| 2 | plus-service backend (auth, IDOR, DoS, MCP, Stripe) |
| 3 | Plugin client (XSS, path, network, model→FS) |
| 4 | Supply chain, CI, git, releases, deps |
| 5 | Privacy, egress map, prompt injection |
| 6 | security-contract-framework skill (method; no contract present → bootstrap candidate) |

**Bottom line:** Safe to stay public on **source hygiene** (no live secrets). **Do not treat hosted multi-tenant Plus as production-safe** until C1/C2/H1 are fixed. Plugin local vault safety is comparatively mature; consent/docs and GitHub/release integrity need catch-up for a public product.
