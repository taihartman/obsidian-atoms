import { describe, expect, it, vi } from "vitest";

import { G2AppController } from "../src/app/controller";
import { ticketFromResponse } from "../src/platform/audio";

describe("G2 lifecycle controller", () => {
  it("maps the production ticket response into the RFC6455 credential", () => {
    expect(ticketFromResponse({ value: "g2t_one", expiresAt: "2026-09-08T23:00:00Z" })).toEqual({ ticket: "g2t_one" });
    expect(() => ticketFromResponse({ ticket: "wrong-shape" })).toThrow("invalid_ticket_response");
  });

  it("wires create, query source opening, recent, recovery, and confirmed exit", async () => {
    const render = vi.fn();
    const stopAudio = vi.fn();
    const closeSockets = vi.fn();
    const unsubscribe = vi.fn();
    const create = { restore: vi.fn(async () => ({ state: "prepared" as const, title: "Walk “East”" })), confirm: vi.fn(async () => ({ state: "queued" as const, message: "Queued" })) };
    const query = { ask: vi.fn(async () => ({ state: "answered" as const, answer: "Friday", sources: [{ id: "atm-one", title: "Launch" }] })), openSource: vi.fn(() => "atm-one") };
    const read = { loadRecent: vi.fn(async () => ({ items: [{ id: "atm-two", title: "Walk" }], selectedIndex: 0, coverageComplete: true })), openById: vi.fn(async () => ({ text: "café 🌱", position: { offset: 0, next_offset: null } })) };
    const app = new G2AppController({ render, stopAudio, closeSockets, unsubscribe, create, query, read });

    await app.start({ paired: true, setupReady: true });
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ screen: "confirmation", title: "Walk “East”" }));
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(create.confirm).toHaveBeenCalledTimes(1);

    app.showRoot();
    await app.handle({ kind: "scroll-down", envelope: "list", selectedIndex: 1 });
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 1 });
    await app.submitSpeech("When?");
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(read.openById).toHaveBeenCalledWith("atm-one");

    app.showRoot();
    await app.handle({ kind: "double-click", envelope: "system" });
    expect(app.snapshot().screen).toBe("root");
    expect(app.requestedSystemExit()).toBe(true);
    await app.systemEvent("foreground-exit");
    expect(stopAudio).not.toHaveBeenCalled();
    await app.systemEvent("system-exit");
    expect(stopAudio).toHaveBeenCalledOnce();
    expect(closeSockets).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("restores encrypted staged audio only into an explicit retry state", async () => {
    const render = vi.fn();
    const stopRecording = vi.fn(async () => ({ purpose: "create" as const, recordingId: "rec-restored", capturedAt: "2026-09-08T20:00:00Z", transcript: "exact" }));
    const app = new G2AppController({
      render, stopAudio: vi.fn(), closeSockets: vi.fn(), unsubscribe: vi.fn(), stopRecording,
      create: { restore: async () => ({ state: "idle" }), confirm: async () => ({ state: "idle" }) },
      query: { ask: async () => ({ state: "unavailable" }), openSource: () => null },
      read: { loadRecent: async () => ({ items: [], selectedIndex: 0, coverageComplete: true }), openById: async () => ({ text: "", position: { offset: 0, next_offset: null } }) },
    });
    await app.start({ paired: true, setupReady: true, recoveredRecording: true });
    expect(app.snapshot()).toMatchObject({ screen: "recovery", kind: "staged" });
    expect(stopRecording).not.toHaveBeenCalled();
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(stopRecording).toHaveBeenCalledOnce();
  });
});
