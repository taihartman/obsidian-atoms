import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import * as dni from "obsidian-daily-notes-interface";
import {
  DailyNotesDisabledError,
  ensureDailyForDate,
  FutureDailyNoteError,
  getPastDailyNotesWithUnmarkedCaptures,
} from "../src/pipeline/daily";

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
