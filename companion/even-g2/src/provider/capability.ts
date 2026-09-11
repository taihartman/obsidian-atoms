import {
  MAX_RECORDING_SECONDS,
  PCM_SAMPLE_RATE_HZ,
} from "../storage/capabilities";
import { MOONSHINE_MODEL_MANIFEST } from "../audio/modelManifest";

export const LOCAL_TRANSCRIPTION_CAPABILITY = Object.freeze({
  package: MOONSHINE_MODEL_MANIFEST.package,
  version: MOONSHINE_MODEL_MANIFEST.packageVersion,
  model: MOONSHINE_MODEL_MANIFEST.model,
  modelArch: MOONSHINE_MODEL_MANIFEST.modelArch,
  audio: Object.freeze({
    encoding: "pcm_s16le",
    sampleRateHz: PCM_SAMPLE_RATE_HZ,
    channels: 1,
    maxDurationSeconds: MAX_RECORDING_SECONDS,
  }),
  execution: "worker",
  runtime: "single-thread-simd",
  networkAudioEgress: false,
  cloudFallback: false,
} as const);

type LocalSpeechEnvironment = {
  worker: boolean;
  webAssembly: boolean;
  simd: boolean;
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
  cacheApi: boolean;
  crypto: boolean;
};

export type LocalSpeechCapabilityResult =
  | { state: "ready"; runtime: "single-thread-simd" }
  | {
      state: "blocked";
      reason:
        | "worker-unavailable"
        | "webassembly-unavailable"
        | "wasm-simd-unavailable"
        | "cache-api-unavailable"
        | "webcrypto-unavailable";
    };

export function evaluateLocalSpeechCapability(
  environment: LocalSpeechEnvironment,
): LocalSpeechCapabilityResult {
  if (!environment.worker) return { state: "blocked", reason: "worker-unavailable" };
  if (!environment.webAssembly) {
    return { state: "blocked", reason: "webassembly-unavailable" };
  }
  if (!environment.simd) return { state: "blocked", reason: "wasm-simd-unavailable" };
  if (!environment.cacheApi) {
    return { state: "blocked", reason: "cache-api-unavailable" };
  }
  if (!environment.crypto) return { state: "blocked", reason: "webcrypto-unavailable" };
  return { state: "ready", runtime: "single-thread-simd" };
}

export function readLocalSpeechEnvironment(): LocalSpeechEnvironment {
  return {
    worker: typeof Worker !== "undefined",
    webAssembly: typeof WebAssembly !== "undefined",
    simd: supportsWasmSimd(),
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    cacheApi: typeof caches !== "undefined",
    crypto: Boolean(globalThis.crypto?.subtle),
  };
}

function supportsWasmSimd(): boolean {
  if (typeof WebAssembly === "undefined") return false;
  return WebAssembly.validate(new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
    0x03, 0x02, 0x01, 0x00,
    0x0a, 0x08, 0x01, 0x06, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0x0b,
  ]));
}
