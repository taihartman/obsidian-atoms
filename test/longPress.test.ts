import { describe, expect, it } from "vitest";
import { LongPressSession } from "../src/ui/longPress";

describe("LongPressSession", () => {
  it("short press without move is a tap", () => {
    const s = new LongPressSession();
    s.down(0, 0);
    expect(s.up()).toBe("tap");
  });

  it("timer fire marks long-press; up is ignore", () => {
    const s = new LongPressSession();
    s.down(0, 0);
    expect(s.timerFire()).toBe(true);
    expect(s.up()).toBe("ignore");
  });

  it("move past slop cancels; no tap, no timer fire", () => {
    const s = new LongPressSession();
    s.down(0, 0);
    expect(s.move(20, 0, 12)).toBe(true);
    expect(s.timerFire()).toBe(false);
    expect(s.up()).toBe("ignore");
  });

  it("small move within slop still allows tap", () => {
    const s = new LongPressSession();
    s.down(0, 0);
    expect(s.move(5, 5, 12)).toBe(false);
    expect(s.up()).toBe("tap");
  });

  it("timer after cancel does not fire", () => {
    const s = new LongPressSession();
    s.down(0, 0);
    s.move(100, 0, 12);
    expect(s.timerFire()).toBe(false);
  });
});
