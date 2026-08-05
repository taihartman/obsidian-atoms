/**
 * Field notes email HTML + plain text.
 * Theme tokens match tryatoms.app (docs/design-handoff/tokens, www/src/styles.css).
 * Table layout + inline CSS only - email clients ignore stylesheets.
 * Prefer hosted PNG for illustrations (Gmail strips SVG); see docs/field-notes-email.md.
 */

export const EMAIL_THEME = {
  bg: "#000000",
  surface: "#1c1c1e",
  elev: "#2c2c2e",
  label: "#ffffff",
  muted: "rgba(235, 235, 245, 0.72)",
  faint: "rgba(235, 235, 245, 0.55)",
  tint: "#0a84ff",
  sep: "rgba(84, 84, 88, 0.55)",
  ok: "#30d158",
  person: "#ff9f0a",
  font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  measure: "560px",
};

/**
 * Simple capture → remember loop as table cells (no images; works in Gmail).
 */
export function loopDiagramHtml() {
  const t = EMAIL_THEME;
  const cell = (title, sub) =>
    `<td align="center" valign="top" style="width:33%;padding:12px 8px;background:${t.elev};border-radius:12px;">
      <div style="font-size:13px;font-weight:600;color:${t.label};line-height:1.3;">${title}</div>
      <div style="font-size:12px;color:${t.muted};margin-top:6px;line-height:1.35;">${sub}</div>
    </td>`;
  const arrow =
    `<td align="center" valign="middle" style="width:4%;padding:0 2px;color:${t.tint};font-size:18px;">→</td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 28px;">
  <tr>
    ${cell("Catch it", "Five seconds. Walk, share sheet, one line.")}
    ${arrow}
    ${cell("It is filed", "Own note. Links. Your words unchanged.")}
    ${arrow}
    ${cell("It comes back", "When it matters. Ask. Resurface.")}
  </tr>
</table>`;
}

/**
 * Optional illustration block. Prefer absolute HTTPS PNG on tryatoms.app.
 * @param {{ src: string, alt: string, width?: number }} opts
 */
export function figureHtml(opts) {
  const t = EMAIL_THEME;
  const w = opts.width ?? 520;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
  <tr>
    <td align="center" style="background:${t.surface};border-radius:16px;padding:16px;border:1px solid ${t.sep};">
      <img src="${opts.src}" alt="${escapeHtml(opts.alt)}" width="${w}" style="display:block;max-width:100%;height:auto;border:0;border-radius:12px;" />
    </td>
  </tr>
</table>`;
}

/**
 * @param {{
 *   title: string,
 *   preheader?: string,
 *   paragraphs: string[],
 *   cta?: { label: string, href: string },
 *   secondaryHref?: { label: string, href: string },
 *   unsubUrl: string,
 *   postalAddress: string,
 *   diagram?: 'loop' | null,
 *   figure?: { src: string, alt: string, width?: number } | null,
 * }} opts
 */
export function buildFieldNotesHtml(opts) {
  const t = EMAIL_THEME;
  const preheader = opts.preheader || opts.paragraphs[0] || "";
  const paras = opts.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${t.label};">${escapeHtml(p)}</p>`,
    )
    .join("\n");

  const diagram =
    opts.diagram === "loop"
      ? loopDiagramHtml()
      : opts.figure
        ? figureHtml(opts.figure)
        : "";

  const cta = opts.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px;">
  <tr>
    <td align="center" style="border-radius:980px;background:${t.tint};">
      <a href="${escapeAttr(opts.cta.href)}" style="display:inline-block;padding:14px 24px;font-size:15px;font-weight:600;color:#fff;text-decoration:none;border-radius:980px;">${escapeHtml(opts.cta.label)}</a>
    </td>
  </tr>
</table>`
    : "";

  const secondary = opts.secondaryHref
    ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;text-align:center;"><a href="${escapeAttr(opts.secondaryHref.href)}" style="color:${t.tint};text-decoration:none;">${escapeHtml(opts.secondaryHref.label)}</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${escapeHtml(opts.title)}</title>
<!--[if mso]><style>body,table,td{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${t.bg};color:${t.label};font-family:${t.font};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${t.bg};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:${t.measure};">
          <tr>
            <td style="padding:0 0 20px;">
              <span style="font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${t.faint};">Field notes</span>
              <span style="font-size:12px;color:${t.faint};"> · Atoms</span>
            </td>
          </tr>
          <tr>
            <td style="background:${t.surface};border-radius:16px;padding:28px 24px;border:1px solid ${t.sep};">
              <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;font-weight:600;color:${t.label};">${escapeHtml(opts.title)}</h1>
              ${paras}
              ${diagram}
              ${cta}
              ${secondary}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 8px 0;font-size:12px;line-height:1.5;color:${t.faint};">
              <p style="margin:0 0 8px;">You are getting this because you joined Field notes on tryatoms.app.</p>
              <p style="margin:0 0 8px;"><a href="${escapeAttr(opts.unsubUrl)}" style="color:${t.muted};">Unsubscribe</a></p>
              <p style="margin:0;">${escapeHtml(opts.postalAddress)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * @param {string[]} paragraphs
 * @param {{ unsubUrl: string, postalAddress: string, ctaLine?: string }} foot
 */
export function buildFieldNotesText(paragraphs, foot) {
  const lines = [...paragraphs, ""];
  if (foot.ctaLine) lines.push(foot.ctaLine, "");
  lines.push(
    "---",
    `Unsubscribe: ${foot.unsubUrl}`,
    foot.postalAddress,
  );
  return lines.join("\n");
}

export function welcomeEmailContent(opts) {
  const { unsubUrl, postalAddress } = opts;
  // Keep welcome close to one-to-one mail: one idea, one diagram, one link.
  // Big promo blocks and link farms push Gmail toward Promotions (not guaranteed either way).
  const paragraphs = [
    "Thanks for joining Field notes.",
    "This is the occasional letter about a second brain you actually use: the five-second capture on a morning walk, and remembering it when it matters later. Obsidian, Claude, the hooks that make it stick. How other people run it too.",
    "Not a drip. Not a changelog. When something is worth saying, you will hear from us.",
    "Want to be featured? Just reply to this email and show how you use Atoms day to day. Clear stories may show up in a future note. We will ask before using your name.",
  ];
  const html = buildFieldNotesHtml({
    title: "You are on Field notes",
    preheader: "Thanks for joining. Rare notes on a second brain in real life.",
    paragraphs,
    diagram: "loop",
    // Text link, not a big sales button - slightly less "promo template"
    secondaryHref: {
      label: "tryatoms.app",
      href: "https://tryatoms.app",
    },
    unsubUrl,
    postalAddress,
  });
  const text = buildFieldNotesText(
    [
      "You are on Field notes.",
      "",
      ...paragraphs,
      "",
      "Catch it → It is filed → It comes back",
      "",
      "https://tryatoms.app",
    ],
    {
      unsubUrl,
      postalAddress,
    },
  );
  return {
    // Personal, short - avoid "newsletter / subscribe / offer" vibes in subject
    subject: "You are on Field notes",
    html,
    text,
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
