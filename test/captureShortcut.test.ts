import { describe, expect, it } from "vitest";
import {
  CAPTURE_SHORTCUT_VERSION,
  labelInstallOrUpdate,
  needsShortcutCta,
  readShortcutAck,
  resolveCaptureShortcutInstallUrl,
  writeShortcutAck,
} from "../src/captureShortcut";

describe("needsShortcutCta / labels", () => {
  it("needs install when never acked", () => {
    expect(needsShortcutCta(null)).toBe(true);
    expect(needsShortcutCta("")).toBe(true);
    expect(labelInstallOrUpdate(null)).toBe("Install capture shortcut");
  });

  it("no CTA when acked matches shipped", () => {
    expect(needsShortcutCta(CAPTURE_SHORTCUT_VERSION)).toBe(false);
  });

  it("needs update when acked differs from shipped", () => {
    expect(needsShortcutCta("0.9.0", "1.0.0")).toBe(true);
    expect(labelInstallOrUpdate("0.9.0")).toBe("Update capture shortcut");
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
});
