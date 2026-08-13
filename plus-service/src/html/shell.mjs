/**
 * Shared first-party browser HTML shell for plus-service.
 * Token hexes track www/src/styles.css (:root + light scheme + .btn*).
 */

/** Landing / magic-link pages — forms only post same-origin. */
export const HTML_SECURITY_HEADERS = Object.freeze({
  "content-type": "text/html; charset=utf-8",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
});

/**
 * OAuth authorize/consent HTML. Consent Allow ends in a 302 to Claude/ChatGPT
 * (or loopback). CSP Level 3 applies form-action to that redirect chain; with
 * only 'self', the browser completes Allow server-side then refuses to leave
 * plus.tryatoms.app — first click looks dead, second Allow is Expired (pending
 * already deleted). Allow connector hosts that isAllowedRedirectUri accepts.
 */
export const OAUTH_HTML_SECURITY_HEADERS = Object.freeze({
  ...HTML_SECURITY_HEADERS,
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai https://chatgpt.com https://grok.com http://127.0.0.1:* http://localhost:* https://localhost:* http://[::1]:* https://[::1]:*",
});

export function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SHELL_CSS = `
:root{
  --bg:#000;
  --surface:#1c1c1e;
  --elev:#2c2c2e;
  --sep:rgba(84,84,88,.55);
  --sep-soft:rgba(84,84,88,.35);
  --label:#fff;
  --muted:rgba(235,235,245,.6);
  --faint:rgba(235,235,245,.5);
  --tint:#0a84ff;
  --tint-ink:#0a84ff;
  --error:#ff453a;
  --font-ui:-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display',system-ui,sans-serif;
  --font-mono:ui-monospace,SFMono-Regular,'SF Mono',Menlo,monospace;
  --r-md:12px;
  --r-lg:16px;
  --measure:32rem;
  --gutter:20px;
}
@media (prefers-color-scheme:light){
  :root{
    --bg:#f2f2f7;
    --surface:#fff;
    --elev:#e9e9ee;
    --sep:rgba(60,60,67,.29);
    --sep-soft:rgba(60,60,67,.16);
    --label:#000;
    --muted:rgba(60,60,67,.78);
    --faint:rgba(60,60,67,.74);
    --tint-ink:color-mix(in srgb,#0a84ff 82%,black);
    --error:color-mix(in srgb,#ff453a 82%,black);
  }
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;
  min-height:100vh;
  background:var(--bg);
  color:var(--label);
  font-family:var(--font-ui);
  font-size:1rem;
  line-height:1.45;
  -webkit-font-smoothing:antialiased;
}
.shell{
  max-width:var(--measure);
  margin:0 auto;
  padding:calc(var(--gutter) + 8px) var(--gutter) 2.5rem;
}
.card{
  background:var(--surface);
  border:1px solid var(--sep);
  border-radius:var(--r-lg);
  padding:18px 18px 20px;
}
.eyebrow{
  margin:0 0 8px;
  font-size:.72rem;
  font-weight:600;
  letter-spacing:.12em;
  text-transform:uppercase;
  color:var(--muted);
}
h1{
  margin:0 0 12px;
  font-size:1.35rem;
  font-weight:700;
  letter-spacing:-.03em;
  line-height:1.25;
}
h2{
  margin:0 0 8px;
  font-size:1rem;
  font-weight:650;
  letter-spacing:-.015em;
}
p{margin:0 0 12px}
p:last-child{margin-bottom:0}
.muted,.note{color:var(--muted);font-size:.9rem}
.error{color:var(--error);margin:0 0 12px}
a{color:var(--tint-ink)}
ul{margin:0 0 12px;padding-left:1.2rem}
li{margin:0 0 6px}
hr{
  border:none;
  border-top:1px solid var(--sep);
  margin:1.25rem 0;
}
.stack{display:flex;flex-direction:column;gap:10px;margin:12px 0}
.stack--tight{gap:8px}
.btn{
  display:flex;
  align-items:center;
  justify-content:center;
  width:100%;
  min-height:44px;
  padding:12px 16px;
  border-radius:var(--r-md);
  border:1px solid transparent;
  font-family:inherit;
  font-size:1rem;
  font-weight:600;
  letter-spacing:-.01em;
  text-align:center;
  text-decoration:none;
  cursor:pointer;
  -webkit-appearance:none;
  appearance:none;
  transition:opacity 130ms ease,transform 130ms ease;
}
.btn:active{transform:scale(.98);opacity:.92}
.btn--primary{background:var(--tint);color:#fff;border-color:transparent}
.btn--secondary{
  background:var(--elev);
  color:var(--label);
  border-color:var(--sep-soft);
}
.field{display:block;margin:0 0 12px;font-size:.95rem}
.field input{
  display:block;
  width:100%;
  margin-top:6px;
  min-height:44px;
  padding:10px 12px;
  border:1px solid var(--sep);
  border-radius:var(--r-md);
  background:var(--elev);
  color:var(--label);
  font-family:inherit;
  font-size:16px;
  line-height:1.3;
}
.field input::placeholder{color:var(--faint)}
.field input[type=text],.field input.mono{
  font-family:var(--font-mono);
  letter-spacing:.06em;
}
.token-block{
  margin:12px 0;
  padding:12px 14px;
  border-radius:var(--r-md);
  background:var(--elev);
  border:1px solid var(--sep-soft);
  font-family:var(--font-mono);
  font-size:.85rem;
  line-height:1.4;
  word-break:break-all;
  -webkit-user-select:all;
  user-select:all;
}
details{margin-top:1.25rem}
summary{
  cursor:pointer;
  color:var(--muted);
  min-height:44px;
  display:flex;
  align-items:center;
}
details ul{margin-top:8px;color:var(--muted);font-size:.95rem}
#fallback{
  margin-top:1.25rem;
  padding-top:1rem;
  border-top:1px solid var(--sep);
}
code{
  font-family:var(--font-mono);
  font-size:.9em;
}
`.replace(/\n/g, "");

/**
 * @param {{ title: string, eyebrow?: string, bodyHtml: string }} opts
 */
export function renderPage({ title, eyebrow = "", bodyHtml }) {
  const t = escHtml(title || "Atoms");
  const brow = eyebrow
    ? `<p class="eyebrow">${escHtml(eyebrow)}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<style>${SHELL_CSS}</style>
</head>
<body>
<main class="shell">
<div class="card">
${brow}
${bodyHtml}
</div>
</main>
</body>
</html>`;
}
