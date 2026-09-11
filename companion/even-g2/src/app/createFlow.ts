import { CREATE_COPY } from "../i18n/en";

type EnqueueResponse = {
  state: "pending" | "claimed" | "applied";
  captureId: string;
  already?: boolean;
};

export type CreateApi = {
  enqueue(request: { captureId: string; capturedAt: string; body: string }): Promise<EnqueueResponse>;
};

export type CreateRecovery = {
  load(): Promise<CreateRecoveryRecord | null>;
  save(record: CreateRecoveryRecord): Promise<void>;
  clear(): Promise<void>;
};

export type CreateRecoveryRecord = {
  state: "prepared";
  recordingId: string;
  capturedAt: string;
  title: string;
  body: string;
  expiresAt: string;
  // Legacy fields stay optional so encrypted recovery rows from the private test
  // remain readable until their normal retention window expires.
  preparationId?: string;
  fingerprint?: string;
};

export type CreateView = {
  state: "prepared" | "queued" | "idle";
  title?: string;
  transcript?: string;
  message?: string;
  acceptedAt?: string;
};

function canonicalTranscript(value: string | undefined): string {
  return (value ?? "").replace(/\r\n?/g, "\n").normalize("NFC").trim();
}

export class CreateFlow {
  private record: CreateRecoveryRecord | null = null;

  constructor(
    private readonly api: CreateApi,
    private readonly recovery: CreateRecovery,
    _legacyMakeCommitKey?: (() => string),
    private readonly now: () => number = Date.now,
  ) {}

  private view(message?: string): CreateView {
    if (!this.record) return { state: "idle" };
    return {
      state: "prepared",
      title: this.record.title,
      transcript: this.record.body,
      ...(message ? { message } : {}),
    };
  }

  async prepare(recordingId: string, capturedAt: string, transcript?: string): Promise<CreateView> {
    const body = canonicalTranscript(transcript);
    if (!body) throw new Error("empty_transcript");
    this.record = {
      state: "prepared",
      recordingId,
      capturedAt,
      title: "Review capture",
      body,
      expiresAt: new Date(this.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await this.recovery.save(this.record);
    return this.view();
  }

  async restore(): Promise<CreateView> {
    this.record = await this.recovery.load();
    return this.view();
  }

  async cancel(): Promise<CreateView> {
    this.record = null;
    await this.recovery.clear();
    return { state: "idle" };
  }

  async confirm(): Promise<CreateView> {
    if (!this.record) return this.view();
    try {
      const result = await this.api.enqueue({
        captureId: this.record.recordingId,
        capturedAt: this.record.capturedAt,
        body: this.record.body,
      });
      if (!["pending", "claimed", "applied"].includes(result.state) || result.captureId !== this.record.recordingId) {
        return this.view(CREATE_COPY.waiting);
      }
      const acceptedAt = new Date(this.now()).toISOString();
      this.record = null;
      await this.recovery.clear();
      return { state: "queued", message: CREATE_COPY.queued, acceptedAt };
    } catch {
      return this.view(CREATE_COPY.waiting);
    }
  }

  async refresh(): Promise<CreateView> {
    return this.view();
  }
}
