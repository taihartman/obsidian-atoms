import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlusSession } from "../src/platform/filingAuth";
import {
  LS_ASK_MIRROR_EMAIL,
  LS_ASK_MIRROR_HASHES,
  LS_ASK_MIRROR_LAST_ERROR,
  LS_ASK_MIRROR_LAST_SUCCESS,
  LS_ASK_MIRROR_SERVER_COUNT,
} from "../src/platform/askMirror";
import { ASK_PRIVACY_ACK_VERSION } from "../src/shared/askAck";
import {
  open,
  press,
  pressSheet,
  prose,
  settingTab,
  sheetText,
  type SettingTabOptions,
} from "./helpers/settingsTab";

/**
 * The two consent-surface holes the adversarial half of #340's QA found (#371, #374).
 *
 * Both are about the same failure: the mirror and the sentence describing it were allowed to
 * disagree with the consent gate. They are tested through the rendered rows rather than against
 * the helpers they call, because in both cases the helper was already correct and the *screen*
 * was the thing that lied.
 */

/** The wipe is the only network call faked here; the reset it triggers is the real one. */
const wipe = vi.fn(async () => ({ ok: true as const }));
vi.mock("../src/platform/plusClient", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/platform/plusClient")>();
  return { ...actual, askMirrorWipe: (...args: unknown[]) => wipe(...(args as [])) };
});

const PLUS_SESSION: PlusSession = {
  sessionToken: "sess_live",
  email: "user@example.com",
  status: "active",
  remaining: 12,
  periodEnd: "2026-09-01T00:00:00.000Z",
};

const ACKED = "2026-08-07T10:00:00.000Z";
const PRIVACY_GRANTED = {
  askPrivacyAckAt: ACKED,
  askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
} as const;

/** A device that has pushed a full vault and knows it. */
const MIRRORED = {
  [LS_ASK_MIRROR_SERVER_COUNT]: "407",
  [LS_ASK_MIRROR_EMAIL]: "user@example.com",
  [LS_ASK_MIRROR_LAST_SUCCESS]: ACKED,
  [LS_ASK_MIRROR_HASHES]: JSON.stringify({ "Atoms/a.md": "h1" }),
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function connect(opts: SettingTabOptions = {}) {
  const made = settingTab({ session: PLUS_SESSION, ...opts });
  made.tab.display();
  open(made.tab, "Connect Claude or ChatGPT");
  return made;
}

/** The status paragraph the destination prints above the rows that change it. */
function statusLine(made: ReturnType<typeof connect>): string {
  const line = prose(made.tab).find((p) => p.startsWith("Ask mirror:"));
  if (!line) throw new Error("no mirror status line on the screen");
  return line;
}

describe("#371 — Wipe cloud copy disarms the mirror", () => {
  beforeEach(() => wipe.mockClear());

  it("turns the mirror off, so the cleared baseline cannot become a re-upload", async () => {
    const made = connect({
      settings: { askEnabled: true, ...PRIVACY_GRANTED },
      local: { ...MIRRORED },
    });

    press(made.tab, "Wipe cloud copy", "Wipe");
    pressSheet("Wipe");
    await flush();

    expect(wipe).toHaveBeenCalledTimes(1);
    // The bug: the baseline was cleared while the gate stayed open, which is an armed mirror
    // that believes it has uploaded nothing.
    expect(made.local.get(LS_ASK_MIRROR_HASHES)).toBe("{}");
    expect(made.plugin.settings.askEnabled).toBe(false);
    expect(made.calls).toContain("saveSettings");
  });

  it("leaves the consent record alone, because the withdrawal row keys off it", async () => {
    const made = connect({
      settings: { askEnabled: true, ...PRIVACY_GRANTED },
      local: { ...MIRRORED },
    });

    press(made.tab, "Wipe cloud copy", "Wipe");
    pressSheet("Wipe");
    await flush();

    expect(made.plugin.settings.askPrivacyAckAt).toBe(ACKED);
    expect(made.plugin.settings.askPrivacyAckVersion).toBe(
      ASK_PRIVACY_ACK_VERSION,
    );
  });

  it("says so before it does it", () => {
    const made = connect({
      settings: { askEnabled: true, ...PRIVACY_GRANTED },
      local: { ...MIRRORED },
    });

    press(made.tab, "Wipe cloud copy", "Wipe");

    expect(sheetText()).toContain("Ask mirror turns off");
  });

  it("a wipe that the server refuses changes nothing on the device", async () => {
    wipe.mockResolvedValueOnce({
      ok: false,
      message: "Plus network error",
    } as never);
    const made = connect({
      settings: { askEnabled: true, ...PRIVACY_GRANTED },
      local: { ...MIRRORED },
    });

    press(made.tab, "Wipe cloud copy", "Wipe");
    pressSheet("Wipe");
    await flush();

    expect(made.plugin.settings.askEnabled).toBe(true);
    expect(made.local.get(LS_ASK_MIRROR_HASHES)).toBe(
      MIRRORED[LS_ASK_MIRROR_HASHES],
    );
  });
});

describe("#374 — the status line consults the consent gate", () => {
  it("reports push state while the gate is open", () => {
    const made = connect({
      settings: { askEnabled: true, ...PRIVACY_GRANTED },
      local: { ...MIRRORED, [LS_ASK_MIRROR_LAST_ERROR]: "Plus network error" },
    });

    // The positive control. Without it, every assertion below passes on a screen that renders
    // no status line at all.
    expect(statusLine(made)).toBe(
      "Ask mirror: 407 · as user@example.com · push failed — Plus network error · Sync now to retry",
    );
  });

  it("stops advertising an active mirror once consent is withdrawn", () => {
    const made = connect({
      // Withdrawal clears both halves of the record and turns the toggle off (#360).
      settings: { askEnabled: false, askPrivacyAckAt: "", askPrivacyAckVersion: "" },
      local: { ...MIRRORED, [LS_ASK_MIRROR_LAST_ERROR]: "Plus network error" },
    });

    expect(statusLine(made)).toBe(
      "Ask mirror: off · no current privacy acknowledgment · 407 in the cloud at last check, Wipe cloud copy to delete",
    );
  });

  /**
   * The state every device lands in the next time `ASK_PRIVACY_ACK_VERSION` moves, which is why
   * this one is worth a case of its own: it is reached by upgrading, not by choosing.
   */
  it("names a stale acknowledgment as stale, and points at Review", () => {
    const made = connect({
      settings: {
        askEnabled: true,
        askPrivacyAckAt: ACKED,
        askPrivacyAckVersion: "2026-01-01",
      },
      local: { ...MIRRORED },
    });

    expect(statusLine(made)).toBe(
      "Ask mirror: off · privacy acknowledgment out of date, Review to resume · 407 in the cloud at last check, Wipe cloud copy to delete",
    );
  });

  it("says only that the mirror is off when the toggle is the reason", () => {
    const made = connect({
      settings: { askEnabled: false, ...PRIVACY_GRANTED },
      local: { ...MIRRORED },
    });

    expect(statusLine(made)).toBe(
      "Ask mirror: off · 407 in the cloud at last check, Wipe cloud copy to delete",
    );
  });

  it("claims no cloud copy on a device whose count a wipe already cleared", async () => {
    const made = connect({
      settings: { askEnabled: true, ...PRIVACY_GRANTED },
      local: { ...MIRRORED },
    });

    press(made.tab, "Wipe cloud copy", "Wipe");
    pressSheet("Wipe");
    await flush();

    // The wipe redisplays this screen itself, so this reads what the user is left looking at.
    expect(statusLine(made)).toBe("Ask mirror: off");
  });
});
