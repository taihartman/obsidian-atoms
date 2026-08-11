import { escHtml, renderPage } from "../html/shell.mjs";

function htmlPage(title, bodyInner) {
  return renderPage({
    title,
    eyebrow: "Atoms Ask",
    bodyHtml: bodyInner,
  });
}

export function authorizeEmailForm(pendingId, error = "") {
  return htmlPage(
    "Atoms Ask — Sign in",
    `<h1>Atoms Ask</h1>
<p>Connect Claude or ChatGPT to your <strong>Atoms Plus</strong> cloud atom mirror. Your Claude/ChatGPT account email does not need to match.</p>
${error ? `<p class="error">${escHtml(error)}</p>` : ""}
<form method="POST" action="/oauth/authorize">
  <input type="hidden" name="pending_id" value="${escHtml(pendingId)}" />
  <input type="hidden" name="mode" value="email" />
  <label class="field">Atoms Plus email
    <input name="email" type="email" required autocomplete="email" placeholder="you@example.com" />
  </label>
  <button type="submit" class="btn btn--primary">Email me a link</button>
</form>
<hr />
<p><strong>Or use a code from Obsidian</strong></p>
<p class="muted">In Obsidian: Settings → Atoms → Ask → <em>Link Claude / ChatGPT</em>. Paste the code here. Codes are secrets — do not share them.</p>
<form method="POST" action="/oauth/authorize">
  <input type="hidden" name="pending_id" value="${escHtml(pendingId)}" />
  <input type="hidden" name="mode" value="pair" />
  <label class="field">Pairing code
    <input class="mono" name="pair_code" type="text" inputmode="text" autocomplete="one-time-code" spellcheck="false" placeholder="XXXX-XXXX" />
  </label>
  <button type="submit" class="btn btn--primary">Continue with code</button>
</form>
<p class="muted">Use the same browser for a magic-link email. Next step asks you to allow access.</p>`,
  );
}

/** When an OAuth browser session already exists (R5). */
export function authorizeChooserForm(pendingId, sessionEmail, error = "") {
  return htmlPage(
    "Atoms Ask — Choose account",
    `<h1>Atoms Ask</h1>
<p>This browser is signed in as <strong>${escHtml(sessionEmail)}</strong> (Atoms Plus).</p>
${error ? `<p class="error">${escHtml(error)}</p>` : ""}
<form method="POST" action="/oauth/authorize" class="stack">
  <input type="hidden" name="pending_id" value="${escHtml(pendingId)}" />
  <input type="hidden" name="mode" value="continue" />
  <button type="submit" class="btn btn--primary">Continue as ${escHtml(sessionEmail)}</button>
</form>
<form method="POST" action="/oauth/authorize" class="stack">
  <input type="hidden" name="pending_id" value="${escHtml(pendingId)}" />
  <input type="hidden" name="mode" value="pair" />
  <label class="field">Use a code from Obsidian
    <input class="mono" name="pair_code" type="text" placeholder="XXXX-XXXX" />
  </label>
  <button type="submit" class="btn btn--secondary">Continue with code</button>
</form>
<p class="muted">Open Obsidian → Settings → Atoms → Ask → Link Claude / ChatGPT if you need a code. Or use a different Atoms Plus email:</p>
<form method="POST" action="/oauth/authorize">
  <input type="hidden" name="pending_id" value="${escHtml(pendingId)}" />
  <input type="hidden" name="mode" value="email" />
  <label class="field">Atoms Plus email
    <input name="email" type="email" required />
  </label>
  <button type="submit" class="btn btn--secondary">Email me a link</button>
</form>`,
  );
}

export function consentForm(pendingId, email, clientLabel) {
  return htmlPage(
    "Atoms Ask — Allow access",
    `<h1>Allow Atoms Ask?</h1>
<p>Signed in as <strong>${escHtml(email)}</strong> (Atoms Plus account)</p>
<p>Client: <strong>${escHtml(clientLabel)}</strong></p>
<p><strong>Permissions (scopes)</strong></p>
<ul>
<li><code>atoms:read</code> — search &amp; fetch your cloud atom mirror (not the whole vault)</li>
<li><code>atoms:write</code> — queue new atoms via outbox; they land in Obsidian only after you enable <strong>Allow filing</strong> and the vault applies them. Does not rewrite existing note bodies.</li>
</ul>
<p class="muted">Tool results are sent to the AI provider (Anthropic or OpenAI) when you chat. Host can decrypt the mirror (not zero-knowledge).</p>
<form method="POST" action="/oauth/consent" class="stack">
  <input type="hidden" name="pending_id" value="${escHtml(pendingId)}" />
  <button type="submit" name="decision" value="allow" class="btn btn--primary">Allow</button>
  <button type="submit" name="decision" value="deny" class="btn btn--secondary">Deny</button>
</form>`,
  );
}

export function simpleMessage(title, msg) {
  return htmlPage(title, `<h1>${escHtml(title)}</h1><p>${escHtml(msg)}</p>`);
}
