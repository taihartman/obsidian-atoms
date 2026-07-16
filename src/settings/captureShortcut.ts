/**
 * Capture shortcut install/update — versioned HTTPS link + device-local ack.
 * We cannot push into Shortcuts.app; "update" = open latest URL + ack.
 *
 * iCloud links can only be created from Shortcuts.app on an Apple device.
 * Prefer Settings → Capture → paste link (syncs via data.json).
 */

export const CAPTURE_SHORTCUT_VERSION = "1.1.0";

/**
 * Built-in default install URL (iCloud share).
 * User settings override still wins — see resolveCaptureShortcutInstallUrl.
 */
export const CAPTURE_SHORTCUT_INSTALL_URL =
  "https://www.icloud.com/shortcuts/28a87317da06494896ef183ec846606f";

/** Device-local (never data.json). */
export const LS_CAPTURE_SHORTCUT_ACK = "atoms-capture-shortcut-acked-version";

/** Prefer synced settings URL, then built-in constant. */
export function resolveCaptureShortcutInstallUrl(
  settingsUrl?: string | null,
): string {
  const fromSettings = (settingsUrl ?? "").trim();
  if (fromSettings) return fromSettings;
  return (CAPTURE_SHORTCUT_INSTALL_URL ?? "").trim();
}

/** True when user should see Install or Update CTA. */
export function needsShortcutCta(
  acked: string | null | undefined,
  shipped: string = CAPTURE_SHORTCUT_VERSION,
): boolean {
  if (!shipped) return false;
  if (acked == null || acked === "") return true;
  return acked !== shipped;
}

export function labelInstallOrUpdate(
  acked: string | null | undefined,
): "Install capture shortcut" | "Update capture shortcut" {
  if (acked == null || acked === "") return "Install capture shortcut";
  return "Update capture shortcut";
}

export function readShortcutAck(
  load: (key: string) => unknown,
): string | null {
  const v = load(LS_CAPTURE_SHORTCUT_ACK);
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

export function writeShortcutAck(
  save: (key: string, value: unknown) => void,
  version: string = CAPTURE_SHORTCUT_VERSION,
): void {
  save(LS_CAPTURE_SHORTCUT_ACK, version);
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
