import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  OPENAI_TRANSCRIPTION_CAPABILITY,
  buildPcm16Wav,
  evaluateSyntheticProviderCapability,
} from "../src/provider/capability";

describe("synthetic speech-provider capability contract", () => {
  it("pins the completed-audio batch fallback without client secrets or network probes", () => {
    expect(OPENAI_TRANSCRIPTION_CAPABILITY).toMatchObject({
      transport: "completed-audio-batch",
      endpoint: "https://api.openai.com/v1/audio/transcriptions",
      model: "gpt-4o-transcribe",
      audio: {
        container: "wav",
        encoding: "pcm_s16le",
        sampleRateHz: 16_000,
        channels: 1,
      },
      interimResults: false,
      finalization: "single-final-response",
      authorizationLocation: "server-only",
      networkCallsDuringProbe: false,
      serviceRetentionHours: 24,
      providerDataControls: {
        trainingUse: false,
        abuseMonitoringRetention: "none",
        applicationStateRetention: "none",
        zeroDataRetentionEligible: true,
      },
    });
  });

  it("exact-pins the current Even floors and declares only exact Atoms origins", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const manifest = JSON.parse(readFileSync("app.json", "utf8")) as {
      min_app_version: string;
      min_sdk_version: string;
      entrypoint: string;
      permissions: Array<{ name: string; whitelist?: string[] }>;
    };

    expect(packageJson.dependencies["@evenrealities/even_hub_sdk"]).toBe("0.0.15");
    expect(packageJson.devDependencies["@evenrealities/evenhub-cli"]).toBe("0.1.14");
    expect(packageJson.devDependencies["@evenrealities/evenhub-simulator"]).toBe("0.9.5");
    expect(manifest).toMatchObject({
      min_app_version: "2.2.10",
      min_sdk_version: "0.0.15",
      entrypoint: "index.html",
    });
    expect(manifest.permissions.map(({ name }) => name)).toEqual([
      "network",
      "g2-microphone",
    ]);
    expect(manifest.permissions[0]?.whitelist).toEqual([
      "https://plus.tryatoms.app",
      "wss://plus.tryatoms.app",
    ]);
  });

  it("wraps arbitrary even-byte PCM chunks in an exact mono 16 kHz PCM16 WAV", () => {
    const wav = buildPcm16Wav([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4, 5, 6]),
    ]);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect(Array.from(wav.subarray(44))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("fails closed for malformed, over-duration, timeout, abort, and disconnected inputs", () => {
    expect(evaluateSyntheticProviderCapability({ pcmBytes: 3 })).toEqual({
      state: "blocked",
      reason: "unaligned-pcm",
    });
    expect(evaluateSyntheticProviderCapability({ pcmBytes: 3_840_002 })).toEqual({
      state: "blocked",
      reason: "duration-exceeded",
    });
    expect(
      evaluateSyntheticProviderCapability({ pcmBytes: 32_000, timedOut: true }),
    ).toEqual({ state: "blocked", reason: "timeout" });
    expect(
      evaluateSyntheticProviderCapability({ pcmBytes: 32_000, aborted: true }),
    ).toEqual({ state: "blocked", reason: "aborted" });
    expect(
      evaluateSyntheticProviderCapability({ pcmBytes: 32_000, disconnected: true }),
    ).toEqual({ state: "staged", reason: "awaiting-recording-lease-status" });
  });

  it("accepts bounded synthetic PCM without sending it", () => {
    expect(evaluateSyntheticProviderCapability({ pcmBytes: 32_000 })).toEqual({
      state: "ready",
      durationMs: 1000,
      request: {
        endpoint: "https://api.openai.com/v1/audio/transcriptions",
        model: "gpt-4o-transcribe",
        filename: "recording.wav",
        responseFormat: "json",
      },
    });
  });
});
