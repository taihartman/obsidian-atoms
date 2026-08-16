import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
import AtomsPlugin from "../src/plugin/main";
import { registerAtomsCommands } from "../src/plugin/commands";
import {
  clampShortlistSize,
  logShortlistDiagnostics,
  shortlistDiagnostics,
  shortlistOptionsFromSettings,
  DEFAULT_GRAPH_EXPANSION,
  DEFAULT_SHORTLIST_K,
  MetadataContextProvider,
  MIN_SHORTLIST_K,
  type ShortlistContext,
  type ShortlistRunOptions,
} from "../src/pipeline/context";
import { runWritePath } from "../src/pipeline/write";
import {
  accountRowDescriptor,
  type AccountState,
  AtomsSettingTab,
  type ConnectivityRequest,
  deriveAccountState,
} from "../src/settings/settings";
import {
  readPendingSignIns,
  readPlusSession,
  type FilingAuth,
  type IssuedBase,
  type PlusSession,
} from "../src/platform/filingAuth";
import { ASK_PRIVACY_ACK_TITLE, EGRESS_DISCLOSURE } from "../src/settings/consent";
import { PLUS_BASE_REFUSED_MESSAGE } from "../src/platform/plusClient";
import { PLUS_BASE_NEEDS_ADDRESS_MESSAGE } from "../src/platform/plusBaseVerify";
import {
  LS_ASK_MIRROR_LAST_ERROR,
  LS_ASK_MIRROR_SERVER_COUNT,
} from "../src/platform/askMirror";
import { formatUsd, PLUS_PRICING } from "../src/shared/plusPricing";
import { s256Challenge } from "../src/platform/pkce";
import {
  DEFAULT_PLUS_BASE_URL,
  PLUS_BASE_URL_INVALID_MESSAGE,
  requestMagicLink,
} from "../src/platform/plusClient";
import * as dni from "obsidian-daily-notes-interface";
import { firstDaySetupCopy } from "../src/home/atomsHomeData";
import {
  destinationNames,
  dismissSheet,
  flip,
  groupHeaders,
  open,
  openAdvanced,
  openPrivacy,
  press,
  pressSheet,
  prose,
  row,
  rowNames,
  settingTab,
  sheet,
  sheetButtons,
  sheetOpen,
  sheetText,
  fill,
  blurRow,
  pressKey,
  type SettingTabOptions,
} from "./helpers/settingsTab";
import {
  LS_CAPTURE_SHORTCUT_ACK,
  resolveCaptureShortcutInstallUrl,
} from "../src/settings/captureShortcut";
import { CAPTURE_ATOM_VERSION } from "../src/shared/mobileInstall";
import {
  EGRESS_ACK_VERSION,
  LS_AUTO_RUN_EGRESS_ACK,
  LS_AUTO_RUN_ENABLED,
  LS_AUTO_RUN_START_DAY,
  LS_LAST_RUN_DAY,
  localDateString,
  readEgressPermitted,
} from "../src/platform/autorun";
import { LS_EGRESS_NOTICE } from "../src/platform/resume";
import {
  ASK_PRIVACY_ACK_VERSION,
  ASK_WRITE_ACK_VERSION,
} from "../src/shared/askAck";
// `../mocks/obsidian` rather than `"obsidian"`: vitest aliases the module, `tsc` does not.
import {
  captureObsidianUi,
  Modal,
  Notice,
  stopCapturingObsidianUi,
  type UiCapture,
} from "./mocks/obsidian";
import {
  API_KEY_SECRET_ID_DEFAULT,
  DEFAULT_SETTINGS,
  LOCAL_STORAGE_API_KEY,
  type LinkerSettings,
} from "../src/shared/types";
import {
  atomResult,
  fakeClassify,
  fakeVault,
  stubDailyNotes,
  type VaultDouble,
} from "./helpers/pipelineVault";

afterEach(() => vi.restoreAllMocks());

const ACKED = "2026-08-01T10:00:00.000Z";

/**
 * An ack as a *live* grant: the timestamp and the version this build ships (#360).
 *
 * Spread rather than written out at each fixture, because "granted" is one concept and a
 * fixture that sets only the timestamp is now a legacy grant — a different state, and one the
 * stale-version tests below assert on purpose. Splitting them here would have quietly turned
 * two dozen "the mirror pushes" fixtures into "the mirror is gated off".
 */
const PRIVACY_GRANTED = {
  askPrivacyAckAt: ACKED,
  askPrivacyAckVersion: ASK_PRIVACY_ACK_VERSION,
} as const;
const WRITE_GRANTED = {
  askWriteAckAt: ACKED,
  askWriteAckVersion: ASK_WRITE_ACK_VERSION,
} as const;

/** Every button label on the named row — how a form row's one button is asserted. */
function buttonLabels(tab: AtomsSettingTab, name: string): string[] {
  return Array.from(row(tab, name).querySelectorAll("button")).map(
    (el) => el.textContent ?? "",
  );
}

/** Only the network call is faked — the verifier, its hash and the record are real. */
vi.mock("../src/platform/plusClient", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/platform/plusClient")>();
  return {
    ...actual,
    requestMagicLink: vi.fn(async () => ({ ok: true as const })),
  };
});

/**
 * The real command table, registered against a real plugin instance. A capability a settings row
 * used to offer only survives its deletion if the palette actually registers it, so R10 is
 * checked against `registerAtomsCommands` rather than inferred.
 */
function registeredCommands(): Array<{ id: string; name: string; callback?: () => void }> {
  // Constructed, not stubbed: the command table is registered against the real plugin, so a
  // command that never reaches `registerAtomsCommands` cannot pass by being mocked in.
  const plugin = new AtomsPlugin({} as App, {} as PluginManifest);
  plugin.settings = { ...DEFAULT_SETTINGS };
  const commands: Array<{ id: string; name: string; callback?: () => void }> = [];
  Object.assign(plugin, {
    app: { workspace: { getActiveViewOfType: () => null } },
    addCommand: (cmd: { id: string; name: string; callback?: () => void }) =>
      commands.push(cmd),
  });
  registerAtomsCommands(plugin);
  return commands;
}

/**
 * A provider that keeps every `ShortlistContext` the run handed out, so a test can assert what
 * classify actually saw rather than that a setting merely persisted.
 */
function recordingProvider(app: App, vocabulary: string[] = ["idea"]) {
  const seen: ShortlistContext[] = [];
  const beginOpts: unknown[] = [];
  const real = new MetadataContextProvider(app, () => vocabulary);
  const provider = {
    async beginRun(opts?: Record<string, unknown>) {
      beginOpts.push(opts);
      const run = await real.beginRun(opts);
      const getCandidates = run.getCandidates.bind(run);
      return Object.assign(run, {
        getCandidates: async (capture: unknown) => {
          const ctx = await getCandidates(capture as never);
          seen.push(ctx);
          return ctx;
        },
      });
    },
  };
  return { provider: provider as unknown as MetadataContextProvider, seen, beginOpts };
}

/** A daily whose capture matches one note, which links on to a note sharing none of its words. */
function linkedVault(): VaultDouble {
  const v = fakeVault({
    "Daily/2026-07-04.md": "- ground the espresso finer and pulled a sweeter shot\n",
    "Notes/Espresso grind size.md": "Grinding espresso finer pulls a sweeter shot.\n",
    "Notes/Roasters.md": "Where the beans come from.\n",
  });
  stubDailyNotes([{ path: "Daily/2026-07-04.md", date: "2026-07-04" }]);
  // fakeVault has no link index of its own; expansion needs one to have anything to reach.
  (v.app as { metadataCache: { resolvedLinks?: unknown } }).metadataCache.resolvedLinks = {
    "Notes/Espresso grind size.md": { "Notes/Roasters.md": 1 },
  };
  return v;
}

const settings = (over: Partial<LinkerSettings> = {}): LinkerSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
});

/**
 * `over` stands for the callers that still choose their own retrieval options in code — a catch-up
 * passes `expandGraph: false`. Neither is a setting any more (KTD8), so a test that wants
 * non-default retrieval asks for it the way production does: through the run options.
 */
async function processWith(
  v: VaultDouble,
  s: LinkerSettings,
  over: Partial<ShortlistRunOptions> = {},
) {
  const rec = recordingProvider(v.app);
  const classify = fakeClassify([atomResult("Espresso ground finer pulls sweeter")]);
  await runWritePath({
    app: v.app,
    contextProvider: rec.provider,
    apiKey: "k",
    model: s.model,
    activeVocabulary: s.activeVocabulary,
    atomFolder: s.atomFolder,
    includeToday: true,
    ...shortlistOptionsFromSettings(),
    ...over,
    classifyDeps: { request: classify.request as never },
  });
  return rec;
}

describe("deleted tuning keys (KTD8)", () => {
  // These keys were removed from LinkerSettings; existing data.json files keep them.
  const stale = {
    shortlistSize: 50,
    expandLinkedNotes: false,
    enableReconsiderCapture: false,
  } as Partial<LinkerSettings>;

  it("a data.json still carrying them loads and has no effect on retrieval", async () => {
    const v = linkedVault();
    const rec = await processWith(v, settings(stale));

    expect(rec.seen[0]!.stats.k).toBe(DEFAULT_SHORTLIST_K);
    // expandLinkedNotes: false is equally inert — the walk still runs.
    expect(rec.seen[0]!.stats.expanded).toBe(1);
  });

  it("renders no row for any of them", () => {
    const { tab } = settingTab({ settings: stale });
    tab.display();

    expect(rowNames(tab)).not.toContain("Notes considered per capture");
    expect(rowNames(tab)).not.toContain("Also consider linked notes");
    // Reconsider capture is now unconditional; a toggle would describe a gate that is gone.
    expect(rowNames(tab)).not.toContain("Reconsider capture");
  });
});

describe("shortlist size (R8)", () => {
  it("is the studied k for every caller (KTD6)", () => {
    expect(clampShortlistSize(undefined)).toBe(DEFAULT_SHORTLIST_K);
    expect(shortlistOptionsFromSettings()).toEqual({
      shortlistK: DEFAULT_SHORTLIST_K,
      expandGraph: DEFAULT_GRAPH_EXPANSION,
    });
  });

  it("keeps a value the user could plausibly want", () => {
    expect(clampShortlistSize(40)).toBe(40);
    expect(clampShortlistSize("1200")).toBe(1200);
    expect(clampShortlistSize(" 60 ")).toBe(60);
    expect(clampShortlistSize(MIN_SHORTLIST_K)).toBe(MIN_SHORTLIST_K);
  });

  it("never lets zero, a negative, or a non-number reach the pipeline", () => {
    // Zero would hand classify an empty note list that looks like an empty vault.
    expect(clampShortlistSize(0)).toBe(MIN_SHORTLIST_K);
    expect(clampShortlistSize("0")).toBe(MIN_SHORTLIST_K);
    expect(clampShortlistSize(-400)).toBe(MIN_SHORTLIST_K);
    // Nothing typed at all is a reset, not a floor.
    expect(clampShortlistSize("")).toBe(DEFAULT_SHORTLIST_K);
    expect(clampShortlistSize("   ")).toBe(DEFAULT_SHORTLIST_K);
    expect(clampShortlistSize("four hundred")).toBe(DEFAULT_SHORTLIST_K);
    expect(clampShortlistSize(Number.NaN)).toBe(DEFAULT_SHORTLIST_K);
    expect(clampShortlistSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SHORTLIST_K);
    expect(clampShortlistSize(null)).toBe(DEFAULT_SHORTLIST_K);
    // Fractions round down rather than being rejected.
    expect(clampShortlistSize(12.9)).toBe(12);
    expect(clampShortlistSize(0.4)).toBe(MIN_SHORTLIST_K);
  });

  it("arrives at getCandidates as the default, not merely in the options object", async () => {
    const v = linkedVault();
    const rec = await processWith(v, settings());

    expect(rec.seen.length).toBeGreaterThan(0);
    expect(rec.seen[0]!.stats.k).toBe(DEFAULT_SHORTLIST_K);
  });

  it("honours a k a caller chose in code, down to one scored slot", async () => {
    const v = linkedVault();
    const rec = await processWith(v, settings(), { shortlistK: 1 });

    expect(rec.seen[0]!.stats.k).toBe(1);
    // One scored slot honoured: only the expansion slots sit on top of it.
    expect(rec.seen[0]!.shortlist.filter((c) => c.score > 0)).toHaveLength(1);
  });

  it("clamps a junk k on the way into the run", async () => {
    const v = linkedVault();
    const rec = await processWith(v, settings(), { shortlistK: clampShortlistSize(0) });

    expect(rec.seen[0]!.stats.k).toBe(MIN_SHORTLIST_K);
    expect(rec.seen[0]!.titles.length).toBeGreaterThan(0);
  });
});

describe("linked-notes expansion on the daily path (R7)", () => {
  it("is on by default, and the daily path reaches a note BM25 scored zero", async () => {
    const v = linkedVault();
    const rec = await processWith(v, settings());

    expect(rec.seen[0]!.stats.expanded).toBe(1);
    expect(rec.seen[0]!.titles).toContain("Roasters");
  });

  it("off is honoured: no walk runs and the stats key is absent entirely", async () => {
    const v = linkedVault();
    const rec = await processWith(v, settings(), { expandGraph: false });

    expect(rec.beginOpts[0]).toMatchObject({ expandGraph: false });
    // Absent, not zero — the off case is byte-identical to the pre-expansion output.
    expect("expanded" in rec.seen[0]!.stats).toBe(false);
    expect(rec.seen[0]!.titles).not.toContain("Roasters");
  });
});

describe("shortlist diagnostics (R6)", () => {
  it("reports the counts a run is diagnosed by", async () => {
    const v = linkedVault();
    const rec = await processWith(v, settings());
    const payload = shortlistDiagnostics(rec.seen[0]!.stats);

    expect(payload.k).toBe(DEFAULT_SHORTLIST_K);
    expect(payload.expansion).toBe("on");
    expect(payload.slotsUsed).toBe(1);
    expect(payload.slotLimit).toBeGreaterThan(0);
    expect(payload.seeds).toBe(payload.scored);
    expect(payload.scored + payload.slotsUsed).toBe(payload.returned);
    expect(payload.matched + payload.zeroScoring).toBe(payload.corpusSize);
  });

  it("drops the expansion counts to zero when the walk never ran", async () => {
    const v = linkedVault();
    const rec = await processWith(v, settings(), { expandGraph: false });
    const payload = shortlistDiagnostics(rec.seen[0]!.stats);

    expect(payload.expansion).toBe("off");
    expect(payload).toMatchObject({ seeds: 0, slotsUsed: 0, slotLimit: 0 });
    expect(payload.scored).toBe(payload.returned);
  });

  it("emits counts only — no capture text and no note title (log safety)", async () => {
    const capture = "zzqwub frotzle grommish";
    const title = "Wubbly frotzle grommet";
    const v = fakeVault({
      "Daily/2026-07-04.md": `- ${capture}\n`,
      [`Notes/${title}.md`]: "Frotzle grommish notes about the wubbly bits.\n",
    });
    stubDailyNotes([{ path: "Daily/2026-07-04.md", date: "2026-07-04" }]);

    const rec = await processWith(v, settings());
    const ctx = rec.seen[0]!;
    // The run really did see both, so their absence below is redaction, not an empty fixture.
    expect(ctx.titles).toContain(title);
    expect(ctx.stats.matched).toBeGreaterThan(0);

    const serialized = JSON.stringify(shortlistDiagnostics(ctx.stats));
    for (const word of [...capture.split(" "), ...title.split(" ")]) {
      expect(serialized.toLowerCase()).not.toContain(word.toLowerCase());
    }
    // Belt and braces: every value is a number or the on/off word.
    for (const value of Object.values(shortlistDiagnostics(ctx.stats))) {
      expect(typeof value === "number" || value === "on" || value === "off").toBe(true);
    }
  });

  it("says nothing at all in a production build", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const v = linkedVault();
    const rec = await processWith(v, settings());

    // ATOMS_DEV_COMMANDS is undefined outside an esbuild bundle — the Community-build case.
    logShortlistDiagnostics("process shortlist", rec.seen[0]!.stats);
    expect(spy).not.toHaveBeenCalled();
  });
});

/**
 * The Atoms Plus account cluster used to be four hand-maintained branches that each rendered
 * their own Refresh status / Sign out / Account rows. These assert the replacement: one sealed
 * state, one main-screen row per state, and one destination holding the management actions.
 */
describe("account row", () => {
  const ACTIVE_SESSION: PlusSession = {
    sessionToken: "sess_live",
    email: "user@example.com",
    status: "active",
    remaining: 12,
    periodEnd: "2026-09-01T00:00:00.000Z",
  };

  function activeTab() {
    return settingTab({
      session: ACTIVE_SESSION,
      auth: {
        mode: "plus",
        sessionToken: ACTIVE_SESSION.sessionToken,
        email: ACTIVE_SESSION.email,
        status: "active",
        remaining: 12,
        periodEnd: ACTIVE_SESSION.periodEnd,
      },
    });
  }

  const STATES: Array<[string, SettingTabOptions, string]> = [
    ["signed out", {}, "Set up automatic filing"],
    [
      "trial incomplete",
      {
        session: {
          sessionToken: "sess_soft",
          email: "user@example.com",
          status: "inactive",
        },
      },
      "Finish trial setup",
    ],
    [
      "active",
      {
        session: ACTIVE_SESSION,
        auth: {
          mode: "plus",
          sessionToken: "sess_live",
          email: "user@example.com",
          status: "active",
          remaining: 12,
        },
      },
      "Plus · 12 filings left",
    ],
    [
      "exhausted",
      {
        session: { ...ACTIVE_SESSION, status: "exhausted", remaining: 0 },
        auth: {
          mode: "plus",
          sessionToken: "sess_live",
          email: "user@example.com",
          status: "exhausted",
          remaining: 0,
        },
      },
      "Monthly limit reached",
    ],
  ];

  /** The one state whose engine-screen description is an offer rather than a condition. */
  const SIGNED_OUT_LABEL = "Set up automatic filing";

  /**
   * U4 moved this row off the main screen and onto the engine screen, where choosing Plus is one
   * of two answers rather than the only one on offer.
   *
   * The row is now named `Atoms Plus` in every state, because a settings row is a noun and the
   * state is its answer rather than its name. The label per state is unchanged and still renders
   * on that row, in the description. The invariant that matters is untouched: one account row,
   * not one per branch.
   */
  it.each(STATES)("renders the %s label on the engine screen", (_name, opts, label) => {
    const { tab } = settingTab(opts);
    tab.display();
    // No row on the main screen is *named* for the account state. The Filing row still answers
    // with it in its description, which is the whole point of that row.
    expect(destinationNames(tab)).not.toContain(label);

    open(tab, "Filing");

    // The name is the noun in every state; the answer rides in the description beneath it.
    expect(destinationNames(tab)).toContain("Atoms Plus");
    const plusRow = row(tab, "Atoms Plus").textContent ?? "";
    if (label === SIGNED_OUT_LABEL) {
      // Signed out is the one state with no account condition to report, so the description
      // carries the offer instead. Being told "Set up automatic filing" on the screen whose
      // whole subject is that setup was never information.
      expect(plusRow).toContain("We pay for the AI");
    } else {
      expect(plusRow).toContain(label);
    }
    // One account row, not one per branch: no other state's label is on screen with it.
    const others = STATES.map(([, , other]) => other).filter((other) => other !== label);
    for (const other of others) {
      expect(plusRow).not.toContain(other);
    }
  });

  it("holds Refresh status, Sign out, and Account exactly once in the destination", () => {
    const { tab } = activeTab();
    tab.display();
    open(tab, "Filing");
    open(tab, "Atoms Plus");

    const names = rowNames(tab);
    for (const once of ["Refresh status", "Sign out", "Account"]) {
      expect(names.filter((name) => name === once)).toEqual([once]);
    }
    // The email is still shown, under the back row that already says "Account".
    expect(names.filter((name) => name === "Signed in as")).toEqual(["Signed in as"]);
    expect(tab.containerEl.textContent).toContain("user@example.com");
    // And nowhere else: the main screen carries neither the account row nor its actions.
    tab.hide();
    tab.display();
    expect(rowNames(tab)).not.toContain("Refresh status");
    expect(rowNames(tab)).not.toContain("Sign out");
  });

  it("offers account setup and no Manage row when signed out", () => {
    const { tab } = settingTab();
    tab.display();
    open(tab, "Filing");
    open(tab, "Atoms Plus");

    // The exact list, not a membership check: each field and the one button that commits it is
    // now a single row, and a regression that re-splits a pair shows up here as an extra row.
    // "Start free trial" survives as the button label on the Email row, never as a row name.
    // The paste fallback is not here since U7 — it is an escape hatch, and the third thing on
    // the one screen that has to explain the product was the wrong place for it.
    expect(rowNames(tab)).toEqual([
      "Account",
      "Skip the API key",
      "Email",
      // Never hidden, in any state: hiding it took the row away from a trialing reader, who is
      // the likeliest holder of a code.
      "Redeem code",
    ]);
    expect(buttonLabels(tab, "Email")).toEqual([
      "Send sign-in link",
      "Start free trial",
      "Use promo code",
    ]);

    openAdvanced(tab);
    expect(buttonLabels(tab, PASTE_ROW)).toEqual(["Save session"]);
  });

  /**
   * The three account pairs are one row each, so the button submits the field beside it rather
   * than reading it back out of the DOM. These assert the value actually arrives — the handlers
   * are stubbed because what is under test is the wiring, not what a trial or a session does.
   */
  describe("each account form row submits its own field", () => {
    afterEach(() => stopCapturingObsidianUi());

    /** The signed-out account screen, with `name` on the tab replaced by a recorder. */
    function accountScreen(name: string) {
      const { tab } = settingTab();
      tab.display();
      open(tab, "Filing");
      open(tab, "Atoms Plus");
      const handler = vi.fn(async () => {});
      // An own property shadowing the prototype method: the row's `onSubmit` resolves
      // `this.<name>` at press time, so stubbing after the render is enough.
      (tab as unknown as Record<string, unknown>)[name] = handler;
      return { tab, handler };
    }

    it("hands the typed email to the trial", () => {
      const { tab, handler } = accountScreen("startTrial");
      fill(tab, "Email", "buyer@example.com");
      press(tab, "Email", "Start free trial");

      expect(handler).toHaveBeenCalledWith("buyer@example.com");
    });

    it("hands the typed email to the sign-in link", () => {
      const { tab, handler } = accountScreen("sendPlusMagicLink");
      fill(tab, "Email", "back@example.com");
      press(tab, "Email", "Send sign-in link");

      expect(handler).toHaveBeenCalledWith("back@example.com");
    });

    it("hands the typed email to Use promo code, not startTrial", () => {
      const { tab, handler } = accountScreen("startSubscribeFromEmail");
      fill(tab, "Email", "friend@example.com");
      press(tab, "Email", "Use promo code");

      expect(handler).toHaveBeenCalledWith("friend@example.com");
    });

    it("refuses a sign-in link for an address without an @", () => {
      const { tab, handler } = accountScreen("sendPlusMagicLink");
      const ui = captureObsidianUi();

      fill(tab, "Email", "nobody");
      press(tab, "Email", "Send sign-in link");

      expect(handler).not.toHaveBeenCalled();
      expect(ui.notices).toEqual(["Enter a valid email first"]);
    });

    it("trims the pasted session before the sess_ check ever sees it", () => {
      // Same wiring claim, one screen over: U7 moved this row to Advanced → Escape hatches.
      const { tab } = settingTab();
      const handler = vi.fn(async () => {});
      openAdvanced(tab);
      (tab as unknown as Record<string, unknown>).savePastedSession = handler;
      // A token pasted out of an email arrives with the whitespace around it.
      fill(tab, PASTE_ROW, "  sess_live  ");
      press(tab, PASTE_ROW, "Save session");

      expect(handler).toHaveBeenCalledWith("sess_live");
    });

    /**
     * #500. This path verifies the pasted token by sending it to `/v1/me` with
     * `requestUrl` directly, so it does not inherit `plusRequest`'s guard and
     * needs its own. The obsidian mock's `requestUrl` throws when called, which
     * is the assertion: a guard that stopped working fails this test loudly.
     */
    it("will not verify a pasted session against a Plus URL we would not talk to", async () => {
      const { tab } = settingTab({
        settings: { plusBaseUrl: "http://evil.example" },
      });
      const ui = captureObsidianUi();

      await (
        tab as unknown as {
          savePastedSession: (token: string) => Promise<void>;
        }
      ).savePastedSession("sess_live_abc");

      expect(ui.notices).toEqual([PLUS_BASE_URL_INVALID_MESSAGE]);
    });
  });

  it("closes the account state so a fifth state cannot be added without a branch", () => {
    const signedOut: AccountState = { kind: "signedOut" };
    expect(accountRowDescriptor(signedOut).name).toBe("Set up automatic filing");

    // The compile error this expects is the guard: `accountRowDescriptor` switches on
    // `AccountState` and closes with `const _exhaustive: never = state`, so a variant added to
    // the union without a matching branch fails `typecheck:test` — and, because the switch lives
    // in `src/`, `npm run build` as well.
    // @ts-expect-error — "grandfathered" is not an account state.
    const notAState: AccountState = { kind: "grandfathered" };
    expect(notAState.kind).toBe("grandfathered");
  });

  /**
   * #442 — the row a lapsed account actually reads. It said "Monthly limit reached", which is
   * the sentence for someone whose allotment refills; a trial that ended has no allotment and
   * no next billing date.
   */
  describe("an ended period is not a spent meter", () => {
    const T0 = Date.parse("2026-08-11T13:49:00.000Z");
    const lapsedTrial: PlusSession = {
      sessionToken: "sess_abc",
      email: "u@example.com",
      status: "exhausted",
      remaining: 0,
      plan: "trial",
      periodEnd: "2026-08-10T14:52:03.632Z",
    };
    const authFor = (s: PlusSession): FilingAuth => ({
      mode: "plus",
      sessionToken: s.sessionToken,
      email: s.email,
      status: s.status ?? "unknown",
      remaining: s.remaining,
      periodEnd: s.periodEnd,
      plan: s.plan,
    });

    it("outranks exhausted, and carries the date the row prints", () => {
      const state = deriveAccountState(
        authFor(lapsedTrial),
        lapsedTrial,
        T0,
      );
      expect(state).toEqual({
        kind: "periodEnded",
        lapseKind: "trial",
        endedOn: "2026-08-10T14:52:03.632Z",
      });
    });

    it("treats an inactive subscribe start as Finish Plus checkout, not trial", () => {
      const pending: PlusSession = {
        sessionToken: "sess_promo",
        email: "friend@example.com",
        status: "inactive",
        setupKind: "subscribe",
      };
      const state = deriveAccountState({ mode: "none" }, pending);
      expect(state).toEqual({
        kind: "subscribeIncomplete",
        email: "friend@example.com",
      });
      expect(accountRowDescriptor(state).name).toBe("Finish Plus checkout");
    });

    it("keeps a kindless inactive session as the trial finish", () => {
      const pending: PlusSession = {
        sessionToken: "sess_trial",
        email: "buyer@example.com",
        status: "inactive",
      };
      expect(deriveAccountState({ mode: "none" }, pending)).toEqual({
        kind: "trialIncomplete",
        email: "buyer@example.com",
      });
    });

    it("names the trial and points at subscribing, with no billing-date promise", () => {
      const row = accountRowDescriptor(
        deriveAccountState(authFor(lapsedTrial), lapsedTrial, T0),
      );
      expect(row.name).toBe("Trial ended");
      expect(row.desc).toMatch(/2026-08-10/);
      expect(row.desc).toMatch(/Subscribe/);
      expect(row.desc).not.toMatch(/billing date|allotment/i);
    });

    it("calls an ended paid period a subscription", () => {
      const paid: PlusSession = { ...lapsedTrial, plan: "monthly" };
      expect(
        accountRowDescriptor(deriveAccountState(authFor(paid), paid, T0)).name,
      ).toBe("Subscription ended");
    });

    it("leaves a spent meter inside a live period saying exactly what it said before", () => {
      const capped: PlusSession = {
        ...lapsedTrial,
        plan: "monthly",
        periodEnd: "2026-09-10T00:00:00.000Z",
      };
      const row = accountRowDescriptor(
        deriveAccountState(authFor(capped), capped, T0),
      );
      expect(row.name).toBe("Monthly limit reached");
      expect(row.desc).toMatch(/next billing date/);
    });
  });
});

