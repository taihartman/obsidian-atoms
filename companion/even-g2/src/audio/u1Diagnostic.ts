export const U1_DIAGNOSTIC_VERSION = "0.1.13";
export const U1_DIAGNOSTIC_SCHEMA = "atoms-g2-u1-diagnostic/v1";

export type AccuracyPhrase = {
  id: string;
  text: string;
  criticalTerms: readonly string[];
};

export const U1_ACCURACY_CORPUS: readonly AccuracyPhrase[] = Object.freeze([
  phrase("p01", "Call Maya after lunch", ["maya"]),
  phrase("p02", "Do not cancel the train ticket", ["not"]),
  phrase("p03", "Meet Jordan on September ninth", ["jordan", "september", "ninth"]),
  phrase("p04", "The locker code is four eight two one", ["four", "eight", "two", "one"]),
  phrase("p05", "Ask Priya about the blue notebook", ["priya"]),
  phrase("p06", "I did not order the large size", ["not", "large"]),
  phrase("p07", "The appointment starts at three thirty", ["three", "thirty"]),
  phrase("p08", "Send the photo to Elena", ["elena"]),
  phrase("p09", "The total was sixty seven dollars", ["sixty", "seven"]),
  phrase("p10", "Remember October twenty first", ["october", "twenty", "first"]),
  phrase("p11", "No peanuts in Sam's order", ["no", "peanuts", "sam's"]),
  phrase("p12", "Pick up two green candles", ["two", "green"]),
  phrase("p13", "Ravi arrives on Friday morning", ["ravi", "friday"]),
  phrase("p14", "The receipt number is nine zero six", ["nine", "zero", "six"]),
  phrase("p15", "Do not email Morgan yet", ["not", "morgan"]),
  phrase("p16", "Book a table for six people", ["six"]),
  phrase("p17", "Nora moved the meeting to Tuesday", ["nora", "tuesday"]),
  phrase("p18", "The package weighs twelve pounds", ["twelve"]),
  phrase("p19", "I cannot leave before seven", ["cannot", "seven"]),
  phrase("p20", "Visit Leo on December fifth", ["leo", "december", "fifth"]),
]);

export type U1DiagnosticStep =
  | { kind: "accuracy"; phraseIndex: number; phrase: AccuracyPhrase }
  | { kind: "timed"; seconds: 30; repetition: number }
  | { kind: "timed"; seconds: 120; repetition: 1 }
  | { kind: "cancellation" }
  | { kind: "complete" };

export type U1RecordingTiming = {
  stopReason: "pcm" | "timer" | "tap";
  scheduledDurationMs: number;
  microphoneAckMs: number | null;
  firstPcmMs: number | null;
  lastPcmMs: number | null;
  stopRequestedMs: number;
  timerDriftMs: number | null;
  packetCount: number;
  maxInterPacketGapMs: number;
  audioStopAckMs: number;
};

export type TranscriptMeasurement = {
  transcript: string;
  recordingMs: number;
  finalLatencyMs: number;
  pcmBytes: number;
  timing?: U1RecordingTiming;
};

export type AccuracyMeasurement = {
  phraseId: string;
  wordEdits: number;
  referenceWords: number;
  criticalError: boolean;
  recordingMs: number;
  finalLatencyMs: number;
  pcmBytes: number;
  pcmDurationMs: number;
};

export type TimedMeasurement = {
  seconds: 30 | 120;
  repetition: number;
  recordingMs: number;
  finalLatencyMs: number;
  pcmBytes: number;
  pcmDurationMs: number;
  passed: boolean;
};

export type U1DiagnosticReport = {
  schema: typeof U1_DIAGNOSTIC_SCHEMA;
  packageVersion: typeof U1_DIAGNOSTIC_VERSION;
  startedAt: string;
  onlineAtLaunch: boolean;
  environment: Record<string, unknown>;
  readinessMs: number;
  readinessPassed: boolean;
  completedCycles: number;
  accuracy: {
    completed: number;
    total: number;
    wordEdits: number;
    referenceWords: number;
    wordErrorRate: number | null;
    meaningChangingErrors: number;
    passed: boolean;
  };
  accuracyCycles: readonly AccuracyMeasurement[];
  timedRecordings: readonly TimedMeasurement[];
  cancellation: { stopMs: number; lateTranscript: boolean; passed: boolean } | null;
  failures: readonly string[];
  targeted?: {
    sourcePackageVersion: string;
    phraseIds: readonly string[];
    completedPhraseIds: readonly string[];
    longRecordingComplete: boolean;
    longRecordingTiming: U1RecordingTiming | null;
  };
};

