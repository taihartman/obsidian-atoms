import { createHash } from "node:crypto";
import { id, subscriptionLive } from "../store/shared.mjs";
import { OUTBOX_MAX_BODY, OUTBOX_TITLE_MAX, validateOutboxPayload } from "../store/askHelpers.mjs";

export const G2_PREPARATION_TTL_MS = 15 * 60 * 1000;
const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function sha256(value) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function canonicalFingerprint(proposal) {
  return sha256(JSON.stringify({
    title: proposal.title,
    body_utf8_sha256: proposal.capturedRecordSha256,
    tags: proposal.tags,
    links: proposal.links,
    origin: "g2",
    captured_at: proposal.capturedAt,
    loop_inference: false,
  }));
}

function canonicalTitle(value) {
  let cleaned = "";
  for (const char of String(value ?? "")) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127 || code === 0x2028 || code === 0x2029) continue;
    cleaned += char;
  }
  cleaned = cleaned.replace(/\[\[/g, "(").replace(/\]\]/g, ")")
    .replace(/[/:\\?%*|"<>]/g, "-").replace(/\.\.+/g, ".")
    .replace(/^\.+|\.+$/g, "").replace(/\s+/g, " ").trim().slice(0, OUTBOX_TITLE_MAX).trim();
  if (!cleaned || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) return "Untitled";
  return cleaned;
}

function publicProposal(row) {
  if (!row) return null;
  return { preparationId: row.id, expiresAt: new Date(row.expiresAt).toISOString(), ...row.payload };
}

export function createG2PreparationService({ store, now = () => Date.now(), generate } = {}) {
  if (!store) throw new Error("store_required");
  const metadata = generate || (async () => ({ ok: false, reason: "unavailable" }));
  const inFlight = new Set();

  async function gates(binding, requireWrite = false) {
    const account = await store.getAccount?.(binding.email);
    const consent = await store.g2ReadConsent(binding.email);
    const devices = await store.g2ListDevices(binding.email);
    const device = devices.find((candidate) => candidate.id === binding.familyId);
    return Boolean(subscriptionLive(account) && consent.g2Disclosure.granted &&
      consent.revision === binding.generation && device && !device.revoked &&
      (!requireWrite || (consent.askMirror.granted && consent.askWrite.granted)));
  }

  function abortMatching({ email, familyId, generation = Number.MAX_SAFE_INTEGER }) {
    const normalized = String(email || "").toLowerCase();
    for (const work of inFlight) {
      if (work.email === normalized && (!familyId || work.familyId === familyId) && work.generation < generation) {
        work.controller.abort("authorization_changed");
      }
    }
  }

  return {
    async prepare(binding, input) {
      if (!await gates(binding)) return { state: "setup_required" };
      if (typeof input?.transcript !== "string" || !input.transcript.trim() || Buffer.byteLength(input.transcript, "utf8") > OUTBOX_MAX_BODY) {
        return { state: "invalid_transcript" };
      }
      if (!OFFSET_TIMESTAMP.test(String(input.capturedAt || ""))) return { state: "invalid_captured_at" };
      const tagResult = await store.mirrorListTags(binding.email);
      const mirrorPage = await store.mirrorList(binding.email, { limit: 50, sort_by: "title", order: "asc" });
      if (!await gates(binding)) return { state: "setup_required" };
      const controller = new AbortController();
      const work = {
        email: String(binding.email || "").toLowerCase(), familyId: binding.familyId,
        generation: binding.generation, controller,
      };
      inFlight.add(work);
      let generated;
      try {
        generated = await metadata({
          transcript: input.transcript,
          transcriptionId: input.transcriptionId,
          availableTags: (tagResult.tags || []).map((tag) => String(tag.name ?? tag.tag ?? tag).replace(/^#/, "")),
          mirrorTitles: (mirrorPage.items || []).map((item) => item.title),
          signal: controller.signal,
        });
      } catch {
        generated = { ok: false, reason: "upstream_error" };
      } finally {
        inFlight.delete(work);
      }
      if (controller.signal.aborted || !await gates(binding)) return { state: "setup_required" };
      if (generated?.ok === false) {
        return { state: generated.reason === "unavailable" ? "preparation_unavailable" : "preparation_failed" };
      }
      generated = generated?.ok === true ? generated.metadata : generated;
      const title = canonicalTitle(generated?.title);
      if (!title) return { state: "preparation_failed" };
      const allowedTags = new Set((tagResult.tags || []).map((tag) => String(tag.name ?? tag.tag ?? tag).replace(/^#/, "").toLowerCase()));
      const tags = [...new Set((Array.isArray(generated.tags) ? generated.tags : [])
        .map((tag) => String(tag).replace(/^#/, "").trim())
        .filter((tag) => tag && allowedTags.has(tag.toLowerCase())))].slice(0, 20);
      const links = [];
      for (const candidate of Array.isArray(generated.links) ? generated.links.slice(0, 10) : []) {
        const note = String(candidate?.note || "").trim();
        const reason = String(candidate?.reason || "").replace(/[\r\n]/g, " ").trim().slice(0, 500);
        if (!note || !reason) continue;
        const known = await store.mirrorFetch(binding.email, note);
        if (known) links.push({ note: known.title, reason });
      }
      const payload = {
        title,
        body: input.transcript,
        tags,
        links,
        transcriptionId: String(input.transcriptionId || ""),
        capturedAt: input.capturedAt,
        capturedRecordSha256: sha256(input.transcript),
        loopInference: false,
      };
      payload.fingerprint = canonicalFingerprint(payload);
      const row = { id: id("g2p"), familyId: binding.familyId, expiresAt: now() + G2_PREPARATION_TTL_MS, payload };
      // Egress authorization can change while the model or mirror checks are
      // parked. The last read is deliberately adjacent to persistence.
      if (!await gates(binding)) return { state: "setup_required" };
      await store.g2PreparationPut(binding.email, row);
      return publicProposal(row);
    },

    async get(binding, preparationId) {
      return publicProposal(await store.g2PreparationGet(binding.email, preparationId, binding.familyId));
    },

    async cancel(binding, preparationId) {
      return { state: await store.g2PreparationDelete(binding.email, preparationId) ? "cancelled" : "not_found" };
    },

    async commit(binding, request) {
      if (!await gates(binding, true)) return { state: "setup_required" };
      const row = await store.g2PreparationGet(binding.email, request.preparationId, binding.familyId);
      if (!row) return { state: "not_found" };
      if (row.expiresAt <= now()) return { state: "expired" };
      const proposal = row.payload;
      if (request.fingerprint !== proposal.fingerprint || request.confirmedTitle !== proposal.title) {
        return { state: "confirmation_mismatch" };
      }
      if (proposal.outboxId) {
        if (proposal.commitKey !== request.commitKey) return { state: "idempotency_conflict" };
        const existing = await store.outboxGet(binding.email, proposal.outboxId);
        if (!existing) return { state: "commit_unknown" };
        return { state: existing.status === "applied" && existing.receipt ? "saved" : existing.status === "rejected" ? "rejected" : "queued", outboxId: existing.id, receipt: existing.receipt || null };
      }
      if (await store.mirrorFetch(binding.email, proposal.title) || await store.outboxHasOpenTitle(binding.email, proposal.title)) {
        return { state: "title_collision" };
      }
      const payload = {
        title: proposal.title, body: proposal.body, tags: proposal.tags, links: proposal.links,
        origin: "g2", captured_at: proposal.capturedAt,
        captured_record_sha256: proposal.capturedRecordSha256, loop_inference: false,
        proposal_fingerprint: proposal.fingerprint, preparation_id: row.id,
        client_request_id: String(request.commitKey || ""),
      };
      const validated = validateOutboxPayload("create", payload);
      if (!validated.ok) return { state: "invalid_proposal" };
      const result = await store.outboxEnqueue(binding.email, {
        kind: "create", payload: validated.payload, client_request_id: request.commitKey,
        proposal_fingerprint: proposal.fingerprint,
      });
      if (!result.ok) return { state: result.error };
      proposal.commitKey = String(request.commitKey || "");
      proposal.outboxId = result.id;
      await store.g2PreparationPut(binding.email, { ...row, payload: proposal });
      return { state: result.status === "applied" && result.receipt ? "saved" : "queued", outboxId: result.id, receipt: result.receipt || null };
    },

    async status(binding, outboxId) {
      const row = await store.outboxGet(binding.email, outboxId);
      if (!row) return { state: "not_found" };
      if (row.status === "applied" && row.receipt) return { state: "saved", outboxId: row.id, receipt: row.receipt };
      if (row.status === "rejected") return { state: "rejected", reason: row.error || "rejected" };
      return { state: "queued", outboxId: row.id };
    },

    revoke(binding) {
      abortMatching(binding);
    },
  };
}