/**
 * U11 — the copy lockstep, over the screens this plan authored.
 *
 * The existing em-dash guards cover main-screen prose, the engine screen, and the File group's
 * footers. They were written before the two screens that now hold most of this plan's new copy
 * existed, and a rule enforced on three surfaces out of seven is a rule with three surfaces'
 * worth of teeth. This walks every string a reader can see on the screens U7 through U9 wrote:
 * prose, group footers, and row descriptions alike, which is where the old guards stopped.
 *
 * Scoped to those screens rather than to the whole tab on purpose. The plan's rule is about copy
 * *this plan* added or edited (R15), and sweeping the untouched screens would fail on strings
 * nobody here wrote, which is how a guard gets deleted instead of obeyed.
 */
describe("copy lockstep on the screens this plan wrote (U11, R15)", () => {
  /** Everything a reader sees: paragraphs, group footers, and the line under each row name. */
  function readableText(tab: AtomsSettingTab): string[] {
    return Array.from(
      tab.containerEl.querySelectorAll(
        "p.setting-item-description, p.atoms-setting-group-foot, .setting-item-description",
      ),
    ).map((el) => el.textContent ?? "");
  }

  it("writes no em dash on the Advanced screen", () => {
    const { tab } = settingTab({
      session: PLUS_SESSION,
      local: { [LS_LAST_RUN_DAY]: "2026-08-13" },
    });
    openAdvanced(tab);

    const lines = readableText(tab);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain("—");
  });

  it("writes no em dash on either account screen", () => {
    for (const opts of [{}, { session: PLUS_SESSION }]) {
      const { tab } = settingTab(opts);
      tab.display();
      open(tab, "Filing");
      open(tab, destinationNames(tab).find((n) => n !== "Account") ?? "");

      const lines = readableText(tab);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).not.toContain("—");
    }
  });

  it("writes no em dash in the capture sheet, in either of its shapes", () => {
    for (const settings of [{}, { captureShortcutInstallUrl: " " }]) {
      const { tab } = settingTab({ settings });
      tab.display();
      open(tab, "Capture on your phone");
      expect(sheetText()).not.toContain("—");
      dismissSheet();
    }
  });

  /**
   * KTD5's other half. The three ack versions and the standing suffixes are frozen, and this
   * plan moved records between screens without touching a word of them — a record describing
   * wording the user never saw is #315 wearing new paint. The suffix pair is asserted where the
   * records render; this pins the versions themselves, so a copy edit that "tidied" a
   * disclosure without bumping its version fails here rather than on somebody's device.
   */
  it("moved every consent record without moving an ack version", () => {
    expect(EGRESS_ACK_VERSION).toBe("2026-08-06");
    expect(ASK_PRIVACY_ACK_VERSION).toBe("2026-08-07");
    expect(ASK_WRITE_ACK_VERSION).toBe("2026-08-06");
  });

  /** R8: a user reading Settings has to be able to say which build they are looking at. */
  it("keeps the three manifests on one version", () => {
    const read = (name: string) =>
      JSON.parse(
        readFileSync(path.resolve(__dirname, "..", name), "utf8"),
      ) as Record<string, unknown>;
    const pkg = read("package.json").version as string;
    expect(read("manifest.json").version).toBe(pkg);
    expect(Object.keys(read("versions.json"))).toContain(pkg);
  });
});

/**
 * U9 — the capture-on-phone procedure, out of a row description and into a sheet.
 *
 * The row used to carry all six steps as one arrow-separated line ending in `Acked: never`, on
 * the main screen, in a group whose whole point is that a row is a name and a control (R2). What
 * matters about the move is that nothing was lost in it: the step people skip is still first, the
 * failure mode is still named, and the ack still happens only on a successful open.
 */
describe("capture on your phone (U9, R2/R19)", () => {
  const ROW = "Capture on your phone";

  /** The install URL the shipped `mobile-install.json` yields, so the button is live. */
  const shipped = () => resolveCaptureShortcutInstallUrl("");

  it("says what this device has, and nothing about how to get it", () => {
    const { tab } = settingTab();
    tab.display();

    // "Not set up" is the whole status. The six steps that used to be here are one tap away.
    expect(row(tab, ROW).textContent).toContain("Not set up");
    expect(row(tab, ROW).textContent).not.toContain("Ask Each Time");
    expect(row(tab, ROW).querySelectorAll("button")).toHaveLength(0);
  });

  it("names the acked version once this device has installed it", () => {
    const { tab } = settingTab({ local: { [LS_CAPTURE_SHORTCUT_ACK]: "2.1.0" } });
    tab.display();

    // The version this device acked, not the one it would get by updating: a device holding an
    // older ack is out of date, and printing the shipped version would hide exactly that.
    expect(row(tab, ROW).textContent).toContain("Capture Atom 2.1.0");
  });

  it("opens a sheet with three numbered steps and the install", () => {
    const { tab } = settingTab();
    tab.display();
    open(tab, ROW);

    const steps = Array.from(sheet().contentEl.querySelectorAll("ol li")).map(
      (el) => el.textContent ?? "",
    );
    expect(steps).toHaveLength(3);
    // Step 1 is the one people skip, and skipping it leaves step 3 with nothing to point at.
    expect(steps[0]).toContain("bookmark exists");
    // The single failure this procedure exists to prevent, still named where it happens.
    expect(steps[2]).toContain("Ask Each Time");
    expect(sheetButtons()).toEqual(["Close", "Install Capture Atom"]);
  });

  it("writes no ack when the sheet is dismissed", () => {
    const { tab, local } = settingTab();
    tab.display();
    open(tab, ROW);
    dismissSheet();

    // Reading the steps is not installing them. Only a successful open acks.
    expect(local.get(LS_CAPTURE_SHORTCUT_ACK)).toBeUndefined();
    expect(row(tab, ROW).textContent).toContain("Not set up");
  });

  it("acks the shipped version when the install opens", () => {
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    const { tab, local } = settingTab();
    tab.display();
    open(tab, ROW);
    pressSheet("Install Capture Atom");

    expect(opened).toHaveBeenCalledWith(shipped(), "_blank");
    expect(local.get(LS_CAPTURE_SHORTCUT_ACK)).toBe(CAPTURE_ATOM_VERSION);
    opened.mockRestore();
  });

  it("still refuses a malformed link with the same guidance, and acks nothing", () => {
    const ui = captureObsidianUi();
    const { tab, local } = settingTab({
      settings: { captureShortcutInstallUrl: "https://evil.example.com/shortcuts/x" },
    });
    tab.display();
    open(tab, ROW);
    pressSheet("Install Capture Atom");

    expect(ui.notices[0]).toContain("https://www.icloud.com/shortcuts/");
    expect(local.get(LS_CAPTURE_SHORTCUT_ACK)).toBeUndefined();
    stopCapturingObsidianUi();
  });

  it("offers Update once installed, not Install", () => {
    const { tab } = settingTab({ local: { [LS_CAPTURE_SHORTCUT_ACK]: "2.1.0" } });
    tab.display();
    open(tab, ROW);

    expect(sheetButtons()).toContain("Update Capture Atom");
    dismissSheet();
  });
});

/**
 * U8's regression bar: the account screen changes how it *looks* and not what it *holds*.
 *
 * The restyle wraps existing rows in the group primitive and applies the v2 tokens. KTD14 keeps
 * everything that would re-shape the actions out of this unit — reducing to one primary per
 * state, demoting `Refresh status` or `Manage subscription`, folding `Sign out all devices` into
 * a footer link, and the `Ended`-versus-`Renews` correction — because the buy-now plan rewrites
 * those rows and two plans editing the same rows is how they end up disagreeing.
 *
 * So this list is written down rather than derived: nine renders, each pinned to the exact rows
 * it produced before the restyle, in order. A grouping pass that quietly drops a conditional row
 * has to fail here, and "it looked fine" is not evidence that it did not.
 */
/**
 * Redeeming a promo code, across every account state (KD6).
 *
 * The invariant with teeth is the **destination**, not the row. A code applies to a subscription,
 * and two of the six states already have one: sending those to a fresh Checkout buys a second
 * subscription, which is a billing incident rather than a bad label.
 *
 * An earlier draft solved that by hiding the row on a live subscription. That took it away from a
 * trialing reader — `start_trial` creates a real Stripe subscription, so a user three days into
 * fourteen is `active` — who is the likeliest holder of a code and was left with no route at all.
 */
describe("Redeem code (KD6)", () => {
  const live = (over: Partial<PlusSession> = {}): SettingTabOptions => {
    const session: PlusSession = {
      sessionToken: "sess_live",
      email: "user@example.com",
      status: "active",
      remaining: 12,
      periodEnd: "2099-09-01T00:00:00.000Z",
      ...over,
    };
    return {
      session,
      auth: {
        mode: "plus",
        sessionToken: session.sessionToken,
        email: session.email,
        status: session.status ?? "unknown",
        remaining: session.remaining,
        periodEnd: session.periodEnd,
        plan: session.plan,
      },
    };
  };

  /** The redeem screen, walked in from the main screen the way a user reaches it. */
  function redeemScreen(opts: SettingTabOptions = {}) {
    const made = settingTab(opts);
    made.tab.display();
    open(made.tab, "Redeem code");
    return made;
  }

  /** Replace both destinations with recorders, so a press proves which one was chosen. */
  function watchDestinations(tab: AtomsSettingTab) {
    const portal = vi.fn(async () => {});
    const checkout = vi.fn(async () => {});
    const t = tab as unknown as Record<string, unknown>;
    t.openBillingPortal = portal;
    t.openSubscribeCheckout = checkout;
    return { portal, checkout };
  }

  const STATES: Array<[name: string, opts: SettingTabOptions, live: boolean]> = [
    ["signed out", {}, false],
    [
      "trial started, checkout unfinished",
      { session: { sessionToken: "sess_soft", email: "user@example.com", status: "inactive" } },
      false,
    ],
    ["active, paying", live(), true],
    // The state the first draft hid the row from.
    ["active, trialing", live({ status: "trialing" }), true],
    ["meter spent inside a live period", live({ status: "exhausted", remaining: 0 }), true],
    [
      "period ended",
      live({ status: "exhausted", remaining: 0, plan: "monthly", periodEnd: "2026-08-10T14:52:03.632Z" }),
      false,
    ],
  ];

  it.each(STATES)("renders the row in %s", (_name, opts) => {
    const { tab } = settingTab(opts);
    tab.display();

    // On the main screen, and never hidden.
    expect(destinationNames(tab)).toContain("Redeem code");
  });

  it.each(STATES.filter(([, , isLive]) => isLive))(
    "sends %s to the billing portal, never to a second subscription",
    (_name, opts) => {
      const { tab } = redeemScreen(opts);
      const { portal, checkout } = watchDestinations(tab);

      press(tab, "Billing portal", "Open billing portal");

      expect(portal).toHaveBeenCalledTimes(1);
      expect(checkout).not.toHaveBeenCalled();
    },
  );

  it.each(STATES.filter(([name, , isLive]) => !isLive && name !== "signed out"))(
    "sends %s to subscribe checkout",
    (_name, opts) => {
      const { tab } = redeemScreen(opts);
      const { portal, checkout } = watchDestinations(tab);

      press(tab, "Checkout", "Open checkout");

      expect(checkout).toHaveBeenCalledTimes(1);
      expect(portal).not.toHaveBeenCalled();
    },
  );

  it("asks a signed-out reader for an email, and mints the session with it", () => {
    const { tab } = redeemScreen();
    const handler = vi.fn(async () => {});
    (tab as unknown as Record<string, unknown>).startSubscribeFromEmail = handler;

    fill(tab, "Email", "  someone@example.com  ");
    press(tab, "Email", "Open checkout");

    // Trimmed by `formRow`, which is what keeps a pasted address with a stray space working.
    expect(handler).toHaveBeenCalledWith("someone@example.com");
  });

  it("tells a trialing reader when the code takes effect, since they already have a subscription", () => {
    const { tab } = redeemScreen(live({ status: "trialing" }));

    expect(prose(tab).join(" ")).toContain(
      "applies when the trial becomes a subscription",
    );
  });

  it("never renders a field for the code itself: Stripe owns that string", () => {
    for (const [, opts] of STATES) {
      const { tab } = redeemScreen(opts);
      const fields = Array.from(
        tab.containerEl.querySelectorAll("input[type=text], input[type=email]"),
      ).map((el) => (el as HTMLInputElement).placeholder);
      // The only field this screen may ever hold is the email that mints a session.
      expect(fields.filter((p) => p !== "you@example.com")).toEqual([]);
    }
  });

  it("writes no em dash into any of its prose", () => {
    const { tab } = redeemScreen(live({ status: "trialing" }));

    for (const line of prose(tab)) expect(line).not.toContain("—");
  });
});

describe("account screen holds the same rows through the restyle (U8, KTD14)", () => {
  const T_PAST = "2026-08-10T14:52:03.632Z";

  const authFor = (s: PlusSession): FilingAuth => ({
    mode: "plus",
    sessionToken: s.sessionToken,
    email: s.email,
    status: s.status ?? "unknown",
    remaining: s.remaining,
    periodEnd: s.periodEnd,
    plan: s.plan,
  });

  /**
   * #508. Every fixture here is stamped, because every session minted since
   * `installPlusSession` took an issuer is. An unstamped session with an empty
   * `plusBaseUrl` is the upgrade cohort, and it earns a row of its own that has
   * nothing to do with what account state the screen is in — pinned separately
   * below so these nine keep answering only the restyle's question.
   */
  const HOSTED = "https://plus.tryatoms.app";

  /** A session whose period is already over, in whichever plan the case is about. */
  const lapsed = (plan: PlusSession["plan"]): PlusSession => ({
    sessionToken: "sess_lapsed",
    email: "user@example.com",
    status: "exhausted",
    remaining: 0,
    plan,
    periodEnd: T_PAST,
    issuedBase: HOSTED as IssuedBase,
  });

  const live: PlusSession = {
    sessionToken: "sess_live",
    email: "user@example.com",
    status: "active",
    remaining: 12,
    periodEnd: "2099-09-01T00:00:00.000Z",
    issuedBase: HOSTED as IssuedBase,
  };

  const plusSession = (session: PlusSession): SettingTabOptions => ({
    session,
    auth: authFor(session),
  });

  /**
   * Every signed-in render opens with these, and closes with the sign-out pair.
   *
   * `Redeem code` closes every render, signed out included: it is rendered once at the end of the
   * screen rather than per state, because a code can be spent from any of them. Hiding it on a
   * live subscription is what an earlier draft did, and it took the row away from a trialing
   * reader holding a founding code.
   */
  const HEAD = ["Account", "Status", "Signed in as"];
  const REDEEM = "Redeem code";
  const TAIL = [
    "Refresh status",
    "Manage subscription",
    "Sign out",
    "Sign out all devices",
    REDEEM,
  ];
  /** Same tail on a state the billing portal has no subject for (#442). */
  const TAIL_NO_PORTAL = ["Refresh status", "Sign out", "Sign out all devices", REDEEM];

  const NINE: Array<[name: string, opts: SettingTabOptions, rows: string[]]> = [
    ["signed out", {}, ["Account", "Skip the API key", "Email", REDEEM]],
    [
      "trial started, checkout unfinished",
      {
        session: {
          sessionToken: "sess_soft",
          email: "user@example.com",
          status: "inactive",
          issuedBase: HOSTED as IssuedBase,
        },
      },
      // No Plan and no portal: an unfinished setup has neither a period nor a Stripe customer.
      [...HEAD, "Finish trial setup", ...TAIL_NO_PORTAL],
    ],
    [
      "promo subscribe started, checkout unfinished",
      {
        session: {
          sessionToken: "sess_promo",
          email: "user@example.com",
          status: "inactive",
          setupKind: "subscribe",
          issuedBase: HOSTED as IssuedBase,
        },
      },
      [...HEAD, "Finish Plus checkout", ...TAIL_NO_PORTAL],
    ],
    ["active with filings left", plusSession(live), [...HEAD, "Plan", ...TAIL]],
    [
      "active with no count to show",
      plusSession({ ...live, remaining: undefined }),
      [...HEAD, "Plan", ...TAIL],
    ],
    [
      "meter spent inside a live period",
      plusSession({ ...live, status: "exhausted", remaining: 0, plan: "monthly" }),
      [...HEAD, "Plan", "Get more filings", ...TAIL],
    ],
    [
      "paid period ended",
      plusSession(lapsed("monthly")),
      [...HEAD, "Plan", "Subscribe", ...TAIL],
    ],
    [
      "trial period ended",
      plusSession(lapsed("trial")),
      // The portal has nothing to open for a trial that never converted (#442).
      [...HEAD, "Plan", "Subscribe", ...TAIL_NO_PORTAL],
    ],
    [
      "period ended on a session stored before plans were persisted",
      plusSession(lapsed(undefined)),
      // Unknown is not proof of a Stripe customer, so it is treated like the trial.
      [...HEAD, "Plan", "Subscribe", ...TAIL_NO_PORTAL],
    ],
  ];

  it.each(NINE)("renders %s unchanged", (_case, opts, expected) => {
    const { tab } = settingTab(opts);
    tab.display();
    open(tab, "Filing");
    open(tab, opts.session ? accountEntryName(tab) : "Atoms Plus");

    expect(rowNames(tab)).toEqual(expected);
  });

  it("groups the signed-in screen into what the account is and what you can do to it", () => {
    const { tab } = settingTab(plusSession(live));
    tab.display();
    open(tab, "Filing");
    open(tab, accountEntryName(tab));

    // Two, not the mock's three: its third is the sign-out block, whose shape is one red row
    // with `Sign out all devices` demoted to a footer link, and that demotion is deferred.
    expect(groupHeaders(tab)).toEqual(["Atoms Plus", "Manage"]);
    // No state in the eyebrow. The `Status` row is still on screen saying exactly that, and a
    // group named for the state would repeat it one line above itself.
    expect(row(tab, "Status").textContent).toContain("Plus");
  });

  it("groups the signed-out screen into the pitch and the way in", () => {
    const { tab } = settingTab();
    tab.display();
    open(tab, "Filing");
    open(tab, "Atoms Plus");

    expect(groupHeaders(tab)).toEqual(["What Plus does", "Sign in or start a trial"]);
    // The locked three-action frame survives the wrap intact.
    expect(buttonLabels(tab, "Email")).toEqual([
      "Send sign-in link",
      "Start free trial",
      "Use promo code",
    ]);
  });

  /** The engine screen names the account row for its state, so the walk has to read it. */
  function accountEntryName(tab: AtomsSettingTab): string {
    const names = destinationNames(tab);
    const entry = names.find((n) => n !== "Account");
    if (entry === undefined) throw new Error("engine screen has no account row");
    return entry;
  }
});

