/**
 * Mobile companion + shortcut install links — SSOT from repo-root mobile-install.json.
 * Plugin and docs read here. iOS companion mirrors append URL/name in DeliverySettings
 * (Swift cannot import this JSON at runtime until bundled; tests pin parity).
 */

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

/** Open companion setup docs (iOS + Android links in notice path). */
export function openCompanionDocs(platform: "ios" | "android" | "both" = "both"): boolean {
  try {
    if (platform === "ios" || platform === "both") {
      window.open(IOS_COMPANION_DOCS_URL, "_blank");
    }
    if (platform === "android") {
      window.open(ANDROID_COMPANION_DOCS_URL, "_blank");
    }
    if (platform === "both") {
      // iOS already opened; Android in same gesture is aggressive — prefer iOS docs
      // which point at the monorepo companion folder. User can find Android from README index.
    }
    return true;
  } catch {
    return false;
  }
}

export function labelGetCompanion(
  acked: string | null | undefined,
): "Get Atoms Capture" | "Companion guide" {
  if (acked == null || acked === "") return "Get Atoms Capture";
  return "Companion guide";
}
