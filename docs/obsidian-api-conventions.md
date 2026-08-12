# Obsidian API conventions (agents)

**Audience:** coding agents. Follow these so Community Plugin review / `obsidianmd/*` ESLint rules stay green.  
**Why it exists:** #407 — the same style / Platform / window / fetch flags kept recurring.

## Upstream (authoritative)

| Source | URL |
|---|---|
| Plugin guidelines | https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines |
| ESLint plugin (rule list) | https://github.com/obsidianmd/eslint-plugin |
| npm | `eslint-plugin-obsidianmd` |

**Local / CI:** `npm run lint` — same recommended ruleset (with a few documented offs). Runs on every PR via `root-tests.yml`.

These are **plugin-source** rules (`src/**`, `styles.css`). Tests may use mocks and plain objects.

---

## Must (errors / review blockers)

| Do | Don’t |
|---|---|
| Prefer **CSS classes** in `styles.css` for static look/behavior | `el.style.foo = …` for fixed values |
| Dynamic styles: `el.setCssStyles({…})` or `el.setCssProps({…})` | Direct `el.style.*` assignment |
| `parent.createEl` / `createDiv` / `createSpan` | `document.createElement` |
| `Platform.isIosApp` / `Platform.isAndroidApp` / `Platform.isMobileApp` / `Platform.isDesktopApp` | `navigator.userAgent` (or any navigator OS sniff) for platform |
| `window.setTimeout` / `window.clearTimeout` (and `activeWindow` when the code is popout-aware) | Bare `setTimeout` / `clearTimeout` |
| `window` (or `activeWindow`) for web globals in UI code | `globalThis` |
| Narrow files with `instanceof TFile` before `vault.read` / `cachedRead` / `modify` | `file as TFile` |
| Network via Obsidian **`requestUrl`** (or an injectable `RequestFn` defaulting to it) | Bare `fetch` for Anthropic / general HTTPS |

### Intentional exceptions (document at the call site)

1. **`plusFetchRequest` (`src/platform/plusClient.ts`)** — uses **`window.fetch`** (never bare `fetch`, never `eslint-disable no-restricted-globals` — disable is forbidden) because desktop `requestUrl` fails to **localhost**. Production Plus is CORS-open. Do **not** copy this for Anthropic or other hosts.
2. **Control / bidi strip** in vault-label sanitizers — use a **code-point loop**, not a control-char regex literal (`no-control-regex`).
3. **`markDestructive`** — prefer `setDestructive` via bracket access when present (1.13+); else `buttonEl.addClass("mod-warning")`. Never `setWarning()`.
4. **Deprecated Capture aliases** (`CAPTURE_SHORTCUT_*`, `labelInstallOrUpdate`) — re-exports only. **New code** uses `CAPTURE_ATOM_*` and `labelCaptureShortcutCta`.
5. **`getSettingDefinitions` / `display` deprecation** — full declarative settings migration is its own claim; do not half-migrate.

---

## Should (warnings that rot the review)

| Topic | Rule |
|---|---|
| Async UI handlers | Setting `onChange` / `onClick` must return **void**. Use `void promise` or `.then(…)` — not `async (x) => { await … }`. |
| `configure:` callbacks | Use a **block body** that does not `return` the component chain. Obsidian components are thenable; returning them trips misused-promises. |
| Line-clamp | Discrete CSS classes (`--clamp-4` / `--clamp-8`), not `setCssProps` / `el.style`. |
| `loadLocalStorage` / `JSON.parse` | Type as `unknown`, then narrow. Do not assign straight into a typed local. |
| Unnecessary `as` | If control-flow already narrows, drop the assertion. |
| `this` alias | Prefer a small arrow closure (`const getX = () => this.x`) over `const self = this` / `const plugin = this` when only a live getter is needed. |
| Unused imports | Delete. Do not leave `Notice` / `TFile` / flags “for later”. |
| Clipboard | `navigator.clipboard` is OK for explicit user-gesture copy in settings; do not use navigator for **OS detection**. |

---

## Settings API (Obsidian 1.13+)

- Community lint wants `PluginSettingTab.getSettingDefinitions()` so settings appear in app search.
- This codebase still uses imperative `display()` (large surface). **Do not** half-migrate one section in a drive-by.
- New settings work: prefer the existing `settingRow` / `formRow` / `actionRow` grammar in `src/settings/rows.ts`. A full declarative migration is its own claim.

---

## CSS + Home UI

- Library rows (`.atoms-home-cell`): put `touch-action: manipulation` (and similar) in **CSS**, not inline.
- Progress fill width and other **runtime** percentages: `setCssStyles({ width: \`${n}%\` })`.
- Line-clamp depth: `setCssProps({ "-webkit-line-clamp": String(n) })` + a clamp class for box model.

---

## Checklist before PR (plugin UI / platform)

```text
[ ] npm run lint          # fails on errors; community rules
[ ] No new el.style.* for static values
[ ] No navigator UA / platform sniff — Platform.* only
[ ] No bare setTimeout/clearTimeout/globalThis in src/
[ ] No document.createElement — createEl/Div/Span
[ ] No `as TFile` — instanceof
[ ] No new fetch() except plusFetchRequest (window.fetch only)
[ ] Setting handlers return void (void promise)
[ ] npm run typecheck && npm test
```

### ESLint offs (intentional)

| Rule | Why |
|---|---|
| `settings-tab/prefer-setting-definitions` | Full declarative settings migration is its own claim |
| `settings-tab/no-deprecated-display` | minAppVersion still &lt; 1.13; `display()` required |
| `ui/sentence-case` | Product voice / brands own UI copy (`docs/voice.md`) |
| `@typescript-eslint/no-deprecated` | Same as display deprecation until migration |

---

## Related

- Stack one-liner in [`CLAUDE.md`](../CLAUDE.md) § Stack + tests  
- Community pre-publish: [`docs/security/pre-community-publish-review.md`](./security/pre-community-publish-review.md)  
- Issue that codified this pass: [#407](https://github.com/taihartman/obsidian-atoms/issues/407)