export type RunOptions = {
  environment: Record<string, unknown>;
  onlineAtLaunch: boolean;
  readinessMs: number;
  startedAt: string;
  checkpoint?: unknown;
};

export function createU1DiagnosticRun(options: RunOptions) {
  const checkpoint = diagnosticCheckpoint(options.checkpoint);
  let stepIndex = checkpoint?.completedCycles ?? 0;
  const accuracy: AccuracyMeasurement[] = checkpoint ? [...checkpoint.accuracyCycles] : [];
  const timed: TimedMeasurement[] = checkpoint ? [...checkpoint.timedRecordings] : [];
  const failures: string[] = checkpoint ? [...checkpoint.failures] : [];
  let cancellation: U1DiagnosticReport["cancellation"] = checkpoint?.cancellation
    ? { ...checkpoint.cancellation }
    : null;
  if (cancellation) stepIndex += 1;

  const startedAt = checkpoint?.startedAt ?? options.startedAt;
  const onlineAtLaunch = checkpoint?.onlineAtLaunch ?? options.onlineAtLaunch;
  const environment = checkpoint?.environment ?? options.environment;
  const readinessMs = checkpoint?.readinessMs ?? options.readinessMs;

  if (!checkpoint && readinessMs > 15_000) failures.push("Cold readiness exceeded 15 seconds.");

  const current = (): U1DiagnosticStep => {
    if (stepIndex < U1_ACCURACY_CORPUS.length) {
      return {
        kind: "accuracy",
        phraseIndex: stepIndex,
        phrase: U1_ACCURACY_CORPUS[stepIndex]!,
      };
    }
    if (stepIndex < 23) {
      return { kind: "timed", seconds: 30, repetition: stepIndex - 19 };
    }
    if (stepIndex === 23) return { kind: "timed", seconds: 120, repetition: 1 };
    if (stepIndex === 24) return { kind: "cancellation" };
    return { kind: "complete" };
  };

  const completeTranscript = (measurement: TranscriptMeasurement): void => {
    const step = current();
    if (step.kind !== "accuracy" && step.kind !== "timed") {
      throw new Error("diagnostic_transcript_out_of_order");
    }
    const cycle = accuracy.length + timed.length + 1;
    if (measurement.finalLatencyMs > 2_000) {
      failures.push(`Cycle ${cycle} final latency exceeded 2 seconds.`);
    }
    const pcmDurationMs = pcmDuration(measurement.pcmBytes);
    if (step.kind === "accuracy") {
      const score = scoreTranscript(step.phrase, measurement.transcript);
      accuracy.push({
        phraseId: step.phrase.id,
        ...score,
        recordingMs: rounded(measurement.recordingMs),
        finalLatencyMs: rounded(measurement.finalLatencyMs),
        pcmBytes: measurement.pcmBytes,
        pcmDurationMs,
      });
    } else {
      const expectedMs = step.seconds * 1_000;
      const passed = Math.abs(pcmDurationMs - expectedMs) <= 500
        && measurement.finalLatencyMs <= 2_000;
      timed.push({
        ...step,
        recordingMs: rounded(measurement.recordingMs),
        finalLatencyMs: rounded(measurement.finalLatencyMs),
        pcmBytes: measurement.pcmBytes,
        pcmDurationMs,
        passed,
      });
      if (Math.abs(pcmDurationMs - expectedMs) > 500) {
        failures.push(`${step.seconds}-second recording ${step.repetition} had ${pcmDurationMs} ms of PCM.`);
      }
    }
    stepIndex += 1;
  };

  const completeCancellation = (measurement: { stopMs: number; lateTranscript: boolean }): void => {
    if (current().kind !== "cancellation") throw new Error("diagnostic_cancellation_out_of_order");
    cancellation = {
      stopMs: rounded(measurement.stopMs),
      lateTranscript: measurement.lateTranscript,
      passed: measurement.stopMs <= 500 && !measurement.lateTranscript,
    };
    if (!cancellation.passed) failures.push("Cancellation did not stop cleanly within 500 ms.");
    stepIndex += 1;
  };

  const recordFailure = (message: string): void => {
    if (!failures.includes(message)) failures.push(message);
  };

  const report = (): U1DiagnosticReport => {
    const wordEdits = accuracy.reduce((sum, item) => sum + item.wordEdits, 0);
    const referenceWords = accuracy.reduce((sum, item) => sum + item.referenceWords, 0);
    const meaningChangingErrors = accuracy.filter((item) => item.criticalError).length;
    const wordErrorRate = referenceWords === 0 ? null : wordEdits / referenceWords;
    return {
      schema: U1_DIAGNOSTIC_SCHEMA,
      packageVersion: U1_DIAGNOSTIC_VERSION,
      startedAt,
      onlineAtLaunch,
      environment,
      readinessMs: rounded(readinessMs),
      readinessPassed: readinessMs <= 15_000,
      completedCycles: accuracy.length + timed.length,
      accuracy: {
        completed: accuracy.length,
        total: U1_ACCURACY_CORPUS.length,
        wordEdits,
        referenceWords,
        wordErrorRate,
        meaningChangingErrors,
        passed: accuracy.length === U1_ACCURACY_CORPUS.length
          && wordErrorRate !== null
          && wordErrorRate <= 0.2
          && meaningChangingErrors <= 2,
      },
      accuracyCycles: accuracy,
      timedRecordings: timed,
      cancellation,
      failures,
    };
  };

  return { current, completeTranscript, completeCancellation, recordFailure, report };
}

