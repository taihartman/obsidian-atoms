/**
 * Capture shortcut install/update — versioned HTTPS link + device-local ack.
 * URLs live in repo-root mobile-install.json (SSOT) via src/shared/mobileInstall.ts.
 * We cannot push into Shortcuts.app; "update" = open latest URL + ack.
 */

import {
  APPEND_SHORTCUT_ALL_URLS,
  CAPTURE_ATOM_ALL_URLS,
  CAPTURE_ATOM_INSTALL_URL,
  CAPTURE_ATOM_VERSION,
} from "../shared/mobileInstall";

/** @deprecated Prefer CAPTURE_ATOM_VERSION — kept for existing imports. */
export const CAPTURE_SHORTCUT_VERSION = CAPTURE_ATOM_VERSION;

/** Capture Atom + Append history — pasting either must not pin as “custom”. */
const BUILTIN_INSTALL_URLS: readonly [string, ...string[]] = [
  ...CAPTURE_ATOM_ALL_URLS,
  ...APPEND_SHORTCUT_ALL_URLS,
];

/** @deprecated Prefer CAPTURE_ATOM_INSTALL_URL */
export const CAPTURE_SHORTCUT_INSTALL_URL: string = CAPTURE_ATOM_INSTALL_URL;

/** Device-local (never data.json). */
export const LS_CAPTURE_SHORTCUT_ACK = "atoms-capture-shortcut-acked-version";

/**
 * Comparison form only — never opened, never stored.
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
 * The settings value only when it is genuinely the user's own link; "" when empty
 * or holds a link we shipped (Capture Atom or Append history).
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

/** Prefer the user's own link, then the built-in Capture Atom constant. */
export function resolveCaptureShortcutInstallUrl(
  settingsUrl?: string | null,
): string {
  const custom = customCaptureShortcutUrl(settingsUrl);
  if (custom) return custom;
  return (CAPTURE_ATOM_INSTALL_URL ?? "").trim();
}

function readAckVersion(
  load: (key: string) => unknown,
  key: string,
): string | null {
  const v = load(key);
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function ackIsStale(
  acked: string | null | undefined,
  shipped: string,
): boolean {
  if (acked == null || acked === "") return true;
  return acked !== shipped;
}

export function needsShortcutCta(
  acked: string | null | undefined,
  shipped: string = CAPTURE_ATOM_VERSION,
): boolean {
  if (!shipped) return false;
  return ackIsStale(acked, shipped);
}

/** @deprecated Home/settings primary CTA is companion — kept for advanced shortcut row. */
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
  version: string = CAPTURE_ATOM_VERSION,
): void {
  save(LS_CAPTURE_SHORTCUT_ACK, version);
}

export const CAPTURE_SHORTCUT_URL_PREFIX =
  "https://www.icloud.com/shortcuts/";

export function isAllowedCaptureShortcutUrl(url: string): boolean {
  const u = (url ?? "").trim();
  if (!u) return false;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== "www.icloud.com") return false;
    if (!parsed.pathname.startsWith("/shortcuts/")) return false;
    const rest = parsed.pathname.slice("/shortcuts/".length);
    if (!rest || rest.includes("..")) return false;
    return true;
  } catch {
    return false;
  }
}

export function openShortcutInstallUrl(url: string): boolean {
  const u = (url ?? "").trim();
  if (!isAllowedCaptureShortcutUrl(u)) return false;
  try {
    window.open(u, "_blank");
    return true;
  } catch {
    return false;
  }
}

/** All shipped Capture Atom URLs (tests freeze the set). */
export function shippedCaptureAtomUrls(): readonly string[] {
  return BUILTIN_INSTALL_URLS;
}
