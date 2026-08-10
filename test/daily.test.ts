import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Notice, TFile } from "obsidian";
import * as dni from "obsidian-daily-notes-interface";
import {
  DailyNotesDisabledError,
  ensureDailyForDate,
  FutureDailyNoteError,
  getPastDailyNotesWithUnmarkedCaptures,
} from "../src/pipeline/daily";
import AtomsPlugin from "../src/plugin/main";
import {
  LS_AUTO_RUN_EGRESS_ACK,
  LS_AUTO_RUN_ENABLED,
  LS_AUTO_RUN_START_DAY,
  LS_LAST_RUN_DAY,
  EGRESS_ACK_VERSION,
} from "../src/platform/autorun";

const app = {} as never;

function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(dni, "appHasDailyNotesPluginLoaded").mockReturnValue(true);
  vi.spyOn(dni, "getAllDailyNotes").mockReturnValue({});
});

describe("ensureDailyForDate", () => {
  it("returns the existing daily without recreating it", async () => {
    const existing = new TFile("Quick Notes/2026-07-27.md");
    vi.spyOn(dni, "getDailyNote").mockReturnValue(existing as never);
    const create = vi.spyOn(dni, "createDailyNote");

    const file = await ensureDailyForDate(app, "2026-07-27");

    expect(file).toBe(existing);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the daily when it is missing", async () => {
    vi.spyOn(dni, "getDailyNote").mockReturnValue(null as never);
    const created = new TFile("Quick Notes/2026-07-27.md");
    const create = vi
      .spyOn(dni, "createDailyNote")
      .mockResolvedValue(created as never);

    const file = await ensureDailyForDate(app, "2026-07-27");

    expect(file).toBe(created);
    expect(create).toHaveBeenCalledTimes(1);
    // The requested date must reach createDailyNote, not today's date.
    const arg = create.mock.calls[0]![0] as { _input?: string | null };
    expect(arg._input).toBe("2026-07-27");
  });

  it("creates the daily when getDailyNote throws", async () => {
    vi.spyOn(dni, "getDailyNote").mockImplementation(() => {
      throw new Error("version mismatch");
    });
    const created = new TFile("Quick Notes/2026-07-27.md");
    vi.spyOn(dni, "createDailyNote").mockResolvedValue(created as never);

    await expect(ensureDailyForDate(app, "2026-07-27")).resolves.toBe(created);
  });

  it("accepts today", async () => {
    vi.spyOn(dni, "getDailyNote").mockReturnValue(null as never);
    const created = new TFile("Quick Notes/today.md");
    vi.spyOn(dni, "createDailyNote").mockResolvedValue(created as never);

    await expect(ensureDailyForDate(app, localToday())).resolves.toBe(created);
  });

  it("rejects a future date rather than creating a future daily", async () => {
    vi.spyOn(dni, "getDailyNote").mockReturnValue(null as never);
    const create = vi.spyOn(dni, "createDailyNote");

    await expect(ensureDailyForDate(app, shiftDays(1))).rejects.toBeInstanceOf(
      FutureDailyNoteError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("throws when the Daily Notes plugin is disabled", async () => {
    vi.spyOn(dni, "appHasDailyNotesPluginLoaded").mockReturnValue(false);

    await expect(
      ensureDailyForDate(app, "2026-07-27"),
    ).rejects.toBeInstanceOf(DailyNotesDisabledError);
  });

  it("throws when creation returns nothing", async () => {
    vi.spyOn(dni, "getDailyNote").mockReturnValue(null as never);
    vi.spyOn(dni, "createDailyNote").mockResolvedValue(
      undefined as never,
    );

    await expect(ensureDailyForDate(app, "2026-07-27")).rejects.toThrow(
      /could not create/i,
    );
  });
});

describe("getPastDailyNotesWithUnmarkedCaptures — bounds plumbing", () => {
  const days = ["2026-08-01", "2026-08-05", "2026-08-07"];

  function mockVault() {
    const files = Object.fromEntries(
      days.map((d) => [d, new TFile(`Daily/${d}.md`)]),
    );
    vi.spyOn(dni, "getAllDailyNotes").mockReturnValue(files as never);
    vi.spyOn(dni, "getDateFromFile").mockImplementation(
      ((file: TFile) => {
        const date = file.path.slice("Daily/".length, -".md".length);
        return { format: () => date } as never;
      }) as never,
    );
    return {
      vault: { cachedRead: async () => "- unmarked capture\n" },
    } as never;
  }

  it("the Date form stays unbounded — attended callers are unchanged", async () => {
    const result = await getPastDailyNotesWithUnmarkedCaptures(
      mockVault(),
      new Date("2026-08-10T12:00:00"),
    );
    expect(result.notes.map((n) => n.date)).toEqual(days);
    expect(result.totalUnprocessed).toBe(3);
  });

  it("the no-opts form stays unbounded", async () => {
    const result = await getPastDailyNotesWithUnmarkedCaptures(mockVault(), {
      today: new Date("2026-08-10T12:00:00"),
    });
    expect(result.notes.map((n) => n.date)).toEqual(days);
  });

  it("since reaches the scan and totalUnprocessed counts only the window", async () => {
    const result = await getPastDailyNotesWithUnmarkedCaptures(mockVault(), {
      today: new Date("2026-08-10T12:00:00"),
      since: "2026-08-05",
    });
    expect(result.notes.map((n) => n.date)).toEqual(["2026-08-05", "2026-08-07"]);
    expect(result.totalUnprocessed).toBe(2);
  });

  it("before reaches the scan as the exclusive complement bound", async () => {
    const result = await getPastDailyNotesWithUnmarkedCaptures(mockVault(), {
      today: new Date("2026-08-10T12:00:00"),
      before: "2026-08-05",
    });
    expect(result.notes.map((n) => n.date)).toEqual(["2026-08-01"]);
    expect(result.totalUnprocessed).toBe(1);
  });
});

/**
 * The window has to bound the *read*, not only the result: reading every daily a vault has
 * ever had costs more the older the vault gets, which is the sweep the window exists to end.
 * `getDateFromFile` already knows the day before any I/O, so a note the bounds exclude is
 * never opened.
 */
describe("getPastDailyNotesWithUnmarkedCaptures — bounds skip the read", () => {
  const days = ["2026-08-01", "2026-08-05", "2026-08-07"];

  function countingVault() {
    const read: string[] = [];
    const files = Object.fromEntries(
      days.map((d) => [d, new TFile(`Daily/${d}.md`)]),
    );
    vi.spyOn(dni, "getAllDailyNotes").mockReturnValue(files as never);
    vi.spyOn(dni, "getDateFromFile").mockImplementation(
      ((file: TFile) => {
        const date = file.path.slice("Daily/".length, -".md".length);
        return { format: () => date } as never;
      }) as never,
    );
    return {
      read,
      app: {
        vault: {
          cachedRead: async (f: TFile) => {
            read.push(f.path);
            return "- unmarked capture\n";
          },
        },
      } as never,
    };
  }

  it("reads only the dailies inside the since window", async () => {
    const { app: vault, read } = countingVault();

    const result = await getPastDailyNotesWithUnmarkedCaptures(vault, {
      today: new Date("2026-08-10T12:00:00"),
      since: "2026-08-05",
    });

    expect(result.notes.map((n) => n.date)).toEqual([
      "2026-08-05",
      "2026-08-07",
    ]);
    expect(read).toEqual(["Daily/2026-08-05.md", "Daily/2026-08-07.md"]);
  });

  it("reads only the dailies strictly before the complement bound", async () => {
    const { app: vault, read } = countingVault();

    const result = await getPastDailyNotesWithUnmarkedCaptures(vault, {
      today: new Date("2026-08-10T12:00:00"),
      before: "2026-08-05",
    });

    expect(result.notes.map((n) => n.date)).toEqual(["2026-08-01"]);
    expect(read).toEqual(["Daily/2026-08-01.md"]);
  });

  it("reads every daily when unbounded — attended diagnostics are unchanged", async () => {
    const { app: vault, read } = countingVault();

    await getPastDailyNotesWithUnmarkedCaptures(vault, {
      today: new Date("2026-08-10T12:00:00"),
    });

    expect(read).toHaveLength(3);
  });

  it("still rejects a non-day bound rather than reading it as unbounded", async () => {
    const { app: vault, read } = countingVault();

    await expect(
      getPastDailyNotesWithUnmarkedCaptures(vault, {
        today: new Date("2026-08-10T12:00:00"),
        since: "August 5",
      }),
    ).rejects.toThrow(/must be YYYY-MM-DD/);
    expect(read).toEqual([]);
  });
});

/**
 * The two plugin-level count surfaces, driven off the prototype with the fields they read.
 * `showAutoRunStatus` is what the CLI smoke reads as evidence, so a count it reports wider
 * than the window would be mistaken for a real defect; `runListUnprocessed` is the deliberate
 * unbounded diagnostic and this pins that difference so a later refactor cannot erase it.
 */
describe("plugin count surfaces vs the filing window", () => {
  /** Pre-window captures only: everything inside the window is already drained. */
  const days = ["2026-08-01", "2026-08-02"];

  function stubPlugin(local: Record<string, unknown>) {
    const files = Object.fromEntries(
      days.map((d) => [d, new TFile(`Daily/${d}.md`)]),
    );
    vi.spyOn(dni, "getAllDailyNotes").mockReturnValue(files as never);
    vi.spyOn(dni, "getDateFromFile").mockImplementation(
      ((file: TFile) => {
        const date = file.path.slice("Daily/".length, -".md".length);
        return { format: () => date } as never;
      }) as never,
    );
    const plugin = Object.create(AtomsPlugin.prototype) as {
      app: unknown;
      settings: unknown;
      vaultIndexReady: boolean;
      getAutoRunSnapshot: () => unknown;
      showAutoRunStatus: () => Promise<void>;
      runListUnprocessed: () => Promise<void>;
    };
    plugin.app = {
      vault: { cachedRead: async () => "- unmarked capture\n" },
      loadLocalStorage: (k: string) => local[k] ?? null,
      saveLocalStorage: (k: string, v: unknown) => {
        local[k] = v;
      },
    };
    plugin.settings = {};
    plugin.vaultIndexReady = true;
    plugin.getAutoRunSnapshot = () => ({
      enabled: true,
      lastRunDay: "2026-08-10",
      egressAcked: true,
      inFlight: false,
      hasKey: true,
    });
    return plugin;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00"));
    Notice.messages.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("showAutoRunStatus reports zero remaining on a drained window", async () => {
    const plugin = stubPlugin({
      [LS_AUTO_RUN_ENABLED]: true,
      [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
      [LS_LAST_RUN_DAY]: "2026-08-10",
      [LS_AUTO_RUN_START_DAY]: "2026-08-09",
    });

    await plugin.showAutoRunStatus();

    expect(Notice.messages.at(-1)).toMatch(/past=0/);
  });

  it("runListUnprocessed stays unbounded — the diagnostic sees all history", async () => {
    const plugin = stubPlugin({
      [LS_AUTO_RUN_ENABLED]: true,
      [LS_AUTO_RUN_START_DAY]: "2026-08-09",
    });

    await plugin.runListUnprocessed();

    expect(Notice.messages.at(-1)).toMatch(
      /2 unprocessed capture\(s\) across 2 past day\(s\)/,
    );
  });
});
