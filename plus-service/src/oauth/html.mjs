export function htmlPage(title, bodyInner) {
  return `<!doctype html><meta charset=utf-8><title>${title}</title>
<body style="font-family:system-ui;max-width:28rem;margin:2rem auto;padding:0 1rem;line-height:1.45">
${bodyInner}
</body>`;
}

export function authorizeEmailForm(pendingId, error = "") {
  return htmlPage(
    "Atoms Ask — Sign in",
    `<h1>Atoms Ask</h1>
<p>Sign in with your Atoms Plus email to allow Claude to <strong>read</strong> your mirrored atoms.</p>
${error ? `<p style="color:#b91c1c">${error}</p>` : ""}
<form method="POST" action="/oauth/authorize">
  <input type="hidden" name="pending_id" value="${esc(pendingId)}" />
  <label>Email<br><input name="email" type="email" required style="width:100%;padding:8px;margin:8px 0" /></label>
  <button type="submit" style="margin-top:8px;padding:8px 16px">Email me a link</button>
</form>
<p style="color:#666;font-size:0.9rem">Use the same browser for the email link. Read-only — no vault writes.</p>`,
  );
}

export function consentForm(pendingId, email, clientLabel) {
  return htmlPage(
    "Atoms Ask — Allow access",
    `<h1>Allow Atoms Ask?</h1>
<p>Signed in as <strong>${esc(email)}</strong></p>
<p>Client: <strong>${esc(clientLabel)}</strong></p>
<p>Permissions: search &amp; fetch of your cloud atom mirror; optional <strong>queue new atoms</strong> (outbox) when you enable Allow filing in Obsidian. Writes land only after your vault applies them.</p>
<form method="POST" action="/oauth/consent">
  <input type="hidden" name="pending_id" value="${esc(pendingId)}" />
  <button type="submit" name="decision" value="allow" style="padding:8px 16px">Allow</button>
  <button type="submit" name="decision" value="deny" style="padding:8px 16px;margin-left:8px">Deny</button>
</form>`,
  );
}

export function simpleMessage(title, msg) {
  return htmlPage(title, `<h1>${esc(title)}</h1><p>${esc(msg)}</p>`);
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
