/**
 * Field notes published JSON → web-safe fragments (build + tests).
 * Not for Pages Functions runtime. Email HTML stays in fieldNotesEmail.mjs.
 */

import { readdirSync, readFileSync } from "fs";
import { basename, join } from "path";

export const PUBLISHED_BASENAME_RE =
  /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;

export const PUBLIC_NOTE_KEYS = new Set([
  "subject",
  "title",
  "preheader",
  "paragraphs",
  "diagram",
  "figure",
  "cta",
  "secondaryHref",
  "slug",
  "date",
  "tease",
]);

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

export function parsePublishedBasename(name) {
  const m = String(name).match(PUBLISHED_BASENAME_RE);
  if (!m) return null;
  return { date: m[1], slug: m[2], filename: name };
}

export function isSafeSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

/** Root-relative path under site root, or tryatoms.app absolute → path. */
export function normalizeFigureSrc(src) {
  if (typeof src !== "string" || !src.trim()) return null;
  const s = src.trim();
  if (s.startsWith("/") && !s.startsWith("//") && !s.includes("..")) {
    return s;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.hostname !== "tryatoms.app" && u.hostname !== "www.tryatoms.app") {
      return null;
    }
    const path = u.pathname || "/";
    if (path.includes("..")) return null;
    return path;
  } catch {
    return null;
  }
}

export function pickPublicFields(obj) {
  const out = {};
  for (const k of PUBLIC_NOTE_KEYS) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/**
 * @param {string} filePath
 * @param {string} filename basename
 */
export function loadPublishedFile(filePath, filename) {
  const meta = parsePublishedBasename(filename);
  if (!meta || !isSafeSlug(meta.slug)) {
    throw new Error(`invalid published basename: ${filename}`);
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  if (!raw.title || !Array.isArray(raw.paragraphs) || !raw.paragraphs.length) {
    throw new Error(`invalid published note (title/paragraphs): ${filename}`);
  }
  const note = pickPublicFields(raw);
  note.slug = meta.slug;
  note.date = meta.date;
  note.filename = filename;
  if (!note.tease && note.preheader) note.tease = note.preheader;
  if (!note.tease && note.paragraphs[0]) {
    note.tease = String(note.paragraphs[0]).slice(0, 160);
  }
  return note;
}

/**
 * @param {string} dir
 * @returns {object[]}
 */
export function loadPublishedNotes(dir) {
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json") && !n.startsWith("."));
  } catch {
    return [];
  }
  const notes = [];
  for (const name of names) {
    if (!parsePublishedBasename(name)) continue;
    try {
      notes.push(loadPublishedFile(join(dir, name), name));
    } catch {
      // skip invalid
    }
  }
  notes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return notes;
}

function loopDiagramWebHtml() {
  return `<div class="notes-loop" role="img" aria-label="Three-step capture loop: Catch it, It is filed, It comes back">
  <div class="notes-loop-step"><strong>Catch it</strong><span>Five seconds. Walk, share sheet, one line.</span></div>
  <div class="notes-loop-arrow" aria-hidden="true">→</div>
  <div class="notes-loop-step"><strong>It is filed</strong><span>Own note. Links. Your words unchanged.</span></div>
  <div class="notes-loop-arrow" aria-hidden="true">→</div>
  <div class="notes-loop-step"><strong>It comes back</strong><span>When it matters. Ask. Resurface.</span></div>
</div>`;
}

/**
 * @param {object} note
 * @returns {string}
 */
export function renderNoteBodyHtml(note) {
  const parts = [];
  for (const p of note.paragraphs || []) {
    parts.push(`<p class="notes-p">${escapeHtml(p)}</p>`);
  }
  if (note.diagram === "loop") {
    parts.push(loopDiagramWebHtml());
  }
  if (note.figure && note.figure.alt) {
    const src = normalizeFigureSrc(note.figure.src);
    if (src) {
      parts.push(
        `<figure class="notes-figure"><img src="${escapeAttr(src)}" alt="${escapeAttr(note.figure.alt)}" width="720" height="auto" loading="lazy" /></figure>`,
      );
    }
  }
  if (note.cta && note.cta.label && note.cta.href) {
    const href = normalizeCtaHref(note.cta.href);
    if (href) {
      parts.push(
        `<p class="notes-cta"><a class="btn btn--primary" href="${escapeAttr(href)}">${escapeHtml(note.cta.label)}</a></p>`,
      );
    }
  }
  if (note.secondaryHref && note.secondaryHref.label && note.secondaryHref.href) {
    const href = normalizeCtaHref(note.secondaryHref.href);
    if (href) {
      parts.push(
        `<p class="notes-secondary"><a href="${escapeAttr(href)}">${escapeHtml(note.secondaryHref.label)}</a></p>`,
      );
    }
  }
  return parts.join("\n");
}

function normalizeCtaHref(href) {
  if (typeof href !== "string") return null;
  const s = href.trim();
  if (s.startsWith("/") && !s.startsWith("//") && !s.includes("..")) return s;
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.href;
  } catch {
    /* */
  }
  return null;
}

/**
 * Promote draft object + basename into published public fields.
 * @param {object} draft
 * @param {string} draftBasename e.g. 2026-08-06-first-note.json
 */
export function promoteDraftToPublished(draft, draftBasename) {
  const meta = parsePublishedBasename(basename(draftBasename));
  if (!meta || !isSafeSlug(meta.slug)) {
    throw new Error(
      `draft basename must match YYYY-MM-DD-<slug>.json (safe slug); got ${draftBasename}`,
    );
  }
  if (!draft.subject || !draft.title || !Array.isArray(draft.paragraphs) || !draft.paragraphs.length) {
    throw new Error("draft needs subject, title, paragraphs[]");
  }
  const out = pickPublicFields(draft);
  out.slug = meta.slug;
  out.date = meta.date;
  out.subject = draft.subject;
  out.title = draft.title;
  out.paragraphs = draft.paragraphs;
  return { filename: meta.filename, note: out };
}

export function formatNoteDate(isoDate) {
  // isoDate YYYY-MM-DD — render as "Aug 6, 2026" without locale surprises in tests
  const [y, m, d] = isoDate.split("-").map(Number);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}
