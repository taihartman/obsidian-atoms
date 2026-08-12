import { describe, expect, it } from "vitest";
import { signOutAllConfirmCopy } from "../src/settings/plusSignOutAllConfirmModal";

describe("signOutAllConfirmCopy", () => {
  it("names this device and connected apps before the buttons", () => {
    const copy = signOutAllConfirmCopy("you@example.com");
    expect(copy.title).toMatch(/Sign out all devices/i);
    expect(copy.lines[0]).toMatch(/you@example.com/);
    expect(copy.lines).toContain(copy.thisDevice);
    expect(copy.lines).toContain(copy.connectedApps);
    expect(copy.declineLabel).toMatch(/Not now/i);
    expect(copy.confirmLabel).toMatch(/everywhere/i);
  });
});
