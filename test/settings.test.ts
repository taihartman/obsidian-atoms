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
  type ShortlistRunOptions,
} from "../src/pipeline/context";
import { runWritePath } from "../src/pipeline/write";
import {
  accountRowDescriptor,
  type AccountState,
  type AtomsSettingTab,
  type ConnectivityRequest,
} from "../src/settings/settings";
import type { PlusSession } from "../src/platform/filingAuth";
import {
  destinationNames,
  dismissSheet,
  flip,
  open,
  press,
  pressSheet,
  row,
  rowNames,
  settingTab,
  sheetOpen,
  sheetText,
  fill,
  type SettingTabOptions,
} from "./helpers/settingsTab";
import {
  LS_AUTO_RUN_EGRESS_ACK,
  LS_AUTO_RUN_ENABLED,
} from "../src/platform/autorun";
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
    expect(rowNames(tab).filter((name) => name.startsWith("Dismiss "))).toEqual([]);
  });

  it("renders the Proposed group when a classify run proposed something", () => {
    const { tab } = settingTab({
      settings: { activeVocabulary: ["idea"], proposedTags: ["gardening"] },
    });
    tab.display();
    open(tab, entry(1));

    expect(tab.containerEl.textContent).toContain("Proposed (approve to activate)");
    // One right edge per row, so approve and dismiss are two rows rather than two buttons.
    expect(rowNames(tab)).toContain("#gardening");
    expect(rowNames(tab)).toContain("Dismiss #gardening");
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
    expect(rowNames(tab)).not.toContain("Dismiss #gardening");
    expect(row(tab, "#gardening").querySelector(".checkbox-container")).not.toBeNull();

    tab.hide();
    tab.display();
    expect(destinationNames(tab)).toContain(entry(2));
  });

  it("dismisses a proposed tag without activating it", async () => {
    const { tab } = settingTab({
      settings: { activeVocabulary: ["idea"], proposedTags: ["gardening"] },
    });
    tab.display();
    open(tab, entry(1));
    press(tab, "Dismiss #gardening", "Dismiss");
    await flush();

    expect(rowNames(tab)).not.toContain("#gardening");
    tab.hide();
    tab.display();
    expect(destinationNames(tab)).toContain(entry(1));
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
    press(tab, "Add to Active", "Add");
    await flush();

    expect(inDestination(tab)).toBe(true);
    expect(rowNames(tab)).toContain("#health");
  });

  it("ignores an empty custom tag", async () => {
    const { tab } = settingTab({ settings: { activeVocabulary: ["idea"] } });
    tab.display();
    open(tab, entry(1));
    fill(tab, "Add a custom tag", "   #  ");
    press(tab, "Add to Active", "Add");
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

  const ACKED = "2026-08-01T10:00:00.000Z";

  describe("declining", () => {
    it("leaves auto-run off and writes no egress ack", async () => {
      const { tab, local } = askTab();
      flip(tab, "Auto-run on open");
      await flush();

      expect(sheetOpen()).toBe(true);
      pressSheet("Cancel");
      await flush();

      expect(sheetOpen()).toBe(false);
      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(true);
      expect(local.get(LS_AUTO_RUN_ENABLED)).not.toBe(true);
      expect(row(tab, "Auto-run on open").querySelector(".is-enabled")).toBeNull();
    });

    it("leaves the Ask mirror off and writes no privacy ack", async () => {
      const { tab } = askTab();
      flip(tab, "Enable Ask mirror");
      await flush();
      pressSheet("Cancel");
      await flush();

      expect(persisted(tab).askPrivacyAckAt).toBe("");
      expect(persisted(tab).askEnabled).toBe(false);
    });

    it("leaves filing off and writes no vault-write ack", async () => {
      const { tab } = askTab({ askPrivacyAckAt: ACKED, askEnabled: true });
      flip(tab, "Allow filing from Claude or ChatGPT");
      await flush();
      pressSheet("Cancel");
      await flush();

      expect(persisted(tab).askWriteAckAt).toBe("");
    });
  });

  describe("dismissing", () => {
    it("treats Escape or a click outside as a decline on every sheet", async () => {
      const { tab, local } = askTab({ askPrivacyAckAt: ACKED, askEnabled: true });

      flip(tab, "Auto-run on open");
      await flush();
      dismissSheet();
      await flush();
      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(true);
      expect(local.get(LS_AUTO_RUN_ENABLED)).not.toBe(true);

      flip(tab, "Allow filing from Claude or ChatGPT");
      await flush();
      dismissSheet();
      await flush();
      expect(persisted(tab).askWriteAckAt).toBe("");
    });

    it("treats a privacy sheet dismissal as a decline", async () => {
      const { tab } = askTab();
      flip(tab, "Enable Ask mirror");
      await flush();
      dismissSheet();
      await flush();

      expect(persisted(tab).askPrivacyAckAt).toBe("");
      expect(persisted(tab).askEnabled).toBe(false);
    });

    it("closes an open sheet when the settings tab closes, writing no ack", async () => {
      const { tab } = askTab();
      flip(tab, "Enable Ask mirror");
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
      const { tab } = askTab({}, { [LS_AUTO_RUN_EGRESS_ACK]: true, [LS_AUTO_RUN_ENABLED]: false });

      expect(rowNames(tab)).toContain("Data egress acknowledgment");
      press(tab, "Data egress acknowledgment", "Review");
      expect(sheetText()).toContain("Withdraw acknowledgment");
    });

    it("shows the Ask privacy ack even while the mirror is off", () => {
      const { tab } = askTab({ askPrivacyAckAt: ACKED, askEnabled: false });

      expect(rowNames(tab)).toContain("Ask privacy acknowledgment");
      expect(row(tab, "Ask privacy acknowledgment").textContent).toContain("2026-08-01");
    });

    it("keeps no acknowledgment row for an ack that was never granted", () => {
      const { tab } = askTab();

      expect(rowNames(tab)).not.toContain("Data egress acknowledgment");
      expect(rowNames(tab)).not.toContain("Ask privacy acknowledgment");
      expect(rowNames(tab)).not.toContain("Vault write acknowledgment");
    });
  });

  describe("withdrawing", () => {
    it("clears the egress ack and force-disables auto-run", async () => {
      const { tab, local } = askTab({}, {
        [LS_AUTO_RUN_EGRESS_ACK]: true,
        [LS_AUTO_RUN_ENABLED]: true,
      });
      press(tab, "Data egress acknowledgment", "Review");
      pressSheet("Withdraw acknowledgment");
      await flush();

      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(true);
      expect(local.get(LS_AUTO_RUN_ENABLED)).not.toBe(true);
    });

    it("clears the vault-write ack when the privacy ack is withdrawn", async () => {
      const { tab } = askTab({
        askPrivacyAckAt: ACKED,
        askEnabled: true,
        askWriteAckAt: ACKED,
      });
      press(tab, "Ask privacy acknowledgment", "Review");
      pressSheet("Withdraw acknowledgment");
      await flush();

      expect(persisted(tab).askPrivacyAckAt).toBe("");
      expect(persisted(tab).askEnabled).toBe(false);
      expect(persisted(tab).askWriteAckAt).toBe("");
    });

    it("clears the vault-write ack when the mirror is turned off", async () => {
      const { tab } = askTab({
        askPrivacyAckAt: ACKED,
        askEnabled: true,
        askWriteAckAt: ACKED,
      });
      flip(tab, "Enable Ask mirror");
      await flush();

      expect(persisted(tab).askEnabled).toBe(false);
      expect(persisted(tab).askWriteAckAt).toBe("");
    });

    it("withdraws the vault-write ack on its own without touching the privacy ack", async () => {
      const { tab } = askTab({
        askPrivacyAckAt: ACKED,
        askEnabled: true,
        askWriteAckAt: ACKED,
      });
      press(tab, "Vault write acknowledgment", "Review");
      pressSheet("Withdraw acknowledgment");
      await flush();

      expect(persisted(tab).askWriteAckAt).toBe("");
      expect(persisted(tab).askPrivacyAckAt).toBe(ACKED);
      expect(persisted(tab).askEnabled).toBe(true);
    });

    it("keeps filing disabled while the Ask mirror is off", () => {
      const { tab } = askTab({ askPrivacyAckAt: ACKED, askEnabled: false });

      expect(
        row(tab, "Allow filing from Claude or ChatGPT").querySelector(".is-disabled"),
      ).not.toBeNull();
    });
  });

  describe("accepting", () => {
    it("writes the egress ack and enables auto-run", async () => {
      const { tab, local } = askTab();
      flip(tab, "Auto-run on open");
      await flush();

      expect(sheetText()).toContain("Anthropic");
      pressSheet("I understand");
      await flush();

      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).toBe(true);
      expect(local.get(LS_AUTO_RUN_ENABLED)).toBe(true);
      // R7: an egress accept authorizes nothing on the Ask side.
      expect(persisted(tab).askPrivacyAckAt).toBe("");
      expect(persisted(tab).askWriteAckAt).toBe("");
    });

    it("writes the privacy ack and enables the mirror, and nothing else", async () => {
      const { tab, local } = askTab();
      flip(tab, "Enable Ask mirror");
      await flush();
      pressSheet("I understand");
      await flush();

      expect(persisted(tab).askPrivacyAckAt).not.toBe("");
      expect(persisted(tab).askEnabled).toBe(true);
      // R7: agreeing to cloud storage does not authorize writes into the vault, or egress.
      expect(persisted(tab).askWriteAckAt).toBe("");
      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(true);
    });

    it("writes the vault-write ack and nothing else", async () => {
      const { tab, local } = askTab({ askPrivacyAckAt: ACKED, askEnabled: true });
      flip(tab, "Allow filing from Claude or ChatGPT");
      await flush();
      pressSheet("I understand");
      await flush();

      expect(persisted(tab).askWriteAckAt).not.toBe("");
      // R7: the privacy ack is untouched — it was already granted, and stays exactly as granted.
      expect(persisted(tab).askPrivacyAckAt).toBe(ACKED);
      expect(local.get(LS_AUTO_RUN_EGRESS_ACK)).not.toBe(true);
    });
  });

  it("keeps no permanent acknowledgment toggle on the screen", () => {
    const { tab } = askTab();

    expect(rowNames(tab)).not.toContain("Privacy acknowledgment");
    expect(rowNames(tab)).not.toContain("Data egress acknowledgment");
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
    flip(tab, "Sync automatically on resume");
    flip(tab, "Sync automatically on resume");
    flip(tab, "Sync automatically on resume");
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
      settings: { askEnabled: true, askPrivacyAckAt: "2026-08-01T10:00:00.000Z" },
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

  /** Every gate-bearing value on the device: what enables money spend, egress, or vault writes. */
  function gateState(tab: AtomsSettingTab, local: Map<string, unknown>) {
    return {
      askEnabled: tab.plugin.settings.askEnabled,
      askPrivacyAckAt: tab.plugin.settings.askPrivacyAckAt,
      askWriteAckAt: tab.plugin.settings.askWriteAckAt,
      autoRunEnabled: local.get(LS_AUTO_RUN_ENABLED),
      egressAcked: local.get(LS_AUTO_RUN_EGRESS_ACK),
    };
  }

  /** Touch every control on the screen the way a user could: flip it, type in it, press it. */
  function exerciseEveryControl(tab: AtomsSettingTab): void {
    for (const el of Array.from(tab.containerEl.querySelectorAll(".setting-item"))) {
      if (el.classList.contains("atoms-setting-back")) continue;
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
  }

  it("holds the four rows and nothing else", () => {
    const { tab } = advanced();
    expect(rowNames(tab)).toEqual([
      "Advanced",
      "Model",
      "Device-local key fallback",
      "Plus service URL override",
    ]);

    const withFallback = advanced({ settings: { useDeviceLocalKeyFallback: true } });
    expect(rowNames(withFallback.tab)).toContain("Device-local API key");
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
