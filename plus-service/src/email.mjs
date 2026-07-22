/**
 * Magic-link email — Resend when RESEND_API_KEY set; else console log.
 */
import { config } from "./config.mjs";

/**
 * @param {{ to: string, link: string }} opts
 */
export async function sendMagicLinkEmail(opts) {
  const { to, link } = opts;
  if (!config.resendApiKey) {
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
        text: `Sign in to Atoms Plus:\n\n${link}\n\nThis link expires in 15 minutes.`,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[plus] resend failed", res.status, t.slice(0, 120));
      console.log(`[plus] magic link fallback for ${to}: ${link}`);
      return { ok: true, via: "console-fallback" };
    }
    return { ok: true, via: "resend" };
  } catch (err) {
    console.error(
      "[plus] resend error",
      err instanceof Error ? err.message : "err",
    );
    console.log(`[plus] magic link fallback for ${to}: ${link}`);
    return { ok: true, via: "console-fallback" };
  }
}
