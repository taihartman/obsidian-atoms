/**
 * Field notes email HTML + plain text.
 * Theme tokens match tryatoms.app (docs/design-handoff/tokens, www/src/styles.css).
 * Table layout + inline CSS only - email clients ignore stylesheets.
 * Prefer hosted PNG for illustrations (Gmail strips SVG); see docs/field-notes-email.md.
 *
 * Body model: prefer `blocks` (p / h2 / tldr / figure / loop) so notes are not a wall of text.
 * Legacy `paragraphs` + trailing diagram/figure still work.
 *
 * No in-message jump links. Gmail strips or rewrites `href="#anchor"`, so a
 * "Short version ↓" link is a dead link in the client most readers use. The
 * short version earns its keep by being read first, so `normalizeBlocks` hoists
 * `tldr` to the top and nothing links to it. See docs/field-notes-email.md.
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
  // Single quotes only. These stacks are interpolated into style="..." attributes,
  // so a double quote closes the attribute early and the whole font-family
  // declaration is dropped - which silently fell back to Times in every client.
  font: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  measure: "560px",
};

/**
 * @typedef {{
 *   type: 'p'|'h2'|'tldr',
 *   text?: string,
 *   lines?: string[],
 * } | { type: 'figure', src: string, alt: string, width?: number } | { type: 'loop' }} FieldNotesBlock
 *
 * Never use colored pull-quote / bookend cards. They read as AI template.
 * There is no `skip` type: jump links do not work in mail (see file header).
 */

/**
 * A short version placed after the long version is decoration, not a summary.
 * Hoisting it makes that unrepresentable no matter what order a draft uses.
 * @param {FieldNotesBlock[]} blocks
 * @returns {FieldNotesBlock[]}
 */
export function hoistTldrFirst(blocks) {
  const list = (blocks || []).filter(Boolean);
  const i = list.findIndex((b) => b?.type === "tldr");
  if (i <= 0) return list;
  return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}

/**
 * Prefer blocks. Fall back to paragraphs (+ optional trailing loop/figure).
 * @param {{ blocks?: FieldNotesBlock[], paragraphs?: string[], diagram?: string|null, figure?: object|null }} draft
 * @returns {FieldNotesBlock[]}
 */
export function normalizeBlocks(draft) {
  if (Array.isArray(draft?.blocks) && draft.blocks.length) {
    return hoistTldrFirst(draft.blocks);
  }
  /** @type {FieldNotesBlock[]} */
  const out = [];
  for (const p of draft?.paragraphs || []) {
    if (typeof p === "string" && p.length) out.push({ type: "p", text: p });
  }
  if (draft?.diagram === "loop") out.push({ type: "loop" });
  if (draft?.figure?.src && draft?.figure?.alt) {
    out.push({
      type: "figure",
      src: draft.figure.src,
      alt: draft.figure.alt,
      width: draft.figure.width,
    });
  }
  return out;
}

/** Plain-text lines from blocks (figures become [alt]). */
export function blocksToTextLines(blocks) {
  const lines = [];
  for (const b of blocks || []) {
    if (!b || !b.type) continue;
    if (b.type === "p" || b.type === "h2") {
      if (b.text) lines.push(String(b.text));
    } else if (b.type === "tldr") {
      lines.push("Short version");
      for (const line of b.lines || (b.text ? [b.text] : [])) {
        lines.push(String(line));
      }
    } else if (b.type === "figure" && b.alt) {
      lines.push(`[${b.alt}]`);
    } else if (b.type === "loop") {
      lines.push("Catch it → It is filed → It comes back");
    }
  }
  return lines;
}

/** First prose for preheader/tease. */
export function firstProseFromBlocks(blocks) {
  for (const b of blocks || []) {
    if (b?.type === "p" && b.text) return String(b.text);
  }
  return "";
}

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
 *
 * No frame around the image. Illustrations already draw their own dark plate
 * (www/src/email/*.svg), and wrapping that in a second bordered card inside the
 * letter card is the nested-box look that made the first set read as clip art.
 * @param {{ src: string, alt: string, width?: number }} opts
 */
export function figureHtml(opts) {
  const w = opts.width ?? 520;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0 26px;">
  <tr>
    <td align="center">
      <img src="${escapeAttr(opts.src)}" alt="${escapeHtml(opts.alt)}" width="${w}" style="display:block;max-width:100%;height:auto;border:0;border-radius:14px;" />
    </td>
  </tr>
</table>`;
}

/**
 * @param {FieldNotesBlock[]} blocks
 */
export function renderBlocksEmailHtml(blocks) {
  const t = EMAIL_THEME;
  const parts = [];
  for (const b of hoistTldrFirst(blocks)) {
    if (!b || !b.type) continue;
    if (b.type === "p" && b.text) {
      parts.push(
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${t.label};">${escapeHtml(b.text)}</p>`,
      );
    } else if (b.type === "h2" && b.text) {
      parts.push(
        `<h2 style="margin:34px 0 14px;font-size:17px;line-height:1.3;font-weight:600;color:${t.label};">${escapeHtml(b.text)}</h2>`,
      );
    } else if (b.type === "tldr") {
      const bodyLines = b.lines || (b.text ? [b.text] : []);
      const inner = bodyLines
        .map(
          (line) =>
            `<p style="margin:0 0 10px;font-size:15px;line-height:1.5;color:${t.muted};">${escapeHtml(line)}</p>`,
        )
        .join("");
      parts.push(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 26px;">
  <tr>
    <td style="padding:16px 18px;background:${t.elev};border-radius:12px;border:1px solid ${t.sep};">
      <div style="font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${t.faint};margin:0 0 10px;">Short version</div>
      ${inner}
    </td>
  </tr>
</table>`,
      );
    } else if (b.type === "figure" && b.src && b.alt) {
      parts.push(figureHtml({ src: b.src, alt: b.alt, width: b.width }));
    } else if (b.type === "loop") {
      parts.push(loopDiagramHtml());
    }
    // intentionally no pull/bookend renderer
  }
  return parts.join("\n");
}

/**
 * @param {{
 *   title: string,
 *   preheader?: string,
 *   blocks?: FieldNotesBlock[],
 *   paragraphs?: string[],
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
  const blocks = normalizeBlocks(opts);
  const preheader =
    opts.preheader || firstProseFromBlocks(blocks) || "";
  const body = renderBlocksEmailHtml(blocks);

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
              ${body}
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
 * @param {string[]} lines title + body lines
 * @param {{ unsubUrl: string, postalAddress: string, ctaLine?: string }} foot
 */
export function buildFieldNotesText(lines, foot) {
  const out = [...lines, ""];
  if (foot.ctaLine) out.push(foot.ctaLine, "");
  out.push(
    "---",
    `Unsubscribe: ${foot.unsubUrl}`,
    foot.postalAddress,
  );
  return out.join("\n");
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
    cta: { label: "Open tryatoms.app", href: "https://tryatoms.app" },
    secondaryHref: {
      label: "Setup guide",
      href: "https://tryatoms.app/setup",
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
      "Try Atoms: https://tryatoms.app",
      "Setup guide: https://tryatoms.app/setup",
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
