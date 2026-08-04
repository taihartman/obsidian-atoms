/**
 * #238 — alert an operator about a recorded Stripe incident.
 *
 * The email is the interrupt, the table is the record: a throttled or
 * unconfigured alert still leaves the row behind for the CLI to find.
 *
 * KTD2 — throttled per (kind, window) on the shared `alerted_at` column, so
 * the throttle holds across Fly machines. Never move it in-process.
 * KTD7 — the body carries kind, Stripe object id and email only.
 */
import { config } from "./config.mjs";
import { sendOpsEmail } from "./email.mjs";

/**
 * Never throws and never rejects: the caller is a webhook that has already
 * answered Stripe, and Node 20+ turns an unhandled rejection into an exit.
 * @param {object} store
 * @param {object | null | undefined} incident row from `recordStripeIncident`
 * @param {{ sendEmail?: Function, now?: number }} [opts]
 * @returns {Promise<{ alerted: boolean, reason?: string }>}
 */
export async function alertStripeIncident(store, incident, opts = {}) {
  try {
    if (!incident || !incident.id) return { alerted: false, reason: "no_incident" };

    const to = config.alertEmail;
    if (!to) return { alerted: false, reason: "no_address" };

    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const last = await store.lastStripeAlertAt(
      incident.kind,
      now - config.alertThrottleMs,
    );
    if (last !== null) return { alerted: false, reason: "throttled" };

    const send = opts.sendEmail || sendOpsEmail;
    const res = await send(buildOpsMessage(to, incident));
    if (res && res.ok === false) return { alerted: false, reason: "send_failed" };

    // Stamp only after a delivered alert, so a Resend outage retries next time.
    // Caught apart from the send: the throttle *is* this column, so a stamp
    // failure swallowed by the outer catch fails open — every later delivery
    // re-sends, and the operator sees a Resend flood with no explanation. It
    // must not throw (the caller is a webhook that already answered Stripe),
    // so name it in the log instead and report the send that did happen.
    try {
      await store.markStripeIncidentAlerted(incident.id, { now });
    } catch (stampErr) {
      console.error(
        "[plus] alert stamp failed",
        incident.kind,
        stampErr instanceof Error ? stampErr.message : "err",
      );
      return { alerted: true, reason: "stamp_failed" };
    }
    return { alerted: true };
  } catch (err) {
    console.error(
      "[plus] stripe alert failed",
      err instanceof Error ? err.message : "err",
    );
    return { alerted: false, reason: "error" };
  }
}

/** @param {string} to @param {object} incident */
function buildOpsMessage(to, incident) {
  const lines = [
    `kind: ${incident.kind}`,
    `stripe id: ${incident.stripeId || "(none — signature never verified)"}`,
    `email: ${incident.email || "(unknown)"}`,
    `occurrences today: ${incident.occurrences}`,
    `first seen: ${incident.firstSeenAt}`,
    `last seen: ${incident.lastSeenAt}`,
    "",
    `Further ${incident.kind} alerts are throttled for ${Math.round(config.alertThrottleMs / 60000)} minutes.`,
    "Query stripe_incidents for the full picture.",
  ];
  return {
    to,
    subject: `[atoms plus] stripe incident: ${incident.kind}`,
    text: lines.join("\n"),
  };
}
