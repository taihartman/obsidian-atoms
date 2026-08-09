import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LS_PLUS_SESSION,
  serializePlusSession,
  type PlusSession,
} from "../src/platform/filingAuth";
import {
  LS_ASK_MIRROR_EMAIL,
  LS_ASK_MIRROR_HASHES,
  LS_ASK_MIRROR_LAST_ERROR,
  LS_ASK_MIRROR_LAST_SUCCESS,
  LS_ASK_MIRROR_SERVER_COUNT,
} from "../src/platform/askMirror";
import {
  ASK_PRIVACY_ACK_VERSION,
  ASK_WRITE_ACK_VERSION,
  askMirrorPermitted,
} from "../src/shared/askAck";
import { readAskMirrorEmail, runAskMirrorSync } from "../src/platform/askMirror";
import { AskCoordinator } from "../src/plugin/askCoordinator";
import {
  open,
  press,
  pressSheet,
  prose,
  row,
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

/** The wipe and the sign-out are the only network calls faked here; the resets they trigger are real. */
const wipe = vi.fn(async () => ({ ok: true as const }));
const signOut = vi.fn(async () => ({ ok: true as const }));
vi.mock("../src/platform/plusClient", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/platform/plusClient")>();
  return {
    ...actual,
    askMirrorWipe: (...args: unknown[]) => wipe(...(args as [])),
    signOutPlus: (...args: unknown[]) => signOut(...(args as [])),
  };
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

// Above both blocks, not inside one: the mock is module-level, so a per-describe reset leaves
// the other block reading call counts the first one left behind.
beforeEach(() => {
  wipe.mockClear();
  signOut.mockClear();
});

function connect(opts: SettingTabOptions = {}) {
  const made = settingTab({ session: PLUS_SESSION, ...opts });
  made.tab.display();
  open(made.tab, "Connect Claude or ChatGPT");
  return made;
}

/** The status paragraph the destination prints above the rows that change it. */
function statusParagraph(made: ReturnType<typeof connect>): HTMLElement {
  const found = Array.from(
    made.tab.containerEl.querySelectorAll("p.setting-item-description"),
  ).find((el) => (el.textContent ?? "").startsWith("Ask mirror:"));
  if (!(found instanceof HTMLElement)) {
    throw new Error("no mirror status line on the screen");
  }
  return found;
}

function statusLine(made: ReturnType<typeof connect>): string {
  return statusParagraph(made).textContent ?? "";
}

/** Whether the line is dressed as a failure, which a gated-off mirror is not. */
function statusIsError(made: ReturnType<typeof connect>): boolean {
  return statusParagraph(made).classList.contains("atoms-ask-mirror-error");
}

describe("#371 — Wipe cloud copy disarms the mirror", () => {
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
    expect(statusIsError(made)).toBe(true);
  });

  /**
   * The other half of the same sentence. A mirror the gate closed did not fail, and dressing it
   * in the error style tells someone who just withdrew consent that something went wrong when
   * it went right.
   */
  it("drops the error styling with the error text", () => {
    const made = connect({
      settings: { askEnabled: false, askPrivacyAckAt: "", askPrivacyAckVersion: "" },
      local: { ...MIRRORED, [LS_ASK_MIRROR_LAST_ERROR]: "Plus network error" },
    });

    expect(statusIsError(made)).toBe(false);
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

/**
 * #372 — the third instance of the same failure, reached by a gesture nobody reads as a consent
 * change. Signing out left `askEnabled` armed and the hash baseline intact, so the *next* account
 * signed in on this device inherited both: egress to a cloud its owner never authorised here, over
 * a baseline that said the vault was already uploaded.
 *
 * Driven through the rendered Sign out row rather than against `signOutOfPlus`, because the row is
 * the only way a user reaches it and the row is what the description promises about.
 */
describe("#372 — signing out tears the mirror down", () => {
  const WRITE_GRANTED = {
    askWriteAckAt: ACKED,
    askWriteAckVersion: ASK_WRITE_ACK_VERSION,
  } as const;

  /**
   * The Sign out row does not render from a seeded session alone: `deriveAccountState` reports
   * `active` only when `resolveFilingAuth()` says `plus`, and the suite's `connect()` seeds the
   * session only. This is `activeTab()` from test/settings.test.ts with the consent state the
   * teardown is about.
   */
  function signedIn(opts: SettingTabOptions = {}) {
    const made = settingTab({
      session: PLUS_SESSION,
      auth: {
        mode: "plus",
        sessionToken: PLUS_SESSION.sessionToken,
        email: PLUS_SESSION.email,
        status: "active",
        remaining: 12,
        periodEnd: PLUS_SESSION.periodEnd,
      },
      settings: { askEnabled: true, ...PRIVACY_GRANTED, ...WRITE_GRANTED },
      local: { ...MIRRORED },
      ...opts,
    });
    made.tab.display();
    open(made.tab, "Plus · 12 filings left");
    return made;
  }

  async function signOutOf(made: ReturnType<typeof signedIn>) {
    press(made.tab, "Sign out", "Sign out");
    await flush();
  }

  it("disarms the mirror and gets the disarm to disk", async () => {
    const made = signedIn();

    await signOutOf(made);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(made.plugin.settings.askEnabled).toBe(false);
    expect(made.calls).toContain("saveSettings");
    // Closing the gate leaves a debounced or owed push still queued against the state being torn
    // down, so the teardown drops it the same way the external-settings paths do.
    expect(made.calls).toContain("ask.cancelPendingSync");
  });

  it("says so before it does it", () => {
    const made = signedIn();

    const desc =
      row(made.tab, "Sign out").querySelector(".setting-item-description")
        ?.textContent ?? "";

    // Both halves of what the button does: the local one, and the one that reaches the user's
    // other devices — the second is the surprising half, so the row must not leave it unsaid.
    expect(desc).toContain("Remove the Plus session from this device");
    expect(desc).toContain(
      "turn the Ask mirror off on every device this vault syncs to",
    );
  });

  it("clears the device state the next account would otherwise inherit", async () => {
    const made = signedIn();

    await signOutOf(made);

    // The 1-of-407 half of the bug: A's baseline survived, so B's first sync uploaded nothing.
    expect(made.local.get(LS_ASK_MIRROR_HASHES)).toBe("{}");
    expect(made.local.get(LS_ASK_MIRROR_EMAIL)).toBe("");
  });

  it("leaves the consent record alone, because the withdrawal row keys off it", async () => {
    const made = signedIn();

    await signOutOf(made);

    expect(made.plugin.settings.askPrivacyAckAt).toBe(ACKED);
    expect(made.plugin.settings.askPrivacyAckVersion).toBe(
      ASK_PRIVACY_ACK_VERSION,
    );
    expect(made.plugin.settings.askWriteAckAt).toBe(ACKED);
    expect(made.plugin.settings.askWriteAckVersion).toBe(ASK_WRITE_ACK_VERSION);
  });

  /**
   * KTD2 — the order is the invariant, not the end state, which is identical either way. The
   * `calls` list cannot see it: `clearAskMirrorDeviceState` writes through `app.saveLocalStorage`,
   * which the harness does not record. So the save itself reads the baseline as it goes past.
   */
  it("persists the disarm while the baseline is still intact", async () => {
    let snapshot: unknown = "never saved";
    // Declared before the seed because the `saveSettings` closure below reads `made.local`, which
    // only exists once `settingTab()` has returned.
    let made!: ReturnType<typeof signedIn>;
    made = signedIn({
      plugin: {
        saveSettings: async () => {
          snapshot = made.local.get(LS_ASK_MIRROR_HASHES);
        },
      },
    });

    await signOutOf(made);

    // Reversed (clear, then persist) this is "{}" — an armed mirror over an empty baseline, #371.
    expect(snapshot).toBe(MIRRORED[LS_ASK_MIRROR_HASHES]);
  });

  it("tears down anyway when the sign-out call fails on the network", async () => {
    signOut.mockResolvedValueOnce({
      ok: false,
      status: 0,
      code: "network",
      message: "Plus network error",
    } as never);
    const made = signedIn();

    await signOutOf(made);

    expect(made.plugin.settings.askEnabled).toBe(false);
    expect(made.local.get(LS_ASK_MIRROR_HASHES)).toBe("{}");
  });

  /**
   * R4, as a **contract test** — deliberately not dead code, do not delete it as unreachable.
   *
   * The teardown above runs after `await signOutPlus(...)` with no try/catch, which is safe only
   * because `signOutPlus` reports failure as a *value*: `plusRequest` catches everything its
   * `request` throws. Nothing else asserts that, so a future `request` implementation whose throw
   * escaped would silently put the sign-out teardown back behind a network failure — #372 again,
   * reached from the other side. This pins the property at its source, on the real client.
   */
  it("contract: signOutPlus reports a throwing transport as a value, never a rejection", async () => {
    const actual = await vi.importActual<
      typeof import("../src/platform/plusClient")
    >("../src/platform/plusClient");

    const r = await actual.signOutPlus(
      {
        baseUrl: "https://plus.example",
        request: () => {
          throw new Error("transport exploded");
        },
      } as never,
      "sess_live",
    );

    expect(r.ok).toBe(false);
  });

  /**
   * R5 — the whole bug in one pass: account A signs out, account B signs in, and B's device may
   * neither push nor believe A's baseline.
   */
  it("leaves no arming and no baseline behind for whoever signs in next", async () => {
    const made = signedIn();

    await signOutOf(made);

    // Scene-setting only: account B on the same device. Nothing below reads this key — the gate
    // is identity-blind by design (`mirrorPermitted()` consults the toggle and the privacy ack,
    // never who is signed in), so the property under test is absence of residue, not a check
    // against an identity. The seed just names the situation the residue would have leaked into.
    const second: PlusSession = { ...PLUS_SESSION, email: "second@example.com" };
    made.local.set(LS_PLUS_SESSION, serializePlusSession(second));

    const coordinator = new AskCoordinator({
      settings: made.plugin.settings,
    } as never);
    expect(coordinator.mirrorPermitted()).toBe(false);
    // The device-local half: A's identity and A's baseline are both gone.
    expect(readAskMirrorEmail((k) => made.local.get(k) ?? null)).toBe("");
    expect(made.local.get(LS_ASK_MIRROR_HASHES)).toBe("{}");
  });

  /**
   * The device that never mirrored: armed and acknowledged, but with no baseline and no stored
   * identity to clear. Every value below is one the teardown had to produce or preserve — seeded
   * defaults would pass this test with the teardown deleted.
   */
  it("tears down safely on a device with no baseline to clear", async () => {
    const made = signedIn({ local: {} });

    await signOutOf(made);

    expect(made.plugin.settings.askEnabled).toBe(false);
    // Writing an empty baseline where there was none is the point, not a no-op: the gate must not
    // be handed an unparseable count on a device that is no longer mirroring.
    expect(made.local.get(LS_ASK_MIRROR_HASHES)).toBe("{}");
    // The consent record outlives the teardown — clearing it would delete the way back out.
    expect(made.plugin.settings.askPrivacyAckAt).toBe(ACKED);
  });

  /**
   * The window the teardown itself opened. A sync pass reads the hash baseline once at its start
   * and persists a copy of it after every upsert chunk, so on a vault big enough to still be
   * pushing when the user presses Sign out, the chunk that lands *after* the teardown puts the
   * whole baseline back — and the account signing in next is skipped past 406 of 407 atoms while
   * Settings reports "last pushed just now". That is #372 reconstituted after the fix for #372.
   *
   * Driven, not simulated: the real `runAskMirrorSync` is parked inside `upsert` — the same place
   * a slow network parks it — and the real Sign out row is pressed while it hangs there. The two
   * share one device-local map, which is the whole reason they can collide.
   */
  it("cannot be un-torn-down by a sync pass that was already in flight", async () => {
    const made = signedIn();

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reachedUpsert!: () => void;
    const inUpsert = new Promise<void>((resolve) => {
      reachedUpsert = resolve;
    });

    const pass = runAskMirrorSync(
      {
        atomFolder: "Atoms",
        scanAtoms: async () => [
          { path: "Atoms/a.md", basename: "a", content: "# A\n\nbody\n" },
        ],
        resolveHubs: async () => [],
        load: (k) => made.local.get(k) ?? null,
        save: (k, v) => made.local.set(k, v),
        // Exactly what `askCoordinator` hands the real host: the live consent predicate over the
        // very settings object the teardown is about to mutate.
        stillPermitted: () => askMirrorPermitted(made.plugin.settings),
        upsert: async (atoms) => {
          reachedUpsert();
          await held;
          return { ok: true, upserted: atoms.length };
        },
        deletePaths: async () => ({ ok: true }),
        reconcile: async () => ({ ok: true }),
        status: async () => ({ ok: true, count: 407, email: PLUS_SESSION.email }),
        confirm: async () => "dismissed",
        notice: () => {},
      },
      { force: false },
    );

    // Parked mid-chunk: the baseline snapshot is already in hand, the upload is in the air.
    await inUpsert;
    await signOutOf(made);
    expect(made.local.get(LS_ASK_MIRROR_HASHES)).toBe("{}");

    release();
    await pass;

    // Both halves of the residue the next account would inherit. The hash map is the one that
    // silently skips their atoms; the email is what makes the lie legible in Settings.
    expect(made.local.get(LS_ASK_MIRROR_HASHES)).toBe("{}");
    expect(made.local.get(LS_ASK_MIRROR_EMAIL)).toBe("");
  });
});
