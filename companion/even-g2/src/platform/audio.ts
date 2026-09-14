import { AudioInputSource, type EvenAppBridge } from "@evenrealities/even_hub_sdk";

import { PcmRecorder } from "../audio/recorder";
import { G2WebSocketTransport } from "../audio/transport";
import { RecoveryJournal } from "../storage/recovery";

type TicketApi = { ticket(recordingId: string): Promise<{ ticket: string }> };
type Checkpoint = { save(value: { recordingId: string; purpose: "create" | "query" }): Promise<void>; clear(): Promise<void> };
type AudioTransportPort = Pick<G2WebSocketTransport, "connect" | "loadRecovered" | "enqueue" | "finalize" | "teardown">;
type SessionOptions = { transportFactory?: (ticket: string) => AudioTransportPort };
type StopResult = {
  purpose: "create" | "query";
  recordingId: string;
  capturedAt: string;
  transcript: string;
  completeHandoff(): Promise<void>;
};

export function ticketFromResponse(response: unknown): { ticket: string } {
  const value = response && typeof response === "object" ? (response as { value?: unknown }).value : undefined;
  if (typeof value !== "string" || !value.startsWith("g2t_")) throw new Error("invalid_ticket_response");
  return { ticket: value };
}

export class EvenAudioSession {
  private purpose: "create" | "query" = "create";
  private recordingId = "";
  private capturedAt = "";
  private recorder = new PcmRecorder();
  private transport: AudioTransportPort | null = null;
  private pending: Promise<void> = Promise.resolve();
  private pendingError: unknown = null;
  private nextSequence = 0;
  private phase: "idle" | "starting" | "active" | "staged" | "finalizing" | "transcribed" = "idle";
  private transcript: string | null = null;
  private lifecycleGeneration = 0;

  constructor(
    private readonly bridge: Pick<EvenAppBridge, "audioControl">,
    private readonly api: TicketApi,
    private readonly journal: RecoveryJournal,
    private readonly socketEndpoint: string,
    private readonly checkpoint?: Checkpoint,
    private readonly options: SessionOptions = {},
  ) {}

  async start(purpose: "create" | "query"): Promise<void> {
    if (this.phase !== "idle") throw new Error("recording_already_active");
    const generation = ++this.lifecycleGeneration;
    this.phase = "starting";
    this.purpose = purpose;
    this.recordingId = crypto.randomUUID();
    this.capturedAt = new Date().toISOString();
    this.nextSequence = 0;
    this.pending = Promise.resolve();
    this.pendingError = null;
    this.transcript = null;
    try {
      await this.journal.start(this.recordingId, this.capturedAt);
      this.assertStarting(generation);
      await this.checkpoint?.save({ recordingId: this.recordingId, purpose });
      this.assertStarting(generation);
      const { ticket } = await this.api.ticket(this.recordingId);
      this.assertStarting(generation);
      this.transport = this.createTransport(ticket);
      await this.transport.connect();
      this.assertStarting(generation);
      this.recorder.start();
      if (!await this.bridge.audioControl(true, AudioInputSource.Glasses)) throw new Error("microphone_denied");
      this.assertStarting(generation);
      this.phase = "active";
    } catch (error) {
      await this.rollbackStart();
      throw error;
    }
  }

  accept(pcm: Uint8Array): void {
    if (this.phase !== "active" || !this.transport || pcm.byteLength === 0) return;
    this.recorder.capture(pcm);
    const retained = pcm.slice();
    const prior = this.pending;
    const sequence = this.nextSequence++;
    this.pending = prior.then(async () => {
      await this.journal.append(this.recordingId, sequence, retained);
      const result = await this.transport?.enqueue(retained);
      if (result && result.sequence !== sequence) throw new Error("recovery_sequence_conflict");
    }).catch((error) => { this.pendingError ??= error; });
  }

  async restore(recordingId: string, purpose: "create" | "query"): Promise<boolean> {
    const recovered = await this.journal.restore(recordingId);
    if (!recovered) return false;
    this.recordingId = recordingId;
    this.purpose = purpose;
    this.capturedAt = recovered.capturedAt;
    this.nextSequence = recovered.nextSequence;
    this.pending = Promise.resolve();
    this.pendingError = null;
    if (recovered.state === "transcribed" && typeof recovered.transcript === "string") {
      this.transcript = recovered.transcript;
      this.phase = "transcribed";
      return true;
    }
    this.phase = "staged";
    return true;
  }

