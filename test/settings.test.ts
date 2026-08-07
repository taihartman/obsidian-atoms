import { existsSync } from "node:fs";
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
} from "../src/settings/settings";
import {
  readPendingSignIns,
  type PlusSession,
} from "../src/platform/filingAuth";
import { s256Challenge } from "../src/platform/pkce";
import { requestMagicLink } from "../src/platform/plusClient";
import {
  destinationNames,
  dismissSheet,
  flip,
  open,
  press,
  pressSheet,
  prose,
  row,
  rowNames,
  settingTab,
  sheetOpen,
  sheetText,
  fill,
  type SettingTabOptions,
} from "./helpers/settingsTab";
import {
  EGRESS_ACK_VERSION,
  LS_AUTO_RUN_EGRESS_ACK,
  LS_AUTO_RUN_ENABLED,
  LS_LAST_RUN_DAY,
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

  it.each(STATES)("renders the %s main-screen label", (_name, opts, label) => {
    const { tab } = settingTab(opts);
    tab.display();

    expect(destinationNames(tab)).toContain(label);
    // One account row, not one per branch: no other state's label is on screen with it.
    const others = STATES.map(([, , other]) => other).filter((other) => other !== label);
    expect(rowNames(tab).filter((name) => others.includes(name))).toEqual([]);
  });

  it("holds Refresh status, Sign out, and Account exactly once in the destination", () => {
    const { tab } = activeTab();
    tab.display();
    open(tab, "Plus · 12 filings left");

    const names = rowNames(tab);
    for (const once of ["Refresh status", "Sign out", "Account"]) {
      expect(names.filter((name) => name === once)).toEqual([once]);
    }
    // The email is still shown, under the back row that already says "Account".
    expect(names.filter((name) => name === "Signed in as")).toEqual(["Signed in as"]);
    expect(tab.containerEl.textContent).toContain("user@example.com");
    // And nowhere else: the main screen carries the account row alone.
    tab.hide();
    tab.display();
    expect(rowNames(tab)).not.toContain("Refresh status");
    expect(rowNames(tab)).not.toContain("Sign out");
  });

  it("offers account setup and no Manage row when signed out", () => {
    const { tab } = settingTab();
    tab.display();
    open(tab, "Set up automatic filing");

    // The exact list, not a membership check: each field and the one button that commits it is
    // now a single row, and a regression that re-splits a pair shows up here as an extra row.
    // "Start free trial" survives as the button label on the Email row, never as a row name.
    expect(rowNames(tab)).toEqual([
      "Account",
      "Skip the API key",
      "Email",
      // Renamed by #240: the emailed link now signs *this* device in, so "another device" is the
      // paste fallback's job rather than this row's.
      "Sign in with a link",
      "Advanced: paste session",
    ]);
    expect(buttonLabels(tab, "Email")).toEqual(["Start free trial"]);
    expect(buttonLabels(tab, "Sign in with a link")).toEqual(["Send sign-in link"]);
    expect(buttonLabels(tab, "Advanced: paste session")).toEqual(["Save session"]);
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
      open(tab, "Set up automatic filing");
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
      fill(tab, "Sign in with a link", "back@example.com");
      press(tab, "Sign in with a link", "Send sign-in link");

      expect(handler).toHaveBeenCalledWith("back@example.com");
    });

    it("refuses a sign-in link for an address without an @", () => {
      const { tab, handler } = accountScreen("sendPlusMagicLink");
      const ui = captureObsidianUi();

      fill(tab, "Sign in with a link", "nobody");
      press(tab, "Sign in with a link", "Send sign-in link");

      expect(handler).not.toHaveBeenCalled();
      expect(ui.notices).toEqual(["Enter a valid email first"]);
    });

    it("trims the pasted session before the sess_ check ever sees it", () => {
      const { tab, handler } = accountScreen("savePastedSession");
      // A token pasted out of an email arrives with the whitespace around it.
      fill(tab, "Advanced: paste session", "  sess_live  ");
      press(tab, "Advanced: paste session", "Save session");

      expect(handler).toHaveBeenCalledWith("sess_live");
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
});

/**
 * The vocabulary is the cluster that grows without bound — one row per active tag, per proposal,
 * and per tag already used in the vault, which is how the settings screen was heading for ninety
 * rows. These assert the replacement: one counted row on the main screen, and every capability
 * still reachable one screen in.
 */
describe("tag vocabulary", () => {
  const entry = (n: number) => `Tag vocabulary — ${n} active`;

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
      const { tab } = askTab(
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
      const { tab, local } = askTab({}, {
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

      expect(rowNames(tab)).not.toContain("What Atoms sends to Anthropic");
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
      expect(rowNames(tab)).toContain("What Atoms sends to Anthropic");
    });

    it("shows the Ask privacy ack even while the mirror is off", () => {
      const { tab } = askTab({ ...PRIVACY_GRANTED, askEnabled: false });

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
      tab.display();

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
      const { tab } = askTab();

      expect(rowNames(tab)).not.toContain("What Atoms sends to Anthropic");
      expect(rowNames(tab)).not.toContain("What Ask stores and shares");
      expect(rowNames(tab)).not.toContain("Vault write acknowledgment");
    });
  });

  describe("withdrawing", () => {
    it("clears the egress ack and force-disables auto-run", async () => {
      const { tab, local } = askTab({}, {
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
      const { tab, local } = askTab(
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
      const { tab } = askTab({
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
      const { tab } = askTab({
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

      // Enable, then withdraw while the enable is still waiting on its own write to disk.
      flip(tab, "Ask mirror");
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

  it("reports a malformed key inline, without claiming success or asking the network", async () => {
    const net = network(200);
    const { tab } = settingTab({ apiKey: "hunter2", request: net.request });
    tab.display();
    await flush();

    expect(keyRowText(tab)).toContain("does not look like an Anthropic API key");
    expect(keyRowText(tab)).not.toContain("works");
    expect(net.anthropicCalls()).toBe(0);
  });

  it("distinguishes a key it could not check from a key that was rejected", async () => {
    const offline = settingTab({ apiKey: KEY, request: network("offline").request });
    offline.tab.display();
    await flush();

    const rejected = settingTab({ apiKey: KEY, request: network(401).request });
    rejected.tab.display();
    await flush();

    expect(keyRowText(offline.tab)).toContain("Could not reach Anthropic");
    expect(keyRowText(offline.tab)).not.toContain("rejected");
    expect(keyRowText(rejected.tab)).toContain("rejected");
    expect(keyRowText(rejected.tab)).not.toContain("Could not reach Anthropic");
  });

  it("says the key works when Anthropic answers", async () => {
    const { tab } = settingTab({ apiKey: KEY, request: network(200).request });
    tab.display();
    await flush();

    expect(keyRowText(tab)).toContain("works");
  });

  it("shows a checking state while the network check is in flight", async () => {
    const { tab } = settingTab({ apiKey: KEY, request: network(200).request });
    tab.display();

    // Before the probes settle: neither terminal outcome, and visibly in progress.
    expect(keyRowText(tab)).toContain("Checking");
    expect(keyRowText(tab)).not.toContain("works");
    expect(keyRowText(tab)).not.toContain("Could not reach");

    await flush();
    expect(keyRowText(tab)).toContain("works");
  });

  it("re-verifies a key already saved, with no re-entry", async () => {
    const net = network(200);
    const { tab } = settingTab({ apiKey: KEY, request: net.request });
    tab.display();
    await flush();

    expect(net.anthropicCalls()).toBe(1);
    expect(keyRowText(tab)).toContain("works");
  });

  it("does not re-check on every redisplay", async () => {
    const net = network(200);
    const { tab } = settingTab({ apiKey: KEY, request: net.request });
    tab.display();
    await flush();

    // Any toggle elsewhere on the screen re-renders the whole tab.
    flip(tab, "Sync when you return to Obsidian");
    flip(tab, "Sync when you return to Obsidian");
    flip(tab, "Sync when you return to Obsidian");
    await flush();

    expect(net.anthropicCalls()).toBe(1);
    expect(keyRowText(tab)).toContain("works");
  });

  it("re-checks on the next visit to Settings", async () => {
    const net = network(200);
    const { tab } = settingTab({ apiKey: KEY, request: net.request });
    tab.display();
    await flush();
    expect(net.anthropicCalls()).toBe(1);

    tab.hide();
    tab.display();
    await flush();

    expect(net.anthropicCalls()).toBe(2);
  });

  it("costs nothing to open Settings — no baseline ping, and no billable request", async () => {
    const seen: Array<{ url: string; body?: unknown }> = [];
    const request: ConnectivityRequest = async (params) => {
      seen.push({ url: params.url, body: params.body });
      return { status: 200, text: "", json: {}, arrayBuffer: new ArrayBuffer(0), headers: {} } as never;
    };
    const { tab } = settingTab({ apiKey: KEY, request });
    tab.display();
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
    tab.display();

    // drain → outbox → mirror → filing is long enough that an impatient second tap lands while
    // the first run is still going.
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
    const urls: string[] = [];
    const request: ConnectivityRequest = async (params) => {
      urls.push(params.url);
      return { status: 200, text: "", json: {}, arrayBuffer: new ArrayBuffer(0), headers: {} } as never;
    };
    const anthropicCalls = () => urls.filter((u) => u.includes("anthropic")).length;

    const { tab } = settingTab({
      session: PLUS_SESSION,
      apiKey: KEY,
      request,
      settings: { ...PRIVACY_GRANTED, askEnabled: true },
      plugin: { saveSettings: () => pendingSave },
    });
    tab.display();
    await flush();
    expect(anthropicCalls()).toBe(1);

    // A gesture that waits on something — here a write to disk, in the app a network round
    // trip — and a user who leaves Settings before it comes back.
    flip(tab, "Ask mirror");
    tab.hide();
    release();
    await flush();

    // Nothing re-renders for a tab that is gone, and nothing re-asks Anthropic about it.
    expect(anthropicCalls()).toBe(1);
  });

  it("declines an open sheet without rebuilding the screen it is leaving", async () => {
    const urls: string[] = [];
    const request: ConnectivityRequest = async (params) => {
      urls.push(params.url);
      return { status: 200, text: "", json: {}, arrayBuffer: new ArrayBuffer(0), headers: {} } as never;
    };
    const anthropicCalls = () => urls.filter((u) => u.includes("anthropic")).length;

    const { tab } = settingTab({ session: PLUS_SESSION, apiKey: KEY, request });
    tab.display();
    await flush();
    expect(anthropicCalls()).toBe(1);

    flip(tab, "Ask mirror");
    await flush();
    expect(sheetOpen()).toBe(true);

    tab.hide();
    await flush();

    // The decline still happens: no ack, mirror still off.
    expect(sheetOpen()).toBe(false);
    expect(tab.plugin.settings.askPrivacyAckAt).toBe("");
    expect(tab.plugin.settings.askEnabled).toBe(false);
    // But nothing re-renders on the way out, so the screen the user just closed asks Anthropic
    // nothing on its way to being thrown away.
    expect(anthropicCalls()).toBe(1);
  });
});

describe("Connect Claude or ChatGPT destination (U6)", () => {
  const CONNECT_ROWS = [
    "MCP connector URL",
    "Link Claude / ChatGPT",
    "Sync now",
    "Cloud mirror status",
    "Wipe cloud copy",
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

  it("still asks before wiping the cloud copy", async () => {
    const { tab, calls } = settingTab({
      session: PLUS_SESSION,
      settings: { askEnabled: true, ...PRIVACY_GRANTED },
    });
    tab.display();
    open(tab, "Connect Claude or ChatGPT");

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
    tab.display();
    open(tab, "Connect Claude or ChatGPT");

    // The one destructive row on the screen. Two confirm modals over each other is a question
    // the user answers once and a wipe they authorized once.
    press(tab, "Wipe cloud copy", "Wipe");
    press(tab, "Wipe cloud copy", "Wipe");

    expect(Modal.open).toHaveLength(1);
  });
});

/**
 * U6 / R5 — Advanced may hold only rows that neither enable nor disable money spend, cloud
 * egress, or vault writes. Asserted by exercising whatever rows are actually there rather than
 * by listing their names: a list passes forever, including the day a gate is moved in.
 */
describe("Advanced destination (U6, R5)", () => {
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
   * clicking detached nodes while never touching the screen the user is looking at. Rows already
   * exercised are remembered by element identity, so a re-render's fresh rows are exercised too
   * and the walk still terminates.
   */
  function exerciseEveryControl(tab: AtomsSettingTab): void {
    const exercised = new Set<Element>();
    for (let guard = 0; guard < 200; guard += 1) {
      const el = Array.from(tab.containerEl.querySelectorAll(".setting-item")).find(
        (candidate) =>
          !candidate.classList.contains("atoms-setting-back") && !exercised.has(candidate),
      );
      if (!el) return;
      exercised.add(el);
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
  }

  it("holds the two rows and nothing else", () => {
    const { tab } = advanced();
    expect(rowNames(tab)).toEqual(["Advanced", "Model", "Plus service URL override"]);
  });

  it("keeps the device-local key path out — it is a credential path, not plumbing", () => {
    // `getApiKey()` falls back to that key, so the pair enables Anthropic spend on its own.
    const { tab } = advanced({ settings: { useDeviceLocalKeyFallback: true } });
    expect(rowNames(tab)).not.toContain("Device-local key fallback");
    expect(rowNames(tab)).not.toContain("Device-local API key");
  });

  it("carries the caution that used to sit above these rows", () => {
    const { tab } = advanced();
    expect(tab.containerEl.textContent).toContain(
      "Leave these alone unless you self-host or dogfood a local Plus server",
    );
  });

  it("holds no control that enables or disables money, egress, or vault writes", async () => {
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
    // Every gate acts through the plugin to do its work, so a screen of pure preferences
    // reaches the plugin for persistence and for nothing else.
    expect([...new Set(calls.slice(from))]).toEqual(["saveSettings"]);
    // A gate reached from here would ask for consent before it moved a value, and an unanswered
    // sheet moves nothing — so the values matching above is not on its own proof of no gate.
    // The sheet appearing at all is.
    expect(sheetOpen()).toBe(false);
  });

  it("keeps the one redirect it does hold inert on its own", async () => {
    const { tab, local } = advanced();
    const before = gateState(tab, local);

    fill(tab, "Plus service URL override", "http://127.0.0.1:8787");
    await flush();

    // The override redirects where egress goes; it cannot turn egress on.
    expect(tab.plugin.settings.plusBaseUrl).toBe("http://127.0.0.1:8787");
    expect(gateState(tab, local)).toEqual(before);
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

  function expectedRows(account: string): string[] {
    const vocabulary = `Tag vocabulary — ${DEFAULT_SETTINGS.activeVocabulary.length} active`;
    return [
      account,
      "iCloud shortcut link",
      "Capture Atom shortcut",
      "Atom folder",
      "List atoms in person notes",
      vocabulary,
      ...ASK_ROWS,
      "File automatically when Obsidian opens",
      "Sync when you return to Obsidian",
      "Sync everything now",
      "Anthropic API key",
      // A credential path that enables Anthropic spend, so R5 keeps it on the main screen
      // rather than in Advanced — with the key row itself appearing only once it is on.
      "Device-local key fallback",
      "Advanced",
    ];
  }

  it("renders the fifteen rows of the plan's table, in order, signed in to Plus", () => {
    const { tab } = plusTab();
    tab.display();

    const rows = rowNames(tab, { headings: false });
    expect(rows).toEqual(expectedRows("Plus · 12 filings left"));
    expect(rows).toHaveLength(15);
  });

  it("renders twelve rows signed out — the Ask cluster is the only difference", () => {
    const { tab } = settingTab();
    tab.display();

    const rows = rowNames(tab, { headings: false });
    expect(rows).toEqual(
      expectedRows("Set up automatic filing").filter((name) => !ASK_ROWS.includes(name)),
    );
    expect(rows).toHaveLength(12);
  });

  it("adds the device-local key row under its toggle, and nowhere else", () => {
    const { tab } = settingTab({ settings: { useDeviceLocalKeyFallback: true } });
    tab.display();

    const rows = rowNames(tab, { headings: false });
    expect(rows).toHaveLength(13);
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
    expect(prose.some((text) => text.includes("Write top-level bullets"))).toBe(true);
  });

  it("keeps opening today's daily as a command, and off the settings screen", () => {
    const commands = registeredCommands();
    const daily = commands.find((c) => c.id === "open-todays-daily");
    expect(daily, "no Atoms command opens today's daily note").toBeDefined();

    const { tab } = plusTab();
    tab.display();
    expect(rowNames(tab, { headings: false })).not.toContain("Open today's daily");
  });

  it("leaves the self-host guide to documentation rather than a settings row", () => {
    const { tab } = plusTab();
    tab.display();
    expect(rowNames(tab, { headings: false })).not.toContain("Self-host Ask");
    expect(existsSync(path.resolve(__dirname, "../docs/ask-self-host.md"))).toBe(true);
  });

  /**
   * A status fact has a name and a value, which is what `statusRow` is for. Rendered as a loose
   * paragraph it drifts out of the grammar and reads as prose the user has to parse.
   */
  describe("status facts", () => {
    it("names the last auto-run day on a status row", () => {
      const { tab } = settingTab({
        session: PLUS_SESSION,
        local: { [LS_LAST_RUN_DAY]: "2026-07-29" },
      });
      tab.display();

      const rows = rowNames(tab, { headings: false });
      expect(rows).toContain("Last auto-run day (this device)");
      expect(row(tab, "Last auto-run day (this device)").textContent).toContain("2026-07-29");
      expect(prose(tab).some((t) => t.startsWith("Last auto-run day"))).toBe(false);
    });

    it("names the last catch-up on a status row", () => {
      const { tab } = settingTab({
        session: PLUS_SESSION,
        plugin: { getLastCatchupLine: () => "Last catch-up 18m ago: caught up" },
      });
      tab.display();

      expect(rowNames(tab, { headings: false })).toContain("Last catch-up");
      expect(row(tab, "Last catch-up").textContent).toContain("18m ago: caught up");
      expect(prose(tab).some((t) => t.startsWith("Last catch-up"))).toBe(false);
    });

    it("keeps the secret-id example with the key row instead of splitting the pair below it", () => {
      const { tab } = plusTab();
      tab.display();

      // The tip belongs to the field it describes, so it lives in that row — not as a paragraph
      // wedged between the key row and the fallback toggle that answers for the same key.
      expect(row(tab, "Anthropic API key").textContent).toContain(API_KEY_SECRET_ID_DEFAULT);
      expect(prose(tab).some((t) => t.startsWith("Tip: secret id example"))).toBe(false);
    });
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
      open(tab, `Tag vocabulary — ${active.length} active`);
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
      open(tab, "Tag vocabulary — 1 active");
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
      open(tab, "Tag vocabulary — 2 active");
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
const SIGN_IN_ROW = "Sign in with a link";
const PASTE_ROW = "Advanced: paste session";

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
      // The assertion is only meaningful if the panel really rendered: both the
      // sign-in-link row and the paste row have to be among the strings checked.
      expect(ui.strings).toContain(SIGN_IN_ROW);
      expect(ui.strings).toContain(PASTE_ROW);
      const offenders = ui.strings.filter((s) => s.includes("Refresh status"));
      expect(offenders).toEqual([]);
    }
  });

  it("describes the emailed link only once a link has been requested", () => {
    const before = descAfter(renderSignedOutPanel(fakeLocalApp()), SIGN_IN_ROW);
    expect(before).toMatch(/email a one-time link/i);
    expect(before).not.toMatch(/sent/i);

    const after = descAfter(
      renderSignedOutPanel(fakeLocalApp(pendingSeed())),
      SIGN_IN_ROW,
    );
    expect(after).toMatch(/open it in the email on this device/i);
  });

  it("ignores a pending record too old to still matter", () => {
    const stale = pendingSeed(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const desc = descAfter(renderSignedOutPanel(fakeLocalApp(stale)), SIGN_IN_ROW);
    expect(desc).not.toMatch(/open it in the email on this device/i);
  });

  it("keeps the paste field below the link row, as the different-device fallback (AE9, R10)", () => {
    const ui = renderSignedOutPanel(fakeLocalApp());
    expect(ui.strings.indexOf(PASTE_ROW)).toBeGreaterThan(
      ui.strings.indexOf(SIGN_IN_ROW),
    );
    expect(descAfter(ui, PASTE_ROW)).toMatch(/different device/i);
    expect(ui.buttons.map((b) => b.text)).toContain("Save session");
  });

  it("says up front when this device cannot sign itself in from a link (R19)", () => {
    stubNoWebCrypto();
    const desc = descAfter(renderSignedOutPanel(fakeLocalApp()), SIGN_IN_ROW);
    expect(desc).toMatch(/Advanced: paste session/);
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
    expect(ui.notices[0]).toMatch(/Advanced: paste session/);
    expect(ui.notices[0]).not.toMatch(/crypto|verifier/i);
  });

  it("does not cry platform trouble on a device that can do the handoff", async () => {
    const ui = captureObsidianUi();
    await sendLink(fakeTab(fakeLocalApp()), "a@b.co");

    expect(ui.notices[0]).not.toMatch(/paste session/i);
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
