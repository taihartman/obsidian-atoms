import { describe, expect, it } from "vitest";
import {
  CAPTURE_SHORTCUT_INSTALL_URL,
  CAPTURE_SHORTCUT_VERSION,
  customCaptureShortcutUrl,
  isAllowedCaptureShortcutUrl,
  labelInstallOrUpdate,
  needsInferredDateSignal,
  needsShortcutCta,
  readInferredDateAck,
  readShortcutAck,
  resolveCaptureShortcutInstallUrl,
  writeInferredDateAck,
  writeShortcutAck,
} from "../src/settings/captureShortcut";

describe("needsShortcutCta / labels", () => {
  it("needs install when never acked", () => {
    expect(needsShortcutCta(null)).toBe(true);
    expect(needsShortcutCta("")).toBe(true);
    expect(labelInstallOrUpdate(null)).toBe("Install Capture Atom");
  });

  it("no CTA when acked matches shipped", () => {
    expect(needsShortcutCta(CAPTURE_SHORTCUT_VERSION)).toBe(false);
  });

  it("needs update when acked differs from shipped", () => {
    expect(needsShortcutCta("0.9.0", "1.0.0")).toBe(true);
    expect(labelInstallOrUpdate("0.9.0")).toBe("Update Capture Atom");
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

describe("inferred-date signal ack", () => {
  const store = () => {
    const s: Record<string, unknown> = {};
    return {
      load: (k: string) => s[k],
      save: (k: string, v: unknown) => {
        s[k] = v;
      },
    };
  };

  it("round-trips its own ack version, separate from the shortcut ack", () => {
    const { load, save } = store();
    expect(readInferredDateAck(load)).toBeNull();
    writeInferredDateAck(save, "1.0.0");
    expect(readInferredDateAck(load)).toBe("1.0.0");
    // Dismissing the signal must not silence the install/update CTA.
    expect(readShortcutAck(load)).toBeNull();
  });

  it("defaults to the shipped shortcut version", () => {
    const { load, save } = store();
    writeInferredDateAck(save);
    expect(readInferredDateAck(load)).toBe(CAPTURE_SHORTCUT_VERSION);
  });

  it("stays silent when nothing was inferred, acked or not", () => {
    expect(needsInferredDateSignal(0, null)).toBe(false);
    expect(needsInferredDateSignal(-1, null)).toBe(false);
    expect(needsInferredDateSignal(0, "0.9.0", "1.0.0")).toBe(false);
  });

  it("fires when captures were inferred and nothing is acked", () => {
    expect(needsInferredDateSignal(1, null)).toBe(true);
    expect(needsInferredDateSignal(3, "")).toBe(true);
  });

  it("stays quiet once acked against the shipped version", () => {
    expect(needsInferredDateSignal(2, CAPTURE_SHORTCUT_VERSION)).toBe(false);
  });

  it("re-arms after the shipped shortcut version moves on", () => {
    // The inbox is append-only, so a read-time count stays true forever. A
    // permanent dismiss would silently re-create the dead end; version-keying
    // brings the signal back once the user's shortcut is updated.
    expect(needsInferredDateSignal(2, "0.9.0", "1.0.0")).toBe(true);
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
    const supersededBuiltin =
      "https://www.icloud.com/shortcuts/e8bfe486b2bc458cb37af87c107771a2";
    expect(resolveCaptureShortcutInstallUrl(supersededBuiltin)).toBe(
      CAPTURE_SHORTCUT_INSTALL_URL,
    );
    expect(resolveCaptureShortcutInstallUrl(CAPTURE_SHORTCUT_INSTALL_URL)).toBe(
      CAPTURE_SHORTCUT_INSTALL_URL,
    );
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
