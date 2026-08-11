/**
 * U5 — the backfill offer card on Atoms home, at the seam where it meets device state.
 *
 * The pure arithmetic and copy live in `atomsHomeData.test.ts`. What is proved here is what only
 * the view can get wrong: that rendering the card mints no device state, that a stale or absent
 * egress ack cannot reach the flow, that the dismissal survives and expires, and that each device
 * is quoted the currency it actually spends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./mocks/obsidian";
import { pressSheet, sheetOpen } from "./helpers/settingsTab";
import { backfillHome } from "./helpers/homeView";
import {
  EGRESS_ACK_VERSION,
  LS_AUTO_RUN_ENABLED,
  LS_AUTO_RUN_EGRESS_ACK,
  LS_AUTO_RUN_START_DAY,
  LS_AUTO_RUN_WINDOW_MIGRATED,
  LS_BACKFILL_OFFER_DISMISSED,
} from "../src/platform/autorun";

const TODAY = "2026-08-10";

/** A year of past dailies, five captures each, all outside any filing window. */
const dailies = Array.from({ length: 40 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 6, 1) - i * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { date: day, path: `Daily/${day}.md`, unprocessedCount: 5 };
});

const plus = {
  mode: "plus" as const,
  status: "active",
  remaining: 150,
  periodEnd: "2026-09-01",
};
const byok = { mode: "byok" as const };
const acked = { [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 10, 9, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  for (const open of [...Modal.open]) open.close();
});

describe("backfill offer card — when it shows", () => {
  it("shows on a Plus device with past captures and budget to spend", () => {
    const home = backfillHome({ auth: plus, dailies, store: acked });
    expect(home.model()?.title).toBe("Older captures");
  });

  it("stays away when nothing sits outside the filing window", () => {
    expect(backfillHome({ auth: plus, dailies: [], store: acked }).model()).toBeNull();
  });

  it("stays away at zero budget, however large the complement", () => {
    // `remaining` at or below the reserve: the last third of a paid period at normal burn.
    const home = backfillHome({
      auth: { ...plus, remaining: 40 },
      dailies,
      store: acked,
    });
    expect(home.model()).toBeNull();
  });

  it("still renders when the newest day back overruns the whole budget", () => {
    // 80 captures on one daily against a paid cap of 50: whole-dailies-only fits nothing, so
    // the range is empty while the budget is not. KTD11 routes that tap to the top-up branch,
    // and home is the only discoverable surface it has.
    const home = backfillHome({
      auth: plus,
      dailies: [{ date: "2026-07-01", path: "Daily/2026-07-01.md", unprocessedCount: 80 }],
      store: acked,
    });
    const copy = home.model();
    expect(copy).not.toBeNull();
    expect(copy!.body).not.toMatch(/\d/);
    home.press();
    expect(home.runs).toBe(1);
  });

  it("stays away with no filing credentials at all", () => {
    expect(
      backfillHome({ auth: { mode: "none" }, dailies, store: acked }).model(),
    ).toBeNull();
  });

  it("leads with what the run files, not the complement total", () => {
    // 40 dailies × 5 = 200 captures; the paid cap is 50.
    const body = backfillHome({ auth: plus, dailies, store: acked }).model()!.body;
    expect(body).toContain("50 most recent");
    expect(body).toContain("200");
    expect(body.indexOf("50")).toBeLessThan(body.indexOf("200"));
  });

  it("excludes the filing window an enabled device already owns", () => {
    // Everything from 2026-06-20 on belongs to unattended filing, so the offer covers less.
    const bounded = backfillHome({
      auth: plus,
      dailies,
      store: {
        ...acked,
        [LS_AUTO_RUN_ENABLED]: true,
        [LS_AUTO_RUN_START_DAY]: "2026-06-20",
      },
    }).model()!;
    const unbounded = backfillHome({ auth: plus, dailies, store: acked }).model()!;
    expect(bounded.body).not.toBe(unbounded.body);
    // 200 past captures, less the 12 dailies from 2026-06-20 on that filing already owns.
    expect(bounded.body).toContain("140");
  });
});

