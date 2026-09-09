import { CREATE_COPY } from "../i18n/en";

type PreparedResponse = { preparationId: string; fingerprint: string; title: string; body: string; expiresAt: string };
type CommitResponse = { state: "queued" | "saved" | "title_collision" | "setup_required" | "expired" | "confirmation_mismatch" | "commit_unknown" | "rejected"; outboxId?: string; receipt?: DeliveryReceipt };
type StatusResponse = { state: "queued" | "saved" | "rejected" | "not_found" | "setup_required"; receipt?: DeliveryReceipt };
type DeliveryReceipt = { path: string; title: string };

export type CreateApi = {
  prepare(recordingId: string, capturedAt: string): Promise<PreparedResponse>;
  commit(request: { preparationId: string; fingerprint: string; confirmedTitle: string; commitKey: string }): Promise<CommitResponse>;
  status(outboxId: string): Promise<StatusResponse>;
};

export type CreateRecovery = {
  load(): Promise<CreateRecoveryRecord | null>;
  save(record: CreateRecoveryRecord): Promise<void>;
  clear(): Promise<void>;
};

export type CreateRecoveryRecord = {
  state: "prepared" | "queued" | "saved" | "rejected" | "title_collision" | "proposal_expired" | "commit_unknown" | "revoked";
  recordingId: string;
  capturedAt: string;
  preparationId: string;
  fingerprint: string;
  title: string;
  body: string;
  expiresAt: string;
  commitKey?: string;
  outboxId?: string;
  receipt?: DeliveryReceipt;
  acceptedAt?: string;
};

export type CreateView = {
  state: CreateRecoveryRecord["state"] | "idle";
  prompt?: string;
  message?: string;
  receipt?: DeliveryReceipt;
  acceptedAt?: string;
  stillQueued?: boolean;
};

export class CreateFlow {
  private record: CreateRecoveryRecord | null = null;

  constructor(
    private readonly api: CreateApi,
    private readonly recovery: CreateRecovery,
    private readonly makeCommitKey: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  private view(): CreateView {
    if (!this.record) return { state: "idle" };
    if (this.record.state === "prepared") return { state: "prepared", prompt: CREATE_COPY.confirm(this.record.title) };
    if (this.record.state === "queued") return { state: "queued", message: CREATE_COPY.queued, acceptedAt: this.record.acceptedAt, stillQueued: Boolean(this.record.acceptedAt && this.now() - Date.parse(this.record.acceptedAt) >= 15 * 60 * 1000) };
    if (this.record.state === "saved") return { state: "saved", message: CREATE_COPY.saved, receipt: this.record.receipt };
    if (this.record.state === "title_collision") return { state: "title_collision", message: CREATE_COPY.collision };
    if (this.record.state === "proposal_expired") return { state: "proposal_expired", message: CREATE_COPY.expired };
    if (this.record.state === "commit_unknown") return { state: "commit_unknown", message: CREATE_COPY.waiting };
    if (this.record.state === "revoked") return { state: "revoked", message: CREATE_COPY.revoked };
    return { state: "rejected", message: CREATE_COPY.rejected };
  }

  async prepare(recordingId: string, capturedAt: string): Promise<CreateView> {
    const proposal = await this.api.prepare(recordingId, capturedAt);
    this.record = { state: "prepared", recordingId, capturedAt, ...proposal };
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
    if (!this.record || this.record.state !== "prepared") return this.view();
    const commitKey = this.record.commitKey || this.makeCommitKey();
    this.record.commitKey = commitKey;
    await this.recovery.save(this.record);
    let result: CommitResponse;
    try {
      result = await this.api.commit({
        preparationId: this.record.preparationId,
        fingerprint: this.record.fingerprint,
        confirmedTitle: this.record.title,
        commitKey,
      });
    } catch {
      return { state: "prepared", prompt: CREATE_COPY.confirm(this.record.title), message: CREATE_COPY.waiting };
    }
    if (result.state === "queued" && result.outboxId) {
      this.record.state = "queued";
      this.record.outboxId = result.outboxId;
      this.record.acceptedAt = new Date(this.now()).toISOString();
    } else if (result.state === "saved" && result.receipt) {
      this.record.state = "saved";
      this.record.receipt = result.receipt;
    } else if (result.state === "title_collision") {
      this.record.state = "title_collision";
    } else if (result.state === "expired" || result.state === "confirmation_mismatch") {
      this.record.state = "proposal_expired";
    } else if (result.state === "commit_unknown") {
      this.record.state = "commit_unknown";
    } else if (result.state === "setup_required") {
      this.record.state = "revoked";
    } else {
      this.record.state = "rejected";
    }
    if (this.record.state === "saved" && this.record.receipt) await this.recovery.clear();
    else await this.recovery.save(this.record);
    return this.view();
  }

  async refresh(): Promise<CreateView> {
    if (!this.record?.outboxId || this.record.state !== "queued") return this.view();
    try {
      const result = await this.api.status(this.record.outboxId);
      if (result.state === "saved" && result.receipt) {
        this.record.state = "saved";
        this.record.receipt = result.receipt;
      } else if (result.state === "setup_required") {
        this.record.state = "revoked";
      } else if (result.state === "rejected") {
        this.record.state = "rejected";
      }
      if (this.record.state === "saved" && this.record.receipt) await this.recovery.clear();
      else await this.recovery.save(this.record);
      return this.view();
    } catch {
      return { ...this.view(), message: CREATE_COPY.waiting };
    }
  }
}
