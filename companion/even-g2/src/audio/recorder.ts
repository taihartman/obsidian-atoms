import { MAX_RECORDING_BYTES } from "../storage/capabilities";

export class PcmRecorder {
  private active = false;
  private stoppedReason = "recording_not_active";
  private capturedBytes = 0;

  constructor(private readonly options: { maxBytes?: number } = {}) {}

  start(): void {
    this.active = true;
    this.stoppedReason = "recording_not_active";
    this.capturedBytes = 0;
  }

  capture(chunk: Uint8Array): number {
    if (!this.active) throw new Error(this.stoppedReason);
    if (chunk.byteLength % 2 !== 0) throw new Error("odd_pcm_bytes");
    const maximum = this.options.maxBytes ?? MAX_RECORDING_BYTES;
    if (this.capturedBytes + chunk.byteLength > maximum) {
      this.stop("recording_limit");
      throw new Error("recording_limit");
    }
    this.capturedBytes += chunk.byteLength;
    return this.capturedBytes;
  }

  stop(reason = "stopped"): void {
    this.active = false;
    this.stoppedReason = reason;
  }
}
