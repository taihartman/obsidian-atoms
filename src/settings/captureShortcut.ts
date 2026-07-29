/**
 * Capture shortcut install/update — versioned HTTPS link + device-local ack.
 * We cannot push into Shortcuts.app; "update" = open latest URL + ack.
 *
 * iCloud links can only be created from Shortcuts.app on an Apple device.
 * Prefer Settings → Capture → paste link (syncs via data.json).
 */

export const CAPTURE_SHORTCUT_VERSION = "2.0.0";

/**
 * Built-in default install URL (iCloud share).
 * User settings override still wins — see resolveCaptureShortcutInstallUrl.
 */
export const CAPTURE_SHORTCUT_INSTALL_URL =
  "https://www.icloud.com/shortcuts/e8bfe486b2bc458cb37af87c107771a2";

/** Device-local (never data.json). */
export const LS_CAPTURE_SHORTCUT_ACK = "atoms-capture-shortcut-acked-version";

/** Device-local (never data.json). Re-arms when the shipped shortcut version changes. */
export const LS_INBOX_INFERRED_DATE_ACK =
  "atoms-inbox-inferred-date-acked-version";

/** Prefer synced settings URL, then built-in constant. */
export function resolveCaptureShortcutInstallUrl(
  settingsUrl?: string | null,
): string {
  const fromSettings = (settingsUrl ?? "").trim();
  if (fromSettings) return fromSettings;
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