describe("backfill offer card — currency", () => {
  it("quotes a Plus device in filings", () => {
    expect(backfillHome({ auth: plus, dailies, store: acked }).model()!.meter).toBe(
      "Uses 50 of the 150 filings left this period.",
    );
  });

  it("quotes a BYOK device in cost", () => {
    expect(backfillHome({ auth: byok, dailies, store: acked }).model()!.meter).toBe(
      "Runs on your own API key. You see the cost before anything starts.",
    );
  });
});

describe("backfill offer card — migrated devices", () => {
  it("names the pause instead of reading as a new offer", () => {
    const fresh = backfillHome({ auth: plus, dailies, store: acked }).model()!;
    const migrated = backfillHome({
      auth: plus,
      dailies,
      store: { ...acked, [LS_AUTO_RUN_WINDOW_MIGRATED]: true },
    }).model()!;
    expect(fresh.title).toBe("Older captures");
    expect(migrated.title).toBe("Filing starts here now");
    expect(migrated.body).toContain("switched it on");
  });
});

describe("backfill offer card — egress ack", () => {
  it("runs straight through when the current disclosure is acked", () => {
    const home = backfillHome({ auth: plus, dailies, store: acked });
    home.press();
    expect(sheetOpen()).toBe(false);
    expect(home.runs).toBe(1);
  });

  it("cannot reach the flow with no ack until the sheet is accepted", () => {
    const home = backfillHome({ auth: plus, dailies });
    home.press();
    expect(home.runs).toBe(0);
    expect(sheetOpen()).toBe(true);
    pressSheet("I understand");
    expect(home.runs).toBe(1);
    expect(home.store[LS_AUTO_RUN_EGRESS_ACK]).toBe(EGRESS_ACK_VERSION);
  });

  it("cannot reach the flow on a declined sheet", () => {
    const home = backfillHome({ auth: plus, dailies });
    home.press();
    pressSheet("Cancel");
    expect(home.runs).toBe(0);
    expect(home.store[LS_AUTO_RUN_EGRESS_ACK]).toBeUndefined();
  });

  it("cannot reach the flow on an ack stamped against older wording", () => {
    const home = backfillHome({
      auth: plus,
      dailies,
      store: { [LS_AUTO_RUN_EGRESS_ACK]: "2026-01-01" },
    });
    home.press();
    expect(home.runs).toBe(0);
    expect(sheetOpen()).toBe(true);
  });

  it("cannot reach the flow on the legacy bare-true ack", () => {
    const home = backfillHome({
      auth: plus,
      dailies,
      store: { [LS_AUTO_RUN_EGRESS_ACK]: true },
    });
    home.press();
    expect(home.runs).toBe(0);
    expect(sheetOpen()).toBe(true);
  });
});

describe("backfill offer card — dismissal", () => {
  it("persists device-locally through the end of the Plus period", () => {
    const home = backfillHome({ auth: plus, dailies, store: acked });
    home.dismiss();
    expect(home.store[LS_BACKFILL_OFFER_DISMISSED]).toBe("2026-09-01");
    expect(home.model()).toBeNull();
  });

  it("scopes a BYOK dismissal to 30 days, since BYOK has no period", () => {
    const home = backfillHome({ auth: byok, dailies, store: acked });
    home.dismiss();
    expect(home.store[LS_BACKFILL_OFFER_DISMISSED]).toBe("2026-09-09");
    expect(home.model()).toBeNull();
  });

  it("returns once the period end passes, while the complement is non-empty", () => {
    const home = backfillHome({
      auth: plus,
      dailies,
      store: { ...acked, [LS_BACKFILL_OFFER_DISMISSED]: "2026-09-01" },
    });
    expect(home.model()).toBeNull();
    vi.setSystemTime(new Date(2026, 8, 2, 9, 0, 0));
    expect(home.model()?.title).toBe("Older captures");
  });
});

describe("backfill offer card — reads never stamp", () => {
  it("writes nothing to device storage while deciding what to show", () => {
    // Home is a read-only surface: a stamp minted here would also beat the window migration to
    // it, leaving the paused-sweep copy unshown on the one device that needs it.
    const home = backfillHome({
      auth: plus,
      dailies,
      store: { ...acked, [LS_AUTO_RUN_ENABLED]: true },
    });
    home.model();
    home.model();
    expect(home.writes).toEqual([]);
    expect(home.store[LS_AUTO_RUN_START_DAY]).toBeUndefined();
  });
});
