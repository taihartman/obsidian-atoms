/**
 * Capture shortcut install/update — versioned HTTPS link + device-local ack.
 * We cannot push into Shortcuts.app; "update" = open latest URL + ack.
 */

export const CAPTURE_SHORTCUT_VERSION = "1.0.0";

/**
 * iCloud / GitHub release link for the capture shortcut.
 * Empty until published — UI disables Install and shows a Settings note.
 */
export const CAPTURE_SHORTCUT_INSTALL_URL = "";

/** Device-local (never data.json). */
export const LS_CAPTURE_SHORTCUT_ACK = "atoms-capture-shortcut-acked-version";

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

/**
 * Open install URL. Returns true if opened (caller may ack).
 * Empty URL → false (caller should Notice).
 */
export function openShortcutInstallUrl(
  url: string = CAPTURE_SHORTCUT_INSTALL_URL,
): boolean {
  const u = (url ?? "").trim();
  if (!u) return false;
  try {
    // Works on desktop Electron and generally on mobile Safari WebView.
    window.open(u, "_blank");
    return true;
  } catch {
    return false;
  }
}
