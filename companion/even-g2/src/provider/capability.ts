import {
  MAX_RECORDING_BYTES,
  PCM_BYTES_PER_SAMPLE,
  PCM_SAMPLE_RATE_HZ,
} from "../storage/capabilities";

export const OPENAI_TRANSCRIPTION_CAPABILITY = Object.freeze({
  transport: "completed-audio-batch",
  endpoint: "https://api.openai.com/v1/audio/transcriptions",
  model: "gpt-4o-transcribe",
  audio: Object.freeze({
    container: "wav",
    encoding: "pcm_s16le",
    sampleRateHz: PCM_SAMPLE_RATE_HZ,
    channels: 1,
  }),
  interimResults: false,
  finalization: "single-final-response",
  abort: "AbortSignal",
  timeout: "server-bounded",
  disconnect: "reattach-to-recording-lease-status",
  authorizationLocation: "server-only",
  networkCallsDuringProbe: false,
  serviceRetentionHours: 24,
  providerDataControls: Object.freeze({
    trainingUse: false,
    abuseMonitoringRetention: "none",
    applicationStateRetention: "none",
    zeroDataRetentionEligible: true,
  }),
} as const);

type SyntheticCapabilityInput = {
  pcmBytes: number;
  timedOut?: boolean;
  aborted?: boolean;
  disconnected?: boolean;
};

export function evaluateSyntheticProviderCapability(input: SyntheticCapabilityInput) {
  if (!Number.isSafeInteger(input.pcmBytes) || input.pcmBytes < 0) {
    return { state: "blocked", reason: "invalid-pcm-length" } as const;
  }
  if (input.pcmBytes % PCM_BYTES_PER_SAMPLE !== 0) {
    return { state: "blocked", reason: "unaligned-pcm" } as const;
  }
  if (input.pcmBytes > MAX_RECORDING_BYTES) {
    return { state: "blocked", reason: "duration-exceeded" } as const;
  }
  if (input.aborted) return { state: "blocked", reason: "aborted" } as const;
  if (input.timedOut) return { state: "blocked", reason: "timeout" } as const;
  if (input.disconnected) {
    return { state: "staged", reason: "awaiting-recording-lease-status" } as const;
  }

  return {
    state: "ready",
    durationMs: (input.pcmBytes / (PCM_SAMPLE_RATE_HZ * PCM_BYTES_PER_SAMPLE)) * 1000,
    request: {
      endpoint: OPENAI_TRANSCRIPTION_CAPABILITY.endpoint,
      model: OPENAI_TRANSCRIPTION_CAPABILITY.model,
      filename: "recording.wav",
      responseFormat: "json",
    },
  } as const;
}

export function buildPcm16Wav(chunks: readonly Uint8Array[]): Uint8Array {
  const pcmBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const capability = evaluateSyntheticProviderCapability({ pcmBytes });
  if (capability.state !== "ready") {
    throw new Error(capability.reason);
  }

  const wav = new Uint8Array(44 + pcmBytes);
  const view = new DataView(wav.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      wav[offset + index] = value.charCodeAt(index);
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, PCM_SAMPLE_RATE_HZ, true);
  view.setUint32(28, PCM_SAMPLE_RATE_HZ * PCM_BYTES_PER_SAMPLE, true);
  view.setUint16(32, PCM_BYTES_PER_SAMPLE, true);
  view.setUint16(34, PCM_BYTES_PER_SAMPLE * 8, true);
  writeAscii(36, "data");
  view.setUint32(40, pcmBytes, true);

  let offset = 44;
  for (const chunk of chunks) {
    wav.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return wav;
}
