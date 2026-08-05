/**
 * Ask mirror HTTP routes (Plus session auth).
 */
import { checkRateLimit, clientIp } from "../ratelimit.mjs";
import { assertMirrorPath } from "../store/askHelpers.mjs";

const MAX_ATOMS_PER_UPSERT = 100;
const MAX_BODY_CHARS = 100_000;
const MAX_BULK_CHARS = 2_000_000;
const MAX_DELETE_PATHS = 100;
const MAX_KEEP_PATHS = 500;

/** @type {Map<string, { paths: Set<string>, exp: number }>} */
const reconcileSessions = new Map();
const RECONCILE_TTL_MS = 10 * 60 * 1000;

function entitled(a) {
  return a && (a.status === "active" || a.status === "trialing");
}

function purgeReconcileSessions() {
  const now = Date.now();
  for (const [k, v] of reconcileSessions) {
    if (v.exp < now) reconcileSessions.delete(k);
  }
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
    path === "/v1/ask/mirror/delete" ||
    path === "/v1/ask/mirror/reconcile" ||
    path === "/v1/ask/outbox/pull" ||
    path === "/v1/ask/outbox/ack" ||
    path === "/v1/ask/mcp/pair";
  if (!isAsk) return false;

  const token = bearer(req);
  // Reject mcp_ tokens on Plus routes
  if (token.startsWith("mcp_")) {
    json(res, 401, { message: "Invalid session" });
    return true;
  }

  // Soft-start (unverified) sessions must not read/write the cloud brain (C1).
  const a = await store.accountFromSession(token, { requireVerified: true });
  if (!a) {
    json(res, 401, {
      message:
        "Invalid session — sign in with a magic link to use Ask mirror",
    });
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

  // Pairing code for connector OAuth (KTD5)
  if (req.method === "POST" && path === "/v1/ask/mcp/pair") {
    if (!entitled(a)) {
      json(res, 403, { message: "Plus entitlement required for Ask pairing" });
      return true;
    }
    const mintRl = checkRateLimit(`pair-mint:${a.email}`, 5);
    if (!mintRl.ok) {
      json(res, 429, {
        message: "Too many pairing codes — try again later",
        retryAfterSec: mintRl.retryAfterSec,
      });
      return true;
    }
    const mintIpRl = checkRateLimit(`pair-mint-ip:${ip}`, 10);
    if (!mintIpRl.ok) {
      json(res, 429, {
        message: "Too many pairing codes — try again later",
        retryAfterSec: mintIpRl.retryAfterSec,
      });
      return true;
    }
    const out = await store.pairMint(a.email);
    json(res, 200, {
      code: out.code,
      expiresAt: out.expiresAt,
    });
    return true;
  }

  // Wipe: valid sess_ enough (exit path even when not entitled)
  if (req.method === "POST" && path === "/v1/ask/mirror/wipe") {
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

  if (req.method === "POST" && path === "/v1/ask/mirror/delete") {
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
    const paths = Array.isArray(body.paths) ? body.paths : null;
    if (!paths) {
      json(res, 400, { message: "paths array required" });
      return true;
    }
    if (paths.length > MAX_DELETE_PATHS) {
      json(res, 400, {
        message: `at most ${MAX_DELETE_PATHS} paths per delete`,
      });
      return true;
    }
    for (const p of paths) {
      const checked = assertMirrorPath(p);
      if (!checked.ok) {
        json(res, 400, { message: checked.error, path: p });
        return true;
      }
    }
    const result = await store.mirrorDelete(a.email, paths);
    json(res, 200, { ok: true, ...result });
    return true;
  }

  if (req.method === "POST" && path === "/v1/ask/mirror/reconcile") {
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
    const keepPaths = Array.isArray(body.keepPaths) ? body.keepPaths : null;
    if (!keepPaths) {
      json(res, 400, { message: "keepPaths array required" });
      return true;
    }
    if (keepPaths.length > MAX_KEEP_PATHS) {
      json(res, 400, {
        message: `at most ${MAX_KEEP_PATHS} keepPaths per request`,
      });
      return true;
    }
    for (const p of keepPaths) {
      const checked = assertMirrorPath(p);
      if (!checked.ok) {
        json(res, 400, { message: checked.error, path: p });
        return true;
      }
    }

    const done = body.done === true;
    const confirmEmpty = body.confirmEmpty === true;
    const sessionId = body.reconcileSessionId
      ? String(body.reconcileSessionId).slice(0, 80)
      : null;

    purgeReconcileSessions();

    if (!done) {
      if (!sessionId) {
        json(res, 400, {
          message: "reconcileSessionId required when done is false",
        });
        return true;
      }
      const sk = `${a.email}::${sessionId}`;
      let sess = reconcileSessions.get(sk);
      if (!sess) {
        sess = { paths: new Set(), exp: Date.now() + RECONCILE_TTL_MS };
        reconcileSessions.set(sk, sess);
      }
      sess.exp = Date.now() + RECONCILE_TTL_MS;
      for (const p of keepPaths) sess.paths.add(String(p).trim());
      json(res, 200, {
        ok: true,
        staged: sess.paths.size,
        deleted: 0,
      });
      return true;
    }

    // done:true — commit
    let keep = keepPaths.map((p) => String(p).trim());
    if (sessionId) {
      const sk = `${a.email}::${sessionId}`;
      const sess = reconcileSessions.get(sk);
      if (sess) {
        for (const p of keep) sess.paths.add(p);
        keep = [...sess.paths];
        reconcileSessions.delete(sk);
      }
    }

    if (keep.length === 0 && !confirmEmpty) {
      json(res, 400, {
        message: "empty keepPaths requires confirmEmpty:true",
      });
      return true;
    }

    const result = await store.mirrorReconcileKeep(a.email, keep);
    json(res, 200, { ok: true, ...result });
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
      const kind =
        String(raw?.kind || "").toLowerCase() === "hub" ? "hub" : "atom";
      const checked = assertMirrorPath(pathStr, { kind });
      if (!checked.ok) {
        json(res, 400, { message: checked.error, path: pathStr });
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
        path: checked.path,
        title: title || pathStr,
        body: text,
        tags: raw?.tags,
        links: raw?.links,
        atomId: raw?.id || raw?.atomId,
        kind: checked.kind,
        created: raw?.created,
      });
    }
    // Tenant email from session only — ignore body.email
    try {
      const result = await store.mirrorUpsert(a.email, cleaned);
      const st = await store.mirrorStatus(a.email);
      json(res, 200, { ok: true, ...result, ...st });
    } catch (err) {
      json(res, 400, {
        message: err instanceof Error ? err.message : "upsert failed",
      });
    }
    return true;
  }

  json(res, 405, { message: "Method not allowed" });
  return true;
}
