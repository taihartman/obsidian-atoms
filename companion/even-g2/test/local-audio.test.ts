import { describe, expect, it, vi } from "vitest";

import { EvenLocalAudioSession } from "../src/platform/localAudio";

function harness() {
  const transcriber = {
    initialize: vi.fn(async () => undefined),
    start: vi.fn(() => undefined),
    accept: vi.fn(() => undefined),
    stop: vi.fn(async () => "exact local transcript"),
    cancel: vi.fn(async () => undefined),
  };
  const bridge = { audioControl: vi.fn(async () => true) };
  const session = new EvenLocalAudioSession(bridge, () => transcriber, {
    makeId: () => "rec_local",
    now: () => new Date("2026-09-10T18:00:00.000Z"),
  });
  return { bridge, session, transcriber };
}

describe("Even local audio session", () => {
  it("keeps PCM on the phone and returns the local transcript", async () => {
    const h = harness();
    await h.session.initialize();
    await h.session.start("create");
    h.session.accept(new Uint8Array([1, 0, 2, 0]));
    const result = await h.session.stop();

    expect(h.transcriber.initialize).toHaveBeenCalledOnce();
    expect(h.transcriber.accept).toHaveBeenCalledWith(new Uint8Array([1, 0, 2, 0]));
    expect(h.bridge.audioControl.mock.calls).toEqual([[true, expect.anything()], [false]]);
    expect(result).toMatchObject({
      purpose: "create",
      recordingId: "rec_local",
      capturedAt: "2026-09-10T18:00:00.000Z",
      transcript: "exact local transcript",
    });
  });

  it("discards an interrupted local recording and can initialize a fresh worker", async () => {
    const h = harness();
    await h.session.start("create");
    await h.session.teardown("cancelled");
    await h.session.start("create");

    expect(h.transcriber.cancel).toHaveBeenCalledOnce();
    expect(h.transcriber.initialize).toHaveBeenCalledTimes(2);
    expect(h.transcriber.start).toHaveBeenCalledTimes(2);
  });

  it("latches a synchronous ingestion failure until teardown stops the microphone", async () => {
    const h = harness();
    h.transcriber.accept.mockImplementation(() => { throw new Error("worker_backpressure"); });
    await h.session.start("create");

    expect(() => h.session.accept(new Uint8Array([1, 0]))).toThrow("worker_backpressure");
    expect(() => h.session.accept(new Uint8Array([2, 0]))).not.toThrow();
    await h.session.teardown("permission_lost");

    expect(h.bridge.audioControl).toHaveBeenLastCalledWith(false);
    expect(h.transcriber.cancel).toHaveBeenCalledOnce();
  });
});
