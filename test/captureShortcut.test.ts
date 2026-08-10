import { describe, expect, it } from "vitest";
import {
  CAPTURE_SHORTCUT_INSTALL_URL,
  CAPTURE_SHORTCUT_VERSION,
  customCaptureShortcutUrl,
  isAllowedCaptureShortcutUrl,
  labelCaptureShortcutCta,
  needsShortcutCta,
  readShortcutAck,
  resolveCaptureShortcutInstallUrl,
  writeShortcutAck,
} from "../src/settings/captureShortcut";

describe("needsShortcutCta / labels", () => {
  it("needs install when never acked", () => {
    expect(needsShortcutCta(null)).toBe(true);
    expect(needsShortcutCta("")).toBe(true);
    expect(labelCaptureShortcutCta(null)).toBe("Install Capture Atom");
  });

  it("no CTA when acked matches shipped", () => {
    expect(needsShortcutCta(CAPTURE_SHORTCUT_VERSION)).toBe(false);
  });

  it("needs update when acked differs from shipped", () => {
    expect(needsShortcutCta("0.9.0", "1.0.0")).toBe(true);
    expect(labelCaptureShortcutCta("0.9.0")).toBe("Update Capture Atom");
  });
});

describe("ack storage helpers", () => {
  it("round-trips ack version", () => {
    const store: Record<string, unknown> = {};
    const load = (k: string) => store[k];
    const save = (k: string, v: unknown) => {
      store[k] = v;
    };
    expect(readShortcutAck(load)).toBeNull();
    writeShortcutAck(save, "1.0.0");
    expect(readShortcutAck(load)).toBe("1.0.0");
  });
});

describe("resolveCaptureShortcutInstallUrl", () => {
  it("prefers settings URL; falls back to built-in default", () => {
    expect(
      resolveCaptureShortcutInstallUrl(
        "https://www.icloud.com/shortcuts/abc",
      ),
    ).toBe("https://www.icloud.com/shortcuts/abc");
    // Empty settings → built-in CAPTURE_SHORTCUT_INSTALL_URL
    expect(resolveCaptureShortcutInstallUrl("")).toContain(
      "icloud.com/shortcuts/",
    );
    expect(resolveCaptureShortcutInstallUrl(null)).toContain(
      "icloud.com/shortcuts/",
    );
  });

  it("treats whitespace-only settings as unset", () => {
    expect(resolveCaptureShortcutInstallUrl("   ")).toBe(
      CAPTURE_SHORTCUT_INSTALL_URL,
    );
  });

  it("ignores a pasted copy of a link we ship, so the default keeps updating", () => {
    // The trap this exists for: a user pastes our own default in, thinking the
    // field is a required step. A settings value outranks the constant, so they
    // would sit on that exact link forever while everyone else moves on.
    for (const shipped of SHIPPED_INSTALL_URLS) {
      expect(resolveCaptureShortcutInstallUrl(shipped)).toBe(
        CAPTURE_SHORTCUT_INSTALL_URL,
      );
    }
  });
});

// Frozen on purpose. Every id here was CAPTURE_SHORTCUT_INSTALL_URL at some
// point (git log -S <id> --follow src/settings/captureShortcut.ts), so someone
// still stores each one. Dropping an entry re-pins those users silently — the
// exact bug this module exists to fix — so removing one must fail here first.
const SHIPPED_INSTALL_URLS = [
  "https://www.icloud.com/shortcuts/d6ee1009562c4a9a9694f36a5f0c0187",
  "https://www.icloud.com/shortcuts/bbd26339dc874a13b36b31620cf3c457",
  "https://www.icloud.com/shortcuts/e8bfe486b2bc458cb37af87c107771a2",
  "https://www.icloud.com/shortcuts/b1a910ea39094d7b857a983529e3bf8b",
  "https://www.icloud.com/shortcuts/28a87317da06494896ef183ec846606f",
  "https://www.icloud.com/shortcuts/e885d7c0d8f04a17803a2cc201f24409",
];

describe("shipped built-in history", () => {
  it("still rescues every link we have ever shipped", () => {
    for (const shipped of SHIPPED_INSTALL_URLS) {
      expect(customCaptureShortcutUrl(shipped)).toBe("");
    }
  });

  it("ships the newest link as the exported constant", () => {
    expect(CAPTURE_SHORTCUT_INSTALL_URL).toBe(SHIPPED_INSTALL_URLS[0]);
  });
});

describe("customCaptureShortcutUrl", () => {
  it("reports a genuine custom link", () => {
    const mine = "https://www.icloud.com/shortcuts/mineownshortcutid";
    expect(customCaptureShortcutUrl(mine)).toBe(mine);
  });

  it("reports no custom link for empty, whitespace, and links we ship", () => {
    for (const v of [
      "",
      "   ",
      null,
      undefined,
      CAPTURE_SHORTCUT_INSTALL_URL,
      "https://www.icloud.com/shortcuts/e8bfe486b2bc458cb37af87c107771a2",
    ]) {
      expect(customCaptureShortcutUrl(v)).toBe("");
    }
  });

  it("trims, so a padded custom link is still the custom link", () => {
    expect(
      customCaptureShortcutUrl("  https://www.icloud.com/shortcuts/pad  "),
    ).toBe("https://www.icloud.com/shortcuts/pad");
  });

  it("sees through cosmetic variants of a link we ship", () => {
    // isAllowedCaptureShortcutUrl accepts a trailing slash, so these reach the
    // field as-is. Matched exactly, each would pin the user permanently.
    const id = "bbd26339dc874a13b36b31620cf3c457";
    for (const variant of [
      `https://www.icloud.com/shortcuts/${id}/`,
      `https://WWW.iCloud.com/shortcuts/${id}`,
      `https://www.icloud.com/shortcuts/${id}?`,
      `https://www.icloud.com/shortcuts/${id}#`,
    ]) {
      expect(customCaptureShortcutUrl(variant)).toBe("");
    }
  });

  it("keeps a genuine custom link verbatim, never canonicalised", () => {
    // Canonicalisation decides only whether a value counts as custom. The link
    // actually opened must stay byte-identical to what the user pasted.
    const mine = "https://www.icloud.com/shortcuts/MyOwnShortcut/";
    expect(customCaptureShortcutUrl(mine)).toBe(mine);
    expect(resolveCaptureShortcutInstallUrl(mine)).toBe(mine);
  });
});

describe("isAllowedCaptureShortcutUrl (AE4)", () => {
  it("allows iCloud shortcuts HTTPS links", () => {
    expect(
      isAllowedCaptureShortcutUrl(
        "https://www.icloud.com/shortcuts/28a87317da06494896ef183ec846606f",
      ),
    ).toBe(true);
  });

  it("rejects javascript, http, wrong host, empty", () => {
    expect(isAllowedCaptureShortcutUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedCaptureShortcutUrl("http://www.icloud.com/shortcuts/x")).toBe(
      false,
    );
    expect(isAllowedCaptureShortcutUrl("https://evil.example/shortcuts/x")).toBe(
      false,
    );
    expect(isAllowedCaptureShortcutUrl("")).toBe(false);
    expect(isAllowedCaptureShortcutUrl("https://www.icloud.com/other")).toBe(
      false,
    );
  });
});
