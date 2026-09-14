import {
  MAX_RECORDING_BYTES,
  PCM_BYTES_PER_SAMPLE,
  PCM_SAMPLE_RATE_HZ,
} from "../storage/capabilities";
import type { MoonshineAsset } from "./modelManifest";

export interface LocalTranscriptionWorker {
  initialize(): Promise<void>;
  start(): Promise<void>;
  addAudio(samples: Float32Array): Promise<void>;
  stop(): Promise<string>;
  close(): void;
}

type LocalTranscriberOptions = {
  worker: LocalTranscriptionWorker;
  maxPcmBytes?: number;
  maxPendingPcmBytes?: number;
};

export class LocalTranscriber {
  private phase: "idle" | "active" | "stopping" | "stopped" | "cancelled" | "failed" = "idle";
  private capturedPcmBytes = 0;
  private pendingPcmBytes = 0;
  private pending: Promise<void> = Promise.resolve();
  private failure: Error | null = null;
  private generation = 0;

  constructor(private readonly options: LocalTranscriberOptions) {}

  async initialize(): Promise<void> {
    if (this.phase !== "idle") throw new Error("transcriber_not_idle");
    await this.options.worker.initialize();
  }

  start(): void {
    if (this.phase !== "idle" && this.phase !== "stopped") {
      throw new Error("transcription_already_active");
    }
    this.phase = "active";
    this.capturedPcmBytes = 0;
    this.pendingPcmBytes = 0;
    this.failure = null;
    const generation = ++this.generation;
    this.pending = this.options.worker.start().catch((error: unknown) => {
      this.recordFailure(error, generation);
    });
  }

  accept(pcm: Uint8Array): void {
    if (this.phase !== "active") throw new Error("transcription_not_active");
    if (pcm.byteLength === 0) return;
    if (pcm.byteLength % PCM_BYTES_PER_SAMPLE !== 0) throw new Error("odd_pcm_bytes");

    const maximum = this.options.maxPcmBytes ?? MAX_RECORDING_BYTES;
    if (this.capturedPcmBytes + pcm.byteLength > maximum) {
      const error = new Error("recording_limit");
      this.failure = error;
      this.phase = "failed";
      this.options.worker.close();
      throw error;
    }

    const pendingMaximum = this.options.maxPendingPcmBytes ?? 256 * 1024;
    if (this.pendingPcmBytes + pcm.byteLength > pendingMaximum) {
      throw new Error("worker_backpressure");
    }

    const samples = pcm16LeToFloat32(pcm);
    const generation = this.generation;
    this.capturedPcmBytes += pcm.byteLength;
    this.pendingPcmBytes += pcm.byteLength;
    this.pending = this.pending
      .then(() => this.options.worker.addAudio(samples))
      .catch((error: unknown) => this.recordFailure(error, generation))
      .finally(() => {
        this.pendingPcmBytes -= pcm.byteLength;
      });
  }

  async stop(): Promise<string> {
    if (this.failure) throw this.failure;
    if (this.phase !== "active") throw new Error("transcription_not_active");
    this.phase = "stopping";
    const generation = this.generation;
    await this.pending;
    if (this.failure) throw this.failure;
    const transcript = await this.options.worker.stop();
    if (generation !== this.generation) {
      throw new Error("transcription_cancelled");
    }
    this.phase = "stopped";
    return transcript;
  }

  async cancel(): Promise<void> {
    if (this.phase === "cancelled") return;
    this.generation += 1;
    this.phase = "cancelled";
    this.failure = new Error("transcription_cancelled");
    this.options.worker.close();
  }

  private recordFailure(error: unknown, generation: number): void {
    if (generation !== this.generation || this.phase === "cancelled") return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.phase = "failed";
    this.options.worker.close();
  }
}

export function pcm16LeToFloat32(pcm: Uint8Array): Float32Array {
  if (pcm.byteLength % PCM_BYTES_PER_SAMPLE !== 0) throw new Error("odd_pcm_bytes");
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = new Float32Array(pcm.byteLength / PCM_BYTES_PER_SAMPLE);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * PCM_BYTES_PER_SAMPLE, true) / 32_768;
  }
  return samples;
}

export async function verifyModelAsset(
  asset: Pick<MoonshineAsset, "name" | "url" | "byteSize" | "sha256">,
  bytes: Uint8Array,
  crypto: Pick<Crypto, "subtle"> = globalThis.crypto,
): Promise<void> {
  if (bytes.byteLength !== asset.byteSize) {
    throw new Error(`asset_size_mismatch:${asset.name}`);
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== asset.sha256) throw new Error(`asset_hash_mismatch:${asset.name}`);
}

export const LOCAL_PCM_SAMPLE_RATE_HZ = PCM_SAMPLE_RATE_HZ;
