import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import * as dni from "obsidian-daily-notes-interface";
import {
  ATOMS_SYSTEM_FOLDER,
  drainInbox,
  ensureInboxBookmark,
  ensureInboxNote,
  INBOX_FILED_MARKER,
  INBOX_NOTE_PATH,
  INBOX_NOTE_TEMPLATE,
  inboxCounts,
  inboxInferredDateFromLine,
  inboxInferredDateMarker,
  isInboxFiledMarkerLine,
  parseInboxCaptures,
  pendingInboxCaptures,
} from "../src/pipeline/inbox";
import {
  DailyNotesDisabledError,
  FutureDailyNoteError,
} from "../src/pipeline/daily";
import { parseCaptures } from "../src/pipeline/parse";

afterEach(() => vi.restoreAllMocks());

describe("parseInboxCaptures — capture shape", () => {
  it("parses a single-line stamped capture", () => {
    const caps = parseInboxCaptures("- 2026-07-27T09:14-04:00 buy milk\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.date).toBe("2026-07-27");
    expect(caps[0]!.time).toBe("09:14");
    expect(caps[0]!.text).toBe("buy milk");
    expect(caps[0]!.filed).toBe(false);
    expect(caps[0]!.inferredDate).toBeNull();
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

  it("skips a bullet that is only a stamp (KTD3)", () => {
    // A stamp with no trailing text carries no content. It is empty, not
    // unreadable — counting it as work is a false alarm about a note the user
    // never opens.
    expect(parseInboxCaptures("- 2026-07-28T12:00:00-04:00\n")).toHaveLength(0);
  });

  it("skips a bare stamp with a trailing space", () => {
    expect(parseInboxCaptures("- 2026-07-28T12:00:00-04:00 \n")).toHaveLength(
      0,
    );
  });

  it("drops the empty first body part of a bare stamp with a continuation", () => {
    // Trailing text is optional (KTD3), so the bullet's own body is "". Keeping
    // it would render an empty first bullet line in the daily.
    const caps = parseInboxCaptures("- 2026-07-28T12:00:00-04:00\n\tbuy milk\n");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("buy milk");
    expect(caps[0]!.time).toBe("12:00:00");
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

  it("reads a capture as filed when a blank line drifted before its marker (F4)", () => {
    // A sync merge (or a hand edit) can drop a blank line between a capture and
    // its filed marker. Marker detection must scan the region, not only the
    // adjacent line, or the capture re-files and gets a second marker.
    const md = [
      "- 2026-07-27T09:14-04:00 buy milk",
      "",
      `\t${INBOX_FILED_MARKER}`,
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.filed).toBe(true);
  });
});

describe("parseInboxCaptures — orphan column-0 lines (KTD4)", () => {
  it("leaves the note's own template prose outside every capture", () => {
    const caps = parseInboxCaptures(INBOX_NOTE_TEMPLATE);
    expect(caps).toHaveLength(0);
  });

  it("absorbs a column-0 line that lost its indentation", () => {
    const md = ["- 2026-07-27T09:14-04:00 first", "second line", ""].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("first\nsecond line");
  });

  it("never folds an orphan into an already-filed capture above it", () => {
    // Absorbing here would rewrite that capture's text and therefore its
    // captureKey — the dedupe key for something already written to a daily.
    const md = [
      "- 2026-07-27T09:14-04:00 buy milk",
      `\t${INBOX_FILED_MARKER}`,
      "orphan line",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("buy milk");
    expect(caps[0]!.filed).toBe(true);
  });
});

describe("parseInboxCaptures — unreadable stamps heal (KTD1, KTD2)", () => {
  const now = new Date(2026, 6, 30, 12, 0, 0); // 2026-07-30 local

  it("files a stampless bullet against today when it has no stamped neighbour", () => {
    const caps = parseInboxCaptures("- no stamp here\n", now);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.stamp).toBeNull();
    expect(caps[0]!.time).toBeNull();
    expect(caps[0]!.date).toBe("2026-07-30");
    expect(caps[0]!.text).toBe("no stamp here");
  });

  it("inherits the date of the nearest preceding stamped capture", () => {
    const md = [
      "- 2026-07-27T09:14-04:00 anchor",
      "- no stamp here",
      "- 2026-07-29T10:00-04:00 later anchor",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md, now);
    expect(caps.map((c) => c.date)).toEqual([
      "2026-07-27",
      "2026-07-27",
      "2026-07-29",
    ]);
  });

  it("falls back to the nearest following stamped capture", () => {
    const md = [
      "- no stamp here",
      "- 2026-07-29T10:00-04:00 anchor",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md, now);
    expect(caps[0]!.date).toBe("2026-07-29");
  });

  it("clamps an inherited future date to today so nothing is stranded", () => {
    // Inheriting the future date would raise FutureDailyNoteError forever —
    // the exact stranding KTD1 exists to prevent.
    const md = ["- 2099-01-01T08:00-04:00 far future", "- no stamp here", ""].join(
      "\n",
    );
    const caps = parseInboxCaptures(md, now);
    expect(caps[1]!.date).toBe("2026-07-30");
  });

  it("anchors only on stamped captures, never on another inferred one", () => {
    const md = [
      "- 2026-07-27T09:14-04:00 anchor",
      "- first orphan",
      "- second orphan",
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md, now);
    expect(caps.map((c) => c.date)).toEqual([
      "2026-07-27",
      "2026-07-27",
      "2026-07-27",
    ]);
  });

  it("strips a junk routing stamp out of the body", () => {
    const caps = parseInboxCaptures("- 7/28/26, 12:00 PM buy milk\n", now);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("buy milk");
    expect(caps[0]!.stamp).toBeNull();
    expect(caps[0]!.time).toBeNull();
    expect(caps[0]!.date).toBe("2026-07-30");
  });

  it("strips an ISO-shaped stamp whose calendar date is impossible", () => {
    const caps = parseInboxCaptures("- 2026-13-45T99:99-04:00 nonsense\n", now);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("nonsense");
  });

  it("drops a bare junk stamp entirely — it carries no content", () => {
    expect(parseInboxCaptures("- 2026-13-45T99:99-04:00\n", now)).toHaveLength(
      0,
    );
  });

  it("leaves a genuine capture that merely looks date-ish alone", () => {
    // Only three named stamp shapes strip, and none of them match this.
    const caps = parseInboxCaptures("- 7/28 3:00 PM meeting with Bob\n", now);
    expect(caps[0]!.text).toBe("7/28 3:00 PM meeting with Bob");
  });

  // The three junk-stamp shapes documented in docs/capture-shortcut.md, and the
  // body text that must survive them. Stripping is the dangerous direction: a
  // junk stamp left in the body is visible and lossless, stripped user text is
  // gone silently and forever (non-negotiable #1).
  it.each([
    ["2026-13-45T99:99-04:00 impossible date", "impossible date"],
    ["2026-07-27T12:00 missing offset", "missing offset"],
    ["7/28/26, 12:00 PM shortcuts short style", "shortcuts short style"],
    ["Fri, 28 Jul 2026 12:00:00 -0400 default custom format", "default custom format"],
  ])("strips the junk stamp off %s", (bullet, text) => {
    const caps = parseInboxCaptures(`- ${bullet}\n`, now);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.stamp).toBeNull();
    expect(caps[0]!.text).toBe(text);
  });

  it.each([
    "2026-13-45T99:99-04:00",
    "2026-07-27T12:00",
    "7/28/26, 12:00 PM",
    "Fri, 28 Jul 2026 12:00:00 -0400",
  ])("drops a bare junk stamp with no body: %s", (bullet) => {
    expect(parseInboxCaptures(`- ${bullet}\n`, now)).toHaveLength(0);
  });

  it.each([
    "12/25/26 10:00 dentist appointment",
    "1/2/3 4:56 remember this",
    "2-1-1 3:45 game highlights",
    "7/28 3:00 PM meeting with Bob",
  ])("leaves real capture text untouched: %s", (bullet) => {
    const caps = parseInboxCaptures(`- ${bullet}\n`, now);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe(bullet);
  });

  it("leaves a 24-hour comma time in the body — the Shortcut never emits one", () => {
    // Alternation 2 requires the AM/PM marker, so a hand-written 24-hour
    // shorthand reads as body rather than as a junk stamp.
    const bullet = "3/15/26, 14:30 finally finished the report";
    const caps = parseInboxCaptures(`- ${bullet}\n`, now);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe(bullet);
  });

  it("accepted limitation: strips a pasted chat export's leading timestamp", () => {
    // A chat export's leading token is indistinguishable from the Shortcut's
    // Short-style junk stamp, so it strips. Only reachable when the Shortcut is
    // simultaneously misconfigured — the strip runs only on a bullet with no
    // valid leading ISO stamp — and pinned here so the tradeoff stays visible.
    const caps = parseInboxCaptures(
      "- 7/29/26, 3:45 PM - Alice: are you free tonight?\n",
      now,
    );
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("- Alice: are you free tonight?");
  });

  it("clamps a future date restored from an inferred-date marker", () => {
    // A marker that survived a sync merge while the filed marker did not would
    // otherwise re-supply the bad date on every parse, so the capture could
    // never heal — worse than the stranding KTD1 exists to prevent.
    const md = [
      "- no stamp here",
      `\t${inboxInferredDateMarker("2099-01-01")}`,
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md, now);
    expect(caps[0]!.inferredDate).toBe("2099-01-01");
    expect(caps[0]!.date).toBe("2026-07-30");
  });

  it("finds a filed marker below a column-0 inferred-date marker", () => {
    // A merge or hand edit stripped the marker's indentation. Reading it as
    // non-indented prose would stop the scan and re-file the capture.
    const md = [
      "- no stamp here",
      inboxInferredDateMarker("2026-07-20"),
      `\t${INBOX_FILED_MARKER}`,
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md, now);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.filed).toBe(true);
    expect(caps[0]!.inferredDate).toBe("2026-07-20");
  });

  it("keeps parsing valid captures after an unreadable one", () => {
    const md = ["- broken line", "", "- 2026-07-27T09:14-04:00 good one", ""].join(
      "\n",
    );
    const caps = parseInboxCaptures(md, now);
    expect(caps).toHaveLength(2);
    expect(caps[0]!.stamp).toBeNull();
    expect(caps[1]!.text).toBe("good one");
  });

  it("heals an out-of-range hour rather than holding it (T4)", () => {
    // The stamp shape matches (25:00 fits (\d{2}):(\d{2})), so only the
    // h > 23 guard keeps this from being read as a real 25 o'clock capture.
    const caps = parseInboxCaptures("- 2026-07-27T25:00-04:00 x\n", now);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.stamp).toBeNull();
    expect(caps[0]!.text).toBe("x");
    expect(caps[0]!.date).toBe("2026-07-30");
  });

  it("prefers a recorded inferred-date marker over re-guessing", () => {
    const md = [
      "- 2026-07-27T09:14-04:00 anchor",
      "- no stamp here",
      `\t${inboxInferredDateMarker("2026-07-20")}`,
      `\t${INBOX_FILED_MARKER}`,
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md, now);
    expect(caps[1]!.inferredDate).toBe("2026-07-20");
    expect(caps[1]!.date).toBe("2026-07-20");
    expect(caps[1]!.filed).toBe(true);
  });

  it("reads the inferred-date marker even when the filed marker precedes it", () => {
    const md = [
      "- no stamp here",
      `\t${INBOX_FILED_MARKER}`,
      `\t${inboxInferredDateMarker("2026-07-21")}`,
      "",
    ].join("\n");
    const caps = parseInboxCaptures(md, now);
    expect(caps[0]!.inferredDate).toBe("2026-07-21");
  });

  it("recognizes only its own inferred-date marker shape", () => {
    expect(inboxInferredDateFromLine(`\t${inboxInferredDateMarker("2026-07-21")}`)).toBe(
      "2026-07-21",
    );
    expect(inboxInferredDateFromLine(`\t${INBOX_FILED_MARKER}`)).toBeNull();
    expect(inboxInferredDateFromLine("\t<!--linker-->")).toBeNull();
  });
});

describe("inbox capture selectors", () => {
  const md = [
    "- 2026-07-27T09:14-04:00 filed",
    `\t${INBOX_FILED_MARKER}`,
    "- 2026-07-27T09:20-04:00 pending",
    "",
    "- broken",
    "",
  ].join("\n");

  it("pending excludes filed captures and includes healed ones", () => {
    const pending = pendingInboxCaptures(parseInboxCaptures(md));
    expect(pending.map((c) => c.text)).toEqual(["pending", "broken"]);
    // Every pending capture carries a date the drain can route on.
    expect(pending.every((c) => typeof c.date === "string")).toBe(true);
  });
});

describe("inboxCounts — inferred dates", () => {
  const now = new Date(2026, 6, 30, 12, 0, 0); // 2026-07-30 local

  it("reports zero when no capture carries an inferred-date marker", () => {
    expect(inboxCounts("- 2026-07-27T09:14-04:00 buy milk\n", now)).toEqual({
      pending: 1,
      held: 0,
      inferredDates: 0,
    });
  });

  it("counts a marked capture whether it is filed or still unfiled", () => {
    const unfiled = [
      "- no stamp here",
      `\t${inboxInferredDateMarker("2026-07-20")}`,
      "",
    ].join("\n");
    expect(inboxCounts(unfiled, now).inferredDates).toBe(1);

    const filed = [
      "- no stamp here",
      `\t${inboxInferredDateMarker("2026-07-20")}`,
      `\t${INBOX_FILED_MARKER}`,
      "",
    ].join("\n");
    expect(inboxCounts(filed, now)).toEqual({
      pending: 0,
      held: 0,
      inferredDates: 1,
    });
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

  it("does not duplicate a bookmark nested inside a group (F6)", async () => {
    // Bookmarks nest: a user can file the inbox bookmark into a group, but
    // addItem only ever inserts at the top level. A flat presence check misses
    // the nested one and adds a duplicate on every load.
    const addItem = vi.fn();
    const { app } = fakeApp({
      bookmarks: {
        enabled: true,
        instance: {
          items: [
            {
              type: "group",
              title: "Captures",
              items: [{ type: "file", path: INBOX_NOTE_PATH }],
            },
          ],
          addItem,
        },
      },
    });

    await expect(ensureInboxBookmark(app)).resolves.toBe("already-present");
    expect(addItem).not.toHaveBeenCalled();
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

  it("heals a stampless capture and still holds a future-dated one", async () => {
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

    // The stampless line inherits its neighbour's day and files (KTD1, KTD2);
    // only the future-dated capture is still held.
    expect(r.filed).toBe(2);
    expect(r.inferred).toBe(1);
    expect(r.held).toBe(1);
    expect(h.dailyContent("2026-07-27")).toContain("- no stamp here");

    const after = parseInboxCaptures(h.inboxContent());
    expect(after.find((c) => c.text === "good past")!.filed).toBe(true);
    const healed = after.find((c) => c.text === "no stamp here")!;
    expect(healed.filed).toBe(true);
    expect(healed.inferredDate).toBe("2026-07-27");
    expect(after.find((c) => c.text === "far future")!.filed).toBe(false);
  });

  // Anchored on a stamped neighbour so the inherited date does not depend on
  // the machine clock.
  const untimedInbox = [
    "- 2026-07-27T09:14-04:00 anchor",
    "- no stamp here",
    "",
  ].join("\n");

  it("writes an untimed daily bullet when the capture has no readable time", async () => {
    const h = drainHarness(untimedInbox, { today: "2026-07-28" });

    await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    // No fabricated time: `- null no stamp here` compiles clean and ships a lie.
    const daily = h.dailyContent("2026-07-27")!;
    expect(daily).toContain("- no stamp here");
    expect(daily).not.toContain("null");
    const healed = parseCaptures(daily).find(
      (c) => c.text === "no stamp here",
    )!;
    expect(healed.timestamp).toBeNull();
  });

  it("does not re-file a healed capture on a second drain", async () => {
    const h = drainHarness(untimedInbox, { today: "2026-07-28" });
    await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    h.modified.length = 0;
    const r = await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    expect(r.filed).toBe(0);
    expect(h.modified).toEqual([]);
    expect(parseCaptures(h.dailyContent("2026-07-27")!)).toHaveLength(2);
  });

  it("falls back to the injected clock's today when nothing anchors the date", async () => {
    // No readable stamp anywhere, so there is no neighbour to inherit from and
    // the capture takes today. `now` is injected so the destination daily does
    // not depend on the machine date.
    const h = drainHarness("- no stamp at all\n", { today: "2026-03-05" });

    const r = await drainInbox(h.app, {
      ensureDaily: h.ensureDaily,
      now: new Date(2026, 2, 5, 9, 0, 0),
    });

    expect(r.filed).toBe(1);
    expect(r.inferred).toBe(1);
    expect(h.dailyContent("2026-03-05")).toContain("- no stamp at all");
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

  it("records the day the bullet was filed to, not a re-inferred one", async () => {
    // The mid-drain append changes the neighbour anchors, so the re-read infers
    // a different day than the bullet actually landed under. Marking that day
    // makes a duplicate file the moment the filed marker is lost.
    const h = drainHarness("- no stamp here\n");
    const now = new Date(2026, 6, 30, 12, 0, 0); // 2026-07-30 local

    const ensureDaily = async (app: unknown, date: string) => {
      h.appendToInbox("- 2026-07-26T09:00-04:00 arrived mid-drain");
      return h.ensureDaily(app, date);
    };

    const r = await drainInbox(h.app, { ensureDaily, now });

    expect(r.filed).toBe(1);
    expect(h.dailyContent("2026-07-30")).toContain("- no stamp here");
    const healed = parseInboxCaptures(h.inboxContent(), now).find(
      (c) => c.text === "no stamp here",
    )!;
    expect(healed.inferredDate).toBe("2026-07-30");
  });

  it("writes no empty first bullet line for a bare stamp with a continuation", async () => {
    const h = drainHarness("- 2026-07-28T12:00:00-04:00\n\tbuy milk\n");

    await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    const daily = h.dailyContent("2026-07-28")!;
    expect(daily).toContain("- 12:00:00 buy milk");
    const caps = parseCaptures(daily);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.text).toBe("buy milk");
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

    expect(r).toEqual({
      filed: 0,
      pending: 2,
      held: 0,
      inferred: 0,
    });
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
      inferred: 0,
    });
  });

  it("keeps a trailing newline on the inbox after marking (F1)", async () => {
    // The iOS Shortcut appends at EOF relying on the terminator. Drop it and
    // the next capture fuses onto the marker line and is lost.
    const h = drainHarness("- 2026-07-27T09:14-04:00 buy milk");

    await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    expect(h.inboxContent().endsWith("\n")).toBe(true);
    // A capture appended at EOF stays its own parseable, unfiled capture.
    h.appendToInbox("- 2026-07-28T10:00-04:00 next one");
    const after = parseInboxCaptures(h.inboxContent());
    const next = after.find((c) => c.text === "next one");
    expect(next).toBeDefined();
    expect(next!.filed).toBe(false);
  });

  it("preserves CRLF terminators when marking the inbox (F2)", async () => {
    const h = drainHarness("- 2026-07-27T09:14-04:00 buy milk\r\n");

    await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    const inbox = h.inboxContent();
    expect(inbox).toContain("\r\n");
    // No line was rewritten to a lone LF — every LF stays part of a CRLF.
    expect(inbox.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("keeps draining later dates when one daily write fails (F3)", async () => {
    const h = drainHarness(
      [
        "- 2026-07-27T09:14-04:00 monday one",
        "- 2026-07-28T10:00-04:00 tuesday one",
        "",
      ].join("\n"),
    );
    const vault = (h.app as unknown as { vault: { modify: unknown } }).vault;
    const realModify = vault.modify as (
      f: { path: string },
      data: string,
    ) => Promise<void>;
    vault.modify = async (f: { path: string }, data: string) => {
      if (f.path === "Quick Notes/2026-07-27.md") throw new Error("disk full");
      return realModify(f, data);
    };

    const r = await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    // Tuesday still files despite Monday's write throwing.
    expect(h.dailyContent("2026-07-28")).toContain("- 10:00 tuesday one");
    const after = parseInboxCaptures(h.inboxContent());
    expect(after.find((c) => c.text === "tuesday one")!.filed).toBe(true);
    // Monday failed: held pending, unmarked — never lost.
    expect(after.find((c) => c.text === "monday one")!.filed).toBe(false);
    expect(r.filed).toBe(1);
    expect(r.pending).toBe(1);
  });

  it("does not splice a second marker when one drifted below a blank line (F4)", async () => {
    const h = drainHarness(
      [
        "- 2026-07-27T09:14-04:00 buy milk",
        "",
        `\t${INBOX_FILED_MARKER}`,
        "",
      ].join("\n"),
      { dailies: { "2026-07-27": "- 09:14 buy milk\n" } },
    );

    await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    const markerCount = h.inboxContent().split(INBOX_FILED_MARKER).length - 1;
    expect(markerCount).toBe(1);
  });

  it("reports filed as markers written, not captures attempted (F5)", async () => {
    const h = drainHarness("- 2026-07-27T09:14-04:00 monday one\n");
    // Between the daily write and the inbox re-read, the inbox line is edited
    // (a sync merge reflows it), so the filed capture cannot be relocated and
    // no marker lands. `filed` must count markers written, not attempts.
    const ensureDaily = async (app: unknown, date: string) => {
      const daily = await h.ensureDaily(app, date);
      await (
        h.app as unknown as {
          vault: { modify: (f: TFile, d: string) => Promise<void> };
        }
      ).vault.modify(
        new TFile(INBOX_NOTE_PATH),
        "- 2026-07-27T09:14-04:00 edited text\n",
      );
      return daily;
    };

    const r = await drainInbox(h.app, { ensureDaily });

    expect(r.filed).toBe(0);
    expect(r.pending).toBe(1);
  });

  it("files both of two captures with identical stamp and text (T3)", async () => {
    const h = drainHarness(
      [
        "- 2026-07-27T09:14:03-04:00 same text",
        "- 2026-07-27T09:14:03-04:00 same text",
        "",
      ].join("\n"),
    );

    const r = await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    expect(r.filed).toBe(2);
    const after = parseInboxCaptures(h.inboxContent());
    expect(after).toHaveLength(2);
    expect(after.every((c) => c.filed)).toBe(true);
  });

  it("pairs each same-key stampless duplicate with its own day (T3)", async () => {
    // Two stampless `ping` captures share a capture key but inherit different
    // days, and the drain groups by date — so the filed list reaches the
    // relocation pass with the second `ping` ahead of the first. Each inbox
    // line's inferred-date marker must still name the daily its bullet landed
    // in, not the other duplicate's.
    const h = drainHarness(
      [
        // Anchors the 2026-07-10 group ahead of the 2026-07-25 one without
        // acting as a stamped neighbour for the ping below it.
        "- gamma",
        `\t${inboxInferredDateMarker("2026-07-10")}`,
        "- ping", // no stamped predecessor — inherits 2026-07-25 forwards
        "- 2026-07-25T09:00-04:00 alpha",
        "- 2026-07-10T08:00-04:00 beta",
        "- ping", // inherits 2026-07-10 backwards
        "",
      ].join("\n"),
    );

    const r = await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    expect(r.filed).toBe(5);
    expect(h.dailyContent("2026-07-25")).toContain("- ping");
    expect(h.dailyContent("2026-07-10")).toContain("- ping");

    const pings = parseInboxCaptures(h.inboxContent()).filter(
      (c) => c.text === "ping",
    );
    expect(pings.map((c) => c.inferredDate)).toEqual([
      "2026-07-25",
      "2026-07-10",
    ]);
  });

  it("never drops or reorders any pre-drain inbox line (T2, append-only)", async () => {
    const before = [
      ...INBOX_NOTE_TEMPLATE.split("\n"),
      "- 2026-07-27T09:14-04:00 first capture",
      "- 2026-07-28T10:00-04:00 second capture",
      "a stray human line with no stamp and no bullet",
      "",
    ];
    const h = drainHarness(before.join("\n"));

    await drainInbox(h.app, { ensureDaily: h.ensureDaily });

    const after = h.inboxContent().split(/\r?\n/);
    // Every original line still appears, in its original relative order.
    let idx = 0;
    for (const line of before) {
      const found = after.indexOf(line, idx);
      expect(found).toBeGreaterThanOrEqual(0);
      idx = found + 1;
    }
  });

  it("drains through the real ensureDailyForDate default when no deps are passed (T1)", async () => {
    vi.spyOn(dni, "appHasDailyNotesPluginLoaded").mockReturnValue(true);
    vi.spyOn(dni, "getAllDailyNotes").mockReturnValue({} as never);
    const daily = new TFile("Quick Notes/2026-07-27.md");
    vi.spyOn(dni, "getDailyNote").mockReturnValue(null as never);
    vi.spyOn(dni, "createDailyNote").mockResolvedValue(daily as never);

    const files = new Map<string, string>();
    files.set(INBOX_NOTE_PATH, "- 2026-07-27T09:14-04:00 real default path\n");
    files.set(daily.path, "");
    const app = {
      vault: {
        getAbstractFileByPath: (p: string) =>
          files.has(p) ? new TFile(p) : null,
        read: async (f: { path: string }) => files.get(f.path) ?? "",
        modify: async (f: { path: string }, data: string) => {
          files.set(f.path, data);
        },
      },
    } as never;

    const r = await drainInbox(app);

    expect(r.filed).toBe(1);
    expect(files.get(daily.path)).toContain("- 09:14 real default path");
    expect(parseInboxCaptures(files.get(INBOX_NOTE_PATH)!)[0]!.filed).toBe(true);
  });
});
