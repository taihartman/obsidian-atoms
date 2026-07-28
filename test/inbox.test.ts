import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import {
  ATOMS_SYSTEM_FOLDER,
  drainInbox,
  ensureInboxBookmark,
  ensureInboxNote,
  INBOX_FILED_MARKER,
  INBOX_NOTE_PATH,
  isInboxFiledMarkerLine,
  parseInboxCaptures,
  pendingInboxCaptures,
  unparseableInboxCaptures,
} from "../src/pipeline/inbox";
import {
  DailyNotesDisabledError,
  FutureDailyNoteError,
} from "../src/pipeline/daily";
import { parseCaptures } from "../src/pipeline/parse";

describe("parseInboxCaptures — capture shape", () => {
  it("parses a single-line stamped capture", () => {
    const caps = parseInboxCaptures("- 2026-07-27T09:14-04:00 buy milk\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.date).toBe("2026-07-27");
    expect(caps[0]!.time).toBe("09:14");
    expect(caps[0]!.text).toBe("buy milk");
    expect(caps[0]!.filed).toBe(false);
    expect(caps[0]!.unparseable).toBe(false);
  });

  it("carries seconds through into the time when the stamp has them", () => {
    // Q2: seconds keep two captures in the same minute distinct, so time is
    // HH:MM:SS when the stamp carries seconds and HH:MM when it does not.
    const caps = parseInboxCaptures("- 2026-07-27T09:14:03-04:00 buy milk\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.time).toBe("09:14:03");
    expect(caps[0]!.stamp).toBe("2026-07-27T09:14:03-04:00");
    expect(caps[0]!.text).toBe("buy milk");
  });

  it("accepts a Z-suffixed stamp", () => {
    const caps = parseInboxCaptures("- 2026-07-27T09:14Z thought\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.date).toBe("2026-07-27");
    expect(caps[0]!.text).toBe("thought");
  });

  it("joins indented continuation lines into one capture", () => {
    const md = [
      "- 2026-07-27T09:14-04:00 first line",
      "\tsecond line",
      "\tthird line",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("first line\nsecond line\nthird line");
  });

  it("keeps blank-line-separated captures separate", () => {
    const md = [
      "- 2026-07-27T09:14-04:00 one",
      "",
      "- 2026-07-27T10:00-04:00 two",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(2);
    expect(caps[0]!.text).toBe("one");
    expect(caps[1]!.text).toBe("two");
  });

  it("skips empty bullets", () => {
    const caps = parseInboxCaptures("- \n- 2026-07-27T09:14-04:00 real\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("real");
  });

  it("ignores frontmatter and prose above the first bullet", () => {
    const md = [
      "---",
      "atoms-inbox: true",
      "---",
      "",
      "Captures land here. Do not edit by hand.",
      "",
      "- 2026-07-27T09:14-04:00 real capture",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("real capture");
  });
});

describe("parseInboxCaptures — day attribution", () => {
  it("derives the date from the stamp's own offset, not the device's", () => {
    // 23:40 on the 27th at -04:00 is the 28th in UTC. The capture belongs to
    // the 27th — the day it was made, where it was made.
    const caps = parseInboxCaptures("- 2026-07-27T23:40-04:00 late thought\n");
    expect(caps[0]!.date).toBe("2026-07-27");
    expect(caps[0]!.time).toBe("23:40");
  });

  it("attributes captures across a date boundary to their own days", () => {
    const md = [
      "- 2026-07-27T23:59-04:00 before midnight",
      "- 2026-07-28T00:01-04:00 after midnight",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps.map((c) => c.date)).toEqual(["2026-07-27", "2026-07-28"]);
  });
});

describe("parseInboxCaptures — filed markers", () => {
  it("marks a capture filed when the marker follows its extent", () => {
    const md = [
      "- 2026-07-27T09:14-04:00 buy milk",
      `\t${INBOX_FILED_MARKER}`,
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.filed).toBe(true);
    expect(caps[0]!.text).toBe("buy milk");
    expect(caps[0]!.markerLine).toBe(1);
  });

  it("does not absorb the marker into a multi-line body", () => {
    const md = [
      "- 2026-07-27T09:14-04:00 first line",
      "\tsecond line",
      `\t${INBOX_FILED_MARKER}`,
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps[0]!.text).toBe("first line\nsecond line");
    expect(caps[0]!.filed).toBe(true);
  });

  it("treats the sentinel inside capture text as body, not a marker", () => {
    const caps = parseInboxCaptures(
      `- 2026-07-27T09:14-04:00 note about ${INBOX_FILED_MARKER} syntax\n`,
    );
    expect(caps).toHaveLength(1);
    expect(caps[0]!.filed).toBe(false);
    expect(caps[0]!.text).toBe(`note about ${INBOX_FILED_MARKER} syntax`);
  });

  it("does not treat a daily-note linker marker as an inbox filed marker", () => {
    // The inbox owns its own sentinel; the daily's linker family must not
    // silently mark inbox captures filed (KTD9).
    expect(isInboxFiledMarkerLine("\t<!--linker:noise-->")).toBe(false);
    expect(
      isInboxFiledMarkerLine("\t↳ [[Some atom]] <!--linker-->"),
    ).toBe(false);
    expect(isInboxFiledMarkerLine(`\t${INBOX_FILED_MARKER}`)).toBe(true);
  });

  it("leaves a following capture unfiled", () => {
    const md = [
      "- 2026-07-27T09:14-04:00 filed one",
      `\t${INBOX_FILED_MARKER}`,
      "- 2026-07-27T09:20-04:00 pending one",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(2);
    expect(caps[0]!.filed).toBe(true);
    expect(caps[1]!.filed).toBe(false);
  });
});

describe("parseInboxCaptures — unparseable lines", () => {
  it("flags a bullet with no stamp rather than dropping it", () => {
    const caps = parseInboxCaptures("- no stamp here\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.unparseable).toBe(true);
    expect(caps[0]!.date).toBeNull();
    expect(caps[0]!.text).toBe("no stamp here");
  });

  it("flags a malformed stamp rather than guessing a date", () => {
    const caps = parseInboxCaptures("- 2026-13-45T99:99-04:00 nonsense\n");
    expect(caps[0]!.unparseable).toBe(true);
    expect(caps[0]!.date).toBeNull();
  });

  it("keeps parsing valid captures after an unparseable one", () => {
    const md = [
      "- broken line",
      "- 2026-07-27T09:14-04:00 good one",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(2);
    expect(caps[0]!.unparseable).toBe(true);
    expect(caps[1]!.unparseable).toBe(false);
    expect(caps[1]!.text).toBe("good one");
  });
});

describe("inbox capture selectors", () => {
  const md = [
    "- 2026-07-27T09:14-04:00 filed",
    `\t${INBOX_FILED_MARKER}`,
    "- 2026-07-27T09:20-04:00 pending",
    "- broken",
    "",
  ].join("\n");

  it("pending excludes filed and unparseable captures", () => {
    const pending = pendingInboxCaptures(parseInboxCaptures(md));
    expect(pending).toHaveLength(1);
    expect(pending[0]!.text).toBe("pending");
  });

  it("unparseable selects only the unreadable lines", () => {
    const bad = unparseableInboxCaptures(parseInboxCaptures(md));
    expect(bad).toHaveLength(1);
    expect(bad[0]!.text).toBe("broken");
  });
});

function fakeApp(opts: {
  existing?: Set<string>;
  bookmarks?: unknown;
} = {}) {
  const existing = opts.existing ?? new Set<string>();
  const created: Array<{ path: string; data: string }> = [];
  const folders: string[] = [];
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) =>
        existing.has(p) ? { path: p } : null,
      createFolder: async (p: string) => {
        folders.push(p);
        existing.add(p);
      },
      create: async (p: string, data: string) => {
        created.push({ path: p, data });
        existing.add(p);
        return { path: p };
      },
    },
    internalPlugins: { plugins: { bookmarks: opts.bookmarks } },
  };
  return { app: app as never, created, folders };
}

describe("ensureInboxNote", () => {
  it("creates the folder and note when neither exists", async () => {
    const { app, created, folders } = fakeApp();
    const file = await ensureInboxNote(app);

    expect(folders).toEqual([ATOMS_SYSTEM_FOLDER]);
    expect(created).toHaveLength(1);
    expect(created[0]!.path).toBe(INBOX_NOTE_PATH);
    expect((file as { path: string }).path).toBe(INBOX_NOTE_PATH);
  });

  it("writes a header that explains the file and warns against renaming", async () => {
    const { app, created } = fakeApp();
    await ensureInboxNote(app);

    const body = created[0]!.data;
    expect(body).toContain("atoms-inbox: true");
    expect(body).toMatch(/do not move or rename/i);
  });

  it("leaves an existing note untouched", async () => {
    const { app, created, folders } = fakeApp({
      existing: new Set([ATOMS_SYSTEM_FOLDER, INBOX_NOTE_PATH]),
    });
    await ensureInboxNote(app);

    expect(created).toHaveLength(0);
    expect(folders).toHaveLength(0);
  });

  it("does not recreate the folder when it already exists", async () => {
    const { app, created, folders } = fakeApp({
      existing: new Set([ATOMS_SYSTEM_FOLDER]),
    });
    await ensureInboxNote(app);

    expect(folders).toHaveLength(0);
    expect(created).toHaveLength(1);
  });

  it("is a no-op on a second call", async () => {
    const { app, created } = fakeApp();
    await ensureInboxNote(app);
    await ensureInboxNote(app);

    expect(created).toHaveLength(1);
  });

  it("still creates the note when folder creation fails", async () => {
    const { app, created } = fakeApp();
    (app as unknown as { vault: { createFolder: unknown } }).vault.createFolder =
      async () => {
        throw new Error("already exists");
      };

    await expect(ensureInboxNote(app)).resolves.toBeTruthy();
    expect(created).toHaveLength(1);
  });
});

describe("ensureInboxBookmark", () => {
  it("adds a bookmark for the canonical inbox path", async () => {
    const addItem = vi.fn();
    const saveData = vi.fn();
    const { app } = fakeApp({
      bookmarks: { enabled: true, instance: { items: [], addItem, saveData } },
    });

    await expect(ensureInboxBookmark(app)).resolves.toBe("created");
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: "file", path: INBOX_NOTE_PATH }),
    );
    expect(saveData).toHaveBeenCalled();
  });

  it("does not duplicate an existing bookmark", async () => {
    const addItem = vi.fn();
    const { app } = fakeApp({
      bookmarks: {
        enabled: true,
        instance: {
          items: [{ type: "file", path: INBOX_NOTE_PATH }],
          addItem,
        },
      },
    });

    await expect(ensureInboxBookmark(app)).resolves.toBe("already-present");
    expect(addItem).not.toHaveBeenCalled();
  });

  it("reports unavailable when the Bookmarks plugin is disabled", async () => {
    const { app } = fakeApp({
      bookmarks: { enabled: false, instance: { addItem: vi.fn() } },
    });
    await expect(ensureInboxBookmark(app)).resolves.toBe("unavailable");
  });

  it("reports unavailable when the internal shape is unrecognized", async () => {
    const { app } = fakeApp({ bookmarks: { enabled: true, instance: {} } });
    await expect(ensureInboxBookmark(app)).resolves.toBe("unavailable");
  });

  it("reports unavailable rather than throwing when addItem blows up", async () => {
    const { app } = fakeApp({
      bookmarks: {
        enabled: true,
        instance: {
          items: [],
          addItem: () => {
            throw new Error("internal API changed");
          },
        },
      },
    });

    await expect(ensureInboxBookmark(app)).resolves.toBe("unavailable");
  });

  it("reports unavailable when internalPlugins is absent entirely", async () => {
    await expect(ensureInboxBookmark({} as never)).resolves.toBe("unavailable");
  });
});

/**
 * In-memory vault + daily resolver for the drain. `ensureDaily` mirrors
 * ensureDailyForDate: it creates a daily on demand and refuses future dates.
 */
function drainHarness(
  inboxContent: string,
  opts: { dailies?: Record<string, string>; today?: string } = {},
) {
  const files = new Map<string, string>();
  files.set(INBOX_NOTE_PATH, inboxContent);
  const dailyPath = (date: string) => `Quick Notes/${date}.md`;
  for (const [date, content] of Object.entries(opts.dailies ?? {})) {
    files.set(dailyPath(date), content);
  }
  // Far-future default so nothing is treated as future unless a test opts in.
  const today = opts.today ?? "2999-12-31";
  const modified: string[] = [];

  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (files.has(p) ? new TFile(p) : null),
      read: async (f: { path: string }) => files.get(f.path) ?? "",
      modify: async (f: { path: string }, data: string) => {
        files.set(f.path, data);
        modified.push(f.path);
      },
    },
  } as never;

  const ensureDaily = async (_app: unknown, date: string): Promise<TFile> => {
    if (date > today) throw new FutureDailyNoteError(date);
    const path = dailyPath(date);
    if (!files.has(path)) files.set(path, "");
    return new TFile(path);
  };

  return {
    app,
    modified,
    ensureDaily,
    dailyContent: (date: string) => files.get(dailyPath(date)) ?? null,
    inboxContent: () => files.get(INBOX_NOTE_PATH)!,
    /** Simulate the Shortcut or Sync appending while the drain is mid-pass. */
    appendToInbox: (line: string) => {
      const prev = files.get(INBOX_NOTE_PATH)!;
      files.set(INBOX_NOTE_PATH, `${prev}${line}\n`);
    },
  };
}

describe("drainInbox", () => {
  it("routes captures spanning three dates into their own dailies", async () => {
    const h = drainHarness(
      [
        "- 2026-07-27T09:14-04:00 monday one",
        "- 2026-07-28T10:00-04:00 tuesday one",
        "- 2026-07-29T11:30-04:00 wednesday one",
        "",
      ].join("\n"),
    );

    const r = await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    expect(r.filed).toBe(3);
    expect(h.dailyContent("2026-07-27")).toContain("- 09:14 monday one");
    expect(h.dailyContent("2026-07-28")).toContain("- 10:00 tuesday one");
    expect(h.dailyContent("2026-07-29")).toContain("- 11:30 wednesday one");
    // No capture crosses into a neighbouring day.
    expect(h.dailyContent("2026-07-27")).not.toContain("tuesday");
    expect(h.dailyContent("2026-07-28")).not.toContain("wednesday");
  });

  it("creates a daily that does not exist and appends the capture", async () => {
    const h = drainHarness("- 2026-07-27T09:14-04:00 fresh day\n");

    const r = await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    expect(r.filed).toBe(1);
    expect(h.dailyContent("2026-07-27")).toContain("- 09:14 fresh day");
  });

  it("is a no-op on a re-run with no new captures", async () => {
    const h = drainHarness("- 2026-07-27T09:14-04:00 once\n");
    await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    h.modified.length = 0;
    const r = await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    expect(r.filed).toBe(0);
    expect(h.modified).toEqual([]);
  });

  it("dedupes against a daily line whose marker was lost", async () => {
    // Marker gone from the inbox (a sync merge dropped it), but the daily still
    // carries the line. The drain must re-mark without adding a second line.
    const h = drainHarness("- 2026-07-27T09:14-04:00 buy milk\n", {
      dailies: { "2026-07-27": "- 09:14 buy milk\n" },
    });

    const r = await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    expect(r.filed).toBe(1);
    const dailyCaps = parseCaptures(h.dailyContent("2026-07-27")!);
    expect(dailyCaps.filter((c) => c.text === "buy milk")).toHaveLength(1);
    expect(parseInboxCaptures(h.inboxContent())[0]!.filed).toBe(true);
  });

  it("writes a multi-line capture that reads back as one capture", async () => {
    const h = drainHarness(
      [
        "- 2026-07-27T09:14-04:00 first line",
        "\tsecond line",
        "\tthird line",
        "",
      ].join("\n"),
    );

    await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    const daily = h.dailyContent("2026-07-27")!;
    expect(daily).toContain("- 09:14 first line");
    const caps = parseCaptures(daily);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("first line\nsecond line\nthird line");
  });

  it("files valid captures and holds unparseable and future-dated ones", async () => {
    const h = drainHarness(
      [
        "- 2026-07-27T09:14-04:00 good past",
        "- no stamp here",
        "- 2999-01-01T08:00-04:00 far future",
        "",
      ].join("\n"),
      { today: "2026-07-28" },
    );

    const r = await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    expect(r.filed).toBe(1);
    expect(r.unparseable).toBe(1);
    expect(r.held).toBe(1);

    const after = parseInboxCaptures(h.inboxContent());
    expect(after.find((c) => c.text === "good past")!.filed).toBe(true);
    expect(after.find((c) => c.text === "no stamp here")!.filed).toBe(false);
    expect(after.find((c) => c.text === "far future")!.filed).toBe(false);
  });

  it("does not join onto a daily that lacks a trailing newline", async () => {
    const h = drainHarness("- 2026-07-27T09:14-04:00 new capture\n", {
      dailies: { "2026-07-27": "- existing note" },
    });

    await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    const daily = h.dailyContent("2026-07-27")!;
    expect(daily).toContain("- existing note\n- 09:14 new capture");
    expect(daily).not.toContain("existing note- 09:14");
  });

  it("marks every capture under its own extent (line-drift guard)", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 6; i++) {
      const mm = String(10 + i).padStart(2, "0");
      lines.push(`- 2026-07-27T09:${mm}-04:00 capture ${i}`);
    }
    lines.push("");
    const h = drainHarness(lines.join("\n"));

    await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    const caps = parseInboxCaptures(h.inboxContent());
    expect(caps).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(caps[i]!.text).toBe(`capture ${i}`);
      expect(caps[i]!.filed).toBe(true);
    }
  });

  it("treats a wikilink in the body as text, not a marker", async () => {
    const h = drainHarness(
      "- 2026-07-27T09:14-04:00 see [[Some Note]] about this\n",
    );

    const r = await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    expect(r.filed).toBe(1);
    const caps = parseCaptures(h.dailyContent("2026-07-27")!);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("see [[Some Note]] about this");
    expect(caps[0]!.processed).toBe(false);
  });

  it("files two same-minute captures that differ only in seconds", async () => {
    const h = drainHarness(
      [
        "- 2026-07-27T09:14:03-04:00 duplicate text",
        "- 2026-07-27T09:14:45-04:00 duplicate text",
        "",
      ].join("\n"),
    );

    const r = await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    expect(r.filed).toBe(2);
    const caps = parseCaptures(h.dailyContent("2026-07-27")!);
    expect(caps).toHaveLength(2);
    expect(caps.map((c) => c.timestamp).sort()).toEqual([
      "09:14:03",
      "09:14:45",
    ]);
  });

  it("keeps a capture appended mid-drain, and marks only what it filed", async () => {
    const h = drainHarness(
      ["- 2026-07-27T09:14-04:00 monday one", ""].join("\n"),
    );

    // The phone appends while the drain is between reading the inbox and
    // marking it — the window Sync delivers into on layout-ready.
    const ensureDaily = async (app: unknown, date: string) => {
      h.appendToInbox("- 2026-07-28T10:00-04:00 arrived mid-drain");
      return h.ensureDaily(app, date);
    };

    const r = await drainInbox(h.app, { ensureDaily });

    expect(r.filed).toBe(1);
    const after = parseInboxCaptures(h.inboxContent());
    expect(after.map((c) => c.text)).toEqual(["monday one", "arrived mid-drain"]);
    // The capture that landed mid-pass survives and is left unfiled, so the
    // next drain picks it up.
    expect(after[0]!.filed).toBe(true);
    expect(after[1]!.filed).toBe(false);
  });

  it("counts captures as pending when their daily cannot be resolved", async () => {
    const h = drainHarness(
      [
        "- 2026-07-27T09:14-04:00 monday one",
        "- 2026-07-27T09:20-04:00 monday two",
        "",
      ].join("\n"),
    );

    const ensureDaily = async () => {
      throw new DailyNotesDisabledError();
    };

    const r = await drainInbox(h.app, { ensureDaily });

    expect(r).toEqual({ filed: 0, pending: 2, held: 0, unparseable: 0 });
    // Nothing filed means nothing marked — the lines stay exactly as they were.
    expect(parseInboxCaptures(h.inboxContent()).every((c) => !c.filed)).toBe(
      true,
    );
  });

  it("returns a zero result when the inbox note is absent", async () => {
    const app = {
      vault: {
        getAbstractFileByPath: () => null,
        read: async () => "",
        modify: async () => {},
      },
    } as never;

    await expect(drainInbox(app)).resolves.toEqual({
      filed: 0,
      pending: 0,
      held: 0,
      unparseable: 0,
    });
  });
});
