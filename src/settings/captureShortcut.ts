/**
 * Capture shortcut install/update — versioned HTTPS link + device-local ack.
 * We cannot push into Shortcuts.app; "update" = open latest URL + ack.
 *
 * iCloud links can only be created from Shortcuts.app on an Apple device.
 * Prefer Settings → Capture → paste link (syncs via data.json).
 */

export const CAPTURE_SHORTCUT_VERSION = "2.1.0";

/**
 * Every install URL we have shipped as the built-in, newest first.
 *
 * Pasting one of these into Settings → Capture is copying the default, not
 * customising it — but a settings value wins over the constant forever, so that
 * user silently stays on a superseded shortcut every time we ship a new link.
 * Treating a match as "no custom link" puts them back on the default and keeps
 * them there.
 *
 * **To ship a new link, prepend it here** — the exported constant is the head of
 * this list, so the outgoing URL cannot be dropped by forgetting a second edit.
 * `captureShortcut.test.ts` freezes the full set: removing an entry fails there
 * rather than silently re-pinning everyone still storing it.
 */
const BUILTIN_INSTALL_URLS: readonly [string, ...string[]] = [
  "https://www.icloud.com/shortcuts/bbd26339dc874a13b36b31620cf3c457",
  "https://www.icloud.com/shortcuts/e8bfe486b2bc458cb37af87c107771a2",
  "https://www.icloud.com/shortcuts/b1a910ea39094d7b857a983529e3bf8b",
  "https://www.icloud.com/shortcuts/28a87317da06494896ef183ec846606f",
  "https://www.icloud.com/shortcuts/e885d7c0d8f04a17803a2cc201f24409",
];

/**
 * Built-in default install URL (iCloud share) — the newest shipped link.
 * User settings override still wins — see resolveCaptureShortcutInstallUrl.
 */
export const CAPTURE_SHORTCUT_INSTALL_URL: string = BUILTIN_INSTALL_URLS[0];

/** Device-local (never data.json). */
export const LS_CAPTURE_SHORTCUT_ACK = "atoms-capture-shortcut-acked-version";

/** Device-local (never data.json). Re-arms when the shipped shortcut version changes. */
export const LS_INBOX_INFERRED_DATE_ACK =
  "atoms-inbox-inferred-date-acked-version";

/**
 * Comparison form only — never opened, never stored.
 *
 * `isAllowedCaptureShortcutUrl` accepts `…/shortcuts/<id>/`, so a shipped link
 * pasted with a trailing slash, a stray `?`/`#`, or an odd-cased host is the
 * same shortcut wearing a different string. Exact equality would read those as
 * a custom link and pin the user permanently — the trap this module exists to
 * close. Anything unparseable falls back to the trimmed input, which simply
 * fails the match and is treated as custom.
 */
function canonicalShortcutUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${path}`;
  } catch {
    return url;
  }
}

/**
 * The settings value only when it is genuinely the user's own link; "" when the
 * field is empty or holds a link we shipped ourselves. Empty therefore means
 * "on the built-in", which is what Settings renders and what decides whether a
 * stored value still deserves to outrank the constant.
 *
 * Returns the user's string verbatim (trimmed) — canonicalisation decides only
 * whether it counts as custom, never what gets opened.
 */
export function customCaptureShortcutUrl(settingsUrl?: string | null): string {
  const fromSettings = (settingsUrl ?? "").trim();
  if (!fromSettings) return "";
  const canonical = canonicalShortcutUrl(fromSettings);
  if (BUILTIN_INSTALL_URLS.some((u) => canonicalShortcutUrl(u) === canonical)) {
    return "";
  }
  return fromSettings;
}

/** Prefer the user's own link, then the built-in constant. */
export function resolveCaptureShortcutInstallUrl(
  settingsUrl?: string | null,
): string {
  const custom = customCaptureShortcutUrl(settingsUrl);
  if (custom) return custom;
  return (CAPTURE_SHORTCUT_INSTALL_URL ?? "").trim();
}

/**
 * Ack version stored under `key`, or null when nothing usable is stored.
 *
 * Shared by the two acks below; each keeps its own key and its own meaning —
 * acking the shortcut says nothing about the inferred-date signal.
 */
function readAckVersion(
  load: (key: string) => unknown,
  key: string,
): string | null {
  const v = load(key);
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

/** Never acked, or acked against an older shipped version. */
function ackIsStale(
  acked: string | null | undefined,
  shipped: string,
): boolean {
  if (acked == null || acked === "") return true;
  return acked !== shipped;
}

/** True when user should see Install or Update CTA. */
export function needsShortcutCta(
  acked: string | null | undefined,
  shipped: string = CAPTURE_SHORTCUT_VERSION,
): boolean {
  if (!shipped) return false;
  return ackIsStale(acked, shipped);
}

/** CTA text names the Shortcut itself, so the button matches what Shortcuts.app shows. */
export function labelInstallOrUpdate(
  acked: string | null | undefined,
): "Install Capture Atom" | "Update Capture Atom" {
  if (acked == null || acked === "") return "Install Capture Atom";
  return "Update Capture Atom";
}

export function readShortcutAck(
  load: (key: string) => unknown,
): string | null {
  return readAckVersion(load, LS_CAPTURE_SHORTCUT_ACK);
}

export function writeShortcutAck(
  save: (key: string, value: unknown) => void,
  version: string = CAPTURE_SHORTCUT_VERSION,
): void {
  save(LS_CAPTURE_SHORTCUT_ACK, version);
}

export function readInferredDateAck(
  load: (key: string) => unknown,
): string | null {
  return readAckVersion(load, LS_INBOX_INFERRED_DATE_ACK);
}

export function writeInferredDateAck(
  save: (key: string, value: unknown) => void,
  version: string = CAPTURE_SHORTCUT_VERSION,
): void {
  save(LS_INBOX_INFERRED_DATE_ACK, version);
}

/**
 * True when home should surface "these captures were filed without a time".
 *
 * Keyed to the shortcut version rather than a plain boolean: the inbox is
 * append-only and never cleaned, so the read-time count stays true forever. A
 * permanent dismiss would silently re-create the dead end this signal exists to
 * remove; a version-keyed one re-arms once the shipped shortcut moves on.
 */
export function needsInferredDateSignal(
  inferredDates: number,
  acked: string | null | undefined,
  shipped: string = CAPTURE_SHORTCUT_VERSION,
): boolean {
  if (inferredDates <= 0) return false;
  return ackIsStale(acked, shipped);
}

/** Only iCloud Shortcuts share links may be opened from the plugin. */
export const CAPTURE_SHORTCUT_URL_PREFIX =
  "https://www.icloud.com/shortcuts/";

/**
 * True when URL is a trusted iCloud Shortcuts install link (HTTPS host+path).
 * Rejects javascript:, http, other hosts, and empty.
 */
export function isAllowedCaptureShortcutUrl(url: string): boolean {
  const u = (url ?? "").trim();
  if (!u) return false;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== "www.icloud.com") return false;
    if (!parsed.pathname.startsWith("/shortcuts/")) return false;
    // Require a non-empty shortcut id segment
    const rest = parsed.pathname.slice("/shortcuts/".length);
    if (!rest || rest.includes("..")) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Open install URL. Returns true if opened (caller may ack).
 * Empty or non-allowlisted URL → false (caller should Notice).
 */
export function openShortcutInstallUrl(url: string): boolean {
  const u = (url ?? "").trim();
  if (!isAllowedCaptureShortcutUrl(u)) return false;
  try {
    // Works on desktop Electron and generally on mobile Safari WebView.
    window.open(u, "_blank");
    return true;
  } catch {
    return false;
  }
}
