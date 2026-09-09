import { afterEach, describe, expect, it, vi } from "vitest";

import { installEvenSdkEventLogPrivacy } from "../src/platform/sdkLogPrivacy";

describe("Even SDK event log privacy", () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  it("suppresses only the SDK's exact raw-event log and restores cleanly", () => {
    const log = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    console.log = log;
    console.warn = warn;
    console.error = error;
    const release = installEvenSdkEventLogPrivacy();
    const pcm = new Uint8Array([1, 2, 3]);

    console.log("[EvenAppBridge] EvenHub event:", { audioEvent: { audioPcm: pcm } });
    console.log("[EvenAppBridge] EvenHub event: connected");
    console.log("application event", pcm);
    console.warn("warning", pcm);
    console.error("error", pcm);

    expect(log.mock.calls).toEqual([
      ["[EvenAppBridge] EvenHub event: connected"],
      ["application event", pcm],
    ]);
    expect(warn).toHaveBeenCalledWith("warning", pcm);
    expect(error).toHaveBeenCalledWith("error", pcm);

    release();
    console.log("[EvenAppBridge] EvenHub event:", { safe: true });
    expect(log).toHaveBeenLastCalledWith("[EvenAppBridge] EvenHub event:", { safe: true });
  });

  it("keeps the filter installed until the final overlapping owner releases it", () => {
    const log = vi.fn();
    console.log = log;
    const releaseOne = installEvenSdkEventLogPrivacy();
    const releaseTwo = installEvenSdkEventLogPrivacy();

    releaseOne();
    console.log("[EvenAppBridge] EvenHub event:", { private: true });
    expect(log).not.toHaveBeenCalled();
    releaseTwo();
    console.log("other");
    expect(log).toHaveBeenCalledWith("other");
  });
});