/**
 * #508 D1. Everyone who was already signed in when the issuer gate shipped holds an unstamped
 * session, and a hosted user leaves `plusBaseUrl` empty, so their first Process refuses. The
 * refusal says to open Settings. Before this row, Settings had nowhere to open *to* except
 * Advanced, which asks them to type the address that is already the implicit default.
 */
describe("#508 - the Account screen offers the upgrade cohort a way out", () => {
  const ROW = "Confirm the Plus address";

  const upgrading: PlusSession = {
    sessionToken: "sess_upgrade",
    email: "user@example.com",
    status: "active",
    remaining: 12,
    periodEnd: "2099-09-01T00:00:00.000Z",
  };

  /** The signed-in account state the tab reads: session on disk plus resolved auth. */
  const signedIn = (session: PlusSession): SettingTabOptions => ({
    session,
    auth: {
      mode: "plus",
      sessionToken: session.sessionToken,
      email: session.email,
      status: session.status ?? "unknown",
      remaining: session.remaining,
      periodEnd: session.periodEnd,
      plan: session.plan,
    },
  });

  /** Walk to Account, whatever the engine screen has named the row for this state. */
  function openAccount(tab: AtomsSettingTab): void {
    tab.display();
    open(tab, "Who does the filing");
    const entry = destinationNames(tab).find((n) => n !== "Account");
    open(tab, entry ?? "");
  }

  it("offers the row when there is no stamp and no address", () => {
    const { tab } = settingTab(signedIn(upgrading));
    openAccount(tab);

    expect(rowNames(tab)).toContain(ROW);
    expect(row(tab, ROW).textContent).toContain("plus.tryatoms.app");
  });

  it("writes the standard address and stops asking", async () => {
    const { tab, plugin } = settingTab(signedIn(upgrading));
    openAccount(tab);

    press(tab, ROW, "Use plus.tryatoms.app");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(plugin.settings.plusBaseUrl).toBe(DEFAULT_PLUS_BASE_URL);
    // The screen re-renders, and the question it was asking is answered.
    expect(rowNames(tab)).not.toContain(ROW);
  });

  /**
   * Found by the cross-model review. Writing the address is not a stamp: the
   * next content call still probes this host and can still refuse it. A Notice
   * promising a filing is a promise this row has no way to keep.
   */
  it("says what it did, not what the next Process will manage", () => {
    Notice.messages.length = 0;
    const { tab } = settingTab(signedIn(upgrading));
    openAccount(tab);

    press(tab, ROW, "Use plus.tryatoms.app");

    const said = Notice.messages.join(" ");
    expect(said).toContain("plus.tryatoms.app");
    expect(said.toLowerCase()).not.toContain("files as usual");
  });

  /**
   * The button writes an *address*, never a stamp. A stamp minted here would be a verdict
   * nothing verified, and the only thing it could be minted from is the ungated resolution
   * this issue exists to stop trusting. The next content call probes with the address now in
   * the field and stamps for real.
   */
  it("mints no issuer stamp of its own", async () => {
    const { tab, local } = settingTab(signedIn(upgrading));
    openAccount(tab);

    press(tab, ROW, "Use plus.tryatoms.app");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const stored = readPlusSession({
      loadLocalStorage: (key) => local.get(key) ?? null,
      saveLocalStorage: () => undefined,
    });
    expect(stored?.issuedBase).toBeUndefined();
    expect(stored?.verifiedBase).toBeUndefined();
  });

  it("says nothing to a session that carries a stamp", () => {
    const { tab } = settingTab(
      signedIn({ ...upgrading, issuedBase: DEFAULT_PLUS_BASE_URL as IssuedBase }),
    );
    openAccount(tab);

    expect(rowNames(tab)).not.toContain(ROW);
  });

  /**
   * A stamp that disagrees with the configured base is the mismatch case, and it is deliberately
   * not this row's business: it is unsettled, the next Process or mirror push may re-stamp, and
   * "confirm the address" is the wrong instruction for someone who already has one.
   */
  it("says nothing about a stamp that disagrees with the address in use", () => {
    const { tab } = settingTab({
      ...signedIn({ ...upgrading, verifiedBase: "https://my.host" }),
      settings: { plusBaseUrl: "https://other.host" },
    });
    openAccount(tab);

    expect(rowNames(tab)).not.toContain(ROW);
  });

  it("says nothing when nobody is signed in", () => {
    const { tab } = settingTab();
    tab.display();
    open(tab, "Who does the filing");
    open(tab, "Set up automatic filing");

    expect(rowNames(tab)).not.toContain(ROW);
  });
});

/**
 * The vocabulary is the cluster that grows without bound — one row per active tag, per proposal,
 * and per tag already used in the vault, which is how the settings screen was heading for ninety
 * rows. These assert the replacement: one counted row on the main screen, and every capability
 * still reachable one screen in.
 */
describe("tag vocabulary", () => {
  const entry = (n: number) => `Tag vocabulary · ${n} active`;

  /** Let the `await plugin.saveSettings()` inside a row's handler land before asserting. */
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  /** The destination renders a back row; the main screen does not. */
  const inDestination = (tab: AtomsSettingTab) =>
    tab.containerEl.querySelector(".atoms-setting-back") !== null;

  /**
   * Every row rendered under the Proposed heading, in order, up to the next heading. Row *count*
   * is the assertion #342 needed, and only a slice of the screen can carry it without breaking
   * every time an unrelated section gains a row.
   */
  const proposedSection = (tab: AtomsSettingTab): string[] => {
    const names = rowNames(tab);
    const start = names.indexOf("Proposed (approve to activate)");
    if (start === -1) return [];
    const rest = names.slice(start + 1);
    const end = rest.indexOf("Found in your vault");
    return end === -1 ? rest : rest.slice(0, end);
  };

  it("counts the active vocabulary on one main-screen row", () => {
    const { tab } = settingTab({ settings: { activeVocabulary: ["idea", "question", "watch"] } });
    tab.display();

    expect(destinationNames(tab)).toContain(entry(3));
    // The cluster itself left: not one per-tag row survives on the main screen.
    expect(rowNames(tab).filter((name) => name.startsWith("#"))).toEqual([]);
  });

  it("stays one row however large the vocabulary grows", () => {
    const { tab: big } = settingTab({
      settings: { activeVocabulary: Array.from({ length: 60 }, (_, i) => `tag${i}`) },
      vaultTags: ["gardening", "cooking"],
    });
    const { tab: small } = settingTab({ settings: { activeVocabulary: ["idea"] } });
    big.display();
    small.display();

    expect(rowNames(big).length).toBe(rowNames(small).length);
  });

  it("holds every active tag in the destination", () => {
    const { tab } = settingTab({ settings: { activeVocabulary: ["idea", "watch"] } });
    tab.display();
    open(tab, entry(2));

    expect(rowNames(tab)).toEqual(expect.arrayContaining(["#idea", "#watch"]));
  });

  it("leaves the Proposed group out when nothing has been proposed", () => {
    const { tab } = settingTab({
      settings: { activeVocabulary: ["idea"], proposedTags: [] },
    });
    tab.display();
    open(tab, entry(1));

    // The intro prose explains proposals, so this is about the group heading and its rows.
    expect(tab.containerEl.textContent).not.toContain("Proposed (approve to activate)");
    expect(rowNames(tab).filter((name) => name.endsWith("waiting"))).toEqual([]);
  });

  it("renders the Proposed group when a classify run proposed something", () => {
    const { tab } = settingTab({
      settings: { activeVocabulary: ["idea"], proposedTags: ["gardening"] },
    });
    tab.display();
    open(tab, entry(1));

    expect(tab.containerEl.textContent).toContain("Proposed (approve to activate)");
    expect(rowNames(tab)).toContain("#gardening");
    // The one dismissal for the queue counts in the singular when the queue holds one.
    expect(rowNames(tab)).toContain("1 proposal waiting");
  });

  /**
   * The section used to cost two full-width rows per proposal — the second one's whole content
   * being its own Dismiss button — so the row *count*, not just the row names, is the assertion
   * that would have caught it (#342). Asserting the exact rendered list rather than filtering by
   * name is deliberate: a regression that brought the second row back under some other wording
   * would slip past any filter keyed to the word "Dismiss".
   */
  it("spends one row per proposal plus one dismissal for the queue", () => {
    const { tab } = settingTab({
      settings: {
        activeVocabulary: ["idea"],
        proposedTags: ["gardening", "cooking", "watch"],
      },
    });
    tab.display();
    open(tab, entry(1));

    expect(proposedSection(tab)).toEqual([
      "#gardening",
      "#cooking",
      "#watch",
      "3 proposals waiting",
    ]);
  });

  it("approves a proposed tag into Active", async () => {
    const { tab } = settingTab({
      settings: { activeVocabulary: ["idea"], proposedTags: ["gardening"] },
    });
    tab.display();
    open(tab, entry(1));
    press(tab, "#gardening", "Approve");
    await flush();

    expect(inDestination(tab)).toBe(true);
    // The queue is empty, so its dismissal goes with it rather than sitting over nothing.
    expect(rowNames(tab).filter((name) => name.endsWith("waiting"))).toEqual([]);
    expect(row(tab, "#gardening").querySelector(".checkbox-container")).not.toBeNull();

    tab.hide();
    tab.display();
    expect(destinationNames(tab)).toContain(entry(2));
  });

  it("approves one proposal and leaves the rest of the queue waiting", async () => {
    const { tab } = settingTab({
      settings: { activeVocabulary: ["idea"], proposedTags: ["gardening", "cooking"] },
    });
    tab.display();
    open(tab, entry(1));
    press(tab, "#gardening", "Approve");
    await flush();

    expect(rowNames(tab)).toContain("1 proposal waiting");
    expect(rowNames(tab)).toContain("#cooking");
  });

  it("dismisses the whole queue without activating anything", async () => {
    const { tab, plugin } = settingTab({
      settings: { activeVocabulary: ["idea"], proposedTags: ["gardening", "cooking"] },
    });
    tab.display();
    open(tab, entry(1));
    press(tab, "2 proposals waiting", "Dismiss all");
    pressSheet("Dismiss");
    await flush();

    expect(inDestination(tab)).toBe(true);
    expect(tab.containerEl.textContent).not.toContain("Proposed (approve to activate)");
    // Dropped, not promoted: the queue is empty and Active gained nothing.
    expect(plugin.settings.proposedTags).toEqual([]);
    expect(plugin.settings.activeVocabulary).toEqual(["idea"]);
    tab.hide();
    tab.display();
    expect(destinationNames(tab)).toContain(entry(1));
  });

  /**
   * One tap was defensible while dismissal was per-tag. A row that clears the whole queue is not,
   * because dismissal does not come back: a processed capture carries a sentinel and is never
   * classified twice.
   */
  it("asks before dismissing the queue, and keeps it when the answer is no", async () => {
    const { tab, plugin } = settingTab({
      settings: { activeVocabulary: ["idea"], proposedTags: ["gardening", "cooking"] },
    });
    tab.display();
    open(tab, entry(1));
    press(tab, "2 proposals waiting", "Dismiss all");

    expect(sheetText()).toContain("Dismiss 2 proposals?");
    dismissSheet();
    await flush();

    expect(plugin.settings.proposedTags).toEqual(["gardening", "cooking"]);
    expect(rowNames(tab)).toContain("2 proposals waiting");
  });

  it("counts the question in the singular when one proposal is waiting", () => {
    const { tab } = settingTab({
      settings: { activeVocabulary: ["idea"], proposedTags: ["gardening"] },
    });
    tab.display();
    open(tab, entry(1));
    press(tab, "1 proposal waiting", "Dismiss all");

    expect(sheetText()).toContain("Dismiss 1 proposal?");
    expect(sheetText()).toContain("This tag will not be offered again");
    dismissSheet();
  });

  /**
   * A Process or auto-run merges into `settings.proposedTags` without redisplaying an open
   * settings tab, so the row can be looking at a smaller queue than the one it would clear. It
   * dismisses what it rendered and nothing else — otherwise a button labelled "2 proposals
   * waiting" silently destroys four, including two the user never saw.
   */
  it("dismisses only the proposals it rendered, not ones that arrived since", async () => {
    const { tab, plugin } = settingTab({
      settings: { activeVocabulary: ["idea"], proposedTags: ["gardening", "cooking"] },
    });
    tab.display();
    open(tab, entry(1));
    expect(rowNames(tab)).toContain("2 proposals waiting");

    // A classify run lands while the screen sits open.
    plugin.settings.proposedTags = ["gardening", "cooking", "watch", "media"];
    press(tab, "2 proposals waiting", "Dismiss all");
    pressSheet("Dismiss");
    await flush();

    expect(plugin.settings.proposedTags).toEqual(["watch", "media"]);
    expect(proposedSection(tab)).toEqual(["#watch", "#media", "2 proposals waiting"]);
  });

  /**
   * `mergeProposedTags` never writes a duplicate or a mixed-case tag, but `loadSettings` assigns
   * `data.json` straight through, so a hand edit or an older build can. The row counted the raw
   * array while the confirm counted the normalized set it actually dismisses, so the two numbers
   * disagreed — "4 proposals waiting" opening a sheet that offered to dismiss 2, then clearing all
   * four. A row whose only job is to state its own reach cannot understate it.
   */
  it("counts the same number in the row and the sheet when settings hold duplicates", () => {
    const { tab } = settingTab({
      settings: {
        activeVocabulary: ["idea"],
        proposedTags: ["design", "Design", "  #PACKING  ", "packing", ""],
      },
    });
    tab.display();
    open(tab, entry(1));

    expect(proposedSection(tab)).toEqual(["#design", "#packing", "2 proposals waiting"]);
    press(tab, "2 proposals waiting", "Dismiss all");
    expect(sheetText()).toContain("Dismiss 2 proposals?");
    dismissSheet();
  });

  it("activates a tag found in the vault and updates the main-screen count", async () => {
    const { tab } = settingTab({
      settings: { activeVocabulary: ["idea"] },
      vaultTags: ["gardening"],
    });
    tab.display();
    expect(destinationNames(tab)).toContain(entry(1));

    open(tab, entry(1));
    expect(tab.containerEl.textContent).toContain("Found in your vault");
    press(tab, "#gardening", "Activate");
    await flush();

    // The re-render keeps the user on the screen they were reading.
    expect(inDestination(tab)).toBe(true);
    // Promoted: the row now wears the Active toggle instead of an Activate button.
    expect(row(tab, "#gardening").querySelector(".checkbox-container")).not.toBeNull();

    tab.hide();
    tab.display();
    expect(destinationNames(tab)).toContain(entry(2));
  });

  it("says so when every tag the vault uses is already active", () => {
    const { tab } = settingTab({
      settings: { activeVocabulary: ["gardening", "cooking"] },
      vaultTags: ["gardening", "cooking"],
    });
    tab.display();
    open(tab, entry(2));

    // The ranking is non-empty but every entry is filtered out as already active, so the
    // "Found in your vault" heading would otherwise sit over nothing.
    expect(rowNames(tab).filter((name) => name.startsWith("#")).sort()).toEqual([
      "#cooking",
      "#gardening",
    ]);
    expect(tab.containerEl.textContent).toContain("Every tag your vault uses is already active.");
  });

  it("keeps the never-tagged empty state distinct from the all-active one", () => {
    const { tab } = settingTab({ settings: { activeVocabulary: ["idea"] }, vaultTags: [] });
    tab.display();
    open(tab, entry(1));

    expect(tab.containerEl.textContent).toContain("No tags found in vault yet.");
  });

  it("deactivates an active tag from its toggle", async () => {
    const { tab } = settingTab({ settings: { activeVocabulary: ["idea", "watch"] } });
    tab.display();
    open(tab, entry(2));
    flip(tab, "#idea");
    await flush();

    expect(inDestination(tab)).toBe(true);
    expect(rowNames(tab)).not.toContain("#idea");
    expect(rowNames(tab)).toContain("#watch");
  });

  it("normalizes a custom tag before adding it", async () => {
    const { tab } = settingTab({ settings: { activeVocabulary: [] } });
    tab.display();
    open(tab, entry(0));
    fill(tab, "Add a custom tag", "  #Health  ");
    press(tab, "Add a custom tag", "Add to Active");
    await flush();

    expect(inDestination(tab)).toBe(true);
    expect(rowNames(tab)).toContain("#health");
  });

  it("ignores an empty custom tag", async () => {
    const { tab } = settingTab({ settings: { activeVocabulary: ["idea"] } });
    tab.display();
    open(tab, entry(1));
    fill(tab, "Add a custom tag", "   #  ");
    press(tab, "Add a custom tag", "Add to Active");
    await flush();

    expect(rowNames(tab).filter((name) => name.startsWith("#"))).toEqual(["#idea"]);
  });
});

/**
 * U5 — the three permanent acknowledgment rows are gone; consent is a sheet at enable time.
 *
 * Ordered decline → dismissal → withdrawal → happy path on purpose. The happy path is the one
 * that would pass by accident: the toggle has already flipped visually by the time the sheet
 * opens, so every path that is *not* an explicit accept is the one that can silently enable
 * egress, cloud storage, or vault writes.
 */
