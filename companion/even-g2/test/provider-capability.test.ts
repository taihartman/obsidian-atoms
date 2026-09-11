import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  LOCAL_TRANSCRIPTION_CAPABILITY,
  evaluateLocalSpeechCapability,
} from "../src/provider/capability";

describe("phone-local speech capability contract", () => {
  it("pins Tiny Streaming English without a cloud speech fallback", () => {
    expect(LOCAL_TRANSCRIPTION_CAPABILITY).toMatchObject({
      package: "@moonshine-ai/moonshine-wasm",
      version: "0.1.5",
      runtime: "single-thread-simd",
      model: "tiny-streaming-en",
      modelArch: "tiny_streaming",
      audio: {
        encoding: "pcm_s16le",
        sampleRateHz: 16_000,
        channels: 1,
        maxDurationSeconds: 120,
      },
      execution: "worker",
      networkAudioEgress: false,
      cloudFallback: false,
    });
  });

  it("reports the packaged single-thread SIMD build without requiring cross-origin isolation", () => {
    expect(evaluateLocalSpeechCapability({
      worker: true,
      webAssembly: true,
      simd: true,
      sharedArrayBuffer: true,
      crossOriginIsolated: true,
      cacheApi: true,
      crypto: true,
    })).toEqual({ state: "ready", runtime: "single-thread-simd" });

    expect(evaluateLocalSpeechCapability({
      worker: true,
      webAssembly: true,
      simd: true,
      sharedArrayBuffer: false,
      crossOriginIsolated: false,
      cacheApi: true,
      crypto: true,
    })).toEqual({ state: "ready", runtime: "single-thread-simd" });
  });

  it("fails closed when the WebView cannot support either allowed local runtime", () => {
    expect(evaluateLocalSpeechCapability({
      worker: true,
      webAssembly: true,
      simd: false,
      sharedArrayBuffer: false,
      crossOriginIsolated: false,
      cacheApi: true,
      crypto: true,
    })).toEqual({ state: "blocked", reason: "wasm-simd-unavailable" });

    expect(evaluateLocalSpeechCapability({
      worker: false,
      webAssembly: true,
      simd: true,
      sharedArrayBuffer: false,
      crossOriginIsolated: false,
      cacheApi: true,
      crypto: true,
    })).toEqual({ state: "blocked", reason: "worker-unavailable" });
  });

  it("packages only Atoms Plus network access and no WebSocket speech route", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const manifest = JSON.parse(readFileSync("app.json", "utf8")) as {
      min_app_version: string;
      min_sdk_version: string;
      permissions: Array<{ name: string; whitelist?: string[]; desc?: string }>;
    };

    expect(packageJson.dependencies["@moonshine-ai/moonshine-wasm"]).toBe("0.1.5");
    expect(manifest).toMatchObject({
      min_app_version: "2.2.10",
      min_sdk_version: "0.0.15",
    });
    expect(manifest.permissions.map(({ name }) => name)).toEqual([
      "network",
      "g2-microphone",
    ]);
    expect(manifest.permissions[0]?.whitelist).toEqual([
      "https://plus.tryatoms.app",
    ]);
    expect(JSON.stringify(manifest)).not.toMatch(/transcription|speech provider|wss:/i);
  });

  it("pins the reproducible single-thread runtime artifacts", () => {
    const runtime = JSON.parse(readFileSync("src/audio/moonshine-runtime-manifest.json", "utf8")) as {
      sourceTag: string;
      sourceCommit: string;
      onnxRuntimeVersion: string;
      emscriptenVersion: string;
      buildMode: string;
      artifacts: Array<{ name: string; bytes: number; sha256: string }>;
    };

    expect(runtime).toMatchObject({
      sourceTag: "v0.1.5",
      sourceCommit: "234f60faa0eb388b01cdf7e60aca232af37aefda",
      onnxRuntimeVersion: "1.23.2",
      emscriptenVersion: "4.0.8",
      buildMode: "single-thread-simd",
    });
    expect(runtime.artifacts).toEqual([
      {
        name: "moonshine.mjs",
        bytes: 138_055,
        sha256: "59f8405f95e4764aae8999a23a8d684c55aa37417f883b8feafa6105d09cb2f9",
      },
      {
        name: "moonshine.wasm",
        bytes: 13_255_489,
        sha256: "ee0948e8c5163dd93ff276fbe5170fdb10a110387a1a949e3bba269ff42cacb9",
      },
    ]);
  });
});
