/**
 * Outbound email — Resend when RESEND_API_KEY set; console only in non-prod.
 * Two senders share the POST: the magic link, and #238 ops alerts.
 */
import { config } from "./config.mjs";
import { isProduction } from "./prodGate.mjs";

function failSend(message) {
  return { ok: false, message };
}

function consoleDeliver(to, link, via) {
  console.log(`[plus] magic link for ${to}: ${link}`);
  return { ok: true, via };
}

/** KTD7: log the subject only — never an ops body. */
function consoleOps(to, subject, via) {
  console.log(`[plus] ops email for ${to}: ${subject}`);
  return { ok: true, via };
}

/**
 * Shared Resend POST. Logs and returns false on any non-2xx or transport error.
 * @param {{ to: string, subject: string, text: string }} msg
 * @returns {Promise<boolean>}
 */
async function postResend(msg) {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.magicLinkFrom,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
      }),
    });
    if (res.ok) return true;

    const t = await res.text().catch(() => "");
    console.error("[plus] resend failed", res.status, t.slice(0, 120));
    return false;
  } catch (err) {
    console.error(
      "[plus] resend error",
      err instanceof Error ? err.message : "err",
    );
    return false;
  }
}

/**
 * @param {{ to: string, link: string }} opts
 * @returns {Promise<{ ok: boolean, via?: string, message?: string }>}
 */
export async function sendMagicLinkEmail(opts) {
  const { to, link } = opts;

  if (!config.resendApiKey) {
    if (isProduction()) return failSend("Email delivery not configured");
    return consoleDeliver(to, link, "console");
  }

  const sent = await postResend({
    to,
    subject: "Your Atoms Plus sign-in link",
    text: `Sign in to Atoms Plus:\n\n${link}\n\nThis link expires in 15 minutes. If you did not request it, ignore this email.`,
  });
  if (sent) return { ok: true, via: "resend" };

  if (isProduction()) return failSend("Could not send sign-in email");
  return consoleDeliver(to, link, "console-fallback");
}

/**
 * Operator-facing alert (#238). Same channel as the magic link, different
 * prose — routing an ops alert through sendMagicLinkEmail would mail the
 * operator a sign-in notice.
 * @param {{ to: string, subject: string, text: string }} opts
 * @returns {Promise<{ ok: boolean, via?: string, message?: string }>}
 */
export async function sendOpsEmail(opts) {
  const { to, subject, text } = opts;

  if (!config.resendApiKey) {
    if (isProduction()) return failSend("Email delivery not configured");
    return consoleOps(to, subject, "console");
  }

  const sent = await postResend({ to, subject, text });
  if (sent) return { ok: true, via: "resend" };

  if (isProduction()) return failSend("Could not send ops email");
  return consoleOps(to, subject, "console-fallback");
}