  async stop(): Promise<StopResult> {
    if (this.phase === "starting") throw new Error("recording_starting");
    if (this.phase === "idle") throw new Error("recording_not_active");
    if (this.phase === "transcribed" && this.transcript !== null) return this.stopResult(this.transcript);
    if (this.phase === "active") {
      this.phase = "finalizing";
      await this.bridge.audioControl(false);
      this.recorder.stop();
      await this.pending;
      if (this.pendingError) {
        this.phase = "staged";
        throw this.pendingError;
      }
    } else {
      this.phase = "finalizing";
      await this.restoreTransport();
    }
    try {
      const result = await this.transport?.finalize();
      if (!result || result.state !== "completed" || typeof result.transcript !== "string") throw new Error("transcription_failed");
      await this.journal.completeTranscription(this.recordingId, this.recordingId, result.transcript);
      this.transcript = result.transcript;
      this.phase = "transcribed";
      return this.stopResult(result.transcript);
    } catch (error) {
      this.phase = "staged";
      throw error;
    }
  }

  async teardown(reason: "cancelled" | "permission_lost" | "background" | "revoked" | "disclosure_withdrawn" = "background"): Promise<void> {
    this.lifecycleGeneration += 1;
    const previousPhase = this.phase;
    if (previousPhase === "idle") {
      await this.bridge.audioControl(false);
      return;
    }
    this.phase = previousPhase === "transcribed" ? "transcribed" : "staged";
    this.recorder.stop(reason);
    this.transport?.teardown(reason);
    this.transport = null;
    await this.pending;
    await this.bridge.audioControl(false);
    if (reason === "cancelled") await this.discardCurrent();
  }

  private createTransport(ticket: string): AudioTransportPort {
    return this.options.transportFactory?.(ticket) ?? new G2WebSocketTransport({ endpoint: this.socketEndpoint, ticket, highWaterBytes: 256 * 1024 });
  }

  private assertStarting(generation: number): void {
    if (generation !== this.lifecycleGeneration || this.phase !== "starting") throw new Error("recording_start_cancelled");
  }

  private async restoreTransport(): Promise<void> {
    const recovered = await this.journal.restore(this.recordingId);
    if (!recovered || recovered.state !== "recording") throw new Error("recording_not_found");
    const { ticket } = await this.api.ticket(this.recordingId);
    this.transport?.teardown("background");
    this.transport = this.createTransport(ticket);
    this.transport.loadRecovered(recovered.chunks);
    await this.transport.connect();
  }

  private stopResult(transcript: string): StopResult {
    return {
      purpose: this.purpose,
      recordingId: this.recordingId,
      capturedAt: this.capturedAt,
      transcript,
      completeHandoff: () => this.completeHandoff(),
    };
  }

  private async completeHandoff(): Promise<void> {
    const recordingId = this.recordingId;
    this.transport?.teardown("cancelled");
    this.transport = null;
    let cleanupError: unknown = null;
    try { if (recordingId) await this.journal.completePreparation(recordingId); }
    catch (error) { cleanupError = error; }
    try { await this.checkpoint?.clear(); }
    finally {
      this.phase = "idle";
      this.recordingId = "";
      this.transcript = null;
    }
    if (cleanupError) throw cleanupError;
  }

  private async discardCurrent(): Promise<void> {
    const recordingId = this.recordingId;
    if (recordingId) await this.journal.discard(recordingId);
    await this.checkpoint?.clear();
    this.phase = "idle";
    this.recordingId = "";
    this.transcript = null;
  }

  private async rollbackStart(): Promise<void> {
    this.recorder.stop("cancelled");
    this.transport?.teardown("cancelled");
    this.transport = null;
    await this.pending;
    try { await this.bridge.audioControl(false); } catch { /* Best-effort OS cleanup after failed setup. */ }
    if (this.recordingId) await this.journal.discard(this.recordingId);
    await this.checkpoint?.clear();
    this.phase = "idle";
    this.recordingId = "";
    this.transcript = null;
  }
}
