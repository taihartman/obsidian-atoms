import { describe, expect, it } from "vitest";

import {
  U1_ACCURACY_CORPUS,
  U1_DIAGNOSTIC_VERSION,
  createU1DiagnosticRun,
  createU1TargetedDiagnosticRun,
  scoreTranscript,
} from "../src/audio/u1Diagnostic";

describe("U1 packaged diagnostic", () => {
  it("guides the fixed 20-cycle corpus before the timed and cancellation checks", () => {
    const run = createU1DiagnosticRun({
      environment: { runtime: "single-thread-simd" },
      onlineAtLaunch: false,
      readinessMs: 1_568,
      startedAt: "2026-09-09T12:00:00.000Z",
    });

    expect(U1_ACCURACY_CORPUS).toHaveLength(20);
    expect(run.current()).toMatchObject({ kind: "accuracy", phraseIndex: 0 });

    for (const phrase of U1_ACCURACY_CORPUS) {
      run.completeTranscript({
        transcript: phrase.text,
        recordingMs: 2_000,
        finalLatencyMs: 400,
        pcmBytes: 64_000,
      });
    }

    expect(run.current()).toMatchObject({ kind: "timed", seconds: 30, repetition: 1 });
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      run.completeTranscript({
        transcript: "timed sample",
        recordingMs: 30_000,
        finalLatencyMs: 700,
        pcmBytes: 960_000,
      });
    }
    expect(run.current()).toMatchObject({ kind: "timed", seconds: 120 });
    run.completeTranscript({
      transcript: "bounded sample",
      recordingMs: 120_000,
      finalLatencyMs: 1_200,
      pcmBytes: 3_840_000,
    });

    expect(run.current()).toEqual({ kind: "cancellation" });
    run.completeCancellation({ stopMs: 320, lateTranscript: false });
    expect(run.current()).toEqual({ kind: "complete" });

    const report = run.report();
    expect(report).toMatchObject({
      schema: "atoms-g2-u1-diagnostic/v1",
      packageVersion: U1_DIAGNOSTIC_VERSION,
      onlineAtLaunch: false,
      readinessMs: 1_568,
      completedCycles: 24,
      accuracy: {
        completed: 20,
        wordErrorRate: 0,
        meaningChangingErrors: 0,
        passed: true,
      },
      cancellation: { stopMs: 320, lateTranscript: false, passed: true },
    });
    expect(JSON.stringify(report)).not.toContain("timed sample");
    expect(JSON.stringify(report)).not.toContain(U1_ACCURACY_CORPUS[0]?.text);
    expect(report.accuracyCycles).toHaveLength(20);
    expect(report.accuracyCycles[0]).toMatchObject({
      phraseId: "p01",
      wordEdits: 0,
      criticalError: false,
    });
  });

  it("scores word edits and critical names, negations, dates, and numbers", () => {
    const phrase = U1_ACCURACY_CORPUS.find(({ criticalTerms }) => criticalTerms.includes("not"));
    expect(phrase).toBeDefined();

    expect(scoreTranscript(phrase!, phrase!.text)).toMatchObject({
      wordEdits: 0,
      criticalError: false,
    });
    expect(scoreTranscript(phrase!, phrase!.text.replace("not ", ""))).toMatchObject({
      wordEdits: 1,
      criticalError: true,
    });

    const numbered = U1_ACCURACY_CORPUS.find(({ id }) => id === "p04")!;
    expect(scoreTranscript(numbered, "The locker code is 4821")).toMatchObject({
      wordEdits: 0,
      criticalError: false,
    });
  });

  it("records visible threshold failures without retaining transcript text", () => {
    const run = createU1DiagnosticRun({
      environment: { runtime: "single-thread-simd" },
      onlineAtLaunch: true,
      readinessMs: 18_000,
      startedAt: "2026-09-09T12:00:00.000Z",
    });
    const phrase = U1_ACCURACY_CORPUS[0]!;
    run.completeTranscript({
      transcript: "completely unrelated words",
      recordingMs: 1_000,
      finalLatencyMs: 2_500,
      pcmBytes: 32_000,
    });

    const report = run.report();
    expect(report.failures).toEqual(expect.arrayContaining([
      "Cold readiness exceeded 15 seconds.",
      "Cycle 1 final latency exceeded 2 seconds.",
    ]));
    expect(JSON.stringify(report)).not.toContain("completely unrelated words");
  });

  it("resumes at the first unfinished check from a privacy-safe checkpoint", () => {
    const original = createU1DiagnosticRun({
      environment: { runtime: "single-thread-simd" },
      onlineAtLaunch: true,
      readinessMs: 326,
      startedAt: "2026-09-10T01:54:35.981Z",
    });
    for (const phrase of U1_ACCURACY_CORPUS) {
      original.completeTranscript({
        transcript: phrase.text,
        recordingMs: 2_000,
        finalLatencyMs: 100,
        pcmBytes: 64_000,
      });
    }
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      original.completeTranscript({
        transcript: "timed sample",
        recordingMs: 30_000,
        finalLatencyMs: 100,
        pcmBytes: 960_000,
      });
    }
    original.completeTranscript({
      transcript: "bounded sample",
      recordingMs: 120_000,
      finalLatencyMs: 100,
      pcmBytes: 3_840_000,
    });

    const resumed = createU1DiagnosticRun({
      environment: { runtime: "single-thread-simd" },
      onlineAtLaunch: true,
      readinessMs: 400,
      startedAt: "2026-09-10T02:30:00.000Z",
      checkpoint: original.report(),
    });

    expect(resumed.current()).toEqual({ kind: "cancellation" });
    expect(resumed.report()).toEqual(original.report());
    expect(JSON.stringify(resumed.report())).not.toContain("timed sample");
    expect(JSON.stringify(resumed.report())).not.toContain("bounded sample");
  });

  it("starts fresh when a checkpoint is incompatible", () => {
    const run = createU1DiagnosticRun({
      environment: { runtime: "single-thread-simd" },
      onlineAtLaunch: true,
      readinessMs: 400,
      startedAt: "2026-09-10T02:30:00.000Z",
      checkpoint: {
        schema: "atoms-g2-u1-diagnostic/v1",
        packageVersion: "0.1.6",
        completedCycles: 24,
      },
    });

    expect(run.current()).toMatchObject({ kind: "accuracy", phraseIndex: 0 });
    expect(run.report().completedCycles).toBe(0);
  });

  it("migrates a completed 0.1.8 report into five failed-phrase retests and one long check", () => {
    const failedIds = new Set(["p01", "p03", "p13", "p17", "p20"]);
    const baseline = completedBaseline(failedIds);
    const run = createU1TargetedDiagnosticRun({
      environment: { runtime: "single-thread-simd" },
      onlineAtLaunch: true,
      readinessMs: 315,
      startedAt: "2026-09-10T15:00:00.000Z",
      checkpoint: baseline,
    });

    expect(run).not.toBeNull();
    for (const phraseId of failedIds) {
      expect(run!.current()).toMatchObject({ kind: "accuracy", phrase: { id: phraseId } });
      const phrase = U1_ACCURACY_CORPUS.find(({ id }) => id === phraseId)!;
      run!.completeTranscript({
        transcript: phrase.text,
        recordingMs: 2_000,
        finalLatencyMs: 100,
        pcmBytes: 64_000,
      });
    }
    expect(run!.current()).toMatchObject({ kind: "timed", seconds: 120 });
    run!.completeTranscript({
      transcript: "long check",
      recordingMs: 120_100,
      finalLatencyMs: 100,
      pcmBytes: 3_840_000,
      timing: {
        stopReason: "timer",
        scheduledDurationMs: 120_000,
        microphoneAckMs: 420,
        firstPcmMs: 450,
        lastPcmMs: 119_950,
        stopRequestedMs: 120_080,
        timerDriftMs: 80,
        packetCount: 2_400,
        maxInterPacketGapMs: 72,
        audioStopAckMs: 20,
      },
    });

    const report = run!.report();
    expect(run!.current()).toEqual({ kind: "complete" });
    expect(report).toMatchObject({
      packageVersion: "0.1.13",
      completedCycles: 24,
      accuracy: { meaningChangingErrors: 0, passed: true },
      cancellation: { stopMs: 60, lateTranscript: false, passed: true },
      targeted: {
        sourcePackageVersion: "0.1.8",
        phraseIds: [...failedIds],
        completedPhraseIds: [...failedIds],
        longRecordingComplete: true,
        longRecordingTiming: { stopReason: "timer", timerDriftMs: 80 },
      },
    });
    expect(JSON.stringify(report)).not.toContain("long check");
  });

  it("resumes a targeted retest at its first unfinished phrase", () => {
    const baseline = completedBaseline(new Set(["p01", "p03", "p13", "p17", "p20"]));
    const first = createU1TargetedDiagnosticRun({
      environment: {}, onlineAtLaunch: true, readinessMs: 315,
      startedAt: "2026-09-10T15:00:00.000Z", checkpoint: baseline,
    })!;
    first.completeTranscript({
      transcript: U1_ACCURACY_CORPUS[0]!.text,
      recordingMs: 2_000,
      finalLatencyMs: 100,
      pcmBytes: 64_000,
    });

    const resumed = createU1TargetedDiagnosticRun({
      environment: {}, onlineAtLaunch: true, readinessMs: 300,
      startedAt: "2026-09-10T15:10:00.000Z", checkpoint: first.report(),
    });

    expect(resumed?.current()).toMatchObject({ kind: "accuracy", phrase: { id: "p03" } });
  });

  it("migrates a completed 0.1.9 report into three failed-phrase retests and a fresh long check", () => {
    const first = createU1TargetedDiagnosticRun({
      environment: {}, onlineAtLaunch: true, readinessMs: 348,
      startedAt: "2026-09-10T15:58:59.324Z",
      checkpoint: completedBaseline(new Set(["p01", "p03", "p13", "p17", "p20"])),
    })!;
    for (const phraseId of ["p01", "p03", "p13", "p17", "p20"]) {
      const phrase = U1_ACCURACY_CORPUS.find(({ id }) => id === phraseId)!;
      first.completeTranscript({
        transcript: ["p03", "p17", "p20"].includes(phraseId) ? "unrelated words" : phrase.text,
        recordingMs: 2_000,
        finalLatencyMs: 100,
        pcmBytes: 64_000,
      });
    }
    first.completeTranscript({
      transcript: "long check",
      recordingMs: 119_942,
      finalLatencyMs: 11,
      pcmBytes: 3_812_800,
      timing: {
        stopReason: "timer",
        scheduledDurationMs: 120_000,
        microphoneAckMs: 59,
        firstPcmMs: 461,
        lastPcmMs: 119_863,
        stopRequestedMs: 119_843,
        timerDriftMs: -157,
        packetCount: 2_383,
        maxInterPacketGapMs: 154,
        audioStopAckMs: 41,
      },
    });

    const checkpoint = { ...first.report(), packageVersion: "0.1.9" };
    const migrated = createU1TargetedDiagnosticRun({
      environment: {}, onlineAtLaunch: true, readinessMs: 300,
      startedAt: "2026-09-10T16:30:00.000Z",
      checkpoint,
    });

    expect(checkpoint.packageVersion).toBe("0.1.9");
    expect(migrated?.report()).toMatchObject({
      packageVersion: "0.1.13",
      targeted: {
        sourcePackageVersion: "0.1.9",
        phraseIds: ["p03", "p17", "p20"],
        completedPhraseIds: [],
        longRecordingComplete: false,
        longRecordingTiming: null,
      },
    });
    expect(migrated?.current()).toMatchObject({ kind: "accuracy", phrase: { id: "p03" } });
  });

  it("migrates passing 0.1.10 accuracy into only a fresh long check", () => {
    const first = createU1TargetedDiagnosticRun({
      environment: {}, onlineAtLaunch: true, readinessMs: 793,
      startedAt: "2026-09-10T16:27:12.014Z",
      checkpoint: completedBaseline(new Set(["p01", "p03", "p13", "p17", "p20"])),
    })!;
    for (const phraseId of ["p01", "p03", "p13", "p17", "p20"]) {
      const phrase = U1_ACCURACY_CORPUS.find(({ id }) => id === phraseId)!;
      first.completeTranscript({
        transcript: ["p03", "p20"].includes(phraseId) ? "unrelated words" : phrase.text,
        recordingMs: 2_000,
        finalLatencyMs: 100,
        pcmBytes: 64_000,
      });
    }
    first.completeTranscript({
      transcript: "long check",
      recordingMs: 119_280,
      finalLatencyMs: 8,
      pcmBytes: 3_792_000,
      timing: {
        stopReason: "timer",
        scheduledDurationMs: 120_000,
        microphoneAckMs: 58,
        firstPcmMs: 440,
        lastPcmMs: 119_178,
        stopRequestedMs: 119_117,
        timerDriftMs: -1_323,
        packetCount: 2_370,
        maxInterPacketGapMs: 427,
        audioStopAckMs: 90,
      },
    });

    const migrated = createU1TargetedDiagnosticRun({
      environment: {}, onlineAtLaunch: true, readinessMs: 300,
      startedAt: "2026-09-10T17:00:00.000Z",
      checkpoint: { ...first.report(), packageVersion: "0.1.10" },
    });

    expect(migrated?.report()).toMatchObject({
      packageVersion: "0.1.13",
      targeted: {
        sourcePackageVersion: "0.1.10",
        phraseIds: [],
        completedPhraseIds: [],
        longRecordingComplete: false,
        longRecordingTiming: null,
      },
    });
    expect(migrated?.current()).toMatchObject({ kind: "timed", seconds: 120 });
  });

  it("migrates 0.1.11 into only its failed 30-second retest", () => {
    const baseline = completedBaseline(new Set());
    const timedRecordings = baseline.timedRecordings.map((item) => {
      if (item.seconds === 30 && item.repetition === 3) {
        return { ...item, pcmBytes: 942_400, pcmDurationMs: 29_450, passed: false };
      }
      if (item.seconds === 120) {
        return { ...item, recordingMs: 120_824, finalLatencyMs: 8, pcmBytes: 3_840_000, pcmDurationMs: 120_000, passed: true };
      }
      return item;
    });
    const checkpoint = {
      ...baseline,
      packageVersion: "0.1.11",
      timedRecordings,
      failures: ["30-second recording 3 had 29450 ms of PCM."],
      targeted: {
        sourcePackageVersion: "0.1.10",
        phraseIds: [],
        completedPhraseIds: [],
        longRecordingComplete: true,
        longRecordingTiming: {
          stopReason: "pcm" as const,
          scheduledDurationMs: 120_000,
          microphoneAckMs: 63,
          firstPcmMs: 469,
          lastPcmMs: 120_730,
          stopRequestedMs: 120_732,
          timerDriftMs: null,
          packetCount: 2_400,
          maxInterPacketGapMs: 172,
          audioStopAckMs: 45,
        },
      },
    };

    const migrated = createU1TargetedDiagnosticRun({
      environment: {}, onlineAtLaunch: true, readinessMs: 300,
      startedAt: "2026-09-10T17:30:00.000Z", checkpoint,
    });

    expect(migrated?.current()).toMatchObject({ kind: "timed", seconds: 30, repetition: 3 });
    migrated?.completeTranscript({
      transcript: "short check",
      recordingMs: 30_500,
      finalLatencyMs: 10,
      pcmBytes: 960_000,
    });
    expect(migrated?.current()).toEqual({ kind: "complete" });
    expect(migrated?.report()).toMatchObject({
      packageVersion: "0.1.13",
      failures: [],
      timedRecordings: [
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ seconds: 30, repetition: 3, pcmDurationMs: 30_000, passed: true }),
        expect.objectContaining({ seconds: 120, pcmDurationMs: 120_000, passed: true }),
      ],
      targeted: {
        sourcePackageVersion: "0.1.11",
        phraseIds: [],
        completedPhraseIds: [],
        longRecordingComplete: true,
      },
    });
  });

  it("migrates a complete 0.1.12 checkpoint into fresh offline-launch evidence without recordings", () => {
    const baseline = completedBaseline(new Set());
    const checkpoint = {
      ...baseline,
      packageVersion: "0.1.12",
      timedRecordings: baseline.timedRecordings.map((item) => item.seconds === 120
        ? { ...item, recordingMs: 120_824, finalLatencyMs: 8, pcmBytes: 3_840_000, pcmDurationMs: 120_000, passed: true }
        : item),
      failures: [],
      targeted: {
        sourcePackageVersion: "0.1.11",
        phraseIds: [],
        completedPhraseIds: [],
        longRecordingComplete: true,
        longRecordingTiming: {
          stopReason: "pcm" as const,
          scheduledDurationMs: 120_000,
          microphoneAckMs: 63,
          firstPcmMs: 469,
          lastPcmMs: 120_730,
          stopRequestedMs: 120_732,
          timerDriftMs: null,
          packetCount: 2_400,
          maxInterPacketGapMs: 172,
          audioStopAckMs: 45,
        },
      },
    };

    const migrated = createU1TargetedDiagnosticRun({
      environment: { runtime: "single-thread-simd" },
      onlineAtLaunch: false,
      readinessMs: 444,
      startedAt: "2026-09-10T18:00:00.000Z",
      checkpoint,
    });

    expect(migrated?.current()).toEqual({ kind: "complete" });
    expect(migrated?.report()).toMatchObject({
      packageVersion: "0.1.13",
      startedAt: "2026-09-10T18:00:00.000Z",
      onlineAtLaunch: false,
      readinessMs: 444,
      failures: [],
      targeted: {
        sourcePackageVersion: "0.1.12",
        phraseIds: [],
        completedPhraseIds: [],
        longRecordingComplete: true,
      },
    });
  });
});

function completedBaseline(failedIds: ReadonlySet<string>) {
  const run = createU1DiagnosticRun({
    environment: { runtime: "single-thread-simd" },
    onlineAtLaunch: true,
    readinessMs: 315,
    startedAt: "2026-09-10T14:14:18.323Z",
  });
  for (const phrase of U1_ACCURACY_CORPUS) {
    run.completeTranscript({
      transcript: failedIds.has(phrase.id) ? "unrelated words" : phrase.text,
      recordingMs: 2_000,
      finalLatencyMs: 100,
      pcmBytes: 64_000,
    });
  }
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    run.completeTranscript({
      transcript: "timed",
      recordingMs: 30_000,
      finalLatencyMs: 100,
      pcmBytes: 960_000,
    });
  }
  run.completeTranscript({
    transcript: "long",
    recordingMs: 118_591,
    finalLatencyMs: 87,
    pcmBytes: 3_769_600,
  });
  run.completeCancellation({ stopMs: 60, lateTranscript: false });
  return { ...run.report(), packageVersion: "0.1.8" };
}
