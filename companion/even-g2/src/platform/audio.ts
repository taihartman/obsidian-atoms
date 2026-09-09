import { AudioInputSource, type EvenAppBridge } from "@evenrealities/even_hub_sdk";

import { PcmRecorder } from "../audio/recorder";
import { G2WebSocketTransport } from "../audio/transport";
import { RecoveryJournal } from "../storage/recovery";

type TicketApi = { ticket(recordingId: string): Promise<{ ticket: string }> };
type Checkpoint = { save(value: { recordingId: string; purpose: "create" | "query" }): Promise<void>; clear(): Promise<void> };

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
  private transport: G2WebSocketTransport | null = null;
  private pending: Promise<unknown> = Promise.resolve();
  private nextSequence = 0;

  constructor(
    private readonly bridge: Pick<EvenAppBridge, "audioControl">,
    private readonly api: TicketApi,
    private readonly journal: RecoveryJournal,
    private readonly socketEndpoint: string,
    private readonly checkpoint?: Checkpoint,
  ) {}

  async start(purpose: "create" | "query"): Promise<void> {
    this.purpose = purpose;
    this.recordingId = crypto.randomUUID();
    this.capturedAt = new Date().toISOString();
    await this.journal.start(this.recordingId, this.capturedAt);
    this.nextSequence = 0;
    await this.checkpoint?.save({ recordingId: this.recordingId, purpose });
    const { ticket } = await this.api.ticket(this.recordingId);
    this.transport = new G2WebSocketTransport({ endpoint: this.socketEndpoint, ticket, highWaterBytes: 256 * 1024 });
    await this.transport.connect();
    this.recorder.start();
    if (!await this.bridge.audioControl(true, AudioInputSource.Glasses)) throw new Error("microphone_denied");
  }

  accept(pcm: Uint8Array): void {
    if (!this.transport || pcm.byteLength === 0) return;
    this.recorder.capture(pcm);
    const prior = this.pending;
    const sequence = this.nextSequence++;
    this.pending = prior.then(async () => {
      await this.journal.append(this.recordingId, sequence, pcm);
      const result = await this.transport?.enqueue(pcm);
      if (result && result.sequence !== sequence) throw new Error("recovery_sequence_conflict");
    });
  }

  async restore(recordingId: string, purpose: "create" | "query"): Promise<boolean> {
    const recovered = await this.journal.restore(recordingId);
    if (!recovered || recovered.transcriptionId) return false;
    this.recordingId = recordingId;
    this.purpose = purpose;
    this.capturedAt = recovered.capturedAt;
    this.nextSequence = recovered.nextSequence;
    const { ticket } = await this.api.ticket(recordingId);
    this.transport = new G2WebSocketTransport({ endpoint: this.socketEndpoint, ticket, highWaterBytes: 256 * 1024 });
    this.transport.loadRecovered(recovered.chunks);
    await this.transport.connect();
    return true;
  }

  async stop(): Promise<{ purpose: "create" | "query"; recordingId: string; capturedAt: string; transcript: string }> {
    await this.bridge.audioControl(false);
    this.recorder.stop();
    await this.pending;
    const result = await this.transport?.finalize();
    if (!result || result.state !== "completed" || typeof result.transcript !== "string") throw new Error("transcription_failed");
    await this.journal.completeTranscription(this.recordingId, this.recordingId);
    await this.checkpoint?.clear();
    return { purpose: this.purpose, recordingId: this.recordingId, capturedAt: this.capturedAt, transcript: result.transcript };
  }

  async teardown(reason: "cancelled" | "permission_lost" | "background" | "revoked" | "disclosure_withdrawn" = "background"): Promise<void> {
    this.recorder.stop(reason);
    this.transport?.teardown(reason);
    this.transport = null;
    await this.bridge.audioControl(false);
  }
}
