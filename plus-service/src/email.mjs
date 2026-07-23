/**
 * Magic-link email — Resend when RESEND_API_KEY set; console only in non-prod.
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

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.magicLinkFrom,
        to: [to],
        subject: "Your Atoms Plus sign-in link",
        text: `Sign in to Atoms Plus:\n\n${link}\n\nThis link expires in 15 minutes. If you did not request it, ignore this email.`,
      }),
    });
    if (res.ok) return { ok: true, via: "resend" };

    const t = await res.text().catch(() => "");
    console.error("[plus] resend failed", res.status, t.slice(0, 120));
    if (isProduction()) return failSend("Could not send sign-in email");
    return consoleDeliver(to, link, "console-fallback");
  } catch (err) {
    console.error(
      "[plus] resend error",
      err instanceof Error ? err.message : "err",
    );
    if (isProduction()) return failSend("Could not send sign-in email");
    return consoleDeliver(to, link, "console-fallback");
  }
}