describe("consent sheets", () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const SESSION: PlusSession = {
    sessionToken: "sess_live",
    email: "user@example.com",
    status: "active",
    remaining: 12,
    periodEnd: "2026-09-01T00:00:00.000Z",
  };

  /** A tab with an Atoms Plus session, because the Ask section renders only behind one. */
  function askTab(settings: Partial<LinkerSettings> = {}, local: Record<string, unknown> = {}) {
    const made = settingTab({ session: SESSION, settings, local });
    made.tab.display();
    return made;
  }

  /**
   * The same tab, standing where U6 put every passive record.
   *
   * The switches that grant these consents stayed on the main screen and the records moved to
   * Privacy, so a case about a *record* has to walk in. `openPrivacy` throws when the entry row
   * is absent, which is the assertion these cases care most about: the way out has to be
   * reachable whenever a grant is live (KTD6).
   */
  function recordsTab(
    settings: Partial<LinkerSettings> = {},
    local: Record<string, unknown> = {},
  ) {
    const made = settingTab({ session: SESSION, settings, local });
    openPrivacy(made.tab);
    return made;
  }

  /** What the plugin double persisted, read back the way the tab wrote it. */
  const persisted = (tab: AtomsSettingTab) => tab.plugin.settings;

  const ASK_PRIVACY_ACK_ROW = "What Ask stores and shares";
  const ASK_WRITE_ACK_ROW = "Vault write acknowledgment";

  describe("declining", () => {
    it("leaves auto-run off and writes no egress ack", async () => {
      const { tab, local } = askTab();
      flip(tab, "File automatically when Obsidian opens");
      await flush();

      expect(sheetOpen()).toBe(true);
      pressSheet("Cancel");
      await flush();

      expect(sheetOpen()).toBe(false);
      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(EGRESS_ACK_VERSION);
      expect(local.get(LS_AUTO_RUN_ENABLED)).not.toBe(true);
      expect(row(tab, "File automatically when Obsidian opens").querySelector(".is-enabled")).toBeNull();
    });

    it("leaves the Ask mirror off and writes no privacy ack", async () => {
      const { tab } = askTab();
      flip(tab, "Ask mirror");
      await flush();
      pressSheet("Cancel");
      await flush();

      expect(persisted(tab).askPrivacyAckAt).toBe("");
      expect(persisted(tab).askEnabled).toBe(false);
    });

    it("leaves filing off and writes no vault-write ack", async () => {
      const { tab } = askTab({ ...PRIVACY_GRANTED, askEnabled: true });
      flip(tab, "Allow filing from Claude or ChatGPT");
      await flush();
      pressSheet("Cancel");
      await flush();

      expect(persisted(tab).askWriteAckAt).toBe("");
    });
  });

  describe("dismissing", () => {
    it("treats Escape or a click outside as a decline on every sheet", async () => {
      const { tab, local } = askTab({ ...PRIVACY_GRANTED, askEnabled: true });

      flip(tab, "File automatically when Obsidian opens");
      await flush();
      dismissSheet();
      await flush();
      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(EGRESS_ACK_VERSION);
      expect(local.get(LS_AUTO_RUN_ENABLED)).not.toBe(true);

      flip(tab, "Allow filing from Claude or ChatGPT");
      await flush();
      dismissSheet();
      await flush();
      expect(persisted(tab).askWriteAckAt).toBe("");
    });

    it("treats a privacy sheet dismissal as a decline", async () => {
      const { tab } = askTab();
      flip(tab, "Ask mirror");
      await flush();
      dismissSheet();
      await flush();

      expect(persisted(tab).askPrivacyAckAt).toBe("");
      expect(persisted(tab).askEnabled).toBe(false);
    });

    it("closes an open sheet when the settings tab closes, writing no ack", async () => {
      const { tab } = askTab();
      flip(tab, "Ask mirror");
      await flush();

      tab.hide();
      await flush();

      expect(sheetOpen()).toBe(false);
      expect(persisted(tab).askPrivacyAckAt).toBe("");
      expect(persisted(tab).askEnabled).toBe(false);
    });
  });

  describe("the acknowledgment record", () => {
    it("shows the egress ack even while auto-run is off, and still offers Review", () => {
      const { tab } = recordsTab(
        {},
        { [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION, [LS_AUTO_RUN_ENABLED]: false },
      );

      expect(rowNames(tab)).toContain("What Atoms sends to Anthropic");
      press(tab, "What Atoms sends to Anthropic", "Review");
      expect(sheetText()).toContain("Withdraw acknowledgment");
    });

    /**
     * The upgrade state U6 nearly stranded: a legacy ack *plus* a granted catch-up notice.
     *
     * Invalidating the stamp does not revoke the notice — `readEgressPermitted` honors it on
     * every catch-up pass, including the unattended one a foreground resume runs. So the grant
     * survives the upgrade and keeps spending. Gating this row on the stamp alone would take
     * away the one surface that withdraws that grant, leaving the user paying for a consent
     * they cannot reach. The row has to key on either grant, and say which one it is.
     */
    it("still offers Review when only the catch-up notice is granted", () => {
      const { tab, local } = recordsTab({}, {
        [LS_AUTO_RUN_EGRESS_ACK]: true,
        [LS_AUTO_RUN_ENABLED]: true,
        [LS_EGRESS_NOTICE]: true,
      });
      const load = (key: string) => local.get(key) ?? null;

      // Asserted open first: a `false` after withdrawal proves nothing if the gate was shut all
      // along. The notice is what still permits the paid catch-up path here.
      expect(readEgressPermitted(load, { catchUp: true })).toBe(true);

      expect(rowNames(tab)).toContain("What Atoms sends to Anthropic");
      // The row must not claim they acknowledged wording they never saw.
      expect(row(tab, "What Atoms sends to Anthropic").textContent).toContain("earlier wording");

      press(tab, "What Atoms sends to Anthropic", "Review");
      pressSheet("Withdraw acknowledgment");

      expect(readEgressPermitted(load, { catchUp: true })).toBe(false);
      expect(readEgressPermitted(load, { catchUp: false })).toBe(false);
    });

    /**
     * U6 / KTD4 — the half of #315 the wording fix cannot reach.
     *
     * A device that accepted through the old home modal stores a bare `true`: consent to
     * *something*, recorded against no wording at all. Reporting that as "Acknowledged on this
     * device" under the current disclosure is the lie the issue names, so a legacy stamp has to
     * read as unacknowledged — no row, toggle off, and the next enable poses the sheet again.
     */
    it("does not report a legacy ack as acknowledged, and re-prompts instead", async () => {
      const { tab, local } = askTab({}, {
        [LS_AUTO_RUN_EGRESS_ACK]: true,
        [LS_AUTO_RUN_ENABLED]: true,
      });

      // The record is on Privacy since U6 and the toggle stayed on main, so this case spans the
      // two: no record to find, then a grant made where grants are made, then a record.
      openPrivacy(tab);
      expect(rowNames(tab)).not.toContain("What Atoms sends to Anthropic");

      tab.hide();
      tab.display();
      expect(
        row(tab, "File automatically when Obsidian opens").querySelector(".is-enabled"),
      ).toBeNull();

      flip(tab, "File automatically when Obsidian opens");
      await flush();
      expect(sheetOpen()).toBe(true);
      pressSheet("I understand");
      await flush();

      // Accepting once replaces the wordless record with one that names what was shown.
      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).toBe(EGRESS_ACK_VERSION);
      openPrivacy(tab);
      expect(rowNames(tab)).toContain("What Atoms sends to Anthropic");
    });

    it("shows the Ask privacy ack even while the mirror is off", () => {
      const { tab } = recordsTab({ ...PRIVACY_GRANTED, askEnabled: false });

      expect(rowNames(tab)).toContain("What Ask stores and shares");
      expect(row(tab, "What Ask stores and shares").textContent).toContain("2026-08-01");
    });

    it("keeps both Ask acks reviewable after signing out of Plus", async () => {
      // Signing out deliberately leaves both acks on record. A consent on record with no way
      // out is not withdrawable at all — and signing into a *different* Plus account would
      // resume mirroring under it.
      const { tab } = settingTab({
        session: null,
        settings: { ...PRIVACY_GRANTED, ...WRITE_GRANTED, askEnabled: true },
      });
      // Signed out there is no session disjunct, so the Privacy entry renders on the acks alone
      // — which is exactly the reachability KTD6 exists to hold. `openPrivacy` throws otherwise.
      openPrivacy(tab);

      expect(rowNames(tab)).toContain(ASK_PRIVACY_ACK_ROW);
      expect(rowNames(tab)).toContain(ASK_WRITE_ACK_ROW);

      press(tab, ASK_PRIVACY_ACK_ROW, "Review");
      pressSheet("Withdraw acknowledgment");
      await flush();

      expect(persisted(tab).askPrivacyAckAt).toBe("");
      expect(persisted(tab).askWriteAckAt).toBe("");
      expect(persisted(tab).askEnabled).toBe(false);
    });

    it("keeps no acknowledgment row for an ack that was never granted", () => {
      const { tab } = recordsTab();

      expect(rowNames(tab)).not.toContain("What Atoms sends to Anthropic");
      expect(rowNames(tab)).not.toContain("What Ask stores and shares");
      expect(rowNames(tab)).not.toContain("Vault write acknowledgment");
    });
  });

  describe("withdrawing", () => {
    it("clears the egress ack and force-disables auto-run", async () => {
      const { tab, local } = recordsTab({}, {
        [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
        [LS_AUTO_RUN_ENABLED]: true,
      });
      press(tab, "What Atoms sends to Anthropic", "Review");
      pressSheet("Withdraw acknowledgment");
      await flush();

      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(EGRESS_ACK_VERSION);
      expect(local.get(LS_AUTO_RUN_ENABLED)).not.toBe(true);
    });

    it("revokes the catch-up notice too, so no device-local path is still permitted", async () => {
      // Both booleans granted: the auto-run ack from this row, and the catch-up notice from the
      // "Got it" card on Atoms home. Withdrawing here has to answer for both, because the
      // disclosure this row shows names "Sync everything now" — the button the notice permits.
      const { tab, local } = recordsTab(
        {},
        {
          [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
          [LS_AUTO_RUN_ENABLED]: true,
          [LS_EGRESS_NOTICE]: true,
        },
      );
      const load = (key: string) => local.get(key) ?? null;
      // Asserted open first: two `false`s taken only after a withdrawal cannot tell a withdrawal
      // that worked from a gate that never opened, and a gate stuck shut fails closed — quietly,
      // for everyone who acked.
      expect(readEgressPermitted(load, { catchUp: false })).toBe(true);

      press(tab, "What Atoms sends to Anthropic", "Review");
      pressSheet("Withdraw acknowledgment");
      await flush();

      expect(readEgressPermitted(load, { catchUp: false })).toBe(false);
      // The manual catch-up path is the one the withdrawn disclosure named by name.
      expect(readEgressPermitted(load, { catchUp: true })).toBe(false);
    });

    it("clears the vault-write ack when the privacy ack is withdrawn", async () => {
      const { tab } = recordsTab({
        ...PRIVACY_GRANTED,
        askEnabled: true,
        ...WRITE_GRANTED,
      });
      press(tab, "What Ask stores and shares", "Review");
      pressSheet("Withdraw acknowledgment");
      await flush();

      expect(persisted(tab).askPrivacyAckAt).toBe("");
      expect(persisted(tab).askEnabled).toBe(false);
      expect(persisted(tab).askWriteAckAt).toBe("");
    });

    it("clears the vault-write ack when the mirror is turned off", async () => {
      const { tab } = askTab({
        ...PRIVACY_GRANTED,
        askEnabled: true,
        ...WRITE_GRANTED,
      });
      flip(tab, "Ask mirror");
      await flush();

      expect(persisted(tab).askEnabled).toBe(false);
      expect(persisted(tab).askWriteAckAt).toBe("");
    });

    it("withdraws the vault-write ack on its own without touching the privacy ack", async () => {
      const { tab } = recordsTab({
        ...PRIVACY_GRANTED,
        askEnabled: true,
        ...WRITE_GRANTED,
      });
      press(tab, "Vault write acknowledgment", "Review");
      pressSheet("Withdraw acknowledgment");
      await flush();

      expect(persisted(tab).askWriteAckAt).toBe("");
      expect(persisted(tab).askPrivacyAckAt).toBe(ACKED);
      expect(persisted(tab).askEnabled).toBe(true);
    });

    it("cannot be undone by a handler still holding the ack it rendered with", async () => {
      const { tab } = askTab({ ...PRIVACY_GRANTED, askEnabled: false });
      // The mirror toggle as a half-finished gesture holds it: live when the user reached for
      // it, and about to be replaced by the withdrawal on the row below.
      const stale = row(tab, "Ask mirror").querySelector(".checkbox-container");
      if (!(stale instanceof HTMLElement)) throw new Error("no Ask mirror toggle");

      // Walking to the record is what makes the toggle stale in the first place now: the switch
      // is on the screen the user just left, and its handler outlives the DOM it was built on.
      open(tab, "Privacy and consents");
      press(tab, "What Ask stores and shares", "Review");
      pressSheet("Withdraw acknowledgment");
      await flush();

      stale.click();
      await flush();

      // The consent is gone, so the toggle has nothing to enable the mirror on.
      expect(persisted(tab).askPrivacyAckAt).toBe("");
      expect(persisted(tab).askEnabled).toBe(false);
    });

    it("beats an enable whose save was still in flight, and its push with it", async () => {
      let release!: () => void;
      const pendingSave = new Promise<void>((resolve) => {
        release = resolve;
      });
      let pushes = 0;
      const { tab } = settingTab({
        session: SESSION,
        settings: { ...PRIVACY_GRANTED, askEnabled: false },
        plugin: {
          saveSettings: () => pendingSave,
          syncAskMirror: () => {
            pushes += 1;
            return Promise.resolve({ ok: true, message: "" });
          },
        },
      });
      tab.display();

      // Enable, then withdraw while the enable is still waiting on its own write to disk. The
      // withdrawal is a screen away since U6, which only widens the window this guards.
      flip(tab, "Ask mirror");
      open(tab, "Privacy and consents");
      press(tab, "What Ask stores and shares", "Review");
      pressSheet("Withdraw acknowledgment");
      release();
      await flush();

      expect(tab.plugin.settings.askPrivacyAckAt).toBe("");
      expect(tab.plugin.settings.askEnabled).toBe(false);
      // The push is the egress. It must not leave under a consent already withdrawn.
      expect(pushes).toBe(0);
    });

    it("keeps filing disabled while the Ask mirror is off", () => {
      const { tab } = askTab({ ...PRIVACY_GRANTED, askEnabled: false });

      expect(
        row(tab, "Allow filing from Claude or ChatGPT").querySelector(".is-disabled"),
      ).not.toBeNull();
    });
  });

  describe("accepting", () => {
    it("writes the egress ack and enables auto-run", async () => {
      const { tab, local } = askTab();
      flip(tab, "File automatically when Obsidian opens");
      await flush();

      expect(sheetText()).toContain("Anthropic");
      pressSheet("I understand");
      await flush();

      // The stamp, not `true` — the record names the wording the sheet just showed (U6/KTD4).
      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).toBe(EGRESS_ACK_VERSION);
      expect(local.get(LS_AUTO_RUN_ENABLED)).toBe(true);
      // R7: an egress accept authorizes nothing on the Ask side — neither ack, and not the
      // mirror those acks gate.
      expect(persisted(tab).askPrivacyAckAt).toBe("");
      expect(persisted(tab).askWriteAckAt).toBe("");
      expect(persisted(tab).askEnabled).toBe(false);
    });

    it("writes the privacy ack and enables the mirror, and nothing else", async () => {
      const { tab, local } = askTab();
      flip(tab, "Ask mirror");
      await flush();
      pressSheet("I understand");
      await flush();

      expect(persisted(tab).askPrivacyAckAt).not.toBe("");
      expect(persisted(tab).askEnabled).toBe(true);
      // R7: agreeing to cloud storage does not authorize writes into the vault, or egress —
      // neither the ack for it nor the unattended runs it would permit.
      expect(persisted(tab).askWriteAckAt).toBe("");
      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(EGRESS_ACK_VERSION);
      expect(local.get(LS_AUTO_RUN_ENABLED)).not.toBe(true);
    });

    it("writes the vault-write ack and nothing else", async () => {
      const { tab, local } = askTab({ ...PRIVACY_GRANTED, askEnabled: true });
      flip(tab, "Allow filing from Claude or ChatGPT");
      await flush();
      pressSheet("I understand");
      await flush();

      expect(persisted(tab).askWriteAckAt).not.toBe("");
      // R7: the privacy ack is untouched — it was already granted, and stays exactly as granted.
      expect(persisted(tab).askPrivacyAckAt).toBe(ACKED);
      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(EGRESS_ACK_VERSION);
    });
  });

  it("keeps no permanent acknowledgment toggle on the screen", () => {
    const { tab } = askTab();

    expect(rowNames(tab)).not.toContain("Privacy acknowledgment");
    expect(rowNames(tab)).not.toContain("What Atoms sends to Anthropic");
  });
});

/** A signed-in Plus session, since Ask plumbing renders only behind one. */
const PLUS_SESSION: PlusSession = {
  sessionToken: "sess_live",
  email: "user@example.com",
  status: "active",
  remaining: 12,
  periodEnd: "2026-09-01T00:00:00.000Z",
  // #508: stamped with the base an empty `plusBaseUrl` resolves to, which is
  // what a hosted session carries from sign-in onward.
  issuedBase: "https://plus.tryatoms.app" as IssuedBase,
  verifiedBase: "https://plus.tryatoms.app",
};

/**
 * U6 — the Anthropic API key row answers the question the deleted *Test connection* row used to:
 * does this key work from this device? Four outcomes, not a boolean, because "wrong key" and
 * "no network" want opposite things from the user.
 */
describe("API key row (U6)", () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const KEY = "sk-ant-api03-looks-real-enough";

  /** A request double that records what was asked for and answers Anthropic a fixed way. */
  function network(anthropic: number | "offline") {
    const urls: string[] = [];
    const request: ConnectivityRequest = async (params) => {
      urls.push(params.url);
      if (anthropic === "offline") throw new Error("net::ERR_INTERNET_DISCONNECTED");
      const status = params.url.includes("anthropic") ? anthropic : 200;
      return { status, text: "", json: {}, arrayBuffer: new ArrayBuffer(0), headers: {} } as never;
    };
    const anthropicCalls = () => urls.filter((u) => u.includes("anthropic")).length;
    return { request, anthropicCalls };
  }

  /** Everything the API key row says, status text included. */
  const keyRowText = (tab: AtomsSettingTab) =>
    row(tab, "Anthropic API key").textContent ?? "";

  /**
   * The screen the key row lives on since U4. It is a destination now, not a main-screen
   * section, so every one of these has to walk in — which is also what makes the row's check
   * cost nothing until somebody is actually looking at the key.
   */
  function engineTab(opts: SettingTabOptions) {
    const made = settingTab(opts);
    made.tab.display();
    open(made.tab, "Filing");
    // The key row moved one screen deeper, so the walk is one tap longer. The point of the walk
    // is unchanged: the check costs nothing until somebody is actually looking at the key.
    open(made.tab, "Use your own Anthropic key");
    return made;
  }

  it("reports a malformed key inline, without claiming success or asking the network", async () => {
    const net = network(200);
    const { tab } = engineTab({ apiKey: "hunter2", request: net.request });
    await flush();

    expect(keyRowText(tab)).toContain("does not look like an Anthropic API key");
    expect(keyRowText(tab)).not.toContain("works");
    expect(net.anthropicCalls()).toBe(0);
  });

  it("distinguishes a key it could not check from a key that was rejected", async () => {
    const offline = engineTab({ apiKey: KEY, request: network("offline").request });
    await flush();

    const rejected = engineTab({ apiKey: KEY, request: network(401).request });
    await flush();

    expect(keyRowText(offline.tab)).toContain("Could not reach Anthropic");
    expect(keyRowText(offline.tab)).not.toContain("rejected");
    expect(keyRowText(rejected.tab)).toContain("rejected");
    expect(keyRowText(rejected.tab)).not.toContain("Could not reach Anthropic");
  });

  it("says the key works when Anthropic answers", async () => {
    const { tab } = engineTab({ apiKey: KEY, request: network(200).request });
    await flush();

    expect(keyRowText(tab)).toContain("works");
  });

  it("shows a checking state while the network check is in flight", async () => {
    const { tab } = engineTab({ apiKey: KEY, request: network(200).request });

    // Before the probes settle: neither terminal outcome, and visibly in progress.
    expect(keyRowText(tab)).toContain("Checking");
    expect(keyRowText(tab)).not.toContain("works");
    expect(keyRowText(tab)).not.toContain("Could not reach");

    await flush();
    expect(keyRowText(tab)).toContain("works");
  });

  it("re-verifies a key already saved, with no re-entry", async () => {
    const net = network(200);
    const { tab } = engineTab({ apiKey: KEY, request: net.request });
    await flush();

    expect(net.anthropicCalls()).toBe(1);
    expect(keyRowText(tab)).toContain("works");
  });

  it("does not re-check on every redisplay", async () => {
    const net = network(200);
    const { tab } = engineTab({ apiKey: KEY, request: net.request });
    await flush();

    // Any toggle on the screen re-renders the whole tab.
    for (let i = 0; i < 3; i += 1) {
      flip(tab, "Device-local key fallback");
      await flush();
    }

    expect(net.anthropicCalls()).toBe(1);
    expect(keyRowText(tab)).toContain("works");
  });

  it("re-checks on the next visit to Settings", async () => {
    const net = network(200);
    const { tab } = engineTab({ apiKey: KEY, request: net.request });
    await flush();
    expect(net.anthropicCalls()).toBe(1);

    tab.hide();
    tab.display();
    open(tab, "Filing");
    open(tab, "Use your own Anthropic key");
    await flush();

    expect(net.anthropicCalls()).toBe(2);
  });

  it("costs nothing to open Settings — no baseline ping, and no billable request", async () => {
    const seen: Array<{ url: string; body?: unknown }> = [];
    const request: ConnectivityRequest = async (params) => {
      seen.push({ url: params.url, body: params.body });
      return { status: 200, text: "", json: {}, arrayBuffer: new ArrayBuffer(0), headers: {} } as never;
    };
    const made = settingTab({ apiKey: KEY, request });
    made.tab.display();
    await flush();

    // Since U4 the main screen holds no key row, so opening Settings asks nothing at all — the
    // check is a cost the user opts into by walking to the screen that shows the key.
    expect(seen).toEqual([]);

    open(made.tab, "Filing");
    await flush();
    // Still nothing: the decision screen has no key row to check since the credential form moved.
    expect(seen).toEqual([]);

    open(made.tab, "Use your own Anthropic key");
    await flush();

    // The GitHub baseline answers a question this row never asks — it reads the Anthropic
    // probe alone — so on this path it is pure egress for nothing.
    expect(seen.filter((r) => r.url.includes("api.github.com"))).toEqual([]);

    const anthropic = seen.filter((r) => r.url.includes("anthropic"));
    expect(anthropic).toHaveLength(1);
    const body = JSON.parse(String(anthropic[0]?.body ?? "{}")) as Record<string, unknown>;
    // Rejected at validation rather than answered: a request that reaches Anthropic proves the
    // key without buying tokens. A real one bills the user for every visit to Settings.
    expect(body.messages).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });

  it("keeps no standalone Test connection row on any screen", () => {
    const { tab } = settingTab({ session: PLUS_SESSION });
    tab.display();
    const screens = destinationNames(tab);
    expect(rowNames(tab)).not.toContain("Test connection");

    for (const destination of screens) {
      const fresh = settingTab({ session: PLUS_SESSION });
      fresh.tab.display();
      open(fresh.tab, destination);
      expect(rowNames(fresh.tab)).not.toContain("Test connection");
    }
  });
});

/**
 * Two rows on the main screen that the row grammar has to own rather than hand-roll: the one
 * that starts a full sync (a double-tap used to start a second one on top of the first), and
 * the teardown path that used to rebuild the whole screen on the way out.
 */
describe("closing Settings", () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const KEY = "sk-ant-api03-looks-real-enough";

  it("runs one full sync per press, not one per tap", async () => {
    let started = 0;
    let finish!: () => void;
    const { tab } = settingTab({
      plugin: {
        runSyncEverythingNow: () => {
          started += 1;
          return new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
      },
    });
    openAdvanced(tab);

    // A full sync is long enough that an impatient second tap lands while the first is going.
    press(tab, "Sync everything now", "Sync everything now");
    press(tab, "Sync everything now", "Sync everything now");

    expect(started).toBe(1);

    finish();
    await flush();

    // And the row comes back rather than staying dead after the run.
    press(tab, "Sync everything now", "Sync everything now");
    expect(started).toBe(2);
  });

  it("stays gone when a continuation lands after the tab is closed", async () => {
    let release!: () => void;
    const pendingSave = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { tab } = settingTab({
      session: PLUS_SESSION,
      settings: { ...PRIVACY_GRANTED, askEnabled: true },
      plugin: { saveSettings: () => pendingSave },
    });
    tab.display();
    await flush();

    // A gesture that waits on something — here a write to disk, in the app a network round
    // trip — and a user who leaves Settings before it comes back.
    flip(tab, "Ask mirror");

    // A marker only a render can remove: `display()` empties `containerEl` before it builds, so
    // this survives exactly as long as nothing re-renders. It replaces the Anthropic probe this
    // used to count, which stopped witnessing main-screen renders once U4 moved the key row to
    // the engine screen. Placed after the flip, so what it witnesses is the continuation alone.
    const marker = tab.containerEl.createDiv();

    tab.hide();
    release();
    await flush();

    // Nothing re-renders for a tab that is gone.
    expect(marker.parentElement).toBe(tab.containerEl);
  });

  it("declines an open sheet without rebuilding the screen it is leaving", async () => {
    const { tab } = settingTab({ session: PLUS_SESSION });
    tab.display();
    await flush();

    flip(tab, "Ask mirror");
    await flush();
    expect(sheetOpen()).toBe(true);

    // Same render witness as above: `display()` empties the container, so a surviving child
    // means no rebuild happened.
    const marker = tab.containerEl.createDiv();

    tab.hide();
    await flush();

    // The decline still happens: no ack, mirror still off.
    expect(sheetOpen()).toBe(false);
    expect(tab.plugin.settings.askPrivacyAckAt).toBe("");
    expect(tab.plugin.settings.askEnabled).toBe(false);
    // But nothing re-renders on the way out: the screen the user just closed is not rebuilt on
    // its way to being thrown away.
    expect(marker.parentElement).toBe(tab.containerEl);
  });
});

/**
 * U5 — leg three as two groups. Atoms home needs nothing and says so; Ask needs a session and
 * two consents, and says *that* without naming a price or a self-hosted server (R13).
 */
