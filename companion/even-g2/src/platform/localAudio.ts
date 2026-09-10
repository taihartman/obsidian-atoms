import { AudioInputSource, type EvenAppBridge } from "@evenrealities/even_hub_sdk";

import type { LocalTranscriber } from "../audio/localTranscriber";

type LocalTranscriberPort = Pick<LocalTranscriber, "initialize" | "start" | "accept" | "stop" | "cancel">;
type StopResult = {
  purpose: "create" | "query";
  recordingId: string;
  capturedAt: string;
  transcript: string;
  completeHandoff(): Promise<void>;
};

export class EvenLocalAudioSession {
  private transcriber: LocalTranscriberPort | null = null;
  private phase: "idle" | "active" | "transcribed" | "failed" = "idle";
  private purpose: "create" | "query" = "create";
  private recordingId = "";
  private capturedAt = "";

  constructor(
    private readonly bridge: Pick<EvenAppBridge, "audioControl">,
    private readonly createTranscriber: () => LocalTranscriberPort,
    private readonly options: { makeId?: () => string; now?: () => Date } = {},
  ) {}

  async initialize(): Promise<void> {
    await this.ensureTranscriber();
  }

  async start(purpose: "create" | "query"): Promise<void> {
    if (this.phase !== "idle") throw new Error("recording_already_active");
    const transcriber = await this.ensureTranscriber();
    this.purpose = purpose;
    this.recordingId = (this.options.makeId ?? (() => crypto.randomUUID()))();
    this.capturedAt = (this.options.now ?? (() => new Date()))().toISOString();
    transcriber.start();
    try {
      if (!await this.bridge.audioControl(true, AudioInputSource.Glasses)) {
        throw new Error("microphone_denied");
      }
      this.phase = "active";
    } catch (error) {
      await transcriber.cancel();
      this.transcriber = null;
      throw error;
    }
  }

  accept(pcm: Uint8Array): void {
    if (this.phase !== "active" || pcm.byteLength === 0) return;
    try {
      this.transcriber?.accept(pcm);
    } catch (error) {
      this.phase = "failed";
      throw error;
    }
  }

  async stop(): Promise<StopResult> {
    if (this.phase !== "active" || !this.transcriber) throw new Error("recording_not_active");
    await this.bridge.audioControl(false);
    const transcript = await this.transcriber.stop();
    this.phase = "transcribed";
    return {
      purpose: this.purpose,
      recordingId: this.recordingId,
      capturedAt: this.capturedAt,
      transcript,
      completeHandoff: async () => {
        this.phase = "idle";
        this.recordingId = "";
        this.capturedAt = "";
      },
    };
  }

  async teardown(_reason: "cancelled" | "permission_lost" | "background" | "revoked" | "disclosure_withdrawn" = "background"): Promise<void> {
    await this.bridge.audioControl(false);
    if (this.phase === "active" || this.phase === "failed") {
      await this.transcriber?.cancel();
      this.transcriber = null;
    }
    this.phase = "idle";
    this.recordingId = "";
    this.capturedAt = "";
  }

  private async ensureTranscriber(): Promise<LocalTranscriberPort> {
    if (this.transcriber) return this.transcriber;
    const transcriber = this.createTranscriber();
    await transcriber.initialize();
    this.transcriber = transcriber;
    return transcriber;
  }
}
