import type { LocalTranscriptionWorker } from "./localTranscriber";
import { verifyModelAsset } from "./localTranscriber";
import { MOONSHINE_MODEL_MANIFEST } from "./modelManifest";

type WorkerRequest =
  | { id: number; type: "initialize"; files: Array<{ name: string; bytes: ArrayBuffer }> }
  | { id: number; type: "start" }
  | { id: number; type: "audio"; samples: ArrayBuffer }
  | { id: number; type: "stop" }
  | { id: number; type: "close" };

type WorkerResponse =
  | { id: number; type: "ok"; transcript?: string }
  | { id: number; type: "error"; message: string };

type WorkerPort = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

type MoonshineWorkerOptions = {
  workerFactory?: () => WorkerPort;
  fetch?: typeof globalThis.fetch;
  crypto?: Pick<Crypto, "subtle">;
};

export class MoonshineWorkerClient implements LocalTranscriptionWorker {
  private readonly worker: WorkerPort;
  private readonly pending = new Map<
    number,
    { resolve(value: string | undefined): void; reject(error: Error): void }
  >();
  private nextId = 1;
  private closed = false;

  constructor(private readonly options: MoonshineWorkerOptions = {}) {
    this.worker = options.workerFactory?.() ?? new Worker(
      new URL("./moonshineWorkerRuntime.ts", import.meta.url),
      { type: "module", name: "atoms-moonshine-stt" },
    );
    this.worker.onmessage = (event) => this.receive(event.data);
    this.worker.onerror = (event) => this.failAll(new Error(event.message || "moonshine_worker_failed"));
  }

  async initialize(): Promise<void> {
    const fetchAsset = this.options.fetch ?? globalThis.fetch;
    const crypto = this.options.crypto ?? globalThis.crypto;
    if (!fetchAsset || !crypto?.subtle) throw new Error("local_asset_verification_unavailable");

    const files: Array<{ name: string; bytes: ArrayBuffer }> = [];
    for (const asset of MOONSHINE_MODEL_MANIFEST.assets) {
      const response = await fetchAsset(asset.path, { cache: "no-store" });
      if (!response.ok) throw new Error(`asset_unavailable:${asset.name}`);
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      await verifyModelAsset(asset, bytes, crypto);
      files.push({ name: asset.name, bytes: buffer });
    }
    const transfer = files.map(({ bytes }) => bytes);
    await this.request({ type: "initialize", files }, transfer);
  }

  async start(): Promise<void> {
    await this.request({ type: "start" });
  }

  async addAudio(samples: Float32Array): Promise<void> {
    const bytes = samples.byteOffset === 0 && samples.byteLength === samples.buffer.byteLength
      ? samples.buffer as ArrayBuffer
      : samples.slice().buffer;
    await this.request({ type: "audio", samples: bytes }, [bytes]);
  }

  async stop(): Promise<string> {
    return (await this.request({ type: "stop" })) ?? "";
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const id = this.nextId++;
    try {
      this.worker.postMessage({ id, type: "close" } satisfies WorkerRequest);
    } catch {
      // The worker may already have failed.
    }
    this.failAll(new Error("transcription_cancelled"));
    this.worker.terminate();
  }

  private request(
    payload: Omit<Extract<WorkerRequest, { type: "initialize" }>, "id">
      | Omit<Extract<WorkerRequest, { type: "start" }>, "id">
      | Omit<Extract<WorkerRequest, { type: "audio" }>, "id">
      | Omit<Extract<WorkerRequest, { type: "stop" }>, "id">,
    transfer: Transferable[] = [],
  ): Promise<string | undefined> {
    if (this.closed) return Promise.reject(new Error("transcription_cancelled"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...payload, id } as WorkerRequest, transfer);
    });
  }

  private receive(response: WorkerResponse): void {
    const slot = this.pending.get(response.id);
    if (!slot) return;
    this.pending.delete(response.id);
    if (response.type === "error") slot.reject(new Error(response.message));
    else slot.resolve(response.transcript);
  }

  private failAll(error: Error): void {
    for (const slot of this.pending.values()) slot.reject(error);
    this.pending.clear();
  }
}
