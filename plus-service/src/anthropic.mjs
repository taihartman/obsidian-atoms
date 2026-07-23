/**
 * Forward classify to Anthropic. Server owns model + size caps.
 * Never log API keys.
 */
import { config } from "./config.mjs";

/**
 * Build a bounded payload — prefer client messagesRequest shape but enforce caps.
 * @param {{ messagesRequest?: object, capture?: string, context?: unknown }} body
 */
export function buildClassifyPayload(body) {
  const maxTok = Math.min(
    config.maxTokens,
    Number(body.messagesRequest?.max_tokens) || config.maxTokens,
  );

  // Reject oversized raw client body before we spend time reshaping
  const maxBytes = 100_000;
  try {
    const probe = JSON.stringify(body.messagesRequest ?? body);
    if (probe.length > maxBytes) {
      return {
        ok: false,
        status: 413,
        message: "Classify request too large",
      };
    }
  } catch {
    return { ok: false, status: 400, message: "Invalid classify body" };
  }

  let payload = body.messagesRequest;
  if (!payload || typeof payload !== "object") {
    const capture = String(body.capture ?? "").slice(0, config.maxCaptureChars);
    payload = {
      model: config.anthropicModel,
      max_tokens: maxTok,
      messages: [
        {
          role: "user",
          content: `Classify this capture:\n\n${capture}`,
        },
      ],
    };
  } else {
    payload = { ...payload, model: config.anthropicModel, max_tokens: maxTok };
    if (Array.isArray(payload.messages)) {
      payload.messages = payload.messages.map((m) => {
        if (typeof m?.content === "string") {
          return {
            ...m,
            content: m.content.slice(0, config.maxCaptureChars * 3),
          };
        }
        return m;
      });
    }
  }

  return { ok: true, payload };
}

/**
 * @param {{ messagesRequest?: object, capture?: string, context?: unknown }} body
 */
export async function proxyClassify(body) {
  if (!config.anthropicApiKey) {
    return {
      ok: false,
      status: 503,
      message: "Plus service missing ANTHROPIC_API_KEY",
    };
  }

  const built = buildClassifyPayload(body);
  if (!built.ok) return built;
  const payload = built.payload;

  try {
    const res = await fetch(config.anthropicUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.anthropicApiKey,
        "anthropic-version": config.anthropicVersion,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message:
          res.status === 401 || res.status === 403
            ? "Upstream model auth failed"
            : `Upstream model error (${res.status})`,
        json,
      };
    }
    return { ok: true, status: res.status, json };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return {
      ok: false,
      status: 0,
      message: `Upstream network error: ${msg.slice(0, 120)}`,
    };
  }
}
