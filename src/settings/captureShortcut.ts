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

/**
 * The whole capture-on-phone procedure, as the three steps it actually is.
 *
 * It used to be one run-on description on a settings row: six arrow-separated fragments plus an
 * "Acked:" stamp, which is a procedure written as a footnote. A row cannot hold a procedure — it
 * has one line and no order — so U9 gives it a sheet and the sheet gives it numbers.
 *
 * Step 1 is first because it is the one people skip. The shortcut appends to a bookmark, and the
 * bookmark does not exist until Obsidian has opened this vault with Atoms once, so a phone that
 * installs before that has nothing to point step 3 at.
 *
 * Step 3 keeps **Ask Each Time** named. It is the default the picker offers and it is the single
 * failure this procedure exists to prevent: a shortcut left on it prompts for a destination at
 * every capture, which is exactly the friction the shortcut was for, and nothing else on any
 * screen would tell the user why.
 */
export const CAPTURE_SHORTCUT_STEPS: readonly string[] = [
  "Open this vault in Obsidian once, so the Atoms Inbox bookmark exists.",
  "Add Capture Atom to Shortcuts on your phone.",
  "In Shortcuts, open Capture Atom, edit it, and set Append to Bookmark to Atoms Inbox. Not Ask Each Time.",
];

/** What the row says about this device, without opening the sheet to find out. */
export function captureShortcutStatus(acked: string | null | undefined): string {
  const version = (acked ?? "").trim();
  // The *acked* version, not the shipped one: a device holding an older ack is out of date, and
  // printing the version it would have after updating would hide exactly that.
  return version ? `Capture Atom ${version}` : "Not set up";
}

/** Shortcut install CTA — Install until ack, then Update. */
export function labelCaptureShortcutCta(
  acked: string | null | undefined,
): "Install Capture Atom" | "Update Capture Atom" {
  if (acked == null || acked === "") return "Install Capture Atom";
  return "Update Capture Atom";
}

/** @deprecated Prefer {@link labelCaptureShortcutCta}. */
export function labelInstallOrUpdate(
  acked: string | null | undefined,
): "Install Capture Atom" | "Update Capture Atom" {
  return labelCaptureShortcutCta(acked);
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
