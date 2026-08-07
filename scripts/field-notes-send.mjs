#!/usr/bin/env node
/**
 * Send a Field notes email (test) or audience Broadcast via Resend.
 *
 * Usage:
 *   RESEND_API_KEY=re_... node scripts/field-notes-send.mjs test --to you@x.com --draft path.json
 *   RESEND_API_KEY=re_... node scripts/field-notes-send.mjs broadcast --draft path.json --confirm
 *
 * Draft JSON shape:
 * {
 *   "subject": "string",
 *   "title": "string",           // H1 in HTML
 *   "preheader": "string?",
 *   "blocks": [                  // preferred: sections + figures inline
 *     { "type": "p", "text": "..." },
 *     { "type": "h2", "text": "Section" },
 *     { "type": "figure", "src": "https://tryatoms.app/email/foo.png", "alt": "..." },
 *     { "type": "tldr", "lines": ["...", "..."] },
 *     { "type": "loop" }
 *   ],
 *   // never use pull/bookend quote cards
 *   "paragraphs": ["..."],       // legacy flat body (still ok)
 *   "diagram": "loop" | null,    // legacy trailing only
 *   "figure": { "src": "https://...", "alt": "..." } | null,
 *   "cta": { "label": "...", "href": "..." } | null,
 *   "secondaryHref": { "label": "...", "href": "..." } | null
 * }
 *
 * Env (or flags):
 *   RESEND_API_KEY (required)
 *   ATOMS_NOTES_FROM (default Field notes <notes@mail.tryatoms.app>)
 *   ATOMS_NOTES_REPLY_TO
 *   ATOMS_NOTES_POSTAL_ADDRESS (required)
 *   RESEND_MARKETING_SEGMENT_ID (required for broadcast)
 *
 * Pull key from Fly if missing:
 *   fly ssh console -a atoms-plus -C 'printenv RESEND_API_KEY'
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  blocksToTextLines,
  buildFieldNotesHtml,
  buildFieldNotesText,
  normalizeBlocks,
} from "../www/functions/_lib/fieldNotesEmail.mjs";
import { promoteDraftToPublished } from "../www/lib/fieldNotesContent.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const publishedDir = join(root, "docs/field-notes/published");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function resend(path, init, apiKey) {
  const res = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { res, json, text };
}

function loadDraft(path) {
  const raw = readFileSync(path, "utf8");
  const d = JSON.parse(raw);
  if (!d.subject || !d.title) {
    throw new Error("draft needs subject, title");
  }
  const blocks = normalizeBlocks(d);
  const hasProse = blocks.some(
    (b) =>
      ((b.type === "p" || b.type === "h2") && b.text) ||
      (b.type === "tldr" && (b.text || (b.lines && b.lines.length))),
  );
  if (!hasProse) {
    throw new Error("draft needs blocks[] or paragraphs[] with prose");
  }
  return d;
}

function buildBodies(draft, unsubUrl, postal) {
  const blocks = normalizeBlocks(draft);
  const html = buildFieldNotesHtml({
    title: draft.title,
    preheader: draft.preheader,
    blocks,
    cta: draft.cta || {
      label: "Open tryatoms.app",
      href: "https://tryatoms.app",
    },
    secondaryHref: draft.secondaryHref || null,
    unsubUrl,
    postalAddress: postal,
  });
  const text = buildFieldNotesText(
    [draft.title, "", ...blocksToTextLines(blocks)],
    {
      unsubUrl,
      postalAddress: postal,
      ctaLine: draft.cta
        ? `${draft.cta.label}: ${draft.cta.href}`
        : "https://tryatoms.app",
    },
  );
  return { html, text };
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "test" && mode !== "broadcast" && mode !== "preview") {
    console.error(`Usage:
  node scripts/field-notes-send.mjs preview --draft file.json [--out preview.html]
  node scripts/field-notes-send.mjs test --to email --draft file.json
  node scripts/field-notes-send.mjs broadcast --draft file.json --confirm`);
    process.exit(1);
  }

  const draftPath = arg("--draft");
  if (!draftPath) {
    console.error("Need --draft path.json");
    process.exit(1);
  }

  // Preview writes the exact bodies a send would, with no key and no network,
  // so the letter can be judged in a browser before anyone's inbox sees it.
  if (mode === "preview") {
    const draft = loadDraft(draftPath);
    const { html, text } = buildBodies(
      draft,
      "https://tryatoms.app/api/unsubscribe?e=preview&t=preview",
      process.env.ATOMS_NOTES_POSTAL_ADDRESS ||
        "Taitopia, 1029 Lyell Ave Unit #740, Rochester, NY 14606",
    );
    const out = arg("--out", "preview-field-note.html");
    writeFileSync(out, html);
    writeFileSync(out.replace(/\.html$/, "") + ".txt", text);
    console.log(`subject: ${draft.subject}`);
    console.log(`html:    ${out}`);
    console.log(`text:    ${out.replace(/\.html$/, "")}.txt`);
    return;
  }

  let apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY missing. Export it or: fly ssh console -a atoms-plus -C 'printenv RESEND_API_KEY'");
    process.exit(1);
  }

  const from =
    process.env.ATOMS_NOTES_FROM || "Field notes <notes@mail.tryatoms.app>";
  const replyTo =
    process.env.ATOMS_NOTES_REPLY_TO || "taihartmandevelopment@gmail.com";
  const postal = process.env.ATOMS_NOTES_POSTAL_ADDRESS;
  if (!postal) {
    console.error("ATOMS_NOTES_POSTAL_ADDRESS required (CAN-SPAM footer)");
    process.exit(1);
  }
  const segmentId = process.env.RESEND_MARKETING_SEGMENT_ID;

  const draft = loadDraft(draftPath);

  if (mode === "test") {
    const to = arg("--to");
    if (!to) {
      console.error("test mode needs --to email");
      process.exit(1);
    }
    // Placeholder unsub for test (still a valid URL shape)
    const unsubUrl = `https://tryatoms.app/api/unsubscribe?e=${encodeURIComponent(to)}&t=test`;
    const { html, text } = buildBodies(draft, unsubUrl, postal);
    const body = {
      from,
      to: [to],
      reply_to: replyTo,
      subject: draft.subject,
      html,
      text,
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
      },
    };
    const { res, json, text: err } = await resend(
      "/emails",
      { method: "POST", body: JSON.stringify(body) },
      apiKey,
    );
    if (!res.ok) {
      console.error("send failed", res.status, err.slice(0, 400));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, mode: "test", to, id: json?.id }, null, 2));
    return;
  }

  // broadcast
  if (!hasFlag("--confirm")) {
    console.error("broadcast requires --confirm (sends to whole segment)");
    process.exit(1);
  }
  if (!segmentId) {
    console.error("RESEND_MARKETING_SEGMENT_ID required for broadcast");
    process.exit(1);
  }

  // Resend Broadcast HTML uses {{{RESEND_UNSUBSCRIBE_URL}}}
  const unsubPlaceholder = "{{{RESEND_UNSUBSCRIBE_URL}}}";
  const { html, text } = buildBodies(draft, unsubPlaceholder, postal);

  const createBody = {
    segment_id: segmentId,
    from,
    reply_to: replyTo,
    subject: draft.subject,
    html,
    text,
    name: draft.subject.slice(0, 80),
  };

  const created = await resend(
    "/broadcasts",
    { method: "POST", body: JSON.stringify(createBody) },
    apiKey,
  );
  if (!created.res.ok) {
    console.error("create broadcast failed", created.res.status, created.text.slice(0, 500));
    process.exit(1);
  }
  const bid = created.json?.id || created.json?.data?.id;
  if (!bid) {
    console.error("no broadcast id", created.json);
    process.exit(1);
  }

  const sent = await resend(
    `/broadcasts/${bid}/send`,
    { method: "POST", body: JSON.stringify({}) },
    apiKey,
  );
  if (!sent.res.ok) {
    console.error("send broadcast failed", sent.res.status, sent.text.slice(0, 500));
    process.exit(1);
  }

  let publishedPath = null;
  try {
    const draftPath = arg("--draft");
    const { filename, note } = promoteDraftToPublished(draft, basename(draftPath));
    mkdirSync(publishedDir, { recursive: true });
    publishedPath = join(publishedDir, filename);
    writeFileSync(publishedPath, JSON.stringify(note, null, 2) + "\n", "utf8");
  } catch (e) {
    console.error(
      "broadcast sent but publish to docs/field-notes/published/ failed:",
      e?.message || e,
    );
    console.error(
      "Email is live. Fix the draft filename (YYYY-MM-DD-<slug>.json), re-run promote, commit, and deploy master so /notes/ updates.",
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "broadcast",
        broadcast_id: bid,
        segment_id: segmentId,
        published: publishedPath,
        next: "Commit published JSON, merge to master (Pages deploy), then verify https://tryatoms.app/notes/<slug>/",
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
