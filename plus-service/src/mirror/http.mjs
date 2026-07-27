/**
 * Ask mirror HTTP routes (Plus session auth).
 */
import { checkRateLimit, clientIp } from "../ratelimit.mjs";

const MAX_ATOMS_PER_UPSERT = 100;
const MAX_BODY_CHARS = 100_000;
const MAX_BULK_CHARS = 2_000_000;

function entitled(a) {
  return a && (a.status === "active" || a.status === "trialing");
}

/**
 * @returns {boolean} true if handled
 */
export async function handleMirrorRoutes({
  req,
  res,
  path,
  store,
  bearer,
  json,
  readBody,
}) {
  const isAsk =
    path === "/v1/ask/mirror/upsert" ||
    path === "/v1/ask/mirror/wipe" ||
    path === "/v1/ask/mirror/status" ||
    path === "/v1/ask/outbox/pull" ||
    path === "/v1/ask/outbox/ack";
  if (!isAsk) return false;

  const token = bearer(req);
  // Reject mcp_ tokens on Plus routes
  if (token.startsWith("mcp_")) {
    json(res, 401, { message: "Invalid session" });
    return true;
  }

  const a = await store.accountFromSession(token);
  if (!a) {
    json(res, 401, { message: "Invalid session" });
    return true;
  }

  const ip = clientIp(req);
  const rl = checkRateLimit(`ask:${ip}:${a.email}`);
  if (!rl.ok) {
    json(res, 429, {
      message: "Too many Ask requests",
      retryAfterSec: rl.retryAfterSec,
    });
    return true;
  }

  if (req.method === "GET" && path === "/v1/ask/mirror/status") {
    if (!entitled(a)) {
      json(res, 403, { message: "Plus entitlement required for Ask mirror" });
      return true;
    }
    const st = await store.mirrorStatus(a.email);
    json(res, 200, { email: a.email, ...st });
    return true;
  }

  if (req.method === "POST" && path === "/v1/ask/mirror/wipe") {
    if (!entitled(a)) {
      json(res, 403, { message: "Plus entitlement required for Ask mirror" });
      return true;
    }
    await store.mirrorWipe(a.email);
    json(res, 200, { ok: true, count: 0 });
    return true;
  }

  if (req.method === "POST" && path === "/v1/ask/outbox/pull") {
    if (!entitled(a)) {
      json(res, 403, { message: "Plus entitlement required for Ask" });
      return true;
    }
    let body = {};
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { message: "invalid json" });
      return true;
    }
    const limit = body?.limit;
    const result = await store.outboxPull(a.email, { limit });
    json(res, 200, result);
    return true;
  }

  if (req.method === "POST" && path === "/v1/ask/outbox/ack") {
    if (!entitled(a)) {
      json(res, 403, { message: "Plus entitlement required for Ask" });
      return true;
    }
    let body;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { message: "invalid json" });
      return true;
    }
    const result = await store.outboxAck(a.email, {
      id: body?.id,
      status: body?.status,
      error: body?.error,
    });
    if (!result.ok && result.error === "not_found") {
      json(res, 404, { message: "not_found" });
      return true;
    }
    if (!result.ok) {
      json(res, 400, { message: result.error || "ack failed" });
      return true;
    }
    json(res, 200, { ok: true, id: result.id, status: result.status });
    return true;
  }

  if (req.method === "POST" && path === "/v1/ask/mirror/upsert") {
    if (!entitled(a)) {
      json(res, 403, { message: "Plus entitlement required for Ask mirror" });
      return true;
    }
    let body;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { message: "invalid json" });
      return true;
    }
    const atoms = Array.isArray(body.atoms) ? body.atoms : null;
    if (!atoms) {
      json(res, 400, { message: "atoms array required" });
      return true;
    }
    if (atoms.length > MAX_ATOMS_PER_UPSERT) {
      json(res, 400, {
        message: `at most ${MAX_ATOMS_PER_UPSERT} atoms per upsert`,
      });
      return true;
    }
    let totalChars = 0;
    const cleaned = [];
    for (const raw of atoms) {
      const pathStr = String(raw?.path || "").trim();
      const title = String(raw?.title || "").trim();
      const text = String(raw?.body ?? raw?.text ?? "");
      if (!pathStr) {
        json(res, 400, { message: "each atom needs path" });
        return true;
      }
      if (text.length > MAX_BODY_CHARS) {
        json(res, 413, {
          message: `atom body exceeds ${MAX_BODY_CHARS} chars`,
          path: pathStr,
        });
        return true;
      }
      totalChars += text.length;
      if (totalChars > MAX_BULK_CHARS) {
        json(res, 413, { message: "bulk upsert too large" });
        return true;
      }
      cleaned.push({
        path: pathStr,
        title: title || pathStr,
        body: text,
        tags: raw?.tags,
        links: raw?.links,
        atomId: raw?.id || raw?.atomId,
      });
    }
    // Tenant email from session only — ignore body.email
    const result = await store.mirrorUpsert(a.email, cleaned);
    const st = await store.mirrorStatus(a.email);
    json(res, 200, { ok: true, ...result, ...st });
    return true;
  }

  json(res, 405, { message: "Method not allowed" });
  return true;
}
