import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
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
} from "../src/pipeline/context";
import { runWritePath } from "../src/pipeline/write";
import { accountRowDescriptor, type AccountState } from "../src/settings/settings";
import type { PlusSession } from "../src/platform/filingAuth";
import {
  destinationNames,
  open,
  rowNames,
  settingTab,
  type SettingTabOptions,
} from "./helpers/settingsTab";
import { DEFAULT_SETTINGS, type LinkerSettings } from "../src/shared/types";
import {
  atomResult,
  fakeClassify,
  fakeVault,
  stubDailyNotes,
  type VaultDouble,
} from "./helpers/pipelineVault";

afterEach(() => vi.restoreAllMocks());

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

async function processWith(v: VaultDouble, s: LinkerSettings) {
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
    ...shortlistOptionsFromSettings(s),
    classifyDeps: { request: classify.request as never },
  });
  return rec;
}

describe("shortlist size setting (R8)", () => {
  it("defaults to the studied k when nothing is configured (KTD6)", () => {
    expect(DEFAULT_SETTINGS.shortlistSize).toBe(DEFAULT_SHORTLIST_K);
    expect(clampShortlistSize(undefined)).toBe(DEFAULT_SHORTLIST_K);
    expect(shortlistOptionsFromSettings()).toEqual({
      shortlistK: DEFAULT_SHORTLIST_K,
      expandGraph: DEFAULT_GRAPH_EXPANSION,
    });
    // A data.json written before this version has neither key.
    expect(shortlistOptionsFromSettings({})).toEqual({
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

  it("arrives at getCandidates, not merely in data.json", async () => {
    const v = linkedVault();
    const rec = await processWith(v, settings({ shortlistSize: 1 }));

    expect(rec.seen.length).toBeGreaterThan(0);
    expect(rec.seen[0]!.stats.k).toBe(1);
    // One scored slot honoured: only the expansion slots sit on top of it.
    expect(rec.seen[0]!.shortlist.filter((c) => c.score > 0)).toHaveLength(1);
  });

  it("clamps an invalid stored size on the way into the run", async () => {
    const v = linkedVault();
    const rec = await processWith(
      v,
      settings({ shortlistSize: 0 as LinkerSettings["shortlistSize"] }),
    );

    expect(rec.seen[0]!.stats.k).toBe(MIN_SHORTLIST_K);
    expect(rec.seen[0]!.titles.length).toBeGreaterThan(0);
  });
});

describe("linked-notes setting on the daily path (R7)", () => {
  it("is on by default, and the daily path reaches a note BM25 scored zero", async () => {
    const v = linkedVault();
    const rec = await processWith(v, settings());

    expect(rec.seen[0]!.stats.expanded).toBe(1);
    expect(rec.seen[0]!.titles).toContain("Roasters");
  });

  it("off is honoured: no walk runs and the stats key is absent entirely", async () => {
    const v = linkedVault();
    const rec = await processWith(v, settings({ expandLinkedNotes: false }));

    expect(rec.beginOpts[0]).toMatchObject({ expandGraph: false });
    // Absent, not zero — the off case is byte-identical to the pre-expansion output.
    expect("expanded" in rec.seen[0]!.stats).toBe(false);
    expect(rec.seen[0]!.titles).not.toContain("Roasters");
  });
});

describe("shortlist diagnostics (R6)", () => {
  it("reports the counts the setting is tuned by", async () => {
    const v = linkedVault();
    const rec = await processWith(v, settings({ shortlistSize: 50 }));
    const payload = shortlistDiagnostics(rec.seen[0]!.stats);

    expect(payload.k).toBe(50);
    expect(payload.expansion).toBe("on");
    expect(payload.slotsUsed).toBe(1);
    expect(payload.slotLimit).toBeGreaterThan(0);
    expect(payload.seeds).toBe(payload.scored);
    expect(payload.scored + payload.slotsUsed).toBe(payload.returned);
    expect(payload.matched + payload.zeroScoring).toBe(payload.corpusSize);
  });

  it("drops the expansion counts to zero when the walk never ran", async () => {
    const v = linkedVault();
    const rec = await processWith(v, settings({ expandLinkedNotes: false }));
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

    const names = rowNames(tab);
    expect(names).toContain("Email");
    expect(names).toContain("Start free trial");
    expect(names).toContain("Sign in on another device");
    expect(names).toContain("Advanced: paste session");
    expect(names).not.toContain("Manage subscription");
    expect(names).not.toContain("Sign out");
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
