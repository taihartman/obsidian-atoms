import { webcrypto } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  LocalTranscriber,
  pcm16LeToFloat32,
  verifyModelAsset,
  type LocalTranscriptionWorker,
} from "../src/audio/localTranscriber";
import { MOONSHINE_MODEL_MANIFEST } from "../src/audio/modelManifest";
import { MoonshineWorkerClient } from "../src/audio/moonshineWorker";

const crypto = webcrypto as unknown as Crypto;

describe("local Moonshine transcription boundary", () => {
  it("converts signed little-endian PCM16 into exact normalized float samples", () => {
    const samples = pcm16LeToFloat32(new Uint8Array([
      0x00, 0x00,
      0xff, 0x7f,
      0x00, 0x80,
      0xff, 0xff,
    ]));

    expect(Array.from(samples)).toEqual([
      0,
      32_767 / 32_768,
      -1,
      -1 / 32_768,
    ]);
  });

  it("rejects odd chunks and recordings beyond the fixed two-minute bound", async () => {
    expect(() => pcm16LeToFloat32(new Uint8Array([0x00]))).toThrow("odd_pcm_bytes");

    const worker = fakeWorker();
    const transcriber = new LocalTranscriber({ worker, maxPcmBytes: 4 });
    await transcriber.initialize();
    transcriber.start();
    transcriber.accept(new Uint8Array([0, 0, 1, 0]));
    expect(() => transcriber.accept(new Uint8Array([2, 0]))).toThrow("recording_limit");
    await expect(transcriber.stop()).rejects.toThrow("recording_limit");
  });

  it("checks byte size and SHA-256 before an asset can reach the runtime", async () => {
    const bytes = new TextEncoder().encode("verified model bytes");
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");

    await expect(verifyModelAsset({
      name: "fixture.ort",
      url: "https://download.moonshine.ai/model/fixture.ort",
      byteSize: bytes.byteLength,
      sha256,
    }, bytes, crypto)).resolves.toBeUndefined();

    await expect(verifyModelAsset({
      name: "fixture.ort",
      url: "https://download.moonshine.ai/model/fixture.ort",
      byteSize: bytes.byteLength + 1,
      sha256,
    }, bytes, crypto)).rejects.toThrow("asset_size_mismatch");

    await expect(verifyModelAsset({
      name: "fixture.ort",
      url: "https://download.moonshine.ai/model/fixture.ort",
      byteSize: bytes.byteLength,
      sha256: "0".repeat(64),
    }, bytes, crypto)).rejects.toThrow("asset_hash_mismatch");
  });

  it("pins every model file to the one allowed Moonshine asset origin", () => {
    expect(MOONSHINE_MODEL_MANIFEST.packageVersion).toBe("0.1.5");
    expect(MOONSHINE_MODEL_MANIFEST.model).toBe("tiny-streaming-en");
    expect(MOONSHINE_MODEL_MANIFEST.assets).toHaveLength(7);
    for (const asset of MOONSHINE_MODEL_MANIFEST.assets) {
      expect(new URL(asset.url).origin).toBe("https://download.moonshine.ai");
      expect(asset.byteSize).toBeGreaterThan(0);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("does not post a truncated model asset to the Moonshine Worker", async () => {
    const postMessage = vi.fn();
    const client = new MoonshineWorkerClient({
      workerFactory: () => ({
        postMessage,
        terminate: vi.fn(),
        onmessage: null,
        onerror: null,
      }),
      fetch: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
      crypto,
    });

    await expect(client.initialize()).rejects.toThrow("asset_size_mismatch:adapter.ort");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("closes the Worker and surfaces an inference failure", async () => {
    const worker = fakeWorker({
      addAudio: vi.fn(async () => { throw new Error("moonshine_inference_failed"); }),
    });
    const transcriber = new LocalTranscriber({ worker });
    await transcriber.initialize();
    transcriber.start();
    transcriber.accept(new Uint8Array([0, 0]));

    await expect(transcriber.stop()).rejects.toThrow("moonshine_inference_failed");
    expect(worker.close).toHaveBeenCalledOnce();
  });

  it("bounds in-flight audio and prevents a late transcript after cancellation", async () => {
    let resolveStop!: (value: string) => void;
    const worker = fakeWorker({
      stop: vi.fn(() => new Promise<string>((resolve) => { resolveStop = resolve; })),
    });
    const transcriber = new LocalTranscriber({ worker, maxPendingPcmBytes: 4 });
    await transcriber.initialize();
    transcriber.start();
    transcriber.accept(new Uint8Array([0, 0, 1, 0]));
    expect(() => transcriber.accept(new Uint8Array([2, 0]))).toThrow("worker_backpressure");

    const stopping = transcriber.stop();
    await vi.waitFor(() => expect(worker.stop).toHaveBeenCalledOnce());
    await transcriber.cancel();
    resolveStop("late result");
    await expect(stopping).rejects.toThrow("transcription_cancelled");
    expect(worker.close).toHaveBeenCalledOnce();
  });
});

function fakeWorker(overrides: Partial<LocalTranscriptionWorker> = {}): LocalTranscriptionWorker {
  return {
    initialize: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    addAudio: vi.fn(async () => undefined),
    stop: vi.fn(async () => "local transcript"),
    close: vi.fn(),
    ...overrides,
  };
}