describe("the Resurface leg (U5)", () => {
  const ASK_OFF_ROW = "Ask in Claude and ChatGPT";

  it("renders Atoms home and Ask as two groups, in that order", () => {
    const { tab } = settingTab();
    tab.display();

    expect(groupHeaders(tab)).toEqual([
      "Get started",
      "1 · Capture",
      "2 · File",
      "3 · Resurface",
      "Ask",
      "Your data",
      "Atoms Plus",
    ]);
  });

  it("opens the home view, and gets the settings modal out of its way", () => {
    const { tab, calls } = settingTab();
    tab.display();

    open(tab, "Atoms home");

    expect(calls).toContain("activateAtomsHome");
    // Still on the settings screen as far as the tab is concerned: this row leaves the modal
    // rather than walking to another route, so nothing here should have re-routed.
    expect(tab.containerEl.querySelector(".atoms-setting-back")).toBeNull();
  });

  it("says there is nothing to set up, because there is not", () => {
    const { tab } = settingTab();
    tab.display();

    expect(prose(tab)).toContain(
      "Nothing to set up. Atoms home brings old thoughts back on its own: something from this day last year, or a note that connects to what you just filed.",
    );
  });

  describe("signed out", () => {
    it("is one row reading Off, with no consent toggles to reach", () => {
      const { tab } = settingTab();
      tab.display();

      const rows = rowNames(tab, { headings: false });
      expect(rows).toContain(ASK_OFF_ROW);
      expect(rows).not.toContain("Ask mirror");
      expect(rows).not.toContain("Allow filing from Claude or ChatGPT");
      expect(rows).not.toContain("Connect Claude or ChatGPT");
      expect(row(tab, ASK_OFF_ROW).textContent).toContain("Off");
    });

    it("names a session from the Atoms service, never a subscription or a price", () => {
      const { tab } = settingTab();
      tab.display();

      expect(prose(tab)).toContain(
        "Claude and ChatGPT can search your atoms once a copy of them is online. That copy needs a session from the Atoms service.",
      );
      const text = tab.containerEl.textContent ?? "";
      expect(text).not.toContain("subscription");
      expect(text).not.toMatch(/\$\d/);
    });

    it("stops naming a heading that no longer exists", () => {
      const { tab } = settingTab();
      tab.display();

      // U3 retired the `Atoms Plus` heading this sentence pointed at. A direction to somewhere
      // "above" outlives the thing above it in silence, which is why it is gone rather than
      // reworded.
      expect(tab.containerEl.textContent).not.toContain("Sign in to Atoms Plus above");
    });

    it("keeps a withdrawal reachable for an ack still on record", () => {
      const { tab } = settingTab({ settings: { ...PRIVACY_GRANTED } });
      openPrivacy(tab);

      // No session, but a live grant: R7 wants the way out reachable whenever one exists, and
      // signing out deliberately leaves the record standing so signing back in does not re-ask.
      // Since U6 the way out is the Privacy screen, which `openPrivacy` throws if it cannot find.
      expect(rowNames(tab, { headings: false })).toContain(ASK_PRIVACY_ACK_TITLE);
    });
  });

  describe("signed in", () => {
    it("renders both switches, with vault-write held until the privacy ack is current", () => {
      const { tab } = settingTab({ session: PLUS_SESSION });
      tab.display();

      const rows = rowNames(tab, { headings: false });
      expect(rows).toContain("Ask mirror");
      expect(rows).toContain("Allow filing from Claude or ChatGPT");
      expect(rows).not.toContain(ASK_OFF_ROW);

      const write = row(tab, "Allow filing from Claude or ChatGPT").querySelector(
        ".checkbox-container",
      );
      expect(write?.classList.contains("is-disabled")).toBe(true);
    });

    it("shows a failing mirror as failing on the entry row, not only one screen in", () => {
      const failing = settingTab({
        session: PLUS_SESSION,
        settings: { askEnabled: true, ...PRIVACY_GRANTED },
        local: { [LS_ASK_MIRROR_LAST_ERROR]: "429 rate limited" },
      });
      failing.tab.display();

      const healthy = settingTab({
        session: PLUS_SESSION,
        settings: { askEnabled: true, ...PRIVACY_GRANTED },
      });
      healthy.tab.display();

      const entry = (t: AtomsSettingTab) => row(t, "Connect Claude or ChatGPT");
      expect(entry(failing.tab).querySelector(".atoms-ask-mirror-error")).not.toBeNull();
      expect(entry(healthy.tab).querySelector(".atoms-ask-mirror-error")).toBeNull();
    });

    it("promises only what the mirror does, and never that it reads the vault", () => {
      const { tab } = settingTab({ session: PLUS_SESSION });
      tab.display();

      expect(prose(tab)).toContain(
        "Claude and ChatGPT read that cloud copy, never your vault.",
      );
    });
  });

  it("writes no em dash into any main-screen prose", () => {
    const { tab } = settingTab({ session: PLUS_SESSION });
    tab.display();

    for (const line of prose(tab)) expect(line).not.toContain("—");
  });
});

/**
 * U6 — the Privacy destination, and the union that decides whether it exists.
 *
 * Its render condition is the whole unit. Every disjunct is a grant that outlives the others, so
 * a screen gated on the wrong one takes away the only surface that can revoke what is still
 * live. These are written open-then-closed per the plan's execution note: a walk over rendered
 * rows cannot catch a required row that renders zero times.
 */
describe("the Privacy destination (U6)", () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const ENTRY = "Privacy and consents";
  const EGRESS_RECORD = "What Atoms sends to Anthropic";
  const NO_SESSION = { session: null } as const;

  /** Whether the entry row is on the main screen at all, which is the reachability question. */
  function entryRenders(opts: SettingTabOptions): boolean {
    const { tab } = settingTab(opts);
    tab.display();
    return destinationNames(tab).includes(ENTRY);
  }

  describe("each grant alone keeps the way out reachable", () => {
    const ALONE: Array<[string, SettingTabOptions, string]> = [
      [
        "the egress ack",
        { ...NO_SESSION, local: { [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION } },
        EGRESS_RECORD,
      ],
      [
        "the catch-up notice, with no egress stamp at all",
        { ...NO_SESSION, local: { [LS_EGRESS_NOTICE]: true } },
        EGRESS_RECORD,
      ],
      [
        "the Ask privacy ack, with no egress grant",
        { ...NO_SESSION, settings: { ...PRIVACY_GRANTED } },
        ASK_PRIVACY_ACK_TITLE,
      ],
      [
        "the Ask vault-write ack, with no egress grant",
        { ...NO_SESSION, settings: { ...WRITE_GRANTED } },
        "Vault write acknowledgment",
      ],
    ];

    it.each(ALONE)("renders under %s, and holds its record", (_name, opts, record) => {
      const { tab } = settingTab(opts);
      openPrivacy(tab);

      expect(rowNames(tab, { headings: false })).toContain(record);
      // And it is reviewable, which is what makes it a withdrawal surface rather than a label.
      expect(buttonLabels(tab, record)).toContain("Review");
    });
  });

  it("renders for a Plus session with nothing acked, so the cloud copy is never stranded", () => {
    const { tab } = settingTab({ session: PLUS_SESSION });
    openPrivacy(tab);

    expect(rowNames(tab, { headings: false })).toContain("Wipe cloud copy");
  });

  it("renders for a known cloud copy with no session and no ack", () => {
    expect(
      entryRenders({ ...NO_SESSION, local: { [LS_ASK_MIRROR_SERVER_COUNT]: "407" } }),
    ).toBe(true);
  });

  it("says the wipe needs a session rather than offering a button that cannot work", () => {
    const { tab } = settingTab({
      ...NO_SESSION,
      local: { [LS_ASK_MIRROR_SERVER_COUNT]: "407" },
    });
    openPrivacy(tab);

    expect(row(tab, "Atoms in the cloud copy").textContent).toContain("407");
    expect(rowNames(tab, { headings: false })).not.toContain("Wipe cloud copy");
    expect(prose(tab).join(" ")).toContain("needs a session");
  });

  it("does not render with no grant, no session, and no cloud copy", () => {
    expect(entryRenders({ ...NO_SESSION })).toBe(false);
  });

  it("counts what is on record, and says so when the answer is none", () => {
    const two = settingTab({
      ...NO_SESSION,
      settings: { ...PRIVACY_GRANTED, ...WRITE_GRANTED },
    });
    two.tab.display();
    expect(row(two.tab, ENTRY).textContent).toContain("2 on record");

    // A session alone puts the row on screen with nothing acked behind it. R20: it declares the
    // empty answer rather than rendering a blank value nobody can interpret.
    const none = settingTab({ session: PLUS_SESSION });
    none.tab.display();
    expect(row(none.tab, ENTRY).textContent).toContain("Nothing on record");
  });

  it("leads with the back row, so leaving never means scrolling", () => {
    const { tab } = settingTab({ session: PLUS_SESSION });
    openPrivacy(tab);

    const back = tab.containerEl.querySelector(".atoms-setting-back");
    expect(back).not.toBeNull();
    expect(tab.containerEl.firstElementChild).toBe(back);
    expect(back?.querySelector(".setting-item-name")?.textContent).toBe(ENTRY);
  });

  it("offers no permanent acknowledgment toggle, here or anywhere", () => {
    const { tab } = settingTab({
      session: PLUS_SESSION,
      settings: { ...PRIVACY_GRANTED, ...WRITE_GRANTED },
      local: { [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION },
    });
    openPrivacy(tab);

    // A record is reviewed through a sheet. A switch would grant or revoke with one tap and no
    // wording on screen, which is the shape the consent sheets replaced.
    for (const name of [EGRESS_RECORD, ASK_PRIVACY_ACK_TITLE, "Vault write acknowledgment"]) {
      expect(row(tab, name).querySelector(".checkbox-container")).toBeNull();
    }
  });

  it("does not shout louder than the switches that granted it (R17)", () => {
    const { tab } = settingTab({
      session: PLUS_SESSION,
      settings: { ...PRIVACY_GRANTED },
      local: { [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION },
    });
    openPrivacy(tab);

    for (const name of [EGRESS_RECORD, ASK_PRIVACY_ACK_TITLE]) {
      const review = Array.from(row(tab, name).querySelectorAll("button")).find(
        (el) => el.textContent === "Review",
      );
      expect(review?.classList.contains("mod-cta")).toBe(false);
    }
    // The destructive row keeps its own weight: it is the one thing here that destroys data.
    const wipe = Array.from(row(tab, "Wipe cloud copy").querySelectorAll("button")).find(
      (el) => el.textContent === "Wipe",
    );
    expect(wipe?.classList.contains("mod-cta")).toBe(false);
  });

  it("says it is empty rather than leaving a back row over nothing", async () => {
    const { tab } = settingTab({ ...NO_SESSION, settings: { ...PRIVACY_GRANTED } });
    openPrivacy(tab);

    press(tab, ASK_PRIVACY_ACK_TITLE, "Review");
    pressSheet("Withdraw acknowledgment");
    await flush();

    // The withdrawal re-renders this screen underneath the user, and there is nothing left on
    // it. A destination holding only a back row reads as broken rather than as finished, so the
    // screen says what happened instead.
    expect(rowNames(tab, { headings: false })).toEqual([ENTRY]);
    expect(groupHeaders(tab)).toEqual([]);
    expect(prose(tab).join(" ")).toContain("Nothing on record");
  });

  it("keeps the frozen egress standing strings exactly as they were", () => {
    // KTD5 freezes these: each names wording a stored ack version was recorded against, and
    // rewording without a bump leaves every device holding a record for text it never saw. U6
    // moved the row and changed none of them, including the one that says "Sync everything now"
    // about a consent that is really for unattended filing.
    const legacy = settingTab({ ...NO_SESSION, local: { [LS_EGRESS_NOTICE]: true } });
    openPrivacy(legacy.tab);
    expect(row(legacy.tab, EGRESS_RECORD).textContent).toContain(
      "Acknowledged on this device for Sync everything now, against earlier wording",
    );

    const stranded = settingTab({
      ...NO_SESSION,
      local: { [LS_AUTO_RUN_EGRESS_ACK]: "2027-01-01", [LS_EGRESS_NOTICE]: true },
    });
    openPrivacy(stranded.tab);
    expect(row(stranded.tab, EGRESS_RECORD).textContent).toContain(
      "Acknowledged on this device for Sync everything now, against different wording",
    );
  });
});

describe("Connect Claude or ChatGPT destination (U6)", () => {
  // `Wipe cloud copy` left this list in U6: it moved to Privacy, beside the count of what it
  // deletes and under a render condition that survives a withdrawal turning the mirror off.
  const CONNECT_ROWS = [
    "MCP connector URL",
    "Link Claude / ChatGPT",
    "Sync now",
    "Cloud mirror status",
  ];

  it("moves the Ask plumbing off the main screen, behind one entry row", () => {
    const { tab } = settingTab({ session: PLUS_SESSION });
    tab.display();

    expect(destinationNames(tab)).toContain("Connect Claude or ChatGPT");
    for (const name of CONNECT_ROWS) expect(rowNames(tab)).not.toContain(name);
  });

  it("holds every moved row", () => {
    const { tab } = settingTab({ session: PLUS_SESSION });
    tab.display();
    open(tab, "Connect Claude or ChatGPT");

    for (const name of CONNECT_ROWS) expect(rowNames(tab)).toContain(name);
  });

  /**
   * #500. This screen is the one place the service URL is handed to somebody
   * else rather than called: it prints the MCP URL and tells the user to paste
   * it into Claude or ChatGPT and complete OAuth there. Withholding the session
   * token is not enough — publishing a refused origin points another agent at
   * it, where whatever the user authorizes is the attacker's to keep.
   */
  it("publishes no MCP URL for a service URL we would not talk to", () => {
    const { tab } = settingTab({
      session: PLUS_SESSION,
      settings: { plusBaseUrl: "http://evil.example" },
    });
    tab.display();
    open(tab, "Connect Claude or ChatGPT");

    expect(tab.containerEl.textContent).not.toContain("evil.example");
    expect(tab.containerEl.textContent).toContain(
      PLUS_BASE_URL_INVALID_MESSAGE,
    );
    expect(rowNames(tab)).not.toContain("MCP connector URL");
  });

  /**
   * #508, the same screen one question further in. `https://plus.tryatoms.app`
   * passes every #500 check; whether *this* session was issued by it is what
   * decides whether its origin may be published for another agent to OAuth
   * against, since `askMcpPair` then sends the session token there.
   */
  it("publishes no MCP URL at a base this session was not issued by", () => {
    // A stamp that names a different server: the refusal proper.
    const { tab } = settingTab({
      session: {
        ...PLUS_SESSION,
        issuedBase: undefined,
        verifiedBase: "https://my.host",
      },
    });
    tab.display();
    open(tab, "Connect Claude or ChatGPT");

    expect(rowNames(tab)).not.toContain("MCP connector URL");
    expect(tab.containerEl.textContent).toContain(PLUS_BASE_REFUSED_MESSAGE);
  });

  it("tells the upgrade cohort to supply an address, not that we distrust one", () => {
    // No stamp and an empty field. "Can't confirm your sign-in at this address"
    // names an address this user never chose; they need to supply one.
    const { tab } = settingTab({
      session: { ...PLUS_SESSION, issuedBase: undefined, verifiedBase: undefined },
    });
    tab.display();
    open(tab, "Connect Claude or ChatGPT");

    expect(rowNames(tab)).not.toContain("MCP connector URL");
    expect(tab.containerEl.textContent).toContain(PLUS_BASE_NEEDS_ADDRESS_MESSAGE);
    expect(tab.containerEl.textContent).not.toContain(PLUS_BASE_REFUSED_MESSAGE);
  });

  it("publishes it again once the stamp names the base in use", () => {
    const { tab } = settingTab({
      session: {
        ...PLUS_SESSION,
        issuedBase: undefined,
        verifiedBase: "https://my.host",
      },
      settings: { plusBaseUrl: "https://my.host/" },
    });
    tab.display();
    open(tab, "Connect Claude or ChatGPT");

    expect(rowNames(tab)).toContain("MCP connector URL");
  });

  it("still asks before wiping the cloud copy", async () => {
    const { tab, calls } = settingTab({
      session: PLUS_SESSION,
      settings: { askEnabled: true, ...PRIVACY_GRANTED },
    });
    openPrivacy(tab);

    press(tab, "Wipe cloud copy", "Wipe");
    expect(sheetOpen()).toBe(true);
    expect(sheetText()).toContain("Wipe cloud copy?");

    dismissSheet();
    // Backing out of the confirmation wipes nothing and persists nothing.
    expect(calls).not.toContain("saveSettings");
  });

  it("asks once on a double-tap, not twice", () => {
    const { tab } = settingTab({
      session: PLUS_SESSION,
      settings: { askEnabled: true, ...PRIVACY_GRANTED },
    });
    openPrivacy(tab);

    // The one destructive row on the screen. Two confirm modals over each other is a question
    // the user answers once and a wipe they authorized once.
    press(tab, "Wipe cloud copy", "Wipe");
    press(tab, "Wipe cloud copy", "Wipe");

    expect(Modal.open).toHaveLength(1);
  });
});

/**
 * Advanced grants nothing. Asserted by exercising whatever rows are actually there rather than
 * by listing their names: a list passes forever, including the day a gate is moved in.
 *
 * The claim used to be stronger — that no row here could *reach* money spend, egress, or vault
 * writes at all — and U7 retired that shape rather than weakening it quietly. This screen now
 * holds `Sync everything now`, whose entire job is to run the pass, so "touches nothing" stopped
 * being a description of the screen. What is still true, and is the thing worth guarding, is that
 * no control here **grants**: nothing writes or clears an acknowledgment, flips `askEnabled`,
 * plants a device-local key, or opens a consent sheet. Every gate the sync button passes through
 * lives in the plugin and is asserted where it lives, which is why the ack keys are what this
 * snapshot watches rather than the call list.
 */
describe("Advanced destination (U7, R4)", () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  function advanced(opts: SettingTabOptions = {}) {
    const made = settingTab({ session: PLUS_SESSION, ...opts });
    made.tab.display();
    open(made.tab, "Advanced");
    return made;
  }

  /**
   * Every gate-bearing value on the device: what enables money spend, egress, or vault writes.
   *
   * The credential path counts. This snapshot once tracked the acks and the toggles alone, and
   * a screen holding the device-local key fallback — which `getApiKey()` falls back to, and
   * which therefore enables Anthropic spend by itself — passed the R5 property test anyway.
   */
  function gateState(tab: AtomsSettingTab, local: Map<string, unknown>) {
    return {
      askEnabled: tab.plugin.settings.askEnabled,
      askPrivacyAckAt: tab.plugin.settings.askPrivacyAckAt,
      // The versions, not the timestamps alone: after #360 the version is what opens the gate,
      // so a screen that wrote a stamp without asking — or left one behind while clearing its
      // timestamp — would pass a timestamp-only snapshot.
      askPrivacyAckVersion: tab.plugin.settings.askPrivacyAckVersion,
      askWriteAckAt: tab.plugin.settings.askWriteAckAt,
      askWriteAckVersion: tab.plugin.settings.askWriteAckVersion,
      autoRunEnabled: local.get(LS_AUTO_RUN_ENABLED),
      egressAcked: local.get(LS_AUTO_RUN_EGRESS_ACK),
      deviceLocalKeyFallback: tab.plugin.settings.useDeviceLocalKeyFallback,
      deviceLocalKey: local.get(LOCAL_STORAGE_API_KEY),
    };
  }

  /**
   * Touch every control on the screen the way a user could: flip it, type in it, press it.
   *
   * The screen is re-queried after each row rather than snapshotted once: a handler that calls
   * `redisplay()` replaces every element, and a snapshot would spend the rest of the run
   * clicking detached nodes while never touching the screen the user is looking at.
   *
   * Rows already exercised are remembered **by name**, not by element identity. Identity was
   * enough until U7 put a redisplaying toggle on this screen: flipping it replaces every element,
   * so an identity set treats the same row as new each pass and the walk flips it forever. A name
   * is what "this control has been touched" actually means, and the set of names is finite, so
   * the walk terminates. Every name on Advanced is unique, which is what makes this sound.
   */
  function exerciseEveryControl(tab: AtomsSettingTab): void {
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      const exercised = new Set<string>();
      for (let guard = 0; guard < 200; guard += 1) {
        const el = Array.from(tab.containerEl.querySelectorAll(".setting-item")).find(
          (candidate) =>
            !candidate.classList.contains("atoms-setting-back") &&
            !exercised.has(candidate.querySelector(".setting-item-name")?.textContent ?? ""),
        );
        if (!el) return;
        exercised.add(el.querySelector(".setting-item-name")?.textContent ?? "");
        for (const toggle of Array.from(el.querySelectorAll(".checkbox-container"))) {
          (toggle as HTMLElement).click();
        }
        for (const input of Array.from(el.querySelectorAll("input"))) {
          input.value = "exercised";
          input.dispatchEvent(new Event("input"));
        }
        for (const button of Array.from(el.querySelectorAll("button"))) {
          button.click();
        }
      }
      throw new Error("screen never settled: 200 rows exercised and it is still re-rendering");
    } finally {
      opened.mockRestore();
    }
  }

  it("holds the plumbing, the sync, the self-host route and the escape hatches, in that order", () => {
    const { tab } = advanced({
      local: { [LS_LAST_RUN_DAY]: "2026-08-13" },
    });
    // The back row first, then one group after another. `This device` is here because the
    // fixture gives the device a run to report; a fresh install renders neither that group nor
    // its header, which the next test is about.
    expect(rowNames(tab)).toEqual([
      "Advanced",
      "Model",
      "Sync when you return to Obsidian",
      "Sync everything now",
      "Last filing run",
      "Plus service URL",
      "Self-host guide",
      "Custom shortcut link",
      PASTE_ROW,
    ]);
    expect(groupHeaders(tab)).toEqual([
      "Model",
      "Sync",
      "This device",
      "Run Ask yourself",
      "Escape hatches",
    ]);
  });

  it("leaves out the device group entirely when this device has nothing to report", () => {
    // A group header over an empty box reads as a screen that failed to load, so a fresh
    // install gets neither.
    const { tab } = advanced();
    expect(groupHeaders(tab)).not.toContain("This device");
    expect(rowNames(tab)).not.toContain("Last filing run");
  });

  it("opens the committed GitHub self-host guide", () => {
    const { tab } = advanced();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    press(tab, "Self-host guide", "Open");
    expect(open).toHaveBeenCalledWith(
      "https://github.com/taihartman/obsidian-atoms/blob/master/docs/ask-self-host.md",
      "_blank",
    );
    open.mockRestore();
  });

  it("keeps the device-local key path out — it is a credential path, not plumbing", () => {
    // `getApiKey()` falls back to that key, so the pair enables Anthropic spend on its own.
    const { tab } = advanced({ settings: { useDeviceLocalKeyFallback: true } });
    expect(rowNames(tab)).not.toContain("Device-local key fallback");
    expect(rowNames(tab)).not.toContain("Device-local API key");
  });

  it("cautions about each group's own rows, where the caution can be acted on", () => {
    const { tab } = advanced();
    const text = tab.containerEl.textContent ?? "";
    // The screen used to open with one blanket "leave these alone unless you self-host", which
    // stopped being true when it took a button ordinary users are meant to press. Each group
    // warns about itself instead.
    expect(text).toContain("Leave it alone unless you have a reason to change it");
    expect(text).toContain("You should not need any of these");
    // And the two constraints the self-host guide is emphatic about, which are the easiest
    // thing on this screen to get wrong.
    expect(text).toContain("before you sign in");
    expect(text).toContain("public HTTPS address");
  });

  it("says nothing about drains, outboxes or mirrors", () => {
    const { tab } = advanced({ local: { [LS_LAST_RUN_DAY]: "2026-08-13" } });
    const text = tab.containerEl.textContent ?? "";
    // Pipeline stage names are how the code is built, not vocabulary a reader has. The old
    // `Sync everything now` description spelled the whole pipeline out.
    for (const stage of ["drain", "outbox", "mirror", "auto-run"]) {
      expect(text.toLowerCase()).not.toContain(stage);
    }
  });

  it("grants nothing: no ack, no key, no consent sheet", async () => {
    const { tab, local, calls } = advanced({
      settings: { useDeviceLocalKeyFallback: true },
    });
    const before = gateState(tab, local);
    // Only what the exercise itself provokes: rendering the main screen on the way in already
    // read from the plugin, and a read is not an act.
    const from = calls.length;

    exerciseEveryControl(tab);
    await flush();

    expect(gateState(tab, local)).toEqual(before);
    // A gate reached from here would ask for consent before it moved a value, and an unanswered
    // sheet moves nothing — so the values matching above is not on its own proof of no gate.
    // The sheet appearing at all is.
    expect(sheetOpen()).toBe(false);
  });

  it("reaches a named handful of plugin entry points, and widening that is a decision", async () => {
    const { tab, calls } = advanced();
    const from = calls.length;

    exerciseEveryControl(tab);
    await flush();

    // The allowlist, not a "calls nothing" assertion, because U7 gave this screen two rows whose
    // whole job is to act. Every gate they pass through is inside the plugin. Two of these are
    // reads the re-render performs, and only `runSyncEverythingNow` and `setResumeEnabled` are
    // acts. A sixth name appearing here means a row that acts was moved onto Advanced, which is
    // the thing to look at rather than the thing to add to this list.
    expect([...new Set(calls.slice(from))].sort()).toEqual([
      "getLastCatchupLine",
      "getResumeEnabled",
      "runSyncEverythingNow",
      "saveSettings",
      "setResumeEnabled",
    ]);
  });

  it("keeps the one redirect it does hold inert on its own", async () => {
    const { tab, local } = advanced();
    const before = gateState(tab, local);

    fill(tab, "Plus service URL", "http://127.0.0.1:8787");
    blurRow(tab, "Plus service URL");
    await flush();

    // The override redirects where egress goes; it cannot turn egress on.
    expect(tab.plugin.settings.plusBaseUrl).toBe("http://127.0.0.1:8787");
    expect(gateState(tab, local)).toEqual(before);
  });

  /**
   * #500. The guards refuse an unvetted host at the request; without this line
   * the user only sees Plus stop working, with nothing naming the reason. The
   * value is still saved — the field persists on every keystroke, so refusing
   * the save would fight `https://…` at `h`, `ht`, `htt`.
   */
  describe("a rejected service URL says so under its own row", () => {
    it("explains a bad value already saved, on first render", () => {
      const { tab } = advanced({ settings: { plusBaseUrl: "http://evil.example" } });

      expect(tab.containerEl.textContent).toContain(
        PLUS_BASE_URL_INVALID_MESSAGE,
      );
    });

    it("appears when a bad value is committed and clears when it is fixed", async () => {
      const { tab } = advanced();
      expect(tab.containerEl.textContent).not.toContain(
        PLUS_BASE_URL_INVALID_MESSAGE,
      );

      fill(tab, "Plus service URL", "http://evil.example");
      blurRow(tab, "Plus service URL");
      await flush();
      expect(tab.containerEl.textContent).toContain(
        PLUS_BASE_URL_INVALID_MESSAGE,
      );
      // Saved anyway — the request guard is the protection, not the field.
      expect(tab.plugin.settings.plusBaseUrl).toBe("http://evil.example");

      fill(tab, "Plus service URL", "https://my.example");
      blurRow(tab, "Plus service URL");
      await flush();
      expect(tab.containerEl.textContent).not.toContain(
        PLUS_BASE_URL_INVALID_MESSAGE,
      );
    });

    /**
     * #505. The row used to write and save on every keystroke, so typing
     * `https://my-tunnel.example` made `https://m` and `https://my` live on the way —
     * each a valid https URL that #500's guard accepts, replicated by Obsidian Sync,
     * and able to receive the session token from any Plus call landing mid-word.
     *
     * These four pin the whole commit contract: typing alone changes nothing, and each
     * of the three ways an edit can end commits it.
     */
    describe("a half-typed URL never goes live (#505)", () => {
      it("typing alone writes nothing and says nothing", async () => {
        const { tab } = advanced();

        // The dangerous prefixes are the ones the guard *accepts*: a single-label host
        // a search domain can expand into something that resolves.
        for (const partial of ["h", "ht", "https://m", "https://my-tunnel"]) {
          fill(tab, "Plus service URL", partial);
          await flush();
          expect(tab.plugin.settings.plusBaseUrl, partial).toBe("");
        }
        // No error either — an unfinished value is not a rejected one.
        expect(tab.containerEl.textContent).not.toContain(
          PLUS_BASE_URL_INVALID_MESSAGE,
        );
      });

      it("blur commits", async () => {
        const { tab } = advanced();

        fill(tab, "Plus service URL", "https://my-tunnel.example");
        blurRow(tab, "Plus service URL");
        await flush();

        expect(tab.plugin.settings.plusBaseUrl).toBe(
          "https://my-tunnel.example",
        );
      });

      it("Enter commits without moving focus", async () => {
        const { tab } = advanced();

        fill(tab, "Plus service URL", "https://my-tunnel.example");
        pressKey(tab, "Plus service URL", "Enter");
        await flush();

        expect(tab.plugin.settings.plusBaseUrl).toBe(
          "https://my-tunnel.example",
        );
      });

      it("closing Settings mid-edit commits rather than discarding", async () => {
        const { tab } = advanced();

        fill(tab, "Plus service URL", "https://my-tunnel.example");
        // No blur: the modal going away is the only signal.
        tab.hide();
        await flush();

        expect(tab.plugin.settings.plusBaseUrl).toBe(
          "https://my-tunnel.example",
        );
      });
    });

    it("stays quiet for an empty field, which means the hosted service", async () => {
      const { tab } = advanced({ settings: { plusBaseUrl: "https://my.example" } });

      fill(tab, "Plus service URL", "");
      await flush();

      expect(tab.containerEl.textContent).not.toContain(
        PLUS_BASE_URL_INVALID_MESSAGE,
      );
    });
  });
});

