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
    const create = { restore: vi.fn(async () => ({ state: "prepared" as const, title: "Walk “East”", transcript: "Remember the east trail" })), confirm: vi.fn(async () => ({ state: "queued" as const, message: "Queued" })) };
    const query = { ask: vi.fn(async () => ({ state: "answered" as const, answer: "Friday", sources: [{ id: "atm-one", title: "Launch" }] })), openSource: vi.fn(() => "atm-one") };
    const read = { loadRecent: vi.fn(async () => ({ items: [{ id: "atm-two", title: "Walk" }], selectedIndex: 0, coverageComplete: true })), openById: vi.fn(async () => ({ text: "café 🌱", position: { offset: 0, next_offset: null } })) };
    const app = new G2AppController({ render, stopAudio, closeSockets, unsubscribe, create, query, read });

    await app.start({ paired: true, setupReady: true });
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ screen: "confirmation", title: "Walk “East”", transcript: "Remember the east trail" }));
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(create.confirm).toHaveBeenCalledTimes(1);

    app.showRoot();
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

  it("retains failed preparation context so Try again retries preparation, not transcription", async () => {
    const prepare = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ state: "prepared", title: "Exact retry" });
    const completeHandoff = vi.fn(async () => undefined);
    const stopRecording = vi.fn(async () => ({
      purpose: "create" as const,
      recordingId: "rec-retry",
      capturedAt: "2026-09-08T20:00:00Z",
      transcript: "exact transcript",
      completeHandoff,
    }));
    const app = new G2AppController({
      render: vi.fn(), stopAudio: vi.fn(), closeSockets: vi.fn(), unsubscribe: vi.fn(), stopRecording,
      create: { restore: async () => ({ state: "idle" }), confirm: async () => ({ state: "idle" }), prepare },
      query: { ask: async () => ({ state: "unavailable" }), openSource: () => null },
      read: { loadRecent: async () => ({ items: [], selectedIndex: 0, coverageComplete: true }), openById: async () => ({ text: "", position: { offset: 0, next_offset: null } }) },
    });

    app.showRoot();
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    await app.handle({ kind: "click", envelope: "text" });
    expect(app.snapshot()).toMatchObject({ screen: "error", reason: "preparation-failed", primaryAction: "retry" });
    expect(completeHandoff).not.toHaveBeenCalled();

    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(stopRecording).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenCalledWith("rec-retry", "2026-09-08T20:00:00Z", "exact transcript");
    expect(completeHandoff).toHaveBeenCalledOnce();
    expect(app.snapshot()).toMatchObject({ screen: "confirmation", title: "Exact retry" });
  });

  it("runs Wait and Return actions against their retained operation context", async () => {
    const refresh = vi.fn(async () => ({ state: "queued" as const, stillQueued: true }));
    const openById = vi.fn().mockRejectedValue(new Error("stale"));
    const app = new G2AppController({
      render: vi.fn(), stopAudio: vi.fn(), closeSockets: vi.fn(), unsubscribe: vi.fn(),
      create: {
        restore: async () => ({ state: "prepared", title: "Title" }),
        confirm: async () => ({ state: "commit_unknown" }),
        refresh,
      },
      query: { ask: async () => ({ state: "closest_matches", matches: [{ id: "atm-one", title: "One" }] }), openSource: () => "atm-one" },
      read: { loadRecent: async () => ({ items: [], selectedIndex: 0, coverageComplete: true }), openById },
    });

    await app.start({ paired: true, setupReady: true });
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(app.snapshot()).toMatchObject({ screen: "error", reason: "commit-unknown", primaryAction: "wait" });
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(refresh).toHaveBeenCalledOnce();
    expect(app.snapshot()).toMatchObject({ screen: "queued", stillQueued: true });

    // A stale body should return to the source screen, not discard the context and jump to root.
    await app.submitSpeech("question");
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(app.snapshot()).toMatchObject({ screen: "error", reason: "stale", primaryAction: "return" });
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(app.snapshot().screen).toBe("closest-matches");
  });

  it("returns from source bodies to the retained answer list and then returns to root", async () => {
    const answer = { state: "answered" as const, answer: "Friday", sources: [{ id: "atm-answer", title: "Launch" }] };
    const recent = { items: [{ id: "atm-recent", title: "Notes" }], selectedIndex: 0, coverageComplete: true };
    const read = {
      loadRecent: vi.fn(async () => recent),
      openById: vi.fn(async () => ({ text: "Short body", position: { offset: 0, next_offset: null } })),
    };
    const app = new G2AppController({
      render: vi.fn(), stopAudio: vi.fn(), closeSockets: vi.fn(), unsubscribe: vi.fn(),
      create: { restore: async () => ({ state: "idle" }), confirm: async () => ({ state: "idle" }) },
      query: { ask: async () => answer, openSource: () => "atm-answer" },
      read,
    });

    await app.submitSpeech("When?");
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(app.snapshot()).toMatchObject({ screen: "body", title: "Launch", pageIndex: 0 });
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(app.snapshot()).toEqual({ screen: "answer", answer: "Friday", sources: answer.sources, selectedIndex: 0 });
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 1 });
    expect(app.snapshot()).toEqual({ screen: "root", selectedIndex: 0 });

  });

  it("returns from closest-match source context and then its Return row to root", async () => {
    const matches = [{ id: "atm-match", title: "Possible match" }];
    const app = new G2AppController({
      render: vi.fn(), stopAudio: vi.fn(), closeSockets: vi.fn(), unsubscribe: vi.fn(),
      create: { restore: async () => ({ state: "idle" }), confirm: async () => ({ state: "idle" }) },
      query: { ask: async () => ({ state: "closest_matches", matches }), openSource: () => null },
      read: {
        loadRecent: async () => ({ items: [], selectedIndex: 0, coverageComplete: true }),
        openById: async () => ({ text: "Body", position: { offset: 0, next_offset: null } }),
      },
    });

    await app.submitSpeech("Maybe?");
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(app.snapshot()).toMatchObject({ screen: "body", title: "Possible match" });
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(app.snapshot()).toEqual({ screen: "closest-matches", matches, selectedIndex: 0 });
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 1 });
    expect(app.snapshot()).toEqual({ screen: "root", selectedIndex: 0 });
  });

  it("keeps multi-page body navigation on scroll gestures", async () => {
    const sources = [{ id: "atm-long", title: "Long note" }];
    const app = new G2AppController({
      render: vi.fn(), stopAudio: vi.fn(), closeSockets: vi.fn(), unsubscribe: vi.fn(),
      create: { restore: async () => ({ state: "idle" }), confirm: async () => ({ state: "idle" }) },
      query: { ask: async () => ({ state: "answered", answer: "Answer", sources }), openSource: () => "atm-long" },
      read: {
        loadRecent: async () => ({ items: [], selectedIndex: 0, coverageComplete: true }),
        openById: async () => ({ text: "x".repeat(451), position: { offset: 0, next_offset: null } }),
      },
    });

    await app.submitSpeech("Question");
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(app.snapshot()).toMatchObject({ screen: "body", pageIndex: 0, pages: ["x".repeat(450), "x"] });
    await app.handle({ kind: "scroll-down", envelope: "text" });
    expect(app.snapshot()).toMatchObject({ screen: "body", pageIndex: 1 });
    await app.handle({ kind: "scroll-up", envelope: "text" });
    expect(app.snapshot()).toEqual({ screen: "answer", answer: "Answer", sources, selectedIndex: 0 });
  });

  it("does not let a repeated New atom gesture stop a recording whose start is unfinished", async () => {
    let releaseStart!: () => void;
    const startRecording = vi.fn(() => new Promise<void>((resolve) => { releaseStart = resolve; }));
    const stopRecording = vi.fn(async () => ({ purpose: "create" as const, recordingId: "rec", capturedAt: "now", transcript: "text" }));
    const app = new G2AppController({
      render: vi.fn(), stopAudio: vi.fn(), closeSockets: vi.fn(), unsubscribe: vi.fn(), startRecording, stopRecording,
      create: { restore: async () => ({ state: "idle" }), confirm: async () => ({ state: "idle" }) },
      query: { ask: async () => ({ state: "unavailable" }), openSource: () => null },
      read: { loadRecent: async () => ({ items: [], selectedIndex: 0, coverageComplete: true }), openById: async () => ({ text: "", position: { offset: 0, next_offset: null } }) },
    });
    app.showRoot();

    const first = app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(app.snapshot()).toMatchObject({ screen: "starting-recording", purpose: "create" });
    await app.handle({ kind: "click", envelope: "text" });
    expect(stopRecording).not.toHaveBeenCalled();
    releaseStart();
    await first;
    expect(app.snapshot()).toMatchObject({ screen: "recording", purpose: "create" });
  });

  it("cancels audio when Back leaves a recording whose start is unfinished", async () => {
    let releaseStart!: () => void;
    const startRecording = vi.fn(() => new Promise<void>((resolve) => { releaseStart = resolve; }));
    const stopAudio = vi.fn(async () => undefined);
    const app = new G2AppController({
      render: vi.fn(), stopAudio, closeSockets: vi.fn(), unsubscribe: vi.fn(), startRecording,
      create: { restore: async () => ({ state: "idle" }), confirm: async () => ({ state: "idle" }) },
      query: { ask: async () => ({ state: "unavailable" }), openSource: () => null },
      read: { loadRecent: async () => ({ items: [], selectedIndex: 0, coverageComplete: true }), openById: async () => ({ text: "", position: { offset: 0, next_offset: null } }) },
    });
    app.showRoot();

    const start = app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(app.snapshot()).toMatchObject({ screen: "starting-recording", purpose: "create" });

    await app.handle({ kind: "scroll-up", envelope: "text" });
    expect(app.snapshot()).toMatchObject({ screen: "root", selectedIndex: 0 });

    releaseStart();
    await start;

    expect(stopAudio).toHaveBeenCalledOnce();
    expect(stopAudio).toHaveBeenCalledWith("cancelled");
    expect(app.snapshot()).toMatchObject({ screen: "root", selectedIndex: 0 });
  });

  it("performs visible Reconnect and Discard actions instead of returning silently", async () => {
    const reconnect = vi.fn(async () => undefined);
    const stopAudio = vi.fn(async () => undefined);
    const cancel = vi.fn(async () => undefined);
    const startRecording = vi.fn()
      .mockRejectedValueOnce(new Error("setup_required"))
      .mockRejectedValueOnce(new Error("recovery_full"));
    const app = new G2AppController({
      render: vi.fn(), stopAudio, closeSockets: vi.fn(), unsubscribe: vi.fn(), reconnect, startRecording,
      create: { restore: async () => ({ state: "idle" }), confirm: async () => ({ state: "idle" }), cancel },
      query: { ask: async () => ({ state: "unavailable" }), openSource: () => null },
      read: { loadRecent: async () => ({ items: [], selectedIndex: 0, coverageComplete: true }), openById: async () => ({ text: "", position: { offset: 0, next_offset: null } }) },
    });

    app.showRoot();
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(app.snapshot()).toMatchObject({ screen: "error", primaryAction: "reconnect" });
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(reconnect).toHaveBeenCalledOnce();
    expect(app.snapshot().screen).toBe("setup-required");

    app.showRoot();
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(app.snapshot()).toMatchObject({ screen: "error", reason: "recovery-full", primaryAction: "discard" });
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(stopAudio).toHaveBeenCalledWith("cancelled");
    expect(cancel).toHaveBeenCalledOnce();
    expect(app.snapshot().screen).toBe("root");
  });

  it("starts a fresh capture when a rejected create response offers Retry", async () => {
    const startRecording = vi.fn(async () => undefined);
    const cancel = vi.fn(async () => undefined);
    const app = new G2AppController({
      render: vi.fn(), stopAudio: vi.fn(), closeSockets: vi.fn(), unsubscribe: vi.fn(), startRecording,
      create: { restore: async () => ({ state: "prepared", title: "Draft" }), confirm: async () => ({ state: "rejected" }), cancel },
      query: { ask: async () => ({ state: "unavailable" }), openSource: () => null },
      read: { loadRecent: async () => ({ items: [], selectedIndex: 0, coverageComplete: true }), openById: async () => ({ text: "", position: { offset: 0, next_offset: null } }) },
    });

    await app.start({ paired: true, setupReady: true });
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });
    expect(app.snapshot()).toMatchObject({ screen: "error", reason: "preparation-failed", primaryAction: "retry" });
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 0 });

    expect(cancel).toHaveBeenCalledOnce();
    expect(startRecording).toHaveBeenCalledWith("create");
    expect(app.snapshot()).toMatchObject({ screen: "recording", purpose: "create" });
  });

  it("starts a fresh local recording when transcript review selects Try again", async () => {
    const startRecording = vi.fn(async () => undefined);
    const cancel = vi.fn(async () => undefined);
    const app = new G2AppController({
      render: vi.fn(), stopAudio: vi.fn(), closeSockets: vi.fn(), unsubscribe: vi.fn(), startRecording,
      create: {
        restore: async () => ({ state: "prepared", title: "Draft", transcript: "wrong local words" }),
        confirm: async () => ({ state: "idle" }),
        cancel,
      },
      query: { ask: async () => ({ state: "unavailable" }), openSource: () => null },
      read: { loadRecent: async () => ({ items: [], selectedIndex: 0, coverageComplete: true }), openById: async () => ({ text: "", position: { offset: 0, next_offset: null } }) },
    });

    await app.start({ paired: true, setupReady: true });
    await app.handle({ kind: "click", envelope: "list", selectedIndex: 1 });

    expect(cancel).toHaveBeenCalledOnce();
    expect(startRecording).toHaveBeenCalledWith("create");
    expect(app.snapshot()).toMatchObject({ screen: "recording", purpose: "create" });
  });
});
