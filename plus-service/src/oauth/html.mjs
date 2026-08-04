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
<p>Connect Claude or ChatGPT to your <strong>Atoms Plus</strong> cloud atom mirror. Your Claude/ChatGPT account email does not need to match.</p>
${error ? `<p style="color:#b91c1c">${error}</p>` : ""}
<form method="POST" action="/oauth/authorize">
  <input type="hidden" name="pending_id" value="${esc(pendingId)}" />
  <input type="hidden" name="mode" value="email" />
  <label>Atoms Plus email<br><input name="email" type="email" required autocomplete="email" style="width:100%;padding:8px;margin:8px 0" placeholder="you@example.com" /></label>
  <button type="submit" style="margin-top:8px;padding:8px 16px">Email me a link</button>
</form>
<hr style="margin:1.5rem 0;border:none;border-top:1px solid #ddd" />
<p><strong>Or use a code from Obsidian</strong></p>
<p style="color:#666;font-size:0.9rem">In Obsidian: Settings → Atoms → Ask → <em>Link Claude / ChatGPT</em>. Paste the code here. Codes are secrets — do not share them.</p>
<form method="POST" action="/oauth/authorize">
  <input type="hidden" name="pending_id" value="${esc(pendingId)}" />
  <input type="hidden" name="mode" value="pair" />
  <label>Pairing code<br><input name="pair_code" type="text" inputmode="text" autocomplete="one-time-code" spellcheck="false" style="width:100%;padding:8px;margin:8px 0;font-family:ui-monospace,monospace;letter-spacing:0.08em" placeholder="XXXX-XXXX" /></label>
  <button type="submit" style="margin-top:8px;padding:8px 16px">Continue with code</button>
</form>
<p style="color:#666;font-size:0.9rem">Use the same browser for a magic-link email. Next step asks you to allow access.</p>`,
  );
}

/** When an OAuth browser session already exists (R5). */
export function authorizeChooserForm(pendingId, sessionEmail, error = "") {
  return htmlPage(
    "Atoms Ask — Choose account",
    `<h1>Atoms Ask</h1>
<p>This browser is signed in as <strong>${esc(sessionEmail)}</strong> (Atoms Plus).</p>
${error ? `<p style="color:#b91c1c">${error}</p>` : ""}
<form method="POST" action="/oauth/authorize" style="margin:1rem 0">
  <input type="hidden" name="pending_id" value="${esc(pendingId)}" />
  <input type="hidden" name="mode" value="continue" />
  <button type="submit" style="padding:8px 16px">Continue as ${esc(sessionEmail)}</button>
</form>
<form method="POST" action="/oauth/authorize" style="margin:1rem 0">
  <input type="hidden" name="pending_id" value="${esc(pendingId)}" />
  <input type="hidden" name="mode" value="pair" />
  <label>Use a code from Obsidian<br><input name="pair_code" type="text" style="width:100%;padding:8px;margin:8px 0;font-family:ui-monospace,monospace" placeholder="XXXX-XXXX" /></label>
  <button type="submit" style="padding:8px 16px">Continue with code</button>
</form>
<p style="color:#666;font-size:0.9rem">Open Obsidian → Settings → Atoms → Ask → Link Claude / ChatGPT if you need a code. Or use a different Atoms Plus email:</p>
<form method="POST" action="/oauth/authorize">
  <input type="hidden" name="pending_id" value="${esc(pendingId)}" />
  <input type="hidden" name="mode" value="email" />
  <label>Atoms Plus email<br><input name="email" type="email" required style="width:100%;padding:8px;margin:8px 0" /></label>
  <button type="submit" style="margin-top:8px;padding:8px 16px">Email me a link</button>
</form>`,
  );
}

export function consentForm(pendingId, email, clientLabel) {
  return htmlPage(
    "Atoms Ask — Allow access",
    `<h1>Allow Atoms Ask?</h1>
<p>Signed in as <strong>${esc(email)}</strong> (Atoms Plus account)</p>
<p>Client: <strong>${esc(clientLabel)}</strong></p>
<p><strong>Permissions (scopes)</strong></p>
<ul>
<li><code>atoms:read</code> — search &amp; fetch your cloud atom mirror (not the whole vault)</li>
<li><code>atoms:write</code> — queue new atoms via outbox; they land in Obsidian only after you enable <strong>Allow filing</strong> and the vault applies them. Does not rewrite existing note bodies.</li>
</ul>
<p style="color:#666;font-size:0.9rem">Tool results are sent to the AI provider (Anthropic or OpenAI) when you chat. Host can decrypt the mirror (not zero-knowledge).</p>
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