/**
 * The main screen's row sequence, and the three action rows U9 removed.
 *
 * The plan's *"The resulting main screen"* table is the contract: fourteen rows, in one order,
 * on a signed-in Plus install. Section headings are not rows and the Capture intro is prose, so
 * neither is counted — `rowNames(tab, { headings: false })` is what the table is about.
 */
describe("main screen row grammar (U9)", () => {
  const PLUS_SESSION: PlusSession = {
    sessionToken: "sess_main",
    email: "user@example.com",
    status: "active",
    periodEnd: "2099-01-01T00:00:00.000Z",
  };

  function plusTab() {
    return settingTab({
      session: PLUS_SESSION,
      auth: {
        mode: "plus",
        sessionToken: PLUS_SESSION.sessionToken,
        email: PLUS_SESSION.email,
        status: "active",
        remaining: 12,
        periodEnd: PLUS_SESSION.periodEnd,
      },
    });
  }

  /** Rows 7–9 of the table: the Ask cluster, which only a Plus session renders. */
  const ASK_ROWS = [
    "Ask mirror",
    "Allow filing from Claude or ChatGPT",
    "Connect Claude or ChatGPT",
  ];

  /** What leg 3's Ask group renders with no session: one row, saying so. */
  const ASK_OFF_ROW = "Ask in Claude and ChatGPT";

  /**
   * @param filingChosen whether someone is set up to file. U2's status group opens the screen
   *   either way: with the one next step when nobody files, and with the automatic-filing
   *   toggle it takes off the auto-run section when somebody does.
   * @param askRows what leg 3's Ask group holds: the three-row cluster with a session, or the
   *   single `Off` row without one. Not a filter on one list, because the signed-out shape is a
   *   different row rather than the signed-in rows minus some.
   * @param privacy whether the utility group carries its Privacy entry, which renders only when
   *   this device has something to take back or delete (KTD6). A live Plus session is one of the
   *   six disjuncts, so the signed-in screen has it and the bare signed-out screen does not.
   */
  function expectedRows(
    filingChosen: boolean,
    askRows: string[],
    privacy: boolean,
  ): string[] {
    const vocabulary = `Tag vocabulary · ${DEFAULT_SETTINGS.activeVocabulary.length} active`;
    return [
      filingChosen ? "File automatically" : "Choose who files your captures",
      // 1 · Capture. Daily Notes is a fact the leg reports rather than a preference it owns,
      // which is why it is the one row here with no control (U3).
      "Daily notes",
      // U9: a name and a status, with the procedure behind it. It was an action row whose
      // description carried all six steps.
      "Capture on your phone",
      // `Custom shortcut link` is not here since U7: it only matters to somebody who forked the
      // recipe, so it sits with the other escape hatches on Advanced.
      // 2 · File, in the mock's order: who files, whether it runs on its own, where atoms land,
      // what they may be tagged, what gets listed on hub notes. The engine row is a noun and
      // its answer is the account's state, whose own screen is two taps in.
      "Filing",
      // Shed to the status group once somebody files; the File group keeps it while the screen
      // is still asking who that is.
      ...(filingChosen ? [] : ["File automatically when Obsidian opens"]),
      "Atom folder",
      vocabulary,
      "List atoms on hub notes",
      // 3 · Resurface, as two groups: home needs nothing, Ask needs a session (R3).
      "Atoms home",
      ...askRows,
      // The sync pair is not here since U7 either: both are diagnostics-shaped, and the main
      // screen answers "is Atoms filing", not "make it file this second".
      // The key rows are not here since U4: a credential path belongs beside the engine choice
      // it enables, which is the engine destination rather than the main screen or Advanced.
      ...(privacy ? ["Privacy and consents"] : []),
      "Advanced",
      // KD8's Atoms Plus group, last. Before it, billing had no presence on the main screen at
      // all: `openRoute("account")` had one call site, on the engine screen.
      "Account",
      "Redeem code",
    ];
  }

  it("renders the main settings rows in order, signed in to Plus", () => {
    const { tab } = plusTab();
    tab.display();

    const rows = rowNames(tab, { headings: false });
    expect(rows).toEqual(expectedRows(true, ASK_ROWS, true));
    expect(rows).toHaveLength(15);
  });

  it("renders thirteen rows signed out — the Ask group is the only difference", () => {
    const { tab } = settingTab();
    tab.display();

    const rows = rowNames(tab, { headings: false });
    // No session, no ack, no cloud copy: nothing to take back, so no Privacy row either.
    expect(rows).toEqual(expectedRows(false, [ASK_OFF_ROW], false));
    expect(rows).toHaveLength(13);
  });

  it("adds the device-local key row under its toggle, and nowhere else", () => {
    const { tab } = settingTab({ settings: { useDeviceLocalKeyFallback: true } });
    tab.display();
    // Not on the main screen at all now: both live on the engine destination. The whole list,
    // not just the absence — a conditional row that leaked here would otherwise only be caught
    // if somebody thought to name it (U11).
    expect(rowNames(tab, { headings: false })).toEqual(
      expectedRows(false, [ASK_OFF_ROW], false),
    );
    expect(rowNames(tab, { headings: false })).not.toContain("Device-local key fallback");

    open(tab, "Filing");
    open(tab, "Use your own Anthropic key");
    const rows = rowNames(tab, { headings: false });
    expect(rows.indexOf("Device-local API key")).toBe(
      rows.indexOf("Device-local key fallback") + 1,
    );
  });

  it("states the daily capture format as prose, not as a row", () => {
    const { tab } = plusTab();
    tab.display();

    expect(rowNames(tab, { headings: false })).not.toContain("Daily capture format");
    const prose = Array.from(
      tab.containerEl.querySelectorAll("p.setting-item-description"),
    ).map((el) => el.textContent ?? "");
    // U3 moved it out of a section intro and into the Capture group's one footer, which is the
    // same claim about where it lives: prose under the rows, never a row of its own.
    const format = prose.find((text) => text.includes("in your daily note")) ?? "";
    expect(format).not.toBe("");
    // "top-level" is the whole guarantee this test has ever carried, and the footer sweep is
    // exactly where it would get dropped: `isContinuationLine` folds an indented bullet into the
    // capture above it with no error, so a user who loses this word loses the only way to predict
    // why two thoughts landed in one atom (R19).
    expect(format).toContain("top-level");
    expect(format).toContain("indented");
  });

  it("keeps opening today's daily as a command, and off the settings screen", () => {
    const commands = registeredCommands();
    const daily = commands.find((c) => c.id === "open-todays-daily");
    expect(daily, "no Atoms command opens today's daily note").toBeDefined();

    const { tab } = plusTab();
    tab.display();
    expect(rowNames(tab, { headings: false })).not.toContain("Open today's daily");
  });

  it("keeps self-hosting off the main screen entirely, on the Advanced screen instead", () => {
    const { tab } = plusTab();
    tab.display();
    expect(rowNames(tab, { headings: false })).not.toContain("Self-host Ask");
    expect(existsSync(path.resolve(__dirname, "../docs/ask-self-host.md"))).toBe(true);

    // U5 stopped offering the route on the main screen (R13). Signed out is exactly the moment
    // somebody has not decided whether they want Ask at all, and "or run the server yourself"
    // is not the sentence that helps them decide. The Advanced screen still names it, so the
    // route is described rather than hidden.
    const signedOut = settingTab();
    signedOut.tab.display();
    const main = signedOut.tab.containerEl.textContent ?? "";
    expect(main).not.toContain("Self-host guide");
    expect(main).not.toContain("run the server yourself");
    // And it is one tap away, named, on the screen R13 puts it on.
    open(signedOut.tab, "Advanced");
    expect(rowNames(signedOut.tab, { headings: false })).toContain("Self-host guide");

    const guide = readFileSync(
      path.resolve(__dirname, "../docs/ask-self-host.md"),
      "utf8",
    );
    // KTD10 in both directions: the guide names the row, so renaming the row without editing
    // the guide leaves a reader hunting a label that no longer exists.
    expect(guide).toContain("Advanced → Plus service URL");
    expect(guide).toContain("Public HTTPS is required");
    expect(guide).not.toContain("Development → Plus service URL");
    expect(guide).not.toContain("local `http://127.0.0.1:8787` can work");
  });

  /**
   * A status fact has a name and a value, which is what `statusRow` is for. Rendered as a loose
   * paragraph it drifts out of the grammar and reads as prose the user has to parse.
   */
  describe("status facts", () => {
    // Both records moved to Advanced → This device in U7, and the first shed the "auto-run"
    // in its name with the move: the group header says whose device it is, and "auto-run" was
    // a stage name rather than a word a reader brings with them.
    it("names the last filing run on a status row", () => {
      const { tab } = settingTab({
        session: PLUS_SESSION,
        local: { [LS_LAST_RUN_DAY]: "2026-07-29" },
      });
      openAdvanced(tab);

      const rows = rowNames(tab, { headings: false });
      expect(rows).toContain("Last filing run");
      expect(row(tab, "Last filing run").textContent).toContain("2026-07-29");
      expect(prose(tab).some((t) => t.startsWith("Last filing run"))).toBe(false);
    });

    it("names the last catch-up on a status row", () => {
      const { tab } = settingTab({
        session: PLUS_SESSION,
        plugin: { getLastCatchupLine: () => "Last catch-up 18m ago: caught up" },
      });
      openAdvanced(tab);

      expect(rowNames(tab, { headings: false })).toContain("Last catch-up");
      expect(row(tab, "Last catch-up").textContent).toContain("18m ago: caught up");
      expect(prose(tab).some((t) => t.startsWith("Last catch-up"))).toBe(false);
    });

    /**
     * The secret-id naming rule has had three homes, and the invariant is the same in all three:
     * it must stay reachable, and it must not come between the key row and the fallback toggle,
     * which answer for the same key. It was prose wedged between them, then it moved into the key
     * row's own description, and now it is the group footer — under *both* rows, so the pair still
     * touches, and off the row itself, which was making somebody four minutes into Atoms read the
     * word `SecretStorage` and an Android emulator command to decide who pays (F4).
     *
     * The jargon assertions are the half that would otherwise rot: a future edit can put the tip
     * back on the row and still satisfy "reachable and not between the pair".
     */
    it("keeps the key naming rule under the pair, and jargon off the key row", () => {
      const { tab } = plusTab();
      tab.display();
      open(tab, "Filing");
      // A fourth home, and the same invariant: the rule answers for the pair, so it stays with
      // the pair. What changed is that the pair is no longer on the who-pays screen at all.
      open(tab, "Use your own Anthropic key");

      // Reachable, and in the footer rather than the row.
      expect(prose(tab).some((t) => t.includes(API_KEY_SECRET_ID_DEFAULT))).toBe(true);
      const keyRow = row(tab, "Anthropic API key");
      expect(keyRow.textContent).not.toContain(API_KEY_SECRET_ID_DEFAULT);

      // The pair still touches: nothing renders between them.
      const names = rowNames(tab, { headings: false });
      expect(names.indexOf("Device-local key fallback")).toBe(
        names.indexOf("Anthropic API key") + 1,
      );

      // The who-pays screen is not the place for implementation nouns.
      const engineCopy = [keyRow.textContent ?? "", ...prose(tab)].join(" ");
      for (const jargon of ["SecretStorage", "emulator", "data.json", "alphanumeric"]) {
        expect(engineCopy).not.toContain(jargon);
      }
    });
  });
});

const FILING_SESSION: PlusSession = {
  sessionToken: "sess_filing",
  email: "user@example.com",
  status: "active",
  periodEnd: "2099-01-01T00:00:00.000Z",
};

/**
 * An install where somebody files: a live Plus session, and the auth that goes with it.
 *
 * Shared by the two groups the same state decides between — the status group renders its filing
 * variant off it, and the File group sheds its automatic-filing toggle off it. Two copies of this
 * setup would let one of those describes drift onto an install the other never sees.
 */
/**
 * The footer under the "Your data" group. Located through its own header rather than by taking
 * the last footer on screen, so a group added after it does not quietly retarget the assertion.
 */
function utilityFooter(tab: AtomsSettingTab): string {
  const header = Array.from(
    tab.containerEl.querySelectorAll("h3.atoms-setting-group-header"),
  ).find((el) => el.textContent === "Your data");
  const foot = header?.nextElementSibling?.nextElementSibling;
  if (!foot?.classList.contains("atoms-setting-group-foot")) {
    throw new Error("no footer under the 'Your data' group");
  }
  return foot.textContent ?? "";
}

function filingTab(opts: SettingTabOptions = {}) {
  return settingTab({
    ...opts,
    session: FILING_SESSION,
    auth: {
      mode: "plus",
      sessionToken: FILING_SESSION.sessionToken,
      email: FILING_SESSION.email,
      status: "active",
      remaining: 12,
      periodEnd: FILING_SESSION.periodEnd,
    },
  });
}

/**
 * The element that answers "is Atoms filing?" before the screen offers a single control (R18).
 *
 * Two variants, because the honest answer has two shapes: nobody files yet, so the screen says
 * what Atoms does and names the one step; or somebody does, so the screen says filing is on and
 * when the first atoms land (R12). Both are read back through the group chrome rather than
 * through raw markup — `groupHeaders` for the eyebrow, `prose` for the footer.
 */
