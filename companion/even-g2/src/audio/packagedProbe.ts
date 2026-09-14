import {
  AudioInputSource,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";

import { normalizeEvenAction } from "../platform/even";
import {
  evaluateLocalSpeechCapability,
  readLocalSpeechEnvironment,
} from "../provider/capability";
import { EvenGlassesRenderer } from "../ui/render";
import { LocalTranscriber } from "./localTranscriber";
import { MoonshineWorkerClient } from "./moonshineWorker";
import {
  createU1DiagnosticRun,
  createU1TargetedDiagnosticRun,
  type RunOptions,
  type U1DiagnosticReport,
  type U1DiagnosticStep,
  type U1RecordingTiming,
} from "./u1Diagnostic";

const MAX_RECORDING_MS = 120_000;
const PCM_STOP_FALLBACK_GRACE_MS = 5_000;
const PCM_BYTES_PER_MILLISECOND = 32;
const U1_CHECKPOINT_KEY = "atoms-g2-u1-checkpoint-v1";

export async function runPackagedLocalSpeechProbe(): Promise<void> {
  const status = document.querySelector<HTMLOutputElement>("#capability-status");
  const report = document.querySelector<HTMLPreElement>("#u1-report");
  if (!status) return;
  status.dataset.state = "checking";
  status.textContent = "Checking local speech on this phone";

  const environment = readLocalSpeechEnvironment();
  const capability = evaluateLocalSpeechCapability(environment);
  status.dataset.u1Environment = JSON.stringify({ ...environment, capability });

  if (capability.state !== "ready") {
    const text = "Local speech is not available on this phone.";
    status.dataset.state = "blocked";
    status.dataset.reason = capability.reason;
    status.textContent = text;
    try {
      const bridge = await waitForEvenAppBridge();
      const renderer = new EvenGlassesRenderer(bridge);
      await renderer.renderPrivateProbe(text);
    } catch {
      // The phone-side result remains visible when this page is opened outside Even Hub.
    }
    return;
  }

  const bridgeResult = waitForEvenAppBridge().then(
    (bridge) => ({ bridge }),
    (error: unknown) => ({ error }),
  );
  const worker = new MoonshineWorkerClient();
  const transcriber = new LocalTranscriber({ worker });
  const readinessStarted = performance.now();
  try {
    await transcriber.initialize();
  } catch (error) {
    worker.close();
    status.dataset.state = "blocked";
    status.dataset.reason = error instanceof Error ? error.message : "model_load_failed";
    status.textContent = "The local speech model could not start.";
    const result = await bridgeResult;
    if ("bridge" in result) {
      await new EvenGlassesRenderer(result.bridge).renderPrivateProbe(status.textContent);
    }
    return;
  }

  const readinessMs = performance.now() - readinessStarted;
  const bridgeState = await bridgeResult;
  if (!("bridge" in bridgeState)) throw bridgeState.error;
  const bridge = bridgeState.bridge;
  const renderer = new EvenGlassesRenderer(bridge);
  const checkpoints = new U1DiagnosticCheckpointStore(bridge);
  const runOptions = {
    environment: { ...environment, capability },
    onlineAtLaunch: navigator.onLine,
    readinessMs,
    startedAt: new Date().toISOString(),
  };
  const selectedDiagnostic = createPackagedDiagnosticRun({
    ...runOptions,
    checkpoint: await checkpoints.load(),
  });
  let diagnostic = selectedDiagnostic.run;
  let diagnosticMode = selectedDiagnostic.mode;
  let canStartOver = diagnostic.report().completedCycles > 0
    || diagnostic.report().cancellation !== null;
  const updateReport = () => {
    const value = diagnostic.report();
    status.dataset.u1Report = JSON.stringify(value);
    if (report) report.textContent = JSON.stringify(value, null, 2);
    return value;
  };
  const saveReport = async () => {
    const value = updateReport();
    try {
      await checkpoints.save(value);
    } catch {
      diagnostic.recordFailure("Diagnostic progress could not be saved.");
      updateReport();
    }
  };
  status.dataset.state = "ready";
  status.dataset.readinessMs = String(Math.round(readinessMs));

  let phase: DiagnosticProbePhase = "ready";
  let recordingStarted = 0;
  let pcmBytes = 0;
  let microphoneAckAt: number | null = null;
  let firstPcmAt: number | null = null;
  let lastPcmAt: number | null = null;
  let packetCount = 0;
  let maxInterPacketGapMs = 0;
  const stopTimer = new PcmDurationStopController(
    (callback, delayMs) => window.setTimeout(callback, delayMs),
    (timer) => window.clearTimeout(timer),
  );
  let tail = Promise.resolve();

  const renderStep = async () => {
    const step = diagnostic.current();
    const targeted = diagnosticMode === "targeted" ? diagnostic.report().targeted : undefined;
    status.dataset.state = step.kind === "complete" ? "complete" : "ready";
    status.textContent = canStartOver
      ? `Saved progress loaded.\n\n${phonePrompt(step, targeted)}`
      : phonePrompt(step, targeted);
    const prompt = glassesPrompt(step, targeted);
    const glassesText = canStartOver ? `Saved progress\n${prompt}` : prompt;
    await renderer.renderPrivateProbe(glassesText, diagnosticStepActions(step, canStartOver));
    updateReport();
  };

  const stop = async (stopReason: "pcm" | "timer" | "tap") => {
    if (phase !== "recording") return;
    phase = "stopping-audio";
    stopTimer.clear();
    const step = diagnostic.current();
    const stopRequestedAt = performance.now();
    await bridge.audioControl(false);
    const audioStoppedAt = performance.now();
    phase = "finalizing";
    status.textContent = "Finishing the local transcript";
    await renderer.renderPrivateProbe(status.textContent);
    const stoppedAt = performance.now();
    let transcript: string;
    let finalLatencyMs: number;
    try {
      transcript = await transcriber.stop();
      finalLatencyMs = performance.now() - stoppedAt;
    } catch (error) {
      status.dataset.state = "blocked";
      status.dataset.reason = error instanceof Error ? error.message : "transcription_failed";
      status.textContent = "The local transcript could not finish.";
      diagnostic.recordFailure(`Transcription failed (${status.dataset.reason}).`);
      await renderer.renderPrivateProbe(status.textContent);
      await saveReport();
      phase = "closed";
      return;
    }
    diagnostic.completeTranscript({
      transcript,
      recordingMs: stoppedAt - recordingStarted,
      finalLatencyMs,
      pcmBytes,
      timing: step.kind === "timed" && step.seconds === 120
        ? buildRecordingTiming({
          stopReason,
          scheduledDurationMs: 120_000,
          recordingStartedAt: recordingStarted,
          microphoneAckAt,
          firstPcmAt,
          lastPcmAt,
          stopRequestedAt,
          audioStoppedAt,
          packetCount,
          maxInterPacketGapMs,
        })
        : undefined,
    });
    status.dataset.state = "review";
    status.dataset.recordingMs = String(Math.round(stoppedAt - recordingStarted));
    status.dataset.finalLatencyMs = String(Math.round(finalLatencyMs));
    status.textContent = `${transcript || "No speech was recognized."}\n\nFinalized in ${Math.round(finalLatencyMs)} ms. Tap for the next check.`;
    phase = "review";
    await saveReport();
    await renderGlassesReviewSafely({
      finalLatencyMs,
      render: (text, items) => renderer.renderPrivateProbe(text, items),
      recordFailure: diagnostic.recordFailure,
    });
    await saveReport();
  };

  const cancelCheck = async () => {
    if (phase !== "recording" || diagnostic.current().kind !== "cancellation") return;
    phase = "finalizing";
    const started = performance.now();
    await Promise.all([transcriber.cancel(), bridge.audioControl(false)]);
    const stopMs = performance.now() - started;
    diagnostic.completeCancellation({ stopMs, lateTranscript: false });
    status.dataset.state = "complete";
    status.textContent = `Cancellation stopped in ${Math.round(stopMs)} ms. The U1 diagnostic sequence is complete.`;
    await saveReport();
    try {
      await renderer.renderPrivateProbe(status.textContent);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "page_rebuild_failed";
      diagnostic.recordFailure(`Glasses completion failed (${reason}).`);
      await saveReport();
    }
    phase = "closed";
  };

  const close = async () => {
    if (phase === "closed") return;
    phase = "closed";
    stopTimer.clear();
    await Promise.all([transcriber.cancel(), bridge.audioControl(false)]);
  };

  await renderStep();

  const removeEvents = bridge.onEvenHubEvent((event: EvenHubEvent) => {
    const pcm = event.audioEvent?.audioPcm;
    if (shouldAcceptDiagnosticPcm(phase) && pcm) {
      try {
        const bytes = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
        const receivedAt = performance.now();
        if (firstPcmAt === null) firstPcmAt = receivedAt;
        if (lastPcmAt !== null) {
          maxInterPacketGapMs = Math.max(maxInterPacketGapMs, receivedAt - lastPcmAt);
        }
        lastPcmAt = receivedAt;
        packetCount += 1;
        pcmBytes += bytes.byteLength;
        transcriber.accept(bytes);
        stopTimer.notePcm(pcmBytes, () => {
          tail = tail.then(() => stop("pcm"));
        });
      } catch (error) {
        status.dataset.state = "blocked";
        status.dataset.reason = error instanceof Error ? error.message : "audio_rejected";
        diagnostic.recordFailure(`Audio was rejected (${status.dataset.reason}).`);
        updateReport();
        tail = tail.then(close);
      }
      return;
    }

    const action = normalizeEvenAction(event);
    if (!action) return;
    if (action.kind === "click" && phase === "review") {
      phase = "ready";
      tail = tail.then(renderStep);
      return;
    }
    if (action.kind === "click" && phase === "ready") {
      const step = diagnostic.current();
      if (canStartOver && (step.kind === "complete" || action.selectedIndex === 1)) {
        tail = tail.then(async () => {
          await checkpoints.clear();
          diagnostic = createU1DiagnosticRun({
            ...runOptions,
            startedAt: new Date().toISOString(),
          });
          diagnosticMode = "full";
          canStartOver = false;
          await renderStep();
        });
        return;
      }
      canStartOver = false;
      tail = tail.then(async () => {
        const step = diagnostic.current();
        if (step.kind === "complete") return;
        const prompt = recordingPrompt(step);
        const duration = step.kind === "timed" ? step.seconds * 1_000 : null;
        await beginDiagnosticRecording({
          startTranscriber: () => transcriber.start(),
          markCaptureActive: () => {
            phase = "recording";
            recordingStarted = performance.now();
            pcmBytes = 0;
            microphoneAckAt = null;
            firstPcmAt = null;
            lastPcmAt = null;
            packetCount = 0;
            maxInterPacketGapMs = 0;
            status.dataset.state = "recording";
            status.textContent = prompt;
            stopTimer.begin(duration);
          },
          enableMicrophone: async () => {
            const enabled = await bridge.audioControl(true, AudioInputSource.Glasses);
            microphoneAckAt = performance.now();
            return enabled;
          },
        });
        await renderer.renderPrivateProbe(prompt);
      }).catch(async (error: unknown) => {
        status.dataset.state = "blocked";
        status.dataset.reason = error instanceof Error ? error.message : "microphone_failed";
        diagnostic.recordFailure(`Microphone check failed (${status.dataset.reason}).`);
        await saveReport();
        await close();
      });
    } else if (action.kind === "double-click" && phase === "recording" && diagnostic.current().kind === "cancellation") {
      tail = tail.then(cancelCheck);
    } else if (action.kind === "click" && phase === "recording") {
      if (diagnostic.current().kind !== "cancellation") tail = tail.then(() => stop("tap"));
    } else if (["double-click", "foreground-exit", "abnormal-exit", "system-exit"].includes(action.kind)) {
      removeEvents();
      tail = tail.then(close);
    }
  });
}

export function createPackagedDiagnosticRun(options: RunOptions) {
  const targeted = createU1TargetedDiagnosticRun(options);
  return targeted
    ? { mode: "targeted" as const, run: targeted }
    : { mode: "full" as const, run: createU1DiagnosticRun(options) };
}

export class U1DiagnosticCheckpointStore {
  constructor(private readonly storage: Pick<EvenAppBridge, "getLocalStorage" | "setLocalStorage">) {}

  async load(): Promise<unknown | undefined> {
    try {
      const raw = await this.storage.getLocalStorage(U1_CHECKPOINT_KEY);
      return raw ? JSON.parse(raw) as unknown : undefined;
    } catch {
      return undefined;
    }
  }

  async save(report: unknown): Promise<void> {
    await this.storage.setLocalStorage(U1_CHECKPOINT_KEY, JSON.stringify(report));
  }

  async clear(): Promise<void> {
    await this.storage.setLocalStorage(U1_CHECKPOINT_KEY, "");
  }
}

export function diagnosticStepActions(step: U1DiagnosticStep, canStartOver: boolean): string[] {
  if (step.kind === "complete") return canStartOver ? ["Start over"] : [];
  return canStartOver ? ["Start check", "Start over"] : ["Start check"];
}

export function buildRecordingTiming(input: {
  stopReason: "pcm" | "timer" | "tap";
  scheduledDurationMs: number;
  recordingStartedAt: number;
  microphoneAckAt: number | null;
  firstPcmAt: number | null;
  lastPcmAt: number | null;
  stopRequestedAt: number;
  audioStoppedAt: number;
  packetCount: number;
  maxInterPacketGapMs: number;
}): U1RecordingTiming {
  const relative = (value: number | null) => value === null
    ? null
    : Math.round(value - input.recordingStartedAt);
  return {
    stopReason: input.stopReason,
    scheduledDurationMs: input.scheduledDurationMs,
    microphoneAckMs: relative(input.microphoneAckAt),
    firstPcmMs: relative(input.firstPcmAt),
    lastPcmMs: relative(input.lastPcmAt),
    stopRequestedMs: relative(input.stopRequestedAt)!,
    timerDriftMs: input.stopReason === "timer"
      ? Math.round(input.stopRequestedAt - (input.firstPcmAt ?? input.recordingStartedAt) - input.scheduledDurationMs)
      : null,
    packetCount: input.packetCount,
    maxInterPacketGapMs: Math.round(input.maxInterPacketGapMs),
    audioStopAckMs: Math.round(input.audioStoppedAt - input.stopRequestedAt),
  };
}

export class PcmDurationStopController {
  private durationMs: number | null = null;
  private targetPcmBytes: number | null = null;
  private timer: number | null = null;

  constructor(
    private readonly schedule: (callback: () => void, delayMs: number) => number,
    private readonly cancel: (timer: number) => void,
  ) {}

  begin(durationMs: number | null): void {
    this.clear();
    this.durationMs = durationMs;
    this.targetPcmBytes = durationMs === null ? null : durationMs * PCM_BYTES_PER_MILLISECOND;
  }

  notePcm(totalPcmBytes: number, stop: () => void): void {
    if (this.durationMs === null || this.targetPcmBytes === null) return;
    if (this.timer === null) {
      this.timer = this.schedule(() => {
        this.timer = null;
        this.durationMs = null;
        this.targetPcmBytes = null;
        stop();
      }, Math.min(this.durationMs, MAX_RECORDING_MS) + PCM_STOP_FALLBACK_GRACE_MS);
    }
    if (totalPcmBytes < this.targetPcmBytes) return;
    this.clear();
    stop();
  }

  clear(): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.durationMs = null;
    this.targetPcmBytes = null;
  }
}

