/**
 * Forward classify to Anthropic. Never log API keys.
 */

import { config } from "./config.mjs";

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

  let payload = body.messagesRequest;
  if (!payload || typeof payload !== "object") {
    // Minimal fallback if client only sent capture+context
    payload = {
      model: config.anthropicModel,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Classify this capture:\n\n${body.capture ?? ""}`,
        },
      ],
    };
  } else {
    // Force server model (KTD-P7)
    payload = { ...payload, model: config.anthropicModel };
  }

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
