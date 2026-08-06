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
import { AtomsSettingTab } from "../src/settings/settings";
import { readPendingSignIns } from "../src/platform/filingAuth";
import { s256Challenge } from "../src/platform/pkce";
import { requestMagicLink } from "../src/platform/plusClient";
import {
  captureObsidianUi,
  stopCapturingObsidianUi,
  type UiCapture,
} from "./mocks/obsidian";
import { DEFAULT_SETTINGS, type LinkerSettings } from "../src/shared/types";
import {
  atomResult,
  fakeClassify,
  fakeVault,
  stubDailyNotes,
  type VaultDouble,
} from "./helpers/pipelineVault";

afterEach(() => vi.restoreAllMocks());

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

/** Render the whole signed-out Plus panel and collect every string it drew. */
function renderSignedOutPanel(app: FakeApp): UiCapture {
  const ui = captureObsidianUi();
  const containerEl = {
    createEl: (_tag: string, opts?: { text?: string }) => {
      if (opts?.text) ui.strings.push(opts.text);
      return {};
    },
    querySelector: () => null,
    empty: () => {},
  };
  const tab = fakeTab(app);
  (tab as unknown as { containerEl: unknown }).containerEl = containerEl;
  (
    tab as unknown as { renderPlusSection: (el: unknown) => void }
  ).renderPlusSection(containerEl);
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
