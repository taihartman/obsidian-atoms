/**
 * GET /api/unsubscribe?e=&t= - one-click marketing opt-out (HMAC).
 */
import { normalizeEmail, isValidEmail } from "../_lib/subscribeCore.mjs";
import { unsubscribeContact } from "../_lib/resendMarketing.mjs";
import { hmacSign } from "../_lib/hmac.mjs";

function htmlPage(title, body) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#111}a{color:#0a84ff}</style></head><body>${body}</body></html>`,
    {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const email = normalizeEmail(url.searchParams.get("e") || "");
  const t = url.searchParams.get("t") || "";

  if (!isValidEmail(email) || !t) {
    return htmlPage(
      "Unsubscribe",
      "<h1>Link incomplete</h1><p>Use the unsubscribe link from an Atoms Notes email.</p><p><a href=\"/\">tryatoms.app</a></p>",
    );
  }

  const secret = env.ATOMS_NOTES_UNSUB_SECRET || env.RESEND_API_KEY || "dev";
  const expected = await hmacSign(secret, `unsub:${email}`);
  if (t !== expected) {
    return htmlPage(
      "Unsubscribe",
      "<h1>Link not valid</h1><p>This unsubscribe link is invalid or expired.</p><p><a href=\"/\">tryatoms.app</a></p>",
    );
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return htmlPage(
      "Unsubscribe",
      "<h1>Something went wrong</h1><p>Try again later, or open an issue on GitHub.</p>",
    );
  }

  const result = await unsubscribeContact({ apiKey, email });
  if (!result.ok) {
    console.error("[atoms-notes] unsub", result.status, result.detail);
    return htmlPage(
      "Unsubscribe",
      "<h1>Something went wrong</h1><p>We could not update your preference. Open an issue on GitHub if this keeps happening.</p>",
    );
  }

  return htmlPage(
    "Unsubscribed",
    "<h1>You're unsubscribed</h1><p>You will not get Atoms Notes marketing email at this address. Sign-in links for Plus are separate and still work if you use Plus.</p><p><a href=\"/\">Back to tryatoms.app</a></p>",
  );
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method not allowed", { status: 405 });
}
