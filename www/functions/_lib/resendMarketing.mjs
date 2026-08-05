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
 * @returns {Promise<
 *   | { ok: true, contactId: string, sendWelcome: boolean }
 *   | { ok: false, status: number, detail: string }
 * >}
 */
export async function upsertMarketingContact(opts) {
  const { apiKey, email, segmentId } = opts;
  const emailPath = `/contacts/${encodeURIComponent(email)}`;

  const existing = await resendFetch(apiKey, emailPath, { method: "GET" });
  let contactId = existing.json?.id || existing.json?.data?.id;
  let wasUnsubscribed = Boolean(
    existing.json?.unsubscribed ?? existing.json?.data?.unsubscribed,
  );
  let sendWelcome = false;

  if (existing.res.ok && contactId) {
    if (wasUnsubscribed) {
      const patched = await resendFetch(apiKey, emailPath, {
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
      sendWelcome = true;
    }
  } else {
    const created = await resendFetch(apiKey, "/contacts", {
      method: "POST",
      body: JSON.stringify({
        email,
        unsubscribed: false,
      }),
    });
    if (!created.res.ok) {
      // Race: created elsewhere - try patch
      const patched = await resendFetch(apiKey, emailPath, {
        method: "PATCH",
        body: JSON.stringify({ unsubscribed: false }),
      });
      if (!patched.res.ok) {
        return {
          ok: false,
          status: created.res.status,
          detail: (created.text || "").slice(0, 200),
        };
      }
      contactId = patched.json?.id || patched.json?.data?.id || email;
      sendWelcome = true;
    } else {
      contactId = created.json?.id || created.json?.data?.id || email;
      sendWelcome = true;
    }
  }

  if (segmentId) {
    const idForPath =
      contactId && !String(contactId).includes("@")
        ? contactId
        : encodeURIComponent(email);
    const segPath = String(contactId).includes("@")
      ? `/contacts/${encodeURIComponent(email)}/segments/${segmentId}`
      : `/contacts/${idForPath}/segments/${segmentId}`;
    const seg = await resendFetch(apiKey, segPath, {
      method: "POST",
      body: "{}",
    });
    if (!seg.res.ok && seg.res.status !== 409 && seg.res.status !== 422) {
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

  return {
    ok: true,
    contactId: String(contactId || email),
    sendWelcome,
  };
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
    "You're on Field notes.",
    "",
    "This list is about a second brain you actually use: the five-second capture on a morning walk, and remembering it when it matters later. How people run that in real life - Obsidian, Claude, the hooks that make it stick. How others do it too.",
    "",
    "When something is worth saying, we'll write. Not a drip. Not a changelog.",
    "",
    "And we want yours: reply to any note with how you capture, remember, and expand. The best of that becomes the list.",
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
    subject: "You're on Field notes",
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
