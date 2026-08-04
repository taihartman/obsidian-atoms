import { describe, expect, it } from "vitest";
import { fireAndForgetAsk } from "../src/plugin/askCoordinator";
import { DEFAULT_SETTINGS } from "../src/shared/types";
import { stripLegacyAskMirrorHashes } from "../src/platform/askMirror";

describe("askCoordinator glue (post-#226 residual peel)", () => {
  it("fireAndForgetAsk never rejects to Process caller", async () => {
    let callerFailed = false;
    try {
      fireAndForgetAsk(Promise.reject(new Error("mirror down")));
      await new Promise((r) => setTimeout(r, 0));
    } catch {
      callerFailed = true;
    }
    expect(callerFailed).toBe(false);
  });

  it("U6 already landed: DEFAULT_SETTINGS has no askMirrorHashes", () => {
    expect(DEFAULT_SETTINGS).not.toHaveProperty("askMirrorHashes");
  });

  it("U6 strip still clears legacy key from raw settings blob", () => {
    const raw: Record<string, unknown> = {
      askEnabled: true,
      askMirrorHashes: { "Atoms/A.md": "h1" },
    };
    expect(stripLegacyAskMirrorHashes(raw)).toBe(true);
    expect(raw).not.toHaveProperty("askMirrorHashes");
  });
});
