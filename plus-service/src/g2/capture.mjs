import { createHash, timingSafeEqual } from "node:crypto";

const CAPTURE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_CAPTURE_BYTES = 64 * 1024;
const MAX_CAPTURE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CAPTURE_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const G2_CAPTURE_DISCLOSURE_VERSION = "g2-capture-relay-v1";

export function canonicalCaptureBody(value) {
  return String(value ?? "").normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

export function captureFingerprint({ captureId, capturedAt, body }) {
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, captureId, capturedAt, body }), "utf8")
    .digest("hex");
}

function sameFingerprint(actual, expected) {
  if (!/^[a-f0-9]{64}$/.test(String(actual || ""))) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function validateConfirmedCapture(input, now = Date.now()) {
  const captureId = String(input?.captureId || "");
  const capturedAt = String(input?.capturedAt || "");
  const body = canonicalCaptureBody(input?.body);
  if (!CAPTURE_ID.test(captureId) || !body || body !== input?.body ||
      Buffer.byteLength(body, "utf8") > MAX_CAPTURE_BYTES || !OFFSET_TIMESTAMP.test(capturedAt)) {
    return { ok: false, error: "invalid_capture" };
  }
  const capturedMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedMs) || now - capturedMs > MAX_CAPTURE_AGE_MS ||
      capturedMs - now > MAX_CAPTURE_FUTURE_SKEW_MS) {
    return { ok: false, error: "invalid_capture" };
  }
  const expected = captureFingerprint({ captureId, capturedAt, body });
  if (!sameFingerprint(input?.fingerprint, expected)) return { ok: false, error: "invalid_capture" };
  return { ok: true, capture: { captureId, capturedAt, body, fingerprint: expected } };
}

export function createG2CaptureService({ store, now = () => Date.now() }) {
  return {
    async enqueue(binding, input) {
      if (!await store.g2Authorize(binding)) return { state: "setup_required" };
      const consent = await store.g2ReadConsent(binding.email);
      if (!consent?.g2Disclosure?.granted || consent.g2Disclosure.version !== G2_CAPTURE_DISCLOSURE_VERSION) {
        return { state: "setup_required" };
      }
      const checked = validateConfirmedCapture(input, now());
      if (!checked.ok) return { state: checked.error };
      return store.g2CaptureEnqueueAuthorized(binding, {
        ...checked.capture,
        familyId: binding.familyId,
      }, {
        now: now(),
        disclosureVersion: G2_CAPTURE_DISCLOSURE_VERSION,
      });
    },
    claim(email, input = {}) {
      return store.g2CaptureClaim(email, { limit: input.limit, now: now() });
    },
    ack(email, input = {}) {
      return store.g2CaptureAck(email, {
        captureId: input.captureId,
        claimToken: input.claimToken,
        now: now(),
      });
    },
  };
}