export function createU1TargetedDiagnosticRun(options: RunOptions) {
  const checkpoint = compatibleDiagnosticReport(options.checkpoint);
  if (!checkpoint) return null;

  const savedTargeted = targetedProgress(checkpoint);
  const resumed = checkpoint.packageVersion === U1_DIAGNOSTIC_VERSION ? savedTargeted : null;
  const isBaseline = checkpoint.packageVersion === "0.1.8"
    && checkpoint.completedCycles === 24
    && checkpoint.accuracyCycles.length === 20
    && checkpoint.timedRecordings.length === 4
    && checkpoint.cancellation !== null;
  const isCompletedTargetedBaseline = ["0.1.9", "0.1.10", "0.1.11", "0.1.12"].includes(checkpoint.packageVersion)
    && checkpoint.completedCycles === 24
    && checkpoint.accuracyCycles.length === 20
    && checkpoint.timedRecordings.length === 4
    && checkpoint.cancellation !== null
    && savedTargeted !== null
    && savedTargeted.completedPhraseIds.length === savedTargeted.phraseIds.length
    && savedTargeted.longRecordingComplete;
  if (!resumed && !isBaseline && !isCompletedTargetedBaseline) return null;

  const failedPhraseIds = checkpoint.accuracyCycles
    .filter(({ criticalError }) => criticalError)
    .map(({ phraseId }) => phraseId);
  const wordEdits = checkpoint.accuracyCycles.reduce((sum, item) => sum + item.wordEdits, 0);
  const referenceWords = checkpoint.accuracyCycles.reduce((sum, item) => sum + item.referenceWords, 0);
  const accuracyPassed = checkpoint.accuracyCycles.length === U1_ACCURACY_CORPUS.length
    && referenceWords > 0
    && wordEdits / referenceWords <= 0.2
    && failedPhraseIds.length <= 2;
  const phraseIds = resumed?.phraseIds ?? (accuracyPassed ? [] : failedPhraseIds);
  const completedPhraseIds = resumed ? [...resumed.completedPhraseIds] : [];
  const timedRetest = !resumed && checkpoint.packageVersion === "0.1.11"
    ? checkpoint.timedRecordings.find(({ seconds, passed }) => seconds === 30 && !passed) ?? null
    : null;
  const preserveCompletedLongRecording = !resumed
    && checkpoint.packageVersion === "0.1.12"
    && savedTargeted?.longRecordingComplete === true
    && checkpoint.timedRecordings.some(({ seconds, passed }) => seconds === 120 && passed);
  let timedRetestComplete = false;
  let longRecordingComplete = resumed?.longRecordingComplete
    ?? (timedRetest || preserveCompletedLongRecording ? true : false);
  let longRecordingTiming = resumed?.longRecordingTiming
    ?? (timedRetest || preserveCompletedLongRecording ? savedTargeted?.longRecordingTiming ?? null : null);
  const accuracy = checkpoint.accuracyCycles.map((item) => ({ ...item }));
  const timed = checkpoint.timedRecordings.map((item) => ({ ...item }));
  const cancellation = checkpoint.cancellation ? { ...checkpoint.cancellation } : null;
  const additionalFailures: string[] = [];
  const reportReadinessMs = resumed ? checkpoint.readinessMs : options.readinessMs;

  const current = (): U1DiagnosticStep => {
    if (completedPhraseIds.length < phraseIds.length) {
      const phraseId = phraseIds[completedPhraseIds.length]!;
      const phraseIndex = U1_ACCURACY_CORPUS.findIndex(({ id }) => id === phraseId);
      return { kind: "accuracy", phraseIndex, phrase: U1_ACCURACY_CORPUS[phraseIndex]! };
    }
    if (timedRetest && !timedRetestComplete) {
      return { kind: "timed", seconds: 30, repetition: timedRetest.repetition };
    }
    if (!longRecordingComplete) return { kind: "timed", seconds: 120, repetition: 1 };
    return { kind: "complete" };
  };

  const completeTranscript = (measurement: TranscriptMeasurement): void => {
    const step = current();
    if (step.kind === "accuracy") {
      const next = {
        phraseId: step.phrase.id,
        ...scoreTranscript(step.phrase, measurement.transcript),
        recordingMs: rounded(measurement.recordingMs),
        finalLatencyMs: rounded(measurement.finalLatencyMs),
        pcmBytes: measurement.pcmBytes,
        pcmDurationMs: pcmDuration(measurement.pcmBytes),
      };
      const index = accuracy.findIndex(({ phraseId }) => phraseId === step.phrase.id);
      if (index < 0) throw new Error("targeted_phrase_missing");
      accuracy[index] = next;
      completedPhraseIds.push(step.phrase.id);
      return;
    }
    if (step.kind === "timed") {
      const index = timed.findIndex(({ seconds, repetition }) => (
        seconds === step.seconds && repetition === step.repetition
      ));
      if (index < 0 || (step.seconds === 120 && !measurement.timing)) {
        throw new Error("targeted_timing_missing");
      }
      const expectedMs = step.seconds * 1_000;
      const durationMs = pcmDuration(measurement.pcmBytes);
      timed[index] = {
        ...step,
        recordingMs: rounded(measurement.recordingMs),
        finalLatencyMs: rounded(measurement.finalLatencyMs),
        pcmBytes: measurement.pcmBytes,
        pcmDurationMs: durationMs,
        passed: Math.abs(durationMs - expectedMs) <= 500 && measurement.finalLatencyMs <= 2_000,
      };
      if (step.seconds === 30) {
        timedRetestComplete = true;
      } else {
        longRecordingTiming = measurement.timing ?? null;
        longRecordingComplete = true;
      }
      return;
    }
    throw new Error("targeted_transcript_out_of_order");
  };

  const recordFailure = (message: string): void => {
    if (!additionalFailures.includes(message)) additionalFailures.push(message);
  };

  const report = (): U1DiagnosticReport => {
    const wordEdits = accuracy.reduce((sum, item) => sum + item.wordEdits, 0);
    const referenceWords = accuracy.reduce((sum, item) => sum + item.referenceWords, 0);
    const meaningChangingErrors = accuracy.filter(({ criticalError }) => criticalError).length;
    const wordErrorRate = referenceWords === 0 ? null : wordEdits / referenceWords;
    const failures = diagnosticFailures({
      readinessMs: reportReadinessMs,
      accuracy,
      timed,
      cancellation,
      additionalFailures,
    });
    return {
      schema: U1_DIAGNOSTIC_SCHEMA,
      packageVersion: U1_DIAGNOSTIC_VERSION,
      startedAt: resumed ? checkpoint.startedAt : options.startedAt,
      onlineAtLaunch: resumed ? checkpoint.onlineAtLaunch : options.onlineAtLaunch,
      environment: resumed ? checkpoint.environment : options.environment,
      readinessMs: rounded(reportReadinessMs),
      readinessPassed: reportReadinessMs <= 15_000,
      completedCycles: accuracy.length + timed.length,
      accuracy: {
        completed: accuracy.length,
        total: U1_ACCURACY_CORPUS.length,
        wordEdits,
        referenceWords,
        wordErrorRate,
        meaningChangingErrors,
        passed: accuracy.length === U1_ACCURACY_CORPUS.length
          && wordErrorRate !== null
          && wordErrorRate <= 0.2
          && meaningChangingErrors <= 2,
      },
      accuracyCycles: accuracy,
      timedRecordings: timed,
      cancellation,
      failures,
      targeted: {
        sourcePackageVersion: resumed?.sourcePackageVersion ?? checkpoint.packageVersion,
        phraseIds,
        completedPhraseIds,
        longRecordingComplete,
        longRecordingTiming,
      },
    };
  };

  return {
    current,
    completeTranscript,
    completeCancellation: () => { throw new Error("targeted_cancellation_not_planned"); },
    recordFailure,
    report,
  };
}

