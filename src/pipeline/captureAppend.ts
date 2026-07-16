import type { App, TFile } from "obsidian";
import { ensureTodaysDaily } from "./daily";

/** Hard cap so a malicious/garbled URI cannot dump huge blobs into the daily. */
export const MAX_CAPTURE_CHARS = 20_000;

export class EmptyCaptureError extends Error {
  constructor() {
    super("Capture text is empty");
    this.name = "EmptyCaptureError";
  }
}

export class CaptureTooLongError extends Error {
  constructor(len: number) {
    super(`Capture text is too long (${len} chars; max ${MAX_CAPTURE_CHARS})`);
    this.name = "CaptureTooLongError";
  }
}

/** Trim + normalize newlines; collapse internal newlines to spaces (one bullet). */
export function normalizeCaptureText(raw: string): string {
  return (raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * One markdown top-level bullet. If text already starts with `- `, keep it
 * (do not double-bullet).
 */
export function formatCaptureBullet(text: string): string {
  const t = normalizeCaptureText(text);
  if (!t) return "";
  if (/^-\s+/.test(t)) return t;
  return `- ${t}`;
}

/**
 * Bytes to pass to vault.append so the daily always gets a clean new line.
 */
export function contentToAppend(
  existingContent: string,
  bulletLine: string,
): string {
  const body = bulletLine.endsWith("\n") ? bulletLine : `${bulletLine}\n`;
  if (existingContent.length > 0 && !existingContent.endsWith("\n")) {
    return `\n${body}`;
  }
  return body;
}

export interface AppendCaptureResult {
  path: string;
  /** True when today's daily was created in this call. */
  created: boolean;
  /** Line written (without trailing newline). */
  bullet: string;
}

/**
 * Create today's daily if missing, append one capture bullet.
 * Never opens the file in the workspace (fast path for shortcuts).
 */
export async function appendCaptureToTodaysDaily(
  app: App,
  rawText: string,
): Promise<AppendCaptureResult> {
  const normalized = normalizeCaptureText(rawText);
  if (!normalized) throw new EmptyCaptureError();
  if (normalized.length > MAX_CAPTURE_CHARS) {
    throw new CaptureTooLongError(normalized.length);
  }

  const { file, created } = await ensureTodaysDaily(app);
  const bullet = formatCaptureBullet(normalized);
  const existing = await app.vault.read(file);
  await app.vault.append(file, contentToAppend(existing, bullet));
  return { path: file.path, created, bullet };
}

/** Resolve capture text from protocol query params. */
export function captureTextFromProtocolParams(
  params: Record<string, string | undefined>,
): string {
  const raw = params.text ?? params.data ?? "";
  return typeof raw === "string" ? raw : "";
}

/** Re-export for callers that only need the file type. */
export type { TFile };
