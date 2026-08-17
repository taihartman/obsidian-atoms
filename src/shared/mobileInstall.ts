/**
 * Mobile companion + shortcut install links — SSOT from repo-root mobile-install.json.
 * Plugin and docs read here. iOS companion mirrors append URL/name in DeliverySettings
 * (Swift cannot import this JSON at runtime until bundled; tests pin parity).
 */

import { Platform } from "obsidian";
import installJson from "../../mobile-install.json";

export type ShortcutInstallSpec = {
  name: string;
  version: string;
  role: string;
  urls: readonly [string, ...string[]];
};

export type CompanionInstallSpec = {
  name: string;
  version: string;
  role: string;
  docsUrl: string;
  /** Play / App Store listing. Open this for "get the app", not the README. */
  storeUrl?: string;
  bundleId?: string;
  applicationId?: string;
};

export type MobileInstall = {
  captureAtom: ShortcutInstallSpec;
  atomsCaptureAppend: ShortcutInstallSpec;
  iosCompanion: CompanionInstallSpec;
  androidCompanion: CompanionInstallSpec;
};

function readShortcut(raw: unknown, key: string): ShortcutInstallSpec {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`mobile-install.json: ${key} expected object`);
  }
  const o = raw as Record<string, unknown>;
  const name = o.name;
  const version = o.version;
  const role = o.role;
  const urls = o.urls;
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(`mobile-install.json: ${key}.name`);
  }
  if (typeof version !== "string" || !version.trim()) {
    throw new Error(`mobile-install.json: ${key}.version`);
  }
  if (typeof role !== "string") {
    throw new Error(`mobile-install.json: ${key}.role`);
  }
  if (!Array.isArray(urls) || urls.length < 1 || urls.some((u) => typeof u !== "string")) {
    throw new Error(`mobile-install.json: ${key}.urls must be non-empty string[]`);
  }
  return {
    name: name.trim(),
    version: version.trim(),
    role,
    urls: urls as [string, ...string[]],
  };
}

function readCompanion(raw: unknown, key: string): CompanionInstallSpec {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`mobile-install.json: ${key} expected object`);
  }
  const o = raw as Record<string, unknown>;
  const name = o.name;
  const version = o.version;
  const role = o.role;
  const docsUrl = o.docsUrl;
  if (typeof name !== "string" || typeof version !== "string" || typeof role !== "string") {
    throw new Error(`mobile-install.json: ${key} fields`);
  }
  if (typeof docsUrl !== "string" || !docsUrl.startsWith("https://")) {
    throw new Error(`mobile-install.json: ${key}.docsUrl`);
  }
  const out: CompanionInstallSpec = {
    name: name.trim(),
    version: version.trim(),
    role,
    docsUrl: docsUrl.trim(),
  };
  if (typeof o.storeUrl === "string" && o.storeUrl.startsWith("https://")) {
    out.storeUrl = o.storeUrl.trim();
  }
  if (typeof o.bundleId === "string") out.bundleId = o.bundleId;
  if (typeof o.applicationId === "string") out.applicationId = o.applicationId;
  return out;
}

function loadMobileInstall(raw: unknown): MobileInstall {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("mobile-install.json: expected object");
  }
  const o = raw as Record<string, unknown>;
  return {
    captureAtom: readShortcut(o.captureAtom, "captureAtom"),
    atomsCaptureAppend: readShortcut(o.atomsCaptureAppend, "atomsCaptureAppend"),
    iosCompanion: readCompanion(o.iosCompanion, "iosCompanion"),
    androidCompanion: readCompanion(o.androidCompanion, "androidCompanion"),
  };
}

export const MOBILE_INSTALL: MobileInstall = loadMobileInstall(installJson);

/** Newest Capture Atom iCloud URL. */
export const CAPTURE_ATOM_INSTALL_URL = MOBILE_INSTALL.captureAtom.urls[0];
export const CAPTURE_ATOM_VERSION = MOBILE_INSTALL.captureAtom.version;
export const CAPTURE_ATOM_NAME = MOBILE_INSTALL.captureAtom.name;
export const CAPTURE_ATOM_ALL_URLS = MOBILE_INSTALL.captureAtom.urls;

export const APPEND_SHORTCUT_INSTALL_URL =
  MOBILE_INSTALL.atomsCaptureAppend.urls[0];
export const APPEND_SHORTCUT_VERSION = MOBILE_INSTALL.atomsCaptureAppend.version;
export const APPEND_SHORTCUT_NAME = MOBILE_INSTALL.atomsCaptureAppend.name;
export const APPEND_SHORTCUT_ALL_URLS = MOBILE_INSTALL.atomsCaptureAppend.urls;

export const IOS_COMPANION_DOCS_URL = MOBILE_INSTALL.iosCompanion.docsUrl;
export const ANDROID_COMPANION_DOCS_URL = MOBILE_INSTALL.androidCompanion.docsUrl;
export const ANDROID_COMPANION_STORE_URL =
  MOBILE_INSTALL.androidCompanion.storeUrl ?? ANDROID_COMPANION_DOCS_URL;
export const IOS_COMPANION_VERSION = MOBILE_INSTALL.iosCompanion.version;
export const ANDROID_COMPANION_VERSION = MOBILE_INSTALL.androidCompanion.version;

/** Device-local ack for opening the companion guide (not the Capture Atom shortcut). */
export const LS_COMPANION_GUIDE_ACK = "atoms-companion-guide-acked-version";

export type CompanionPlatform = "ios" | "android" | "both";

/** Prefer Platform API; desktop / unknown → both docs. */
export function detectCompanionPlatform(): CompanionPlatform {
  if (Platform.isAndroidApp) return "android";
  if (Platform.isIosApp) return "ios";
  return "both";
}

/** Open companion setup docs. */
export function openCompanionDocs(
  platform: CompanionPlatform = detectCompanionPlatform(),
): boolean {
  try {
    if (platform === "ios" || platform === "both") {
      window.open(IOS_COMPANION_DOCS_URL, "_blank");
    }
    if (platform === "android" || platform === "both") {
      // Play listing when we have one. The README is for sideload, not for "get the app".
      const androidUrl = ANDROID_COMPANION_STORE_URL;
      // Slight delay so two tabs aren't blocked as one gesture on some WebViews.
      if (platform === "both") {
        window.setTimeout(() => {
          window.open(androidUrl, "_blank");
        }, 200);
      } else {
        window.open(androidUrl, "_blank");
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function companionGuideVersion(
  platform: CompanionPlatform = detectCompanionPlatform(),
): string {
  if (platform === "android") return ANDROID_COMPANION_VERSION;
  // iOS or both: iOS version is the banner key (desktop users get iOS+Android docs).
  return IOS_COMPANION_VERSION;
}

export function readCompanionGuideAck(
  load: (key: string) => unknown,
): string | null {
  const v = load(LS_COMPANION_GUIDE_ACK);
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

export function writeCompanionGuideAck(
  save: (key: string, value: unknown) => void,
  version: string = companionGuideVersion(),
): void {
  save(LS_COMPANION_GUIDE_ACK, version);
}

export function needsCompanionGuideCta(
  acked: string | null | undefined,
  shipped: string = companionGuideVersion(),
): boolean {
  if (!shipped) return false;
  if (acked == null || acked === "") return true;
  return acked !== shipped;
}

export function labelGetCompanion(
  acked: string | null | undefined,
  shipped: string = companionGuideVersion(),
): "Get Atoms Capture" | "Companion guide" {
  if (needsCompanionGuideCta(acked, shipped)) return "Get Atoms Capture";
  return "Companion guide";
}