type CompatibleDiagnosticReport = Omit<U1DiagnosticReport, "packageVersion"> & {
  packageVersion: string;
};

function compatibleDiagnosticReport(value: unknown): CompatibleDiagnosticReport | null {
  if (!isRecord(value)
    || value.schema !== U1_DIAGNOSTIC_SCHEMA
    || !["0.1.8", "0.1.9", "0.1.10", "0.1.11", "0.1.12", U1_DIAGNOSTIC_VERSION].includes(String(value.packageVersion))
    || typeof value.startedAt !== "string"
    || typeof value.onlineAtLaunch !== "boolean"
    || !isRecord(value.environment)
    || !isFiniteNumber(value.readinessMs)
    || !Array.isArray(value.accuracyCycles)
    || !Array.isArray(value.timedRecordings)
    || !Array.isArray(value.failures)
    || !value.failures.every((failure) => typeof failure === "string")) {
    return null;
  }
  const completedCycles = value.accuracyCycles.length + value.timedRecordings.length;
  if (value.completedCycles !== completedCycles
    || !value.accuracyCycles.every((item, index) => isAccuracyCheckpoint(item, U1_ACCURACY_CORPUS[index]?.id))
    || !value.timedRecordings.every(isTimedCheckpoint)
    || !isCancellationCheckpoint(value.cancellation, completedCycles)) {
    return null;
  }
  return value as unknown as CompatibleDiagnosticReport;
}