describe("status group (U2)", () => {
  /** Automatic filing already on and acknowledged, with no run behind it yet: day one. */
  const FILING_ON = {
    [LS_AUTO_RUN_ENABLED]: true,
    [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
  };

  describe("nobody files yet", () => {
    it("opens the screen by saying what Atoms does, above every control", () => {
      const { tab } = settingTab();
      tab.display();

      expect(groupHeaders(tab)[0]).toBe("Get started");
      const footer =
        "Atoms reads thoughts you already wrote and files each one as its own note, linked to the people and topics it mentions.";
      expect(prose(tab)).toContain(footer);
      // R9 is about order, not just presence: the sentence has to land before the first leg the
      // screen offers controls under. The old anchor was the phrase "Atoms Plus", which U5 took
      // off the main screen with the Ask sign-in paragraph.
      const text = tab.containerEl.textContent ?? "";
      expect(text.indexOf("Get started")).toBeLessThan(text.indexOf(footer));
      expect(text.indexOf(footer)).toBeLessThan(text.indexOf("1 · Capture"));
    });

    it("names one next step, and walks into the screen that answers it", () => {
      const { tab } = settingTab();
      tab.display();

      const rows = rowNames(tab, { headings: false });
      expect(rows[0]).toBe("Choose who files your captures");
      expect(destinationNames(tab)).toContain("Choose who files your captures");

      // The screen that answers "who files" is the one offering both answers, not the one that
      // manages only the paid half of it. Both answers are chevrons now: the key field itself
      // moved one screen deeper, so the decision screen holds a decision.
      open(tab, "Choose who files your captures");
      const answers = rowNames(tab, { headings: false });
      expect(answers).toContain("Atoms Plus");
      expect(answers).toContain("Use your own Anthropic key");
    });

    it("leaves the automatic filing toggle where it was", () => {
      const { tab } = settingTab();
      tab.display();

      expect(rowNames(tab, { headings: false })).toContain(
        "File automatically when Obsidian opens",
      );
      expect(rowNames(tab, { headings: false })).not.toContain("File automatically");
    });
  });

  describe("somebody files", () => {
    it("states filing is on and when the first atoms arrive", () => {
      const { tab } = filingTab({ local: FILING_ON });
      tab.display();

      expect(groupHeaders(tab)[0]).toBe("Status");
      expect(rowNames(tab, { headings: false })[0]).toBe("File automatically");
      expect(row(tab, "File automatically").querySelector(".is-enabled")).not.toBeNull();
      expect(row(tab, "File automatically").textContent).toContain(
        "First atoms arrive tomorrow morning.",
      );
      expect(row(tab, "Next run").textContent).toContain(
        "Tomorrow, when Obsidian opens.",
      );
      expect(prose(tab)).toContain(
        "Atoms waits until a day is done, so it never files a thought you are still writing.",
      );
    });

    it("stops promising a first arrival once a run is behind it", () => {
      const { tab } = filingTab({
        local: { ...FILING_ON, [LS_LAST_RUN_DAY]: "2026-08-13" },
      });
      tab.display();

      expect(row(tab, "File automatically").textContent).not.toContain(
        "First atoms arrive",
      );
      expect(row(tab, "Next run").textContent).toContain("Tomorrow, when Obsidian opens.");
    });

    it("says filing is off without a next run, when the toggle is off", () => {
      const { tab } = filingTab();
      tab.display();

      expect(groupHeaders(tab)[0]).toBe("Status");
      expect(row(tab, "File automatically").querySelector(".is-enabled")).toBeNull();
      expect(rowNames(tab, { headings: false })).not.toContain("Next run");
    });

    it("sheds the toggle from the auto-run section rather than rendering it twice", () => {
      const { tab, local } = filingTab({ local: FILING_ON });
      tab.display();

      const rows = rowNames(tab, { headings: false });
      expect(rows).not.toContain("File automatically when Obsidian opens");
      expect(rows.filter((name) => name === "File automatically")).toHaveLength(1);
      // Still the same toggle, with the same consent behind it: flipping it off writes through.
      flip(tab, "File automatically");
      expect(local.get(LS_AUTO_RUN_ENABLED)).toBe(false);
    });
  });

  /** KTD11: one computation of what is unfinished, rendered as a card and as a line. */
  it("agrees with Atoms home about what is unfinished", () => {
    vi.spyOn(dni, "appHasDailyNotesPluginLoaded").mockReturnValue(false);
    const { tab } = filingTab();
    tab.display();

    const step = firstDaySetupCopy(false).nextStep;
    expect(step?.name).toBe("Turn on Daily Notes");
    expect(groupHeaders(tab)[0]).toBe("Get started");
    expect(rowNames(tab, { headings: false })[0]).toBe(step?.name);
  });

  /**
   * Unfinished setup and "not filing" are two different questions, and Daily Notes is where they
   * come apart: switching that core plugin off under a configured engine leaves the window and
   * the ack spent while the toggle falls back to the File group. Telling that device its first
   * atoms arrive tomorrow describes a silence window it already spent.
   */
  it("does not promise a first arrival to a device that is already filing", () => {
    vi.spyOn(dni, "appHasDailyNotesPluginLoaded").mockReturnValue(false);
    const { tab } = filingTab({
      local: { ...FILING_ON, [LS_LAST_RUN_DAY]: "2026-08-13" },
    });
    tab.display();

    // The setup step is still the honest headline — nothing files without a daily note.
    expect(rowNames(tab, { headings: false })[0]).toBe("Turn on Daily Notes");

    const toggle = row(tab, "File automatically when Obsidian opens");
    expect(toggle.textContent).not.toContain("Filing starts with tomorrow's note");
    expect(toggle.textContent).toContain("Atoms files each past day when Obsidian opens.");
  });

  it("keeps the day-one promise until a run is actually on the books", () => {
    vi.spyOn(dni, "appHasDailyNotesPluginLoaded").mockReturnValue(false);
    // Enabled, acked, and nothing filed yet: the promise is still true, so it must survive.
    const { tab } = filingTab({ local: FILING_ON });
    tab.display();

    expect(
      row(tab, "File automatically when Obsidian opens").textContent,
    ).toContain("Filing starts with tomorrow's note");
  });

  /**
   * The other side of the test above, and the line between them is what the device can still do.
   *
   * A spent window argues filing *was* happening, which is why Daily Notes going off keeps the
   * running line. A deleted engine argues nothing can be sent at all. Adversarial repro, live:
   * engine screen → device-local key fallback on → paste a key → back, and the status group takes
   * the toggle; then engine screen → fallback off, which deletes the key → back. The status group
   * correctly hands the toggle down again and the engine row reads `Not set up`, while the toggle
   * itself went on claiming the device files every past day. It files nothing: `resolveFilingAuth`
   * reports `none`, so there is no credential to send a capture with.
   */
  it("does not claim a device with no engine is filing each past day", () => {
    vi.spyOn(dni, "appHasDailyNotesPluginLoaded").mockReturnValue(true);
    // No `auth`, so `resolveFilingAuth()` is `{ mode: "none" }` — the state deleting the key left.
    const { tab } = settingTab({
      local: { ...FILING_ON, [LS_LAST_RUN_DAY]: "2026-08-11" },
    });
    tab.display();

    // The screen agrees setup is unfinished, twice.
    expect(rowNames(tab, { headings: false })[0]).toBe(
      "Choose who files your captures",
    );
    expect(row(tab, "Filing").textContent).toContain("Not set up");

    // So the toggle may not say otherwise.
    const toggle = row(tab, "File automatically when Obsidian opens");
    expect(toggle.textContent).not.toContain(
      "Atoms files each past day when Obsidian opens.",
    );
    expect(toggle.textContent).toContain("Filing starts with tomorrow's note");
  });
});

/**
 * Holes found by an adversarial pass, each one live-reproduced before it was fixed. Kept
 * together because they share a cause: a settings screen that can be rebuilt or walked away
 * from, and state that assumed it would not be.
 */
describe("adversarial regressions", () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  /** 40 tags, one file each, so every count ties and the sort falls back to alphabetical. */
  const many = Array.from(
    { length: 40 },
    (_, i) => `zqa${String(i + 1).padStart(2, "0")}`,
  );

  describe("Found in your vault", () => {
    /**
     * The list capped at 30 rows *before* dropping the ones already active, so the budget went
     * to rows that were then thrown away. At 30 active tags the section rendered empty — under
     * a sentence claiming every tag in the vault was already active — while the unactivated
     * ones sat below the cut, permanently unreachable. The default vocabulary is 13.
     */
    function vocabularyTab(active: string[], vaultTags: string[]) {
      const { tab } = settingTab({ settings: { activeVocabulary: active }, vaultTags });
      tab.display();
      open(tab, `Tag vocabulary · ${active.length} active`);
      return tab;
    }

    it("still offers an unactivated tag when 30 more-used tags are already active", () => {
      const tab = vocabularyTab(many.slice(0, 30), many);

      const offered = rowNames(tab).filter((n) => n.startsWith("#zqa"));
      expect(offered).toContain("#zqa31");
      expect(offered).toContain("#zqa40");
    });

    it("does not claim every vault tag is active while ten of them are not", () => {
      const tab = vocabularyTab(many.slice(0, 30), many);

      expect(prose(tab).join(" ")).not.toContain(
        "Every tag your vault uses is already active.",
      );
    });

    it("caps the list at 30 promotable rows and says how many it is not showing", () => {
      const tab = vocabularyTab([], many);

      // 40 unactivated, 30 rendered: the cap still holds, it just no longer eats the answer.
      expect(rowNames(tab).filter((n) => n.startsWith("#zqa"))).toHaveLength(30);
      expect(prose(tab).join(" ")).toContain(
        "Showing the 30 most-used of 40 tags you have not activated yet",
      );
    });

    it("still tells the two silences apart", () => {
      // Genuinely nothing left to promote.
      const all = vocabularyTab(many, many);
      expect(rowNames(all).filter((n) => n.startsWith("#zqa"))).toHaveLength(40);
      expect(prose(all).join(" ")).toContain("Every tag your vault uses is already active.");

      // Nothing found at all — a different fact, and a different sentence.
      const none = vocabularyTab([], []);
      expect(prose(none).join(" ")).toContain("No tags found in vault yet.");
      expect(prose(none).join(" ")).not.toContain("already active");
    });
  });

  describe("Add to Active", () => {
    function vocabularyTab() {
      const { tab } = settingTab({ settings: { activeVocabulary: ["alpha"] } });
      tab.display();
      open(tab, "Tag vocabulary · 1 active");
      Notice.messages.length = 0;
      return tab;
    }

    const draft = (tab: AtomsSettingTab): string => {
      const input = row(tab, "Add a custom tag").querySelector("input");
      if (!(input instanceof HTMLInputElement)) throw new Error("no draft field");
      return input.value;
    };

    it("renders the field and the button that commits it as one row", () => {
      const tab = vocabularyTab();

      // The exact list, not a membership check: a regression that re-splits the pair back into a
      // field row plus a button row named "Add to Active" shows up here as an extra row.
      expect(rowNames(tab, { headings: false })).toEqual([
        "Tag vocabulary",
        "#alpha",
        "Add a custom tag",
      ]);
      expect(buttonLabels(tab, "Add a custom tag")).toEqual(["Add to Active"]);
    });

    /**
     * The trap the doc-review caught: `customTagDraft` does not fall out just because `onSubmit`
     * now receives the value. Flipping any active tag off calls `redisplay()`, and the draft is
     * what the rebuilt field is seeded from — delete it and a half-typed tag silently vanishes.
     */
    it("keeps a half-typed tag when deactivating another tag rebuilds the screen", async () => {
      const { tab } = settingTab({ settings: { activeVocabulary: ["alpha", "beta"] } });
      tab.display();
      open(tab, "Tag vocabulary · 2 active");
      fill(tab, "Add a custom tag", "healt");
      flip(tab, "#beta");
      await flush();

      expect(tab.plugin.settings.activeVocabulary).toEqual(["alpha"]);
      expect(draft(tab)).toBe("healt");
    });

    it.each([
      ["a tag that normalizes to nothing", "###"],
      ["whitespace", "   "],
      ["a tag past the length cap", "a".repeat(300)],
      ["emoji", "🔥🔥"],
    ])("refuses %s out loud and adds nothing", async (_label, typed) => {
      const tab = vocabularyTab();
      fill(tab, "Add a custom tag", typed);
      press(tab, "Add a custom tag", "Add to Active");
      await flush();

      // The defect was the silence, not the refusal: `normalizeTag("###")` returned "" and the
      // handler returned with no Notice, no row, and the text still sitting in the field.
      expect(Notice.messages).toHaveLength(1);
      expect(Notice.messages[0]).toMatch(/^Atoms: /);
      expect(tab.plugin.settings.activeVocabulary).toEqual(["alpha"]);
      // Left in the field on purpose — the user is being asked to fix it, not to retype it.
      expect(draft(tab)).toBe(typed);
    });

    it("still accepts an ordinary tag, and clears the field when it lands", async () => {
      const tab = vocabularyTab();
      fill(tab, "Add a custom tag", "#Health");
      press(tab, "Add a custom tag", "Add to Active");
      await flush();

      expect(tab.plugin.settings.activeVocabulary).toEqual(["alpha", "health"]);
      expect(Notice.messages).toHaveLength(0);
      expect(draft(tab)).toBe("");
    });
  });

  describe("automatic filing toggle", () => {
    /**
     * The twin of the Ask mirror test above ("cannot be undone by a handler still holding the
     * ack it rendered with"). This side captured `readDeviceAutoRunState(load)` at render time
     * and consumed the snapshot in its `onChange`, so a handler built before a withdrawal still
     * believed it held the ack. No egress followed — `shouldRunAutoProcess` re-checks — but the
     * asymmetry between the two toggles is the exact bug this change exists to kill.
     */
    it("cannot be enabled by a handler still holding the ack it rendered with", async () => {
      const { tab, local } = settingTab({
        local: { [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION },
      });
      tab.display();

      const stale = row(tab, "File automatically when Obsidian opens").querySelector(
        ".checkbox-container",
      );
      if (!(stale instanceof HTMLElement)) throw new Error("no auto-run toggle");

      // The withdrawal is on the Privacy screen since U6; the toggle it must not re-enable is on
      // the screen behind it, still held by the test the way a finger holds a stale button.
      open(tab, "Privacy and consents");
      press(tab, "What Atoms sends to Anthropic", "Review");
      pressSheet("Withdraw acknowledgment");
      await flush();

      stale.click();
      await flush();

      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(EGRESS_ACK_VERSION);
      expect(local.get(LS_AUTO_RUN_ENABLED)).not.toBe(true);
    });
  });

  describe("walking into a destination", () => {
    /**
     * `hide()` has always settled an open sheet as a decline, on the rule that a sheet must not
     * outlive the screen that posed it. `openRoute()` — the one other screen change — did not,
     * so a sheet a main-screen toggle raised survived the walk, and accepting it from inside a
     * destination still wrote the ack.
     */
    it("settles a sheet the screen behind it posed", async () => {
      const { tab } = settingTab();
      tab.display();
      flip(tab, "File automatically when Obsidian opens");
      await flush();
      expect(sheetOpen()).toBe(true);

      open(tab, "Advanced");
      await flush();

      expect(sheetOpen()).toBe(false);
    });

    it("does not let that sheet write an ack from the screen the user left", async () => {
      const { tab, local } = settingTab();
      tab.display();
      flip(tab, "File automatically when Obsidian opens");
      await flush();

      open(tab, "Advanced");
      await flush();

      // The user is looking at Advanced now. Accept whatever is still up — an orphaned sheet
      // grants a consent on behalf of a screen that is no longer on the display.
      if (sheetOpen()) {
        pressSheet("I understand");
        await flush();
      }

      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(EGRESS_ACK_VERSION);
      expect(local.get(LS_AUTO_RUN_ENABLED)).not.toBe(true);
    });
  });

  /**
   * #323 F5 — the third way the screen behind a sheet can be replaced: `data.json` changed
   * on another device. `refreshFromExternalSettings()` rebuilt the DOM but left the sheet
   * floating above it, so the user could accept a consent question posed under state that
   * no longer exists — the same defect `hide()` and `openRoute()` already settle.
   */
  describe("an external settings change under an open sheet", () => {
    it("settles the sheet before rebuilding the screen", async () => {
      const { tab } = settingTab();
      tab.display();
      flip(tab, "File automatically when Obsidian opens");
      await flush();
      expect(sheetOpen()).toBe(true);

      tab.refreshFromExternalSettings();
      await flush();

      expect(sheetOpen()).toBe(false);
    });

    it("does not let that sheet write an ack after the state it asked about was replaced", async () => {
      const { tab, local } = settingTab();
      tab.display();
      flip(tab, "File automatically when Obsidian opens");
      await flush();

      tab.refreshFromExternalSettings();
      await flush();

      if (sheetOpen()) {
        pressSheet("I understand");
        await flush();
      }

      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(true);
      expect(local.get(LS_AUTO_RUN_ENABLED)).not.toBe(true);
    });
  });
});

/* ------------------------------------------------------------------ *
 * Signed-out Atoms Plus panel — magic-link handoff copy (R10, R15)
 * ------------------------------------------------------------------ */

const VAULT = "Vault A";
const EMAIL_ROW = "Email";
// U7 moved this row to Advanced → Escape hatches and dropped the `Advanced:` prefix with it: the
// prefix was an address, and the row now lives at the address.
const PASTE_ROW = "Paste a session";
const PASTE_ROUTE = `Advanced → ${PASTE_ROW}`;

type FakeApp = ReturnType<typeof fakeLocalApp>;

function fakeLocalApp(seed: Record<string, string> = {}) {
  const store: Record<string, string> = { ...seed };
  return {
    store,
    loadLocalStorage: (key: string) => store[key] ?? null,
    saveLocalStorage: (key: string, value: string) => {
      store[key] = value;
    },
    vault: { getName: () => VAULT },
  };
}

function fakeTab(app: FakeApp) {
  const plugin = {
    settings: { ...DEFAULT_SETTINGS, plusBaseUrl: "https://plus.test" },
    manifest: { version: "9.9.9" },
    resolveFilingAuth: () => ({ mode: "none" as const }),
    // Read by the Advanced screen's sync group and its device group. This double predates that
    // screen, so both are stubs rather than behavior — the panels under test here are about copy.
    getResumeEnabled: () => false,
    getLastCatchupLine: () => null,
  };
  const tab = new AtomsSettingTab(app as never, plugin as never);
  (tab as unknown as { app: unknown }).app = app;
  return tab;
}

/**
 * Render the whole signed-out Plus panel and collect every string it drew.
 *
 * The rows moved: the main screen now carries one Atoms Plus row that opens the Account
 * destination, and everything this panel used to show inline renders there instead. So this
 * drives `renderAccountDestination` — same copy, one tap in. A real element, because the tab
 * builds its rows through the DOM now.
 */
function renderSignedOutPanel(app: FakeApp): UiCapture {
  const ui = captureObsidianUi();
  const containerEl = document.createElement("div");
  const tab = fakeTab(app);
  (tab as unknown as { containerEl: unknown }).containerEl = containerEl;
  (
    tab as unknown as { renderAccountDestination: (el: HTMLElement) => void }
  ).renderAccountDestination(containerEl);
  return ui;
}

/** The same harness pointed at the screen U7 moved the paste fallback onto. */
function renderAdvancedPanel(app: FakeApp): UiCapture {
  const ui = captureObsidianUi();
  const containerEl = document.createElement("div");
  const tab = fakeTab(app);
  (tab as unknown as { containerEl: unknown }).containerEl = containerEl;
  (
    tab as unknown as { renderAdvancedDestination: (el: HTMLElement) => void }
  ).renderAdvancedDestination(containerEl);
  return ui;
}

/** A description sits immediately after the name it belongs to. */
function descAfter(ui: UiCapture, name: string): string {
  const i = ui.strings.indexOf(name);
  expect(i, `panel never rendered a row named "${name}"`).toBeGreaterThanOrEqual(0);
  return ui.strings[i + 1] ?? "";
}

function pendingSeed(requestedAt = Date.now()) {
  return {
    "atoms-plus-signin-pending": JSON.stringify([
      { verifier: "v".repeat(43), vault: VAULT, requestedAt },
    ]),
  };
}

const sendLink = (tab: ReturnType<typeof fakeTab>, email: string) =>
  (
    tab as unknown as { sendPlusMagicLink: (e: string) => Promise<void> }
  ).sendPlusMagicLink(email);

const magicLinkMock = requestMagicLink as unknown as ReturnType<typeof vi.fn>;

/** A platform with randomness but no `crypto.subtle` — the mobile-webview case. */
function stubNoWebCrypto(): void {
  vi.stubGlobal("crypto", {
    getRandomValues: (a: Uint8Array) => a,
  });
}

describe("signed-out Plus panel copy (R15, AE11)", () => {
  afterEach(() => {
    stopCapturingObsidianUi();
    vi.unstubAllGlobals();
  });

  it("points at Refresh status nowhere on the panel, in either state", () => {
    for (const app of [fakeLocalApp(), fakeLocalApp(pendingSeed())]) {
      const ui = renderSignedOutPanel(app);
      // The assertion is only meaningful if the panel really rendered: both of the rows it is
      // made of have to be among the strings checked. The paste row was the second witness
      // until U7 moved it to Advanced, so the plans row stands in for it.
      expect(ui.strings).toContain(EMAIL_ROW);
      expect(ui.strings).toContain("Skip the API key");
      const offenders = ui.strings.filter((s) => s.includes("Refresh status"));
      expect(offenders).toEqual([]);
    }
  });

  it("describes the emailed link only once a link has been requested", () => {
    const before = descAfter(renderSignedOutPanel(fakeLocalApp()), EMAIL_ROW);
    expect(before).toMatch(/promo code/i);
    expect(before).not.toMatch(/sent/i);

    const after = descAfter(
      renderSignedOutPanel(fakeLocalApp(pendingSeed())),
      EMAIL_ROW,
    );
    expect(after).toMatch(/open it in the email on this device/i);
  });

  it("ignores a pending record too old to still matter", () => {
    const stale = pendingSeed(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const desc = descAfter(renderSignedOutPanel(fakeLocalApp(stale)), EMAIL_ROW);
    expect(desc).not.toMatch(/open it in the email on this device/i);
  });

  it("puts the sign-in commit ahead of Start free trial on the Email row", () => {
    const ui = renderSignedOutPanel(fakeLocalApp());
    const labels = ui.buttons.map((b) => b.text);
    expect(labels.indexOf("Send sign-in link")).toBeLessThan(
      labels.indexOf("Start free trial"),
    );
    expect(labels.indexOf("Start free trial")).toBeLessThan(
      labels.indexOf("Use promo code"),
    );
  });

  it("keeps the paste field off the sign-in panel and on Advanced, still the different-device fallback (AE9, R10)", () => {
    // The row itself is unchanged (AE9, R10 hold): what moved is where it is. Nothing sells the
    // product on the signed-out screen if the third thing a new reader meets is a token field.
    expect(renderSignedOutPanel(fakeLocalApp()).strings).not.toContain(PASTE_ROW);

    const ui = renderAdvancedPanel(fakeLocalApp());
    expect(descAfter(ui, PASTE_ROW)).toMatch(/different device/i);
    expect(ui.buttons.map((b) => b.text)).toContain("Save session");
  });

  it("says up front when this device cannot sign itself in from a link (R19)", () => {
    stubNoWebCrypto();
    const desc = descAfter(renderSignedOutPanel(fakeLocalApp()), EMAIL_ROW);
    // Now that the fallback is two screens away, the sentence has to carry the route to it.
    expect(desc).toContain(PASTE_ROUTE);
    // It must not promise the automatic sign-in it cannot deliver.
    expect(desc).not.toMatch(/signs itself in\./);
  });

  it("renders no session token", () => {
    const ui = renderSignedOutPanel(fakeLocalApp(pendingSeed()));
    // The `sess_…` placeholder is fine; an actual token value is not.
    expect(ui.strings.filter((s) => /sess_[A-Za-z0-9]/.test(s))).toEqual([]);
  });
});

describe("requesting a sign-in link (R15, U7 binding)", () => {
  afterEach(() => {
    stopCapturingObsidianUi();
    vi.unstubAllGlobals();
    magicLinkMock.mockClear();
  });

  it("sends a fresh verifier hash and the vault, and keeps the verifier local", async () => {
    const app = fakeLocalApp();
    captureObsidianUi();
    await sendLink(fakeTab(app), "a@b.co");

    const call = magicLinkMock.mock.calls[0]!;
    expect(call[1]).toBe("a@b.co");
    expect(call[2]).toMatchObject({ vault: VAULT });
    expect(call[2].verifierHash).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const pending = readPendingSignIns(app);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.vault).toBe(VAULT);
    expect(await s256Challenge(pending[0]!.verifier)).toBe(call[2].verifierHash);
    // Only the hash crosses the wire.
    expect(JSON.stringify(call)).not.toContain(pending[0]!.verifier);
  });

  it("a second request does not strand the link already in flight", async () => {
    const app = fakeLocalApp();
    captureObsidianUi();
    const tab = fakeTab(app);
    await sendLink(tab, "a@b.co");
    await sendLink(tab, "a@b.co");

    const pending = readPendingSignIns(app);
    expect(pending).toHaveLength(2);
    expect(new Set(pending.map((p) => p.verifier)).size).toBe(2);
  });

  it("tells the user to open the link on this device, not to tap Refresh status", async () => {
    const ui = captureObsidianUi();
    await sendLink(fakeTab(fakeLocalApp()), "a@b.co");

    expect(ui.notices).toHaveLength(1);
    expect(ui.notices[0]).toMatch(/this device/i);
    expect(ui.notices[0]).not.toContain("Refresh status");
  });

  it("sends the link unbound where the handoff cannot work, and says so (R19)", async () => {
    stubNoWebCrypto();
    const app = fakeLocalApp();
    const ui = captureObsidianUi();
    await sendLink(fakeTab(app), "a@b.co");

    // The link still goes out — locking sign-in out would be worse than pasting.
    expect(magicLinkMock).toHaveBeenCalledTimes(1);
    expect(magicLinkMock.mock.calls[0]![2].verifierHash).toBeUndefined();
    // Nothing to redeem with, so nothing is recorded as redeemable.
    expect(readPendingSignIns(app)).toEqual([]);
    // And the user is told where to go instead, in their own terms.
    expect(ui.notices).toHaveLength(1);
    expect(ui.notices[0]).toContain(PASTE_ROUTE);
    expect(ui.notices[0]).not.toMatch(/crypto|verifier/i);
  });

  it("does not cry platform trouble on a device that can do the handoff", async () => {
    const ui = captureObsidianUi();
    await sendLink(fakeTab(fakeLocalApp()), "a@b.co");

    expect(ui.notices[0]).not.toContain(PASTE_ROUTE);
    expect(ui.notices[0]).not.toMatch(/paste/i);
    expect(ui.notices[0]).not.toMatch(/can't/i);
  });

  it("records nothing when the service refuses the request", async () => {
    magicLinkMock.mockImplementationOnce(async () => ({
      ok: false as const,
      kind: "http" as const,
      status: 429,
      message: "Too many requests",
    }));
    const app = fakeLocalApp();
    captureObsidianUi();
    await sendLink(fakeTab(app), "a@b.co");

    expect(readPendingSignIns(app)).toEqual([]);
  });
});

/**
 * U3 / KTD1 — the Settings toggle is an enable path too, and the one every re-enable takes.
 *
 * The already-acked branch short-circuits before the consent sheet, so a stamp written only
 * inside the sheet's callback would miss every device whose ack is current. Both branches also
 * fire `runFilingAfterEnable`, so enabling from Settings is not a worse first run than enabling
 * from home. That pass never reaches today (the disclosure promises as much) — what it buys is
 * the empty-window stamp that stops the hourly interval rescanning for the rest of the session.
 */
describe("automatic filing toggle stamps the window (U3)", () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const TOGGLE = "File automatically when Obsidian opens";
  const ACKED = { [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION };

  it("stamps today and fires one filing pass on the already-acked re-enable", async () => {
    const { tab, local, calls } = settingTab({
      local: { ...ACKED, [LS_AUTO_RUN_ENABLED]: false, [LS_AUTO_RUN_START_DAY]: "2026-01-01" },
    });
    tab.display();

    flip(tab, TOGGLE);
    await flush();

    expect(sheetOpen()).toBe(false);
    expect(local.get(LS_AUTO_RUN_ENABLED)).toBe(true);
    expect(local.get(LS_AUTO_RUN_START_DAY)).toBe(localDateString());
    expect(calls.filter((c) => c === "runFilingAfterEnable")).toHaveLength(1);
  });

  it("stamps today and fires one filing pass when the consent sheet is accepted", async () => {
    const { tab, local, calls } = settingTab({});
    tab.display();

    flip(tab, TOGGLE);
    await flush();
    pressSheet("I understand");
    await flush();

    expect(local.get(LS_AUTO_RUN_ENABLED)).toBe(true);
    expect(local.get(LS_AUTO_RUN_START_DAY)).toBe(localDateString());
    expect(calls.filter((c) => c === "runFilingAfterEnable")).toHaveLength(1);
  });

  it("stamps nothing and files nothing when the sheet is declined", async () => {
    const { tab, local, calls } = settingTab({});
    tab.display();

    flip(tab, TOGGLE);
    await flush();
    pressSheet("Cancel");
    await flush();

    expect(local.get(LS_AUTO_RUN_START_DAY)).toBeUndefined();
    expect(calls).not.toContain("runFilingAfterEnable");
  });

  it("preserves the stamp when the toggle goes off (KTD6)", async () => {
    const { tab, local, calls } = settingTab({
      local: { ...ACKED, [LS_AUTO_RUN_ENABLED]: true, [LS_AUTO_RUN_START_DAY]: "2026-01-01" },
    });
    tab.display();

    flip(tab, TOGGLE);
    await flush();

    expect(local.get(LS_AUTO_RUN_ENABLED)).toBe(false);
    expect(local.get(LS_AUTO_RUN_START_DAY)).toBe("2026-01-01");
    expect(calls).not.toContain("runFilingAfterEnable");
  });
});

/**
 * U7 — day one of automatic filing is deliberately silent: the window starts today and every
 * pass excludes today, so a user who enables it and sees nothing concludes it is broken. The
 * toggle carries a persistent line saying when filing starts and where the rest is offered.
 *
 * It must never name `Process unprocessed captures`. That is the one path left unbounded and
 * unpriced, so recommending it beside the toggle hands a trial device a single tap that can
 * spend the whole period allowance on years-old notes. The backfill offer on Atoms home is the
 * bounded answer, and the only one this line may point at.
 *
 * U3 split the line in two rather than deleting it. The paragraph used to say both halves twice
 * over — once here and once as the status group's day-one promise — so the *when* now lives on
 * the toggle's own line, in whichever of its two homes is rendering, and the *where the rest is*
 * lives in the File group's footer, which is on screen in every state.
 */
describe("the enable-time window line (U7)", () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  /** The half that says when filing starts: the toggle's own line, either home. */
  const whenLine = (tab: AtomsSettingTab): string =>
    row(tab, "File automatically when Obsidian opens").textContent ?? "";
  /** The half that says where the older captures are: the File group's footer. */
  const backfillLine = (tab: AtomsSettingTab): string =>
    prose(tab).find((t) => t.includes("backfill")) ?? "";

  it("renders beside the toggle before the user has enabled anything", () => {
    const { tab } = settingTab();
    const before = Notice.messages.length;
    tab.display();

    expect(whenLine(tab)).toContain("Filing starts with tomorrow's note");
    expect(backfillLine(tab)).not.toBe("");
    // Persistent, not a toast: the user is already reading the panel, and a Notice raised here
    // is gone by the time day one's silence needs explaining.
    expect(Notice.messages.slice(before)).toHaveLength(0);
  });

  it("stays on screen after the toggle goes on", async () => {
    const { tab } = settingTab({
      local: { [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION },
    });
    tab.display();

    flip(tab, "File automatically when Obsidian opens");
    await flush();

    expect(whenLine(tab)).toContain("Filing starts with tomorrow's note");
    expect(backfillLine(tab)).not.toBe("");
  });

  it("points at the backfill offer and never at the unbounded process path", () => {
    const { tab } = settingTab();
    tab.display();

    // Both halves, not just the one that names the offer. Splitting the paragraph in two is
    // exactly how the pointer could survive on the half nobody re-checked.
    expect(backfillLine(tab).toLowerCase()).not.toContain("process");
    expect(whenLine(tab).toLowerCase()).not.toContain("process");
    expect(backfillLine(tab)).toContain("Atoms home");
  });
});

/**
 * The version the panel shows is how a user on a phone tells a stale Sync from a current build,
 * so it has to be the manifest's own number, and the three files that carry it have to agree:
 * CI cuts the GitHub Release from `manifest.json` and fails if the tag does not match.
 */
describe("the version the settings panel renders", () => {
  const readJson = (name: string): Record<string, unknown> =>
    JSON.parse(readFileSync(path.resolve(__dirname, `../${name}`), "utf8")) as Record<
      string,
      unknown
    >;

  it("is the one manifest.json carries", () => {
    const version = readJson("manifest.json").version;
    const { tab } = settingTab({ plugin: { manifest: { version } } });
    tab.display();

    expect(prose(tab).some((t) => t.startsWith(`Version ${String(version)} ·`))).toBe(true);
  });

  it("agrees across manifest, package, and versions", () => {
    const version = String(readJson("manifest.json").version);
    expect(readJson("package.json").version).toBe(version);
    expect(Object.keys(readJson("versions.json"))).toContain(version);
  });
});

/**
 * The Capture and File legs, as two groups instead of five headings (U3, R1).
 *
 * The assertions are about what a reader can see: the eyebrows in order, the one footer under
 * each group, and the handful of rules that could not survive the footer sweep as prose and had
 * to stay on their rows (R19).
 */
describe("Capture and File groups (U3)", () => {
  /** The one footer under a group, by the header above it. */
  function footerUnder(tab: AtomsSettingTab, header: string): string {
    const headers = groupHeaders(tab);
    const at = headers.indexOf(header);
    if (at < 0) throw new Error(`no group headed ${header}`);
    const feet = Array.from(
      tab.containerEl.querySelectorAll("p.atoms-setting-group-foot"),
    ).map((el) => el.textContent ?? "");
    const foot = feet[at];
    if (foot === undefined) throw new Error(`group ${header} has no footer`);
    return foot;
  }

  it("groups the two legs under their own headers, in the product's order", () => {
    const { tab } = settingTab();
    tab.display();

    expect(groupHeaders(tab).slice(0, 3)).toEqual(["Get started", "1 · Capture", "2 · File"]);
    const text = tab.containerEl.textContent ?? "";
    expect(text.indexOf("1 · Capture")).toBeLessThan(text.indexOf("2 · File"));
  });

  it("reports Daily Notes as a fact, and never as a blank right edge (R20)", () => {
    const { tab } = filingTab();
    tab.display();
    expect(row(tab, "Daily notes").querySelector(".atoms-setting-status")?.textContent).toBe("On");

    vi.spyOn(dni, "appHasDailyNotesPluginLoaded").mockReturnValue(false);
    const off = settingTab();
    off.tab.display();
    expect(row(off.tab, "Daily notes").querySelector(".atoms-setting-status")?.textContent).toBe(
      "Off",
    );
  });

  // Five, as the plan said: `Your API key (optional)` outlived U3 because its rows belong on the
  // engine destination, and folding a credential into a group whose footer is about what Atoms
  // writes would have put it under the wrong promise. U4 built that destination and took it.
  it("retires the five headings the two groups replace", () => {
    const { tab } = filingTab();
    tab.display();

    const headings = rowNames(tab).filter((name) => !rowNames(tab, { headings: false }).includes(name));
    for (const gone of [
      "Atoms Plus",
      "Capture",
      "Filing",
      "Automatic filing (this device)",
      "Your API key (optional)",
    ]) {
      expect(headings).not.toContain(gone);
    }
  });

  describe("the engine row", () => {
    /** What the row says under its name: the answer to the question the name asks. */
    const answer = (tab: AtomsSettingTab) =>
      row(tab, "Filing").textContent ?? "";

    it("says nothing is chosen when no engine is", () => {
      const { tab } = settingTab();
      tab.display();

      expect(answer(tab)).toContain("Not set up");
    });

    it("names the user's own key as the engine when one is set", () => {
      const { tab } = settingTab({ auth: { mode: "byok", apiKey: "sk-ant-x" } });
      tab.display();

      expect(answer(tab)).toContain("Your own key");
    });

    it("names Plus as the engine, and walks into the screen that changes it", () => {
      const { tab } = filingTab();
      tab.display();

      expect(answer(tab)).toContain("Plus · 12 filings left");
      open(tab, "Filing");
      // The row there is the noun; the state is its description, asserted in the account-row suite.
      expect(destinationNames(tab)).toContain("Atoms Plus");
    });
  });

  /**
   * U4 — the screen the engine row opens: both ways to pay for filing on one screen, and what
   * leaves the device either way. Before it, choosing an engine meant finding an Account row
   * that named only the paid half and a key field three headings further down.
   */
  describe("the engine destination (U4)", () => {
    /**
     * The three egress facts, pinned here rather than imported: each is a promise the pipeline
     * keeps, and a test that reads the same constant the screen renders would pass however the
     * promise changed.
     */
    const ENGINE_STATEMENTS = [
      // `TLS` was the one security fact on the screen stated as an acronym; it now states the
      // promise it was making instead.
      "Each capture, and the titles of your notes, encrypted on the way",
      "Never the text inside your other notes, and never your whole vault",
      "Nothing from today, unless you ask for it",
    ];

    /** The engine screen, walked into the way a user reaches it. */
    function engineScreen(opts: SettingTabOptions = {}) {
      const made = settingTab(opts);
      made.tab.display();
      open(made.tab, "Filing");
      return made;
    }

    /** One tap further: the screen the credential form moved to. */
    function keyScreen(opts: SettingTabOptions = {}) {
      const made = engineScreen(opts);
      open(made.tab, "Use your own Anthropic key");
      return made;
    }

    it("renders three groups, the recommendation first and the alternative under it", () => {
      const { tab } = engineScreen();

      // Not two peers under one "Pick one": a recommended path and an escape hatch at equal
      // weight leave the reader to work out which is which, and this reader cannot.
      expect(groupHeaders(tab)).toEqual([
        "Recommended",
        "Instead",
        "What gets sent",
      ]);
      // The back row doubles as the screen's title, so leaving never means scrolling down.
      const back = tab.containerEl.querySelector(".atoms-setting-back");
      expect(back?.querySelector(".setting-item-name")?.textContent).toBe(
        "Filing",
      );
    });

    it("holds a decision and no credential control", () => {
      const { tab } = engineScreen();

      expect(rowNames(tab, { headings: false })).toEqual([
        // The back row is a row too, and it leads the screen.
        "Filing",
        "Atoms Plus",
        "Use your own Anthropic key",
        ...ENGINE_STATEMENTS,
      ]);
      // Both engines are chevrons now. The key field used to sit inline here, which made the
      // screen a decision and a credential form at once and put seven undefined terms in front
      // of somebody four minutes into Atoms.
      expect(destinationNames(tab)).toEqual([
        "Atoms Plus",
        "Use your own Anthropic key",
      ]);
      for (const jargon of [
        "Anthropic API key",
        "Device-local key fallback",
        "sk-ant-",
        "SecretStorage",
      ]) {
        expect(tab.containerEl.textContent ?? "").not.toContain(jargon);
      }
    });

    it("stores a typed secret id through SecretStorage, not data.json", () => {
      const { tab, plugin } = keyScreen();

      fill(tab, "Anthropic API key", "my-other-key");
      expect(plugin.settings.apiKeySecretId).toBe("my-other-key");
    });

    it("deletes the device-local key when the fallback toggle goes off", () => {
      const { tab, local } = keyScreen({
        settings: { useDeviceLocalKeyFallback: true },
        local: { [LOCAL_STORAGE_API_KEY]: "sk-ant-local" },
      });
      expect(rowNames(tab, { headings: false })).toContain("Device-local API key");

      flip(tab, "Device-local key fallback");

      expect(local.get(LOCAL_STORAGE_API_KEY)).toBeNull();
    });

    it("states what leaves the device without repeating the versioned disclosure", () => {
      const { tab } = engineScreen();
      const text = tab.containerEl.textContent ?? "";

      for (const line of ENGINE_STATEMENTS) expect(text).toContain(line);
      // The sheet owns the wording an ack is recorded against (KTD5). A second copy on a screen
      // no ack version covers is the #315 shape: a record naming text the user never saw.
      expect(text).not.toContain(EGRESS_DISCLOSURE);
    });

    it("promises nothing about features, because a Plus session does unlock Ask", () => {
      const { tab } = engineScreen();
      const text = tab.containerEl.textContent ?? "";

      // Same claim, said about filing rather than about the product: what is identical between
      // the two engines is the filing, not what a Plus session unlocks (R13).
      expect(text).toContain("Same atoms, same links, same speed");
      expect(text).not.toContain("Nothing here unlocks features");
    });

    it("quotes the price from the pricing SSOT rather than a literal in the screen", () => {
      const { tab } = engineScreen();
      const text = tab.containerEl.textContent ?? "";

      expect(text).toContain(`${PLUS_PRICING.trialDays} days free`);
      expect(text).toContain(`${formatUsd(PLUS_PRICING.monthlyUsd)} a month`);
      // Nothing else on the screen quotes money: a second amount is a copy that goes stale in
      // silence, which is the rule `src/shared/plusPricing.ts` exists to enforce.
      expect(text.match(/\$\d+/g)).toEqual([formatUsd(PLUS_PRICING.monthlyUsd)]);
    });

    it("writes no em dash into any of its prose", () => {
      const { tab } = engineScreen();

      for (const line of prose(tab)) expect(line).not.toContain("—");
    });

    /**
     * The credential form, one tap off the decision.
     *
     * Every term this screen carries was on the decision screen until now. None was deleted;
     * they render in front of the one reader who chose to meet them.
     */
    describe("the key destination", () => {
      it("holds the key rows and the naming rule that answers for them", () => {
        const { tab } = keyScreen();

        expect(rowNames(tab, { headings: false })).toEqual([
          "Use your own Anthropic key",
          "Anthropic API key",
          "Device-local key fallback",
        ]);
        expect(prose(tab).join(" ")).toContain(API_KEY_SECRET_ID_DEFAULT);
      });

      it("writes no em dash into any of its prose", () => {
        const { tab } = keyScreen();

        for (const line of prose(tab)) expect(line).not.toContain("—");
      });
    });
  });

  describe("the atom folder row", () => {
    it("still rejects .. and subfolders", () => {
      const { tab, plugin } = filingTab();
      tab.display();

      fill(tab, "Atom folder", "../escape");
      expect(plugin.settings.atomFolder).toBe("Atoms");
      fill(tab, "Atom folder", "Notes/Atoms");
      expect(plugin.settings.atomFolder).toBe("Atoms");
      fill(tab, "Atom folder", "Thoughts");
      expect(plugin.settings.atomFolder).toBe("Thoughts");
    });

    /**
     * Every rule, not only the two this row started with. `clampAtomFolder` rejects four kinds of
     * folder now (#501 added the leading dot and the length cap), and this description is still
     * the only surface that ever tells a user a fallback happened — silently for the two new ones
     * would be the same bug wearing a newer guard. Matched case-insensitively so the sentence can
     * be worded naturally.
     */
    it("still states those rules to the user, because nothing else reports the fallback", () => {
      const { tab } = filingTab();
      tab.display();

      const desc =
        row(tab, "Atom folder")
          .querySelector(".setting-item-description")
          ?.textContent?.toLowerCase() ?? "";
      expect(desc).toContain("..");
      expect(desc).toContain("subfolder");
      expect(desc).toContain("dot");
      expect(desc).toContain("too long");
    });

    it("keeps an overlong value in the field rather than in the row's own text", () => {
      const long = "L".repeat(200);
      const { tab } = filingTab({ settings: { atomFolder: long } });
      tab.display();

      const folder = row(tab, "Atom folder");
      expect(folder.querySelector("input")?.value).toBe(long);
      // The name is what a truncating right edge must never eat, so it has to survive whole —
      // and the value must not be row text, which would grow the row instead of clipping.
      expect(folder.querySelector(".setting-item-name")?.textContent).toBe("Atom folder");
      expect(folder.textContent).not.toContain(long);
    });
  });

  it("reveals the hub-list refresh only while its toggle is on", async () => {
    const { tab } = filingTab();
    tab.display();
    expect(rowNames(tab, { headings: false })).not.toContain("Refresh hub lists");

    flip(tab, "List atoms on hub notes");
    // The toggle saves before it rebuilds, so the row it reveals arrives a microtask later.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const rows = rowNames(tab, { headings: false });
    expect(rows).toContain("Refresh hub lists");
    expect(rows.indexOf("Refresh hub lists")).toBe(rows.indexOf("List atoms on hub notes") + 1);
  });

  describe("the two footers", () => {
    it("says Atoms never captures for you, under the Capture group (R10)", () => {
      const { tab } = filingTab();
      tab.display();

      expect(footerUnder(tab, "1 · Capture")).toContain("Atoms never captures for you.");
    });

    it("names every kind of write Atoms makes, under the File group (R11)", () => {
      const { tab } = filingTab();
      tab.display();

      const foot = footerUnder(tab, "2 · File");
      expect(foot).toContain("never rewritten");
      expect(foot).toContain("atom files");
      expect(foot).toContain("marker line");
      expect(foot).toContain("block on hub notes");
    });

    it("carries no em dash on any group footer (R15)", () => {
      const { tab } = filingTab();
      tab.display();

      const feet = Array.from(
        tab.containerEl.querySelectorAll("p.atoms-setting-group-foot"),
      ).map((el) => el.textContent ?? "");
      expect(feet.length).toBeGreaterThan(0);
      for (const foot of feet) expect(foot).not.toContain("—");
    });

    /**
     * The "Your data" footer says what is behind each row under it, and the Privacy row is
     * conditional — a fresh install has allowed nothing, so it renders no such row. A footer that
     * describes a row that is not there is worst on the one state every user starts in.
     */
    it("does not name Privacy in the footer when there is no Privacy row", () => {
      const { tab } = settingTab();
      tab.display();

      expect(rowNames(tab, { headings: false })).not.toContain("Privacy and consents");
      const foot = utilityFooter(tab);
      expect(foot).not.toContain("Privacy");
      expect(foot).toContain("Advanced holds the settings almost nobody needs.");
    });

    it("names Privacy again once there is something to take back", () => {
      const { tab } = settingTab({
        local: {
          [LS_AUTO_RUN_ENABLED]: true,
          [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
        },
      });
      tab.display();

      expect(rowNames(tab, { headings: false })).toContain("Privacy and consents");
      expect(utilityFooter(tab)).toContain("Privacy holds what you have allowed");
    });
  });

  /**
   * The orphan U2 left: the automatic-filing heading and its two paragraphs stayed behind when
   * the toggle moved, so a filing install read a heading with no control under it and the
   * day-one promise twice on one screen.
   */
  describe("the automatic-filing chrome the toggle left behind", () => {
    it("leaves no headed section without its control", () => {
      const { tab } = filingTab();
      tab.display();

      const text = tab.containerEl.textContent ?? "";
      expect(text).not.toContain("Automatic filing (this device)");
      expect(prose(tab).some((t) => t.startsWith("Stored only on this device"))).toBe(false);
    });

    it("promises the first atoms exactly once", () => {
      const { tab } = filingTab({
        local: {
          [LS_AUTO_RUN_ENABLED]: true,
          [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
        },
      });
      tab.display();

      const said = (tab.containerEl.textContent ?? "").match(/tomorrow/gi) ?? [];
      // "First atoms arrive tomorrow morning." and the "Next run" row's own fact, and nothing
      // else: the auto-run section used to say it a third time under a heading of its own.
      expect(said).toHaveLength(2);
    });
  });
});