type DiagnosticProbePhase =
  | "ready"
  | "recording"
  | "stopping-audio"
  | "finalizing"
  | "review"
  | "closed";

export function shouldAcceptDiagnosticPcm(phase: DiagnosticProbePhase): boolean {
  return phase === "recording" || phase === "stopping-audio";
}

export async function beginDiagnosticRecording(dependencies: {
  startTranscriber(): void;
  markCaptureActive(): void;
  enableMicrophone(): Promise<boolean>;
}): Promise<void> {
  dependencies.startTranscriber();
  dependencies.markCaptureActive();
  if (!await dependencies.enableMicrophone()) throw new Error("microphone_denied");
}

export function glassesReviewSummary(finalLatencyMs: number): string {
  return `Cycle recorded.\nFinalized in ${Math.round(finalLatencyMs)} ms.`;
}

export function timedCheckLabel(seconds: 30 | 120): string {
  return `${seconds}-second timing check`;
}

export async function renderGlassesReviewSafely(dependencies: {
  finalLatencyMs: number;
  render(text: string, items: readonly string[]): Promise<void>;
  recordFailure(message: string): void;
}): Promise<void> {
  try {
    await dependencies.render(glassesReviewSummary(dependencies.finalLatencyMs), ["Next check"]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "page_rebuild_failed";
    dependencies.recordFailure(`Glasses review failed (${reason}).`);
  }
}

type TargetedProgress = NonNullable<U1DiagnosticReport["targeted"]>;

function phonePrompt(step: U1DiagnosticStep, targeted?: TargetedProgress): string {
  if (targeted) {
    const position = targeted.completedPhraseIds.length + 1;
    switch (step.kind) {
      case "accuracy":
        return `Targeted phrase ${position} of ${targeted.phraseIds.length}\n\nRead this aloud:\n${step.phrase.text}\n\nTap the glasses to start. Tap again when finished.`;
      case "timed":
        return `${timedCheckLabel(step.seconds)}\n\nTap the glasses to start. Recording stops automatically.`;
      case "complete":
        return "The targeted checks are complete. Copy the report below into the private-test ledger.";
      case "cancellation":
        return "Cancellation is already recorded.";
    }
  }
  switch (step.kind) {
    case "accuracy":
      return `Accuracy cycle ${step.phraseIndex + 1} of 20\n\nRead this aloud:\n${step.phrase.text}\n\nTap the glasses to start. Tap again when finished.`;
    case "timed":
      return `${step.seconds}-second recording${step.seconds === 30 ? ` ${step.repetition} of 3` : ""}\n\nTap the glasses to start. Recording stops automatically.`;
    case "cancellation":
      return "Cancellation check\n\nTap the glasses to start. Then double-click to cancel.";
    case "complete":
      return "The U1 diagnostic sequence is complete. Copy the report below into the private-test ledger.";
  }
}

function glassesPrompt(step: U1DiagnosticStep, targeted?: TargetedProgress): string {
  if (targeted) {
    const position = targeted.completedPhraseIds.length + 1;
    switch (step.kind) {
      case "accuracy": return `Retest ${position}/${targeted.phraseIds.length}\nRead: ${step.phrase.text}`;
      case "timed": return timedCheckLabel(step.seconds);
      case "complete": return "Targeted checks complete. Copy the phone report.";
      case "cancellation": return "Cancellation already recorded.";
    }
  }
  switch (step.kind) {
    case "accuracy": return `Cycle ${step.phraseIndex + 1}/20\nRead: ${step.phrase.text}`;
    case "timed": return `${step.seconds}-second check${step.seconds === 30 ? ` ${step.repetition}/3` : ""}`;
    case "cancellation": return "Cancellation check\nStart, then double-click.";
    case "complete": return "U1 diagnostics complete. Copy the phone report.";
  }
}

function recordingPrompt(step: U1DiagnosticStep): string {
  if (step.kind === "cancellation") return "Recording locally. Double-click now to cancel.";
  if (step.kind === "timed") return `Recording locally for ${step.seconds} seconds.`;
  return "Recording locally. Tap when you finish the phrase.";
}
