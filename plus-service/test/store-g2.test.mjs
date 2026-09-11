import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { askStoreModes, withStore } from "./helpers/askStore.mjs";

const modes = askStoreModes();

describe("G2 device store contract", () => {
  for (const mode of modes) {
    it(`${mode}: G2_STREAM_AUDIO_011 leases and terminal results have one durable owner`, async () => {
      await withStore(mode, async (store) => {
        const email = `lease-${mode}@atoms.test`;
        store.ensureAccount(email);
        await store.grantPeriod(email, { status: "active" });
        const pair = await store.g2PairMint(email, { scopes: ["g2:transcribe"] });
        const redeemed = await store.g2PairRedeem(pair.code, { jkt: "lease-jkt", name: "Lease G2" });
        const consent = await store.g2SynchronizeDisclosure(email, {
          baseRevision: 0, freshGesture: true,
          disclosure: { granted: true, version: "g2-voice-v1" },
        });
        const binding = {
          email,
          familyId: redeemed.device.id,
          generation: consent.revision,
        };
        const first = await store.g2TranscriptionClaim(binding, "rec-lease", "worker-a", 1_000, 30_000);
        assert.equal(first.acquired, true);
        const parked = await store.g2TranscriptionClaim(binding, "rec-lease", "worker-b", 2_000, 30_000);
        assert.equal(parked.acquired, false);
        const takeover = await store.g2TranscriptionClaim(binding, "rec-lease", "worker-b", 32_000, 30_000);
        assert.equal(takeover.acquired, true);
        assert.equal(await store.g2TranscriptionComplete(binding, "rec-lease", "worker-a", "stale"), false);
        assert.equal(await store.g2TranscriptionComplete(binding, "rec-lease", "worker-b", "winner"), true);
        const terminal = await store.g2TranscriptionGet(binding, "rec-lease");
        assert.equal(terminal.state, "completed");
        assert.equal(terminal.transcript, "winner");

        assert.equal((await store.g2TranscriptionClaim(binding, "rec-withdrawn", "worker-c", 33_000, 30_000)).acquired, true);
        await store.g2SynchronizeDisclosure(email, {
          baseRevision: binding.generation,
          disclosure: { granted: false, version: "" },
        });
        assert.equal(await store.g2TranscriptionComplete(binding, "rec-withdrawn", "worker-c", "must not persist"), false);
      });
    });

    it(`${mode}: G2_STREAM_TICKET_010 disclosure revision is device-controlled and monotonic`, async () => {
      await withStore(mode, async (store) => {
        const email = `disclosure-${mode}@atoms.test`;
        store.ensureAccount(email);
        await store.grantPeriod(email, { status: "active" });
        const accepted = await store.g2SynchronizeDisclosure(email, {
          baseRevision: 0,
          freshGesture: true,
          disclosure: { granted: true, version: "g2-voice-v1" },
        });
        assert.equal(accepted.revision, 1);
        assert.equal(accepted.g2Disclosure.granted, true);
        const withdrawn = await store.g2SynchronizeDisclosure(email, {
          baseRevision: 0,
          disclosure: { granted: false, version: "" },
        });
        assert.equal(withdrawn.revision, 2);
        assert.equal(withdrawn.g2Disclosure.granted, false);
        const staleGrant = await store.g2SynchronizeDisclosure(email, {
          baseRevision: 1,
          freshGesture: true,
          disclosure: { granted: true, version: "g2-voice-v1" },
        });
        assert.equal(staleGrant.revision, 2);
        assert.equal(staleGrant.g2Disclosure.granted, false);
        assert.equal(staleGrant.regrantRequired, true);
      });
    });

    it(`${mode}: G2_SESSION_CONSENT_008 G2_SESSION_CONSENT_009 are monotonic and withdrawal wins`, async () => {
      await withStore(mode, async (store) => {
        assert.equal(typeof store.g2ReadConsent, "function");
        assert.equal(typeof store.g2SynchronizeConsent, "function");
        const email = `consent-${mode}@atoms.test`;
        store.ensureAccount(email);
        await store.grantPeriod(email, { status: "active" });

        const initial = await store.g2ReadConsent(email);
        assert.deepEqual(initial, {
          revision: 0,
          g2Disclosure: { granted: false, version: "" },
          askMirror: { granted: false, version: "" },
          askWrite: { granted: false, version: "" },
        });

        const granted = await store.g2SynchronizeConsent(email, {
          baseRevision: 0,
          freshGesture: true,
          askMirror: { granted: true, version: "mirror-v1" },
          askWrite: { granted: true, version: "write-v1" },
        });
        assert.equal(granted.revision, 1);
        assert.equal(granted.askMirror.granted, true);
        assert.equal(granted.askWrite.granted, true);

        const withdrawn = await store.g2SynchronizeConsent(email, {
          baseRevision: 1,
          askMirror: { granted: false, version: "" },
          askWrite: { granted: false, version: "" },
        });
        assert.equal(withdrawn.revision, 2);
        assert.equal(withdrawn.askMirror.granted, false);
        assert.equal(withdrawn.askWrite.granted, false);

        const staleReplay = await store.g2SynchronizeConsent(email, {
          baseRevision: 1,
          freshGesture: true,
          askMirror: { granted: true, version: "mirror-v1" },
          askWrite: { granted: true, version: "write-v1" },
        });
        assert.equal(staleReplay.revision, 2);
        assert.equal(staleReplay.askMirror.granted, false);
        assert.equal(staleReplay.askWrite.granted, false);
        assert.equal(staleReplay.regrantRequired, true);

        const noGesture = await store.g2SynchronizeConsent(email, {
          baseRevision: 2,
          askMirror: { granted: true, version: "mirror-v1" },
          askWrite: { granted: true, version: "write-v1" },
        });
        assert.equal(noGesture.revision, 2);
        assert.equal(noGesture.regrantRequired, true);

        const regranted = await store.g2SynchronizeConsent(email, {
          baseRevision: 2,
          freshGesture: true,
          askMirror: { granted: true, version: "mirror-v1" },
          askWrite: { granted: true, version: "write-v1" },
        });
        assert.equal(regranted.revision, 3);
        assert.equal(regranted.askWrite.granted, true);

        const staleWithdrawal = await store.g2SynchronizeConsent(email, {
          baseRevision: 0,
          askMirror: { granted: false, version: "" },
        });
        assert.equal(staleWithdrawal.revision, 4);
        assert.equal(staleWithdrawal.askMirror.granted, false);
        assert.equal(staleWithdrawal.askWrite.granted, false);
      });
    });

    it(`${mode}: G2_REDEEM_004 code is single-use and tenant-scoped`, async () => {
      await withStore(mode, async (store) => {
        store.ensureAccount("owner@atoms.test");
        await store.grantPeriod("owner@atoms.test", { status: "active" });
        const minted = await store.g2PairMint("owner@atoms.test", {
          scopes: ["g2:query", "g2:commit", "not-real"],
        });
        const displayed = `${minted.code.slice(0, 4)}-${minted.code.slice(4)}`;
        const first = await store.g2PairRedeem(displayed, {
          jkt: "jkt-owner",
          name: "My G2",
        });
        assert.ok(first?.accessToken?.startsWith("g2a_"));
        assert.ok(first?.refreshToken?.startsWith("g2r_"));
        assert.deepEqual(first.scopes, ["g2:commit", "g2:query"]);
        assert.equal(await store.g2PairRedeem(minted.code, { jkt: "jkt-other" }), null);
        assert.equal((await store.g2ListDevices("foreign@atoms.test")).length, 0);
      });
    });

    it(`${mode}: G2_REFRESH_005 replay revokes the family atomically`, async () => {
      await withStore(mode, async (store) => {
        store.ensureAccount("refresh@atoms.test");
        await store.grantPeriod("refresh@atoms.test", { status: "active" });
        const pair = await store.g2PairMint("refresh@atoms.test", { scopes: ["g2:query"] });
        const issued = await store.g2PairRedeem(pair.code, { jkt: "jkt-refresh" });
        const rotated = await store.g2Refresh(issued.refreshToken, "jkt-refresh");
        assert.ok(rotated?.refreshToken?.startsWith("g2r_"));
        assert.equal(await store.g2Refresh(issued.refreshToken, "jkt-refresh"), null);
        assert.equal(await store.g2AccessLookup(rotated.accessToken), null);
        assert.equal(await store.g2Refresh(rotated.refreshToken, "jkt-refresh"), null);
      });
    });

    it(`${mode}: G2_SESSION_REVOKE_003 revokes only the owned family`, async () => {
      await withStore(mode, async (store) => {
        for (const email of ["a@atoms.test", "b@atoms.test"]) {
          store.ensureAccount(email);
          await store.grantPeriod(email, { status: "active" });
        }
        const ca = await store.g2PairMint("a@atoms.test", { scopes: ["g2:fetch"] });
        const cb = await store.g2PairMint("b@atoms.test", { scopes: ["g2:fetch"] });
        const a = await store.g2PairRedeem(ca.code, { jkt: "a" });
        const b = await store.g2PairRedeem(cb.code, { jkt: "b" });
        assert.equal(await store.g2RevokeDevice("b@atoms.test", a.device.id), false);
        assert.equal(await store.g2RevokeDevice("a@atoms.test", a.device.id), true);
        assert.equal(await store.g2AccessLookup(a.accessToken), null);
        assert.ok(await store.g2AccessLookup(b.accessToken));
      });
    });
  }
});
