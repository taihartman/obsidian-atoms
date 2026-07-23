/**
 * Magic-link email — Resend when RESEND_API_KEY set; console only in non-prod.
 */
import { config } from "./config.mjs";
import { isProduction } from "./prodGate.mjs";

/**
 * @param {{ to: string, link: string }} opts
 * @returns {Promise<{ ok: boolean, via?: string, message?: string }>}
 */
export async function sendMagicLinkEmail(opts) {
  const { to, link } = opts;

  if (!config.resendApiKey) {
    if (isProduction()) {
      return {
        ok: false,
        message: "Email delivery not configured",
      };
    }
    console.log(`[plus] magic link for ${to}: ${link}`);
    return { ok: true, via: "console" };
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
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[plus] resend failed", res.status, t.slice(0, 120));
      if (isProduction()) {
        return {
          ok: false,
          message: "Could not send sign-in email",
        };
      }
      console.log(`[plus] magic link fallback for ${to}: ${link}`);
      return { ok: true, via: "console-fallback" };
    }
    return { ok: true, via: "resend" };
  } catch (err) {
    console.error(
      "[plus] resend error",
      err instanceof Error ? err.message : "err",
    );
    if (isProduction()) {
      return {
        ok: false,
        message: "Could not send sign-in email",
      };
    }
    console.log(`[plus] magic link fallback for ${to}: ${link}`);
    return { ok: true, via: "console-fallback" };
  }
}