function targetedProgress(value: CompatibleDiagnosticReport) {
  const progress = value.targeted;
  if (!progress
    || !["0.1.8", "0.1.9", "0.1.10", "0.1.11", "0.1.12"].includes(progress.sourcePackageVersion)
    || !Array.isArray(progress.phraseIds)
    || !Array.isArray(progress.completedPhraseIds)
    || !progress.phraseIds.every((id) => typeof id === "string" && U1_ACCURACY_CORPUS.some((phrase) => phrase.id === id))
    || !progress.completedPhraseIds.every((id, index) => id === progress.phraseIds[index])
    || typeof progress.longRecordingComplete !== "boolean"
    || (progress.longRecordingComplete && !progress.longRecordingTiming)) {
    return null;
  }
  return progress;
}

function diagnosticFailures(options: {
  readinessMs: number;
  accuracy: readonly AccuracyMeasurement[];
  timed: readonly TimedMeasurement[];
  cancellation: U1DiagnosticReport["cancellation"];
  additionalFailures: readonly string[];
}): string[] {
  const failures = [...options.additionalFailures];
  if (options.readinessMs > 15_000) failures.push("Cold readiness exceeded 15 seconds.");
  [...options.accuracy, ...options.timed].forEach((item, index) => {
    if (item.finalLatencyMs > 2_000) failures.push(`Cycle ${index + 1} final latency exceeded 2 seconds.`);
  });
  for (const item of options.timed) {
    if (Math.abs(item.pcmDurationMs - item.seconds * 1_000) > 500) {
      failures.push(`${item.seconds}-second recording ${item.repetition} had ${item.pcmDurationMs} ms of PCM.`);
    }
  }
  if (options.cancellation && !options.cancellation.passed) {
    failures.push("Cancellation did not stop cleanly within 500 ms.");
  }
  return failures;
}

