import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { askStoreModes, withStore } from "./helpers/askStore.mjs";
import {
  createG2CaptureService,
  G2_CAPTURE_DISCLOSURE_VERSION,
} from "../src/g2/capture.mjs";

const fingerprint = (captureId, capturedAt, body) => createHash("sha256")
  .update(JSON.stringify({ version: 1, captureId, capturedAt, body }), "utf8")
  .digest("hex");

describe("G2 capture relay store contract", () => {
  it("G2_CAPTURE_ENQUEUE_016 rejects a stale disclosure version before persistence", async () => {
    let persisted = false;
    const service = createG2CaptureService({
      now: () => Date.parse("2026-09-10T16:00:00Z"),
      store: {
        g2Authorize: async () => true,
        g2ReadConsent: async () => ({ g2Disclosure: { granted: true, version: "old" } }),
        g2CaptureEnqueueAuthorized: async () => { persisted = true; return { state: "pending" }; },
      },
    });
    const capture = { captureId: "capture_old", capturedAt: "2026-09-10T16:00:00Z", body: "exact" };
    const result = await service.enqueue({ email: "owner@atoms.test" }, {
      ...capture, fingerprint: fingerprint(capture.captureId, capture.capturedAt, capture.body),
    });
    assert.equal(result.state, "setup_required");
    assert.equal(persisted, false);
  });

  it("G2_CAPTURE_ENQUEUE_016 accepts a recovered capture throughout its seven-day recovery window", async () => {
    const now = Date.parse("2026-09-10T16:00:00Z");
    const capturedAt = new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString();
    const capture = { captureId: "capture_recovered", capturedAt, body: "exact recovered words" };
    let persisted = false;
    const service = createG2CaptureService({
      now: () => now,
      store: {
        g2Authorize: async () => true,
        g2ReadConsent: async () => ({
          g2Disclosure: { granted: true, version: G2_CAPTURE_DISCLOSURE_VERSION },
        }),
        g2CaptureEnqueueAuthorized: async () => {
          persisted = true;
          return { state: "pending" };
        },
      },
    });

    const result = await service.enqueue({ email: "owner@atoms.test", familyId: "family", generation: 1 }, {
      ...capture,
      fingerprint: fingerprint(capture.captureId, capture.capturedAt, capture.body),
    });

    assert.equal(result.state, "pending");
    assert.equal(persisted, true);
  });

  it("G2_CAPTURE_ENQUEUE_016 delegates the final authorization and insert to one store operation", async () => {
    const capture = { captureId: "capture_atomic", capturedAt: "2026-09-10T16:00:00Z", body: "exact" };
    let authorizedInsert = 0;
    const binding = { email: "owner@atoms.test", familyId: "family", generation: 1 };
    const service = createG2CaptureService({
      now: () => Date.parse(capture.capturedAt),
      store: {
        g2Authorize: async () => true,
        g2ReadConsent: async () => ({
          g2Disclosure: { granted: true, version: G2_CAPTURE_DISCLOSURE_VERSION },
        }),
        g2CaptureEnqueue: async () => { throw new Error("non_atomic_enqueue_used"); },
        g2CaptureEnqueueAuthorized: async (actualBinding, row, options) => {
          authorizedInsert += 1;
          assert.deepEqual(actualBinding, binding);
          assert.equal(row.familyId, binding.familyId);
          assert.equal(options.disclosureVersion, G2_CAPTURE_DISCLOSURE_VERSION);
          return { captureId: row.captureId, state: "pending" };
        },
      },
    });

    const result = await service.enqueue(binding, {
      ...capture,
      fingerprint: fingerprint(capture.captureId, capture.capturedAt, capture.body),
    });

    assert.equal(result.state, "pending");
    assert.equal(authorizedInsert, 1);
  });

  for (const mode of askStoreModes()) {
    it(`${mode}: G2_CAPTURE_ENQUEUE_016 rechecks authorization inside the enqueue boundary`, async () => {
      await withStore(mode, async (store) => {
        const email = `capture-auth-${mode}@atoms.test`;
        store.ensureAccount(email);
        await store.grantPeriod(email, { remaining: 10, status: "active", plan: "monthly" });
        const pair = await store.g2PairMint(email, { scopes: ["g2:capture"] });
        const redeemed = await store.g2PairRedeem(pair.code, { jkt: `capture-${mode}`, name: "Capture G2" });
        const consent = await store.g2SynchronizeDisclosure(email, {
          baseRevision: 0,
          disclosure: { granted: true, version: G2_CAPTURE_DISCLOSURE_VERSION },
          freshGesture: true,
        });
        const binding = { email, familyId: redeemed.device.id, generation: consent.revision };
        const row = {
          captureId: "capture_authorized",
          familyId: binding.familyId,
          capturedAt: "2026-09-10T16:00:00Z",
          body: "exact authorized words",
        };
        row.fingerprint = fingerprint(row.captureId, row.capturedAt, row.body);

        const accepted = await store.g2CaptureEnqueueAuthorized(binding, row, {
          now: 1_000,
          disclosureVersion: G2_CAPTURE_DISCLOSURE_VERSION,
        });
        assert.equal(accepted.state, "pending");

        await store.g2SynchronizeDisclosure(email, {
          baseRevision: consent.revision,
          disclosure: { granted: false, version: "" },
          freshGesture: true,
        });
        const rejected = await store.g2CaptureEnqueueAuthorized(binding, {
          ...row,
          captureId: "capture_after_withdrawal",
        }, {
          now: 1_001,
          disclosureVersion: G2_CAPTURE_DISCLOSURE_VERSION,
        });
        assert.equal(rejected.state, "setup_required");
      });
    });
  }

  for (const mode of askStoreModes()) {
    it(`${mode}: G2_CAPTURE_ENQUEUE_016 retries exactly and rejects changed reuse`, async () => {
      await withStore(mode, async (store) => {
        assert.equal(typeof store.g2CaptureEnqueue, "function");
        const row = {
          captureId: "capture_one",
          familyId: "family_one",
          capturedAt: "2026-09-10T12:00:00-04:00",
          body: "Correct these exact words",
        };
        row.fingerprint = fingerprint(row.captureId, row.capturedAt, row.body);
        const first = await store.g2CaptureEnqueue("owner@atoms.test", row, { now: 1000 });
        const retry = await store.g2CaptureEnqueue("owner@atoms.test", row, { now: 1001 });
        const changed = await store.g2CaptureEnqueue("owner@atoms.test", {
          ...row,
          body: "Different words",
          fingerprint: fingerprint(row.captureId, row.capturedAt, "Different words"),
        }, { now: 1002 });
        assert.equal(first.state, "pending");
        assert.equal(retry.state, "pending");
        assert.equal(retry.already, true);
        assert.equal(changed.error, "capture_id_conflict");
      });
    });

    it(`${mode}: G2_CAPTURE_CLAIM_017 G2_CAPTURE_ACK_018 claim exact text and purge it after proof`, async () => {
      await withStore(mode, async (store) => {
        assert.equal(typeof store.g2CaptureClaim, "function");
        assert.equal(typeof store.g2CaptureAck, "function");
        const row = {
          captureId: "capture_two",
          familyId: "family_two",
          capturedAt: "2026-09-10T12:00:00-04:00",
          body: "A phrase I can edit in Obsidian",
        };
        row.fingerprint = fingerprint(row.captureId, row.capturedAt, row.body);
        await store.g2CaptureEnqueue("owner@atoms.test", row, { now: 2000 });
        const claimed = await store.g2CaptureClaim("owner@atoms.test", { now: 2001, limit: 10, leaseMs: 30_000 });
        assert.equal(claimed.items.length, 1);
        assert.deepEqual({
          captureId: claimed.items[0].captureId,
          capturedAt: claimed.items[0].capturedAt,
          body: claimed.items[0].body,
        }, {
          captureId: row.captureId,
          capturedAt: row.capturedAt,
          body: row.body,
        });
        assert.ok(claimed.items[0].claimToken);
        const wrong = await store.g2CaptureAck("owner@atoms.test", {
          captureId: row.captureId,
          claimToken: "wrong",
          now: 2002,
        });
        assert.equal(wrong.error, "not_found");
        const acked = await store.g2CaptureAck("owner@atoms.test", {
          captureId: row.captureId,
          claimToken: claimed.items[0].claimToken,
          now: 2003,
        });
        assert.equal(acked.state, "applied");
        const after = await store.g2CaptureClaim("owner@atoms.test", { now: 2004, limit: 10, leaseMs: 30_000 });
        assert.deepEqual(after.items, []);
        const swept = await store.g2SweepExpired(2003 + 7 * 24 * 60 * 60 * 1000, 100);
        assert.ok(swept.receipts >= 1);
        const tombstone = await store.g2CaptureAck("owner@atoms.test", {
          captureId: row.captureId,
          claimToken: claimed.items[0].claimToken,
          now: 2004 + 7 * 24 * 60 * 60 * 1000,
        });
        assert.equal(tombstone.state, "tombstone");
      });
    });
  }
});
