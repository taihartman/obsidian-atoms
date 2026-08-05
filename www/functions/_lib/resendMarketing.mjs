/**
 * Resend Contacts + welcome email for Atoms Notes (server-side only).
 */

/**
 * @param {string} apiKey
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function resendFetch(apiKey, path, init = {}) {
  const res = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

/**
 * Create or update contact opted in for marketing; add to segment.
 * @param {{
 *   apiKey: string,
 *   email: string,
 *   segmentId: string,
 * }} opts
 * @returns {Promise<{ ok: true, contactId: string, created: boolean } | { ok: false, status: number, detail: string }>}
 */
export async function upsertMarketingContact(opts) {
  const { apiKey, email, segmentId } = opts;

  const created = await resendFetch(apiKey, "/contacts", {
    method: "POST",
    body: JSON.stringify({
      email,
      unsubscribed: false,
    }),
  });

  let contactId = created.json?.id || created.json?.data?.id;
  let isNew = created.res.ok;

  if (!created.res.ok) {
    // Already exists - patch unsubscribed false (re-opt-in)
    const patched = await resendFetch(apiKey, `/contacts/${encodeURIComponent(email)}`, {
      method: "PATCH",
      body: JSON.stringify({ unsubscribed: false }),
    });
    if (!patched.res.ok) {
      return {
        ok: false,
        status: patched.res.status,
        detail: (patched.text || "").slice(0, 200),
      };
    }
    contactId =
      patched.json?.id ||
      patched.json?.data?.id ||
      email;
    isNew = false;
  }

  if (segmentId) {
    const segPath = contactId.includes("@")
      ? `/contacts/${encodeURIComponent(email)}/segments/${segmentId}`
      : `/contacts/${contactId}/segments/${segmentId}`;
    const seg = await resendFetch(apiKey, segPath, { method: "POST", body: "{}" });
    // 409 / already in segment is fine
    if (!seg.res.ok && seg.res.status !== 409 && seg.res.status !== 422) {
      // Try alternate path shape once
      const alt = await resendFetch(
        apiKey,
        `/contacts/${encodeURIComponent(email)}/segments/${segmentId}`,
        { method: "POST", body: "{}" },
      );
      if (!alt.res.ok && alt.res.status !== 409 && alt.res.status !== 422) {
        return {
          ok: false,
          status: alt.res.status,
          detail: (alt.text || "").slice(0, 200),
        };
      }
    }
  }

  return { ok: true, contactId: String(contactId), created: isNew };
}

/**
 * @param {{
 *   apiKey: string,
 *   email: string,
 *   from: string,
 *   replyTo?: string,
 *   postalAddress: string,
 *   unsubUrl: string,
 * }} opts
 */
export async function sendWelcomeEmail(opts) {
  const { apiKey, email, from, replyTo, postalAddress, unsubUrl } = opts;
  const lines = [
    "You're on Atoms Notes.",
    "",
    "Rare notes on the capture → recall → deepen loop - real workflows, not a feature dump. About once a month or less.",
    "",
    "Here's the idea in one beat: something lands (a text, a photo, a half-thought). You capture it. Atoms files it as a note you can find later - and, when you want, you deepen it (calendar, recap, ask).",
    "",
    "Try Atoms: https://tryatoms.app",
    "Setup guide: https://tryatoms.app/setup",
    "",
    `Unsubscribe: ${unsubUrl}`,
    "",
    postalAddress,
  ];
  const body = {
    from,
    to: [email],
    subject: "You're on Atoms Notes",
    text: lines.join("\n"),
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
    },
  };
  if (replyTo) body.reply_to = replyTo;

  const { res, text } = await resendFetch(apiKey, "/emails", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: text.slice(0, 200) };
  }
  return { ok: true };
}

/**
 * @param {{ apiKey: string, email: string }} opts
 */
export async function unsubscribeContact(opts) {
  const { apiKey, email } = opts;
  const { res, text } = await resendFetch(
    apiKey,
    `/contacts/${encodeURIComponent(email)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ unsubscribed: true }),
    },
  );
  if (!res.ok) {
    return { ok: false, status: res.status, detail: text.slice(0, 200) };
  }
  return { ok: true };
}
