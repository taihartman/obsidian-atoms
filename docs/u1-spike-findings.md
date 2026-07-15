# U1 spike findings

Date: 2026-07-15

## Verified against live docs (no API key required)

### Structured outputs (KTD4)

- **Current field:** `output_config.format` with `type: "json_schema"`.
- **Deprecated:** top-level `output_format`.
- **Beta header:** **not required** (GA). Migration tip in Anthropic docs: beta header + old field still work during transition.
- **Endpoint:** `POST https://api.anthropic.com/v1/messages` with `anthropic-version: 2023-06-01`.
- Plugin uses the GA shape only.

### Prompt caching (KTD3)

- Explicit `cache_control: { type: "ephemeral", ttl: "5m" | "1h" }` on content blocks.
- Usage fields: `cache_creation_input_tokens`, `cache_read_input_tokens`.
- Sonnet 5 minimum cacheable prefix: **~1024 tokens**. Below that, both cache fields stay 0 (not a bug).
- Spike pads vault titles so the stable prefix clears the floor (AE6).

### SecretStorage (KTD5)

- Obsidian ≥ **1.11.4**: `app.secretStorage` + `SecretComponent`.
- Settings store the secret **id/name**, not the key value; retrieve via `getSecret(id)`.
- Secret ids: lowercase alphanumeric with optional dashes.
- `SecretComponent` needs `App` → use `Setting#addComponent()`, not `addText()`.
- **iOS plugin-sandbox verification:** still required on device (command: *Spike: probe SecretStorage read/write*). Contingency implemented: device-local `saveLocalStorage` fallback with explicit disclosure.

## Runtime evidence still needed (your key / device)

| Check | How |
|---|---|
| Structured-output call returns schema-valid JSON | Command: *Spike: classify hardcoded capture* **or** `ANTHROPIC_API_KEY=… npm run spike:api` |
| `cache_read_input_tokens > 0` on 2nd call | Command: *Spike: measure cache + per-day batch fork* **or** same npm script |
| SecretStorage on **iOS** | Run probe command on iPhone/iPad Obsidian |
| KTD3 winner (per-capture vs day-batch) | Compare console output of the measure command / spike script |

## Provisional KTD3 decision (until measured)

**Default implementation path remains per-capture + prompt caching** (as written in the plan), because:

1. One bad response cannot kill an entire day of captures.
2. Within-run cache amortization is the documented cost story for multi-capture mornings.
3. Day-batch can still be adopted if measurement shows better cost *and* equal quality.

The day-batch path is fully instrumented in the spike (plugin command + `scripts/spike-api.mjs`) so the decision can flip without redesign.

## Provisional KTD5 decision

**Primary: SecretStorage.** **Fallback: device-local localStorage** (never `data.json`), gated by an explicit settings toggle + disclosure. Flip to fallback-only only if the iOS probe fails.