function diagnosticCheckpoint(value: unknown): U1DiagnosticReport | null {
  if (!isRecord(value)
    || value.schema !== U1_DIAGNOSTIC_SCHEMA
    || value.packageVersion !== U1_DIAGNOSTIC_VERSION
    || typeof value.startedAt !== "string"
    || typeof value.onlineAtLaunch !== "boolean"
    || !isRecord(value.environment)
    || !isFiniteNumber(value.readinessMs)
    || !Array.isArray(value.accuracyCycles)
    || !Array.isArray(value.timedRecordings)
    || !Array.isArray(value.failures)
    || !value.failures.every((failure) => typeof failure === "string")) {
    return null;
  }

  const accuracyCycles = value.accuracyCycles;
  const timedRecordings = value.timedRecordings;
  if (accuracyCycles.length > U1_ACCURACY_CORPUS.length
    || timedRecordings.length > 4
    || !accuracyCycles.every((item, index) => isAccuracyCheckpoint(item, U1_ACCURACY_CORPUS[index]?.id))
    || !timedRecordings.every(isTimedCheckpoint)
    || timedRecordings.some((item, index) => index < 3
      ? item.seconds !== 30 || item.repetition !== index + 1
      : item.seconds !== 120 || item.repetition !== 1)) {
    return null;
  }

  const completedCycles = accuracyCycles.length + timedRecordings.length;
  if (value.completedCycles !== completedCycles
    || (timedRecordings.length > 0 && accuracyCycles.length !== U1_ACCURACY_CORPUS.length)
    || completedCycles > 24
    || !isCancellationCheckpoint(value.cancellation, completedCycles)) {
    return null;
  }

  return value as unknown as U1DiagnosticReport;
}

function isAccuracyCheckpoint(value: unknown, phraseId: string | undefined): value is AccuracyMeasurement {
  return isRecord(value)
    && value.phraseId === phraseId
    && isFiniteNumber(value.wordEdits)
    && isFiniteNumber(value.referenceWords)
    && typeof value.criticalError === "boolean"
    && isFiniteNumber(value.recordingMs)
    && isFiniteNumber(value.finalLatencyMs)
    && isFiniteNumber(value.pcmBytes)
    && isFiniteNumber(value.pcmDurationMs);
}

function isTimedCheckpoint(value: unknown): value is TimedMeasurement {
  return isRecord(value)
    && (value.seconds === 30 || value.seconds === 120)
    && isFiniteNumber(value.repetition)
    && isFiniteNumber(value.recordingMs)
    && isFiniteNumber(value.finalLatencyMs)
    && isFiniteNumber(value.pcmBytes)
    && isFiniteNumber(value.pcmDurationMs)
    && typeof value.passed === "boolean";
}

function isCancellationCheckpoint(value: unknown, completedCycles: number): boolean {
  if (value === null) return true;
  return completedCycles === 24
    && isRecord(value)
    && isFiniteNumber(value.stopMs)
    && typeof value.lateTranscript === "boolean"
    && typeof value.passed === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function scoreTranscript(
  phraseToScore: AccuracyPhrase,
  transcript: string,
): Pick<AccuracyMeasurement, "wordEdits" | "referenceWords" | "criticalError"> {
  const expected = words(phraseToScore.text);
  const actual = words(transcript);
  const actualSet = new Set(actual);
  return {
    wordEdits: editDistance(expected, actual),
    referenceWords: expected.length,
    criticalError: phraseToScore.criticalTerms.some((term) => !actualSet.has(normalize(term))),
  };
}

function phrase(id: string, text: string, criticalTerms: readonly string[]): AccuracyPhrase {
  return Object.freeze({ id, text, criticalTerms: Object.freeze([...criticalTerms]) });
}

function words(value: string): string[] {
  return value.split(/\s+/u).flatMap((token) => {
    const normalized = normalize(token);
    if (!normalized) return [];
    return NUMBER_WORDS[normalized] ?? [normalized];
  });
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9']/gu, "");
}

const NUMBER_WORDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "0": ["zero"],
  "1": ["one"],
  "2": ["two"],
  "3": ["three"],
  "4": ["four"],
  "5": ["five"],
  "6": ["six"],
  "7": ["seven"],
  "8": ["eight"],
  "9": ["nine"],
  "12": ["twelve"],
  "21st": ["twenty", "first"],
  "30": ["thirty"],
  "67": ["sixty", "seven"],
  "906": ["nine", "zero", "six"],
  "330": ["three", "thirty"],
  "4821": ["four", "eight", "two", "one"],
});

function editDistance(left: readonly string[], right: readonly string[]): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

function pcmDuration(pcmBytes: number): number {
  return rounded((pcmBytes / 2 / 16_000) * 1_000);
}

function rounded(value: number): number {
  return Math.round(value);
}
