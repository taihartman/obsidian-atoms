/**
 * #238 U3 — alert on a recorded incident.
 *
 * KTD2: throttled per (kind, window) on the shared `alerted_at` column, so the
 * throttle survives a two-machine deploy. KTD7: the body carries kind, Stripe
 * object id and email address only — never a session token, never an email body.
 *
 * The sender is injected. `sendOpsEmail` itself is proven against its own
 * console path; nothing here touches the network.
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memory.mjs";
import { alertStripeIncident } from "../src/alert.mjs";
import { sendOpsEmail } from "../src/email.mjs";
import { config } from "../src/config.mjs";

const MIN_MS = 60 * 1000;

before(() => {
  process.env.ATOMS_PLUS_ENV = "development";
  process.env.DOGFOOD_AUTO_GRANT = "0";
});

beforeEach(() => {
  process.env.ATOMS_PLUS_ALERT_EMAIL = "ops@atoms.test";
  delete process.env.ATOMS_PLUS_ALERT_THROTTLE_MIN;
});

function recorder() {
  const sent = [];
  return {
    sent,
    send: async (msg) => {
      sent.push(msg);
      return { ok: true, via: "test" };
    },
  };
}

describe("#238 U3 config", () => {
  it("exposes the alert address and a throttle in ms", () => {
    assert.equal(config.alertEmail, "ops@atoms.test");
    assert.equal(config.alertThrottleMs, 60 * MIN_MS);

    process.env.ATOMS_PLUS_ALERT_THROTTLE_MIN = "15";
    assert.equal(config.alertThrottleMs, 15 * MIN_MS);
  });
});

describe("#238 U3 alertStripeIncident", () => {
  it("sends once and stamps the row", async () => {
    const store = createMemoryStore();
    const now = Date.UTC(2026, 7, 4, 9, 0, 0);
    const row = await store.recordStripeIncident("webhook_reject", {
      stripeId: "",
      detail: "Stripe signature mismatch",
      now,
    });
    const mail = recorder();

    const out = await alertStripeIncident(store, row, {
      sendEmail: mail.send,
      now,
    });
    assert.equal(out.alerted, true);
    assert.equal(mail.sent.length, 1);
    assert.equal(mail.sent[0].to, "ops@atoms.test");
    assert.match(mail.sent[0].subject, /webhook_reject/);
    assert.equal(await store.lastStripeAlertAt("webhook_reject", 0), now);
  });

  it("throttles a second incident of the same kind inside the window", async () => {
    const store = createMemoryStore();
    const t0 = Date.UTC(2026, 7, 4, 9, 0, 0);
    const mail = recorder();

    const first = await store.recordStripeIncident("webhook_reject", {
      stripeId: "",
      now: t0,
    });
    await alertStripeIncident(store, first, { sendEmail: mail.send, now: t0 });

    // Same kind, still inside the 60-minute window → recorded, not alerted.
    const inside = await store.recordStripeIncident("webhook_reject", {
      stripeId: "",
      now: t0 + 30 * MIN_MS,
    });
    const out = await alertStripeIncident(store, inside, {
      sendEmail: mail.send,
      now: t0 + 30 * MIN_MS,
    });
    assert.equal(out.alerted, false);
    assert.equal(mail.sent.length, 1);

    // A different kind throttles independently.
    const other = await store.recordStripeIncident("missing_email", {
      stripeId: "cs_1",
      now: t0 + 31 * MIN_MS,
    });
    await alertStripeIncident(store, other, {
      sendEmail: mail.send,
      now: t0 + 31 * MIN_MS,
    });
    assert.equal(mail.sent.length, 2);

    // Outside the window → through again.
    const later = await store.recordStripeIncident("webhook_reject", {
      stripeId: "",
      now: t0 + 61 * MIN_MS,
    });
    const out2 = await alertStripeIncident(store, later, {
      sendEmail: mail.send,
      now: t0 + 61 * MIN_MS,
    });
    assert.equal(out2.alerted, true);
    assert.equal(mail.sent.length, 3);
  });

  it("50 collapsed rejects produce exactly one email", async () => {
    const store = createMemoryStore();
    const t0 = Date.UTC(2026, 7, 4, 1, 0, 0);
    const mail = recorder();

    for (let i = 0; i < 50; i += 1) {
      const row = await store.recordStripeIncident("webhook_reject", {
        stripeId: "",
        detail: "bad signature",
        now: t0 + i,
      });
      await alertStripeIncident(store, row, {
        sendEmail: mail.send,
        now: t0 + i,
      });
    }
    const rows = await store.listStripeIncidents({ since: 0 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].occurrences, 50);
    assert.equal(mail.sent.length, 1);
  });

  it("carries kind, stripe id and email only — no token, no body", async () => {
    const store = createMemoryStore();
    const now = Date.UTC(2026, 7, 4, 9, 0, 0);
    const row = await store.recordStripeIncident("email_mismatch", {
      stripeId: "cs_ktd7",
      email: "Payer@Atoms.Test",
      detail: "customer email disagrees with plugin metadata",
      now,
    });
    const mail = recorder();
    await alertStripeIncident(store, row, { sendEmail: mail.send, now });

    const body = `${mail.sent[0].subject}\n${mail.sent[0].text}`;
    assert.match(body, /email_mismatch/);
    assert.match(body, /cs_ktd7/);
    assert.match(body, /payer@atoms\.test/);
    assert.doesNotMatch(body, /sess_|mt_|whsec_|sk_|re_/);
  });

  it("records without alerting when no address is configured", async () => {
    delete process.env.ATOMS_PLUS_ALERT_EMAIL;
    const store = createMemoryStore();
    const now = Date.UTC(2026, 7, 4, 9, 0, 0);
    const row = await store.recordStripeIncident("webhook_reject", {
      stripeId: "",
      now,
    });
    const mail = recorder();

    const out = await alertStripeIncident(store, row, {
      sendEmail: mail.send,
      now,
    });
    assert.equal(out.alerted, false);
    assert.equal(mail.sent.length, 0);
    assert.equal(await store.lastStripeAlertAt("webhook_reject", 0), null);
    assert.equal((await store.listStripeIncidents({ since: 0 })).length, 1);
  });

  it("never throws and never rejects when the sender blows up", async () => {
    const store = createMemoryStore();
    const now = Date.UTC(2026, 7, 4, 9, 0, 0);
    const row = await store.recordStripeIncident("webhook_reject", {
      stripeId: "",
      now,
    });

    const unhandled = [];
    const onUnhandled = (err) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);
    try {
      const out = await alertStripeIncident(store, row, {
        sendEmail: async () => {
          throw new Error("resend outage");
        },
        now,
      });
      assert.equal(out.alerted, false);
      // Not stamped — the next incident may still try.
      assert.equal(await store.lastStripeAlertAt("webhook_reject", 0), null);
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("a store that cannot record leaves the caller unharmed", async () => {
    const out = await alertStripeIncident({}, null, { sendEmail: async () => {} });
    assert.equal(out.alerted, false);
  });
});

describe("#238 U3 sendOpsEmail", () => {
  it("falls back to console in non-prod without RESEND_API_KEY", async () => {
    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const r = await sendOpsEmail({
        to: "ops@atoms.test",
        subject: "[atoms plus] stripe incident: webhook_reject",
        text: "kind: webhook_reject",
      });
      assert.equal(r.ok, true);
      assert.equal(r.via, "console");
    } finally {
      if (saved !== undefined) process.env.RESEND_API_KEY = saved;
    }
  });
});

describe("#238 F8 — a stamp failure is visible, never a silent flood", () => {
  /**
   * `alerted_at` *is* the throttle. Swallowing a stamp failure in the outer
   * catch fails open: the row is never stamped, so every later delivery of the
   * same kind sends again — the operator gets a Resend flood with no
   * explanation instead of the silence the throttle promises.
   */
  function brokenStampStore() {
    const store = createMemoryStore();
    store.markStripeIncidentAlerted = async () => {
      throw new Error("connection terminated unexpectedly");
    };
    return store;
  }

  it("logs [plus] alert stamp failed rather than the generic send failure", async () => {
    const store = brokenStampStore();
    const now = Date.UTC(2026, 7, 4, 9, 0, 0);
    const row = await store.recordStripeIncident("webhook_reject", {
      stripeId: "",
      detail: "Stripe signature mismatch",
      now,
    });
    const mail = recorder();

    const errs = [];
    const realError = console.error;
    console.error = (...a) => errs.push(a.join(" "));
    let res;
    try {
      res = await alertStripeIncident(store, row, { sendEmail: mail.send, now });
    } finally {
      console.error = realError;
    }

    assert.equal(mail.sent.length, 1, "the email really did go out");
    assert.equal(res.alerted, true, "reporting it as unsent would be a lie");
    assert.equal(res.reason, "stamp_failed");
    assert.ok(
      errs.some((e) => e.includes("[plus] alert stamp failed")),
      `stamp failure must be named distinctly, got: ${JSON.stringify(errs)}`,
    );
    assert.ok(
      !errs.some((e) => e.includes("[plus] stripe alert failed")),
      "must not present as the generic catch-all failure",
    );
  });

  it("never throws or rejects — the caller already answered Stripe", async () => {
    const store = brokenStampStore();
    const now = Date.UTC(2026, 7, 4, 9, 0, 0);
    const row = await store.recordStripeIncident("missing_email", {
      stripeId: "cs_x",
      now,
    });
    const realError = console.error;
    console.error = () => {};
    try {
      await assert.doesNotReject(() =>
        alertStripeIncident(store, row, { sendEmail: recorder().send, now }),
      );
    } finally {
      console.error = realError;
    }
  });
});
