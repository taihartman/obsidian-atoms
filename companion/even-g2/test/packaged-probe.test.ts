import { describe, expect, it, vi } from "vitest";

import {
  U1DiagnosticCheckpointStore,
  PcmDurationStopController,
  beginDiagnosticRecording,
  buildRecordingTiming,
  createPackagedDiagnosticRun,
  diagnosticStepActions,
  glassesReviewSummary,
  shouldAcceptDiagnosticPcm,
  timedCheckLabel,
  renderGlassesReviewSafely,
} from "../src/audio/packagedProbe";
import { U1_ACCURACY_CORPUS, createU1DiagnosticRun } from "../src/audio/u1Diagnostic";

describe("packaged U1 probe", () => {
  it("labels a targeted timed retest with its actual duration", () => {
    expect(timedCheckLabel(30)).toBe("30-second timing check");
    expect(timedCheckLabel(120)).toBe("120-second timing check");
  });

  it("stops timed recording from PCM duration and keeps a delayed timer as fallback", () => {
    const schedule = vi.fn((_callback: () => void, _delayMs: number) => 17);
    const cancel = vi.fn();
    const timer = new PcmDurationStopController(schedule, cancel);
    const stop = vi.fn();

    timer.begin(120_000);
    expect(schedule).not.toHaveBeenCalled();

    timer.notePcm(1_600, stop);
    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 125_000);
    expect(stop).not.toHaveBeenCalled();

    timer.notePcm(3_839_999, stop);
    expect(stop).not.toHaveBeenCalled();

    timer.notePcm(3_840_000, stop);
    expect(cancel).toHaveBeenCalledWith(17);
    expect(stop).toHaveBeenCalledOnce();

    timer.notePcm(3_841_600, stop);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("accepts PCM before microphone startup acknowledgement returns", async () => {
    let resolveMicrophone!: (enabled: boolean) => void;
    let captureActive = false;
    const enabling = new Promise<boolean>((resolve) => { resolveMicrophone = resolve; });
    const starting = beginDiagnosticRecording({
      startTranscriber: vi.fn(),
      markCaptureActive: () => { captureActive = true; },
      enableMicrophone: () => enabling,
    });

    expect(captureActive).toBe(true);
    resolveMicrophone(true);
    await expect(starting).resolves.toBeUndefined();
  });

  it("keeps accepting final PCM until microphone shutdown is acknowledged", () => {
    expect(shouldAcceptDiagnosticPcm("recording")).toBe(true);
    expect(shouldAcceptDiagnosticPcm("stopping-audio")).toBe(true);
    expect(shouldAcceptDiagnosticPcm("finalizing")).toBe(false);
  });

  it("keeps long transcripts off the constrained glasses result page", () => {
    const transcript = "A very long transcript ".repeat(500);
    const summary = glassesReviewSummary(86);

    expect(summary).toBe("Cycle recorded.\nFinalized in 86 ms.");
    expect(summary).not.toContain(transcript);
    expect(summary.length).toBeLessThan(80);
  });

  it("keeps the next diagnostic step available when the glasses result page fails", async () => {
    const recordFailure = vi.fn();

    await expect(renderGlassesReviewSafely({
      finalLatencyMs: 86,
      render: vi.fn(async () => { throw new Error("page_rebuild_failed"); }),
      recordFailure,
    })).resolves.toBeUndefined();

    expect(recordFailure).toHaveBeenCalledWith("Glasses review failed (page_rebuild_failed).");
  });

  it("saves privacy-safe progress and clears it only when starting over", async () => {
    const values = new Map<string, string>();
    const storage = {
      getLocalStorage: vi.fn(async (key: string) => values.get(key) ?? ""),
      setLocalStorage: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
        return true;
      }),
    };
    const checkpoints = new U1DiagnosticCheckpointStore(storage);
    const report = {
      schema: "atoms-g2-u1-diagnostic/v1",
      packageVersion: "0.1.8",
      completedCycles: 24,
      cancellation: null,
    };

    await checkpoints.save(report);
    expect(await checkpoints.load()).toEqual(report);
    expect(JSON.stringify(await checkpoints.load())).not.toContain("transcript");

    await checkpoints.clear();
    expect(await checkpoints.load()).toBeUndefined();
  });

  it("offers start over without replacing the primary next action", () => {
    expect(diagnosticStepActions({ kind: "cancellation" }, true)).toEqual(["Start check", "Start over"]);
    expect(diagnosticStepActions({ kind: "complete" }, true)).toEqual(["Start over"]);
    expect(diagnosticStepActions({ kind: "cancellation" }, false)).toEqual(["Start check"]);
  });

  it("records the long-check stop source, timer drift, PCM edges, and packet gaps", () => {
    expect(buildRecordingTiming({
      stopReason: "timer",
      scheduledDurationMs: 120_000,
      recordingStartedAt: 1_000,
      microphoneAckAt: 1_420,
      firstPcmAt: 1_450,
      lastPcmAt: 121_400,
      stopRequestedAt: 121_480,
      audioStoppedAt: 121_500,
      packetCount: 2_400,
      maxInterPacketGapMs: 72,
    })).toEqual({
      stopReason: "timer",
      scheduledDurationMs: 120_000,
      microphoneAckMs: 420,
      firstPcmMs: 450,
      lastPcmMs: 120_400,
      stopRequestedMs: 120_480,
      timerDriftMs: 30,
      packetCount: 2_400,
      maxInterPacketGapMs: 72,
      audioStopAckMs: 20,
    });
  });

  it("selects the targeted follow-up when a complete 0.1.8 checkpoint is present", () => {
    const baseline = createU1DiagnosticRun({
      environment: {}, onlineAtLaunch: true, readinessMs: 315,
      startedAt: "2026-09-10T14:14:18.323Z",
    });
    for (const phrase of U1_ACCURACY_CORPUS) {
      baseline.completeTranscript({
        transcript: phrase.id === "p01" ? "wrong" : phrase.text,
        recordingMs: 2_000, finalLatencyMs: 100, pcmBytes: 64_000,
      });
    }
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      baseline.completeTranscript({
        transcript: "timed", recordingMs: 30_000, finalLatencyMs: 100, pcmBytes: 960_000,
      });
    }
    baseline.completeTranscript({
      transcript: "long", recordingMs: 120_000, finalLatencyMs: 100, pcmBytes: 3_840_000,
    });
    baseline.completeCancellation({ stopMs: 60, lateTranscript: false });

    const selected = createPackagedDiagnosticRun({
      environment: {}, onlineAtLaunch: true, readinessMs: 315,
      startedAt: "2026-09-10T15:00:00.000Z",
      checkpoint: { ...baseline.report(), packageVersion: "0.1.8" },
    });

    expect(selected.mode).toBe("targeted");
    expect(selected.run.current()).toMatchObject({ kind: "timed", seconds: 120 });
  });
});
