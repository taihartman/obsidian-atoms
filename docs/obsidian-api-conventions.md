# Obsidian API conventions (agents)

**Audience:** coding agents. Follow these so Community Plugin review / `obsidianmd/*` ESLint rules stay green.  
**Why it exists:** #407 — the same style / Platform / window / fetch flags kept recurring.

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

1. **`plusFetchRequest` (`src/platform/plusClient.ts`)** — uses renderer `fetch` because desktop `requestUrl` often fails to **localhost** during Plus dogfood; production Plus is CORS-open. Keep the file docstring + a one-line disable comment. Do **not** copy this pattern for Anthropic or other hosts.
2. **Control-character regex** in vault-label sanitizers (`plusSignIn`) — security strip of U+0000–U+001F / bidi / zero-width. Keep `eslint-disable-next-line no-control-regex` with the R5 reason.
3. **`markDestructive` + `setWarning` fallback** — `setDestructive` is 1.13+; manifest floor is older. Prefer `setDestructive` when present; fallback is required, not laziness.
4. **Deprecated Capture Atom aliases** (`CAPTURE_SHORTCUT_*`) — re-exports only for old imports. **New code** uses `CAPTURE_ATOM_INSTALL_URL` / `CAPTURE_ATOM_VERSION` from `mobileInstall.ts`.

---

## Should (warnings that rot the review)

| Topic | Rule |
|---|---|
| Async UI handlers | Setting `onChange` / `onClick` must return **void**. Use `void promise` or `.then(…)` — not `async (x) => { await … }`. |
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
[ ] No new el.style.* for static values
[ ] No navigator UA / platform sniff — Platform.* only
[ ] No bare setTimeout/clearTimeout/globalThis in src/
[ ] No document.createElement — createEl/Div/Span
[ ] No `as TFile` — instanceof
[ ] No new fetch() except plusFetchRequest (documented)
[ ] Setting handlers return void (void promise)
[ ] npm run typecheck && npm test
```

---

## Related

- Stack one-liner in [`CLAUDE.md`](../CLAUDE.md) § Stack + tests  
- Community pre-publish: [`docs/security/pre-community-publish-review.md`](./security/pre-community-publish-review.md)  
- Issue that codified this pass: [#407](https://github.com/taihartman/obsidian-atoms/issues/407)
