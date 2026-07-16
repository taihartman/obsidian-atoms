import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import {
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
} from "../pipeline/classify";

export type ConnectivityProbeId = "https_baseline" | "anthropic_api";

export interface ProbeResult {
  id: ConnectivityProbeId;
  /** Short label for UI */
  label: string;
  ok: boolean;
  /** User-safe one-liner (no secrets, no full error objects) */
  summary: string;
  /** Optional detail for console / advanced */
  detail?: {
    status?: number;
    errorName?: string;
    errorMessage?: string;
    ms?: number;
  };
}

export interface ConnectivityReport {
  generatedAt: string;
  probes: ProbeResult[];
  /**
   * High-level verdict for Notices:
   * - ok: Anthropic path looks good (or at least reachable)
   * - baseline_only: general HTTPS works, Anthropic fails
   * - no_https: even baseline HTTPS fails inside Obsidian
   * - no_key: Anthropic key missing (baseline may still pass)
   */
  verdict: "ok" | "baseline_only" | "no_https" | "no_key" | "partial";
  /** Single user-facing message */
  userMessage: string;
}

type RequestFn = (params: RequestUrlParam) => Promise<RequestUrlResponse>;

const BASELINE_URL = "https://api.github.com/zen";

function safeErrorBits(err: unknown): { name: string; message: string } {
  const name = err instanceof Error ? err.name : "Error";
  const raw = err instanceof Error ? err.message : String(err);
  const message = raw
    .replace(/sk-ant-[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 160);
  return { name, message };
}

/**
 * General HTTPS via Obsidian requestUrl (not Anthropic-specific).
 * 2xx / 3xx / even 4xx means the network stack reached a server.
 */
export async function probeHttpsBaseline(
  request: RequestFn = requestUrl,
): Promise<ProbeResult> {
  const label = "General HTTPS (GitHub zen)";
  const t0 = Date.now();
  try {
    const res = await request({
      url: BASELINE_URL,
      method: "GET",
      throw: false,
    });
    const ms = Date.now() - t0;
    const reached = res.status > 0 && res.status < 600;
    return {
      id: "https_baseline",
      label,
      ok: reached,
      summary: reached
        ? `Reached the internet from Obsidian (HTTP ${res.status}, ${ms}ms)`
        : `Unexpected status ${res.status}`,
      detail: { status: res.status, ms },
    };
  } catch (err) {
    const { name, message } = safeErrorBits(err);
    return {
      id: "https_baseline",
      label,
      ok: false,
      summary: `Obsidian could not complete a basic HTTPS request (${name}: ${message})`,
      detail: { errorName: name, errorMessage: message, ms: Date.now() - t0 },
    };
  }
}

/**
 * Anthropic Messages endpoint reachability.
 * - With key: 200 is ideal; 400/401/403 still mean "reachable"
 * - Without key: 401 authentication_error still means reachable
 * - Throw / status 0: network failure inside Obsidian
 */
export async function probeAnthropicApi(
  apiKey: string | null,
  request: RequestFn = requestUrl,
): Promise<ProbeResult> {
  const label = "Anthropic API";
  const t0 = Date.now();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (apiKey?.trim()) {
    headers["x-api-key"] = apiKey.trim();
  }

  // Minimal invalid body — we only care that TLS + HTTP complete.
  const body = JSON.stringify({
    model: "claude-sonnet-5",
    max_tokens: 1,
    messages: [{ role: "user", content: "ping" }],
  });

  try {
    const res = await request({
      url: ANTHROPIC_MESSAGES_URL,
      method: "POST",
      headers,
      body,
      throw: false,
    });
    const ms = Date.now() - t0;
    const status = res.status;

    // Reached API if we got a real HTTP status
    if (status >= 200 && status < 500) {
      let summary: string;
      if (status === 200) {
        summary = `Anthropic reachable and accepted a request (${ms}ms)`;
      } else if (status === 401 || status === 403) {
        summary = apiKey?.trim()
          ? `Anthropic reachable, but the API key was rejected (HTTP ${status})`
          : `Anthropic reachable (HTTP ${status} — set an API key in settings to authenticate)`;
      } else if (status === 400) {
        summary = `Anthropic reachable (HTTP 400 validation — network path is fine, ${ms}ms)`;
      } else {
        summary = `Anthropic reachable (HTTP ${status}, ${ms}ms)`;
      }
      return {
        id: "anthropic_api",
        label,
        ok: status === 200 || status === 400 || (!apiKey?.trim() && (status === 401 || status === 403)),
        // "ok" for connectivity: 200/400, or 401 without key still proves path
        // For auth quality we encode in summary; overall report verdict handles key.
        summary,
        detail: { status, ms },
      };
    }

    if (status >= 500) {
      return {
        id: "anthropic_api",
        label,
        ok: true, // reached server
        summary: `Anthropic reachable but returned a server error (HTTP ${status}) — try again later`,
        detail: { status, ms },
      };
    }

    return {
      id: "anthropic_api",
      label,
      ok: false,
      summary: `Unexpected response from Anthropic (HTTP ${status})`,
      detail: { status, ms },
    };
  } catch (err) {
    const { name, message } = safeErrorBits(err);
    return {
      id: "anthropic_api",
      label,
      ok: false,
      summary: `Could not reach Anthropic from Obsidian (${name}: ${message})`,
      detail: { errorName: name, errorMessage: message, ms: Date.now() - t0 },
    };
  }
}

/** Normalize anthropic probe: treat "reachable" as connectivity success. */
export function anthropicConnectivityOk(probe: ProbeResult): boolean {
  const s = probe.detail?.status;
  if (s !== undefined && s >= 200 && s < 600 && s !== 0) return true;
  return probe.ok;
}

export function buildConnectivityReport(
  probes: ProbeResult[],
  hasApiKey: boolean,
): ConnectivityReport {
  const baseline = probes.find((p) => p.id === "https_baseline");
  const anthropic = probes.find((p) => p.id === "anthropic_api");

  const baselineOk = baseline?.ok === true;
  const anthropicReached = anthropic
    ? anthropicConnectivityOk(anthropic)
    : false;
  const anthropicAuthBad =
    anthropic?.detail?.status === 401 || anthropic?.detail?.status === 403;

  let verdict: ConnectivityReport["verdict"];
  let userMessage: string;

  if (!baselineOk && !anthropicReached) {
    verdict = "no_https";
    userMessage =
      "Obsidian cannot complete HTTPS requests from this device. This is an Obsidian/network runtime issue — not your vault. Try restarting Obsidian; if it persists, another plugin or security tool may be blocking Electron network access.";
  } else if (baselineOk && !anthropicReached) {
    verdict = "baseline_only";
    userMessage =
      "General HTTPS works inside Obsidian, but the Anthropic API is unreachable. The API host may be blocked on this network, or there may be a TLS/path issue specific to api.anthropic.com.";
  } else if (anthropicReached && !hasApiKey) {
    verdict = "no_key";
    userMessage =
      "Anthropic is reachable from Obsidian. Set your API key in settings to classify captures.";
  } else if (anthropicReached && anthropicAuthBad && hasApiKey) {
    verdict = "partial";
    userMessage =
      "Anthropic is reachable, but your API key was rejected. Check the key in settings (SecretStorage).";
  } else if (anthropicReached) {
    verdict = "ok";
    userMessage =
      "Connection looks good. Obsidian can reach Anthropic — you can dry-run and process captures.";
  } else {
    verdict = "partial";
    userMessage = "Mixed results — open the console for probe details.";
  }

  return {
    generatedAt: new Date().toISOString(),
    probes,
    verdict,
    userMessage,
  };
}

export async function runConnectivityTest(opts: {
  apiKey: string | null;
  request?: RequestFn;
}): Promise<ConnectivityReport> {
  const request = opts.request ?? requestUrl;
  const probes: ProbeResult[] = [];
  probes.push(await probeHttpsBaseline(request));
  probes.push(await probeAnthropicApi(opts.apiKey, request));
  return buildConnectivityReport(probes, Boolean(opts.apiKey?.trim()));
}

/** Console-safe dump (no API key). */
export function formatConnectivityConsole(report: ConnectivityReport): object {
  return {
    verdict: report.verdict,
    userMessage: report.userMessage,
    generatedAt: report.generatedAt,
    probes: report.probes.map((p) => ({
      id: p.id,
      label: p.label,
      ok: p.ok,
      summary: p.summary,
      status: p.detail?.status,
      error: p.detail?.errorMessage,
      ms: p.detail?.ms,
    })),
  };
}
