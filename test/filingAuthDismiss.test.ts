import { describe, expect, it } from "vitest";
import {
  isPlusLimitDismissedToday,
  localCalendarDay,
  readPlusLimitDismissDay,
  writePlusLimitDismissDay,
  clearPlusLimitDismissDay,
} from "../src/platform/filingAuth";

describe("plus limit dismiss day", () => {
  it("isPlusLimitDismissedToday matches same day only", () => {
    expect(isPlusLimitDismissedToday("2026-07-17", "2026-07-17")).toBe(true);
    expect(isPlusLimitDismissedToday("2026-07-16", "2026-07-17")).toBe(false);
    expect(isPlusLimitDismissedToday(null, "2026-07-17")).toBe(false);
  });

  it("round-trips device-local dismiss day", () => {
    const store = new Map<string, string>();
    const app = {
      loadLocalStorage: (k: string) => store.get(k),
      saveLocalStorage: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    writePlusLimitDismissDay(app, "2026-07-17");
    expect(readPlusLimitDismissDay(app)).toBe("2026-07-17");
    clearPlusLimitDismissDay(app);
    expect(readPlusLimitDismissDay(app)).toBeNull();
  });

  it("localCalendarDay is YYYY-MM-DD", () => {
    expect(localCalendarDay(new Date("2026-07-17T15:00:00"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});
