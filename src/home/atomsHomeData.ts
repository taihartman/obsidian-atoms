/**
 * Pure data for Atoms home view: library rows + pending helpers.
 */

import {
  CURRENT_ATOMS_QUALITY,
  CURRENT_ATOMS_QUALITY_ANSWER,
  CURRENT_ATOMS_QUALITY_REASON,
  isEligibleForUpdate,
} from "../pipeline/atomQuality";
import {
  isPolishableContent,
  UPDATE_NOTES_BATCH_LIMIT,
} from "../pipeline/refreshAtoms";
import { isCalendarDay, utcMidnight } from "../pipeline/backfillOffer";
import { parseCaptures } from "../pipeline/parse";
import {
  plusLapse,
  type FilingAuth,
  type PlusLapseKind,
} from "../platform/filingAuth";
import { resolveCreatedField } from "../pipeline/render";
import {
  PLUS_PRICING,
  includedFilingsBullet,
  monthlyPriceLabel,
  topUpDetailLabel,
  topUpPriceLabel,
  trialFinePrint,
  yearlyPriceLabel,
} from "../shared/plusPricing";

/** Home-row chip role — person (warm) vs work/media (cool). */
export type LinkChipRole = "person" | "work";

export type DisplayLinkChip = {
  label: string;
  role: LinkChipRole;
};

export interface AtomLibraryEntry {
  path: string;
  title: string;
  sourceDay: string | null;
  /** All body wikilinks (resurface / graph). */
  linkChips: string[];
  /** Home display: max 2, typed person|work, model order. */
  displayChips: DisplayLinkChip[];
  /**
   * Sort + relative-time clock for Recents.
   * Prefer frontmatter `created` (not file mtime) so Update notes does not
   * make every row say “5m ago”.
   */
  mtime: number;
}

export interface AtomFileInput {
  path: string;
  mtime: number;
  content: string;
}

/** Max chips on a library row (home-v2). */
export const HOME_CHIP_MAX = 2;

/** Product atoms: Process (linker) or Ask MCP write (ask-mcp). */
const GENERATED_BY_RE = /^generated-by:\s*(linker|ask-mcp)\s*$/m;
const SOURCE_RE = /^source:\s*["']?\[\[([^\]]+)\]\]["']?\s*$/m;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;
const DATE_TITLE_RE = /^\d{4}-\d{2}-\d{2}/;
const JUNK_TITLES = new Set([
  "user link",
  "untitled",
  "index",
  "home",
  "tags",
]);

/** Basename without .md */
export function titleFromAtomPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

export function isUnderAtomFolder(path: string, atomFolder: string): boolean {
  const folder = atomFolder.replace(/\/$/, "") || "Atoms";
  return path === folder || path.startsWith(`${folder}/`);
}

/** Prefer files stamped by our writer (KTD-V3). */
export function isGeneratedAtomContent(content: string): boolean {
  // Frontmatter block only
  if (!content.startsWith("---")) return false;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 400) : content.slice(0, end + 4);
  return GENERATED_BY_RE.test(fm);
}

export function extractSourceDay(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 800) : content.slice(0, end + 4);
  const m = fm.match(SOURCE_RE);
  if (!m?.[1]) return null;
  const name = m[1].trim();
  // Daily basenames are often YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(name)) return name.slice(0, 10);
  return name;
}

const CREATED_RE = /^created:\s*(.+)$/m;

/**
 * Parse atom `created` frontmatter to epoch ms.
 * Accepts `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm(:ss)?` (local wall clock).
 */
export function parseCreatedMs(content: string): number | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 800) : content.slice(0, end + 4);
  const m = fm.match(CREATED_RE);
  if (!m?.[1]) return null;
  const raw = m[1].trim().replace(/^["']|["']$/g, "");
  const dayOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dayOnly) {
    const y = Number(dayOnly[1]);
    const mo = Number(dayOnly[2]);
    const d = Number(dayOnly[3]);
    if (!y || !mo || !d) return null;
    return new Date(y, mo - 1, d, 12, 0, 0, 0).getTime();
  }
  const withTime = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (withTime) {
    const y = Number(withTime[1]);
    const mo = Number(withTime[2]);
    const d = Number(withTime[3]);
    const h = Number(withTime[4]);
    const mi = Number(withTime[5]);
    const s = Number(withTime[6] ?? 0);
    return new Date(y, mo - 1, d, h, mi, s, 0).getTime();
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/**
 * Library sort/display clock: `created` → source day noon → file mtime.
 * Update notes must not reshuffle Recents via file mtime.
 */
export function libraryTimeMs(content: string, fileMtimeMs: number): number {
  const created = parseCreatedMs(content);
  if (created != null && Number.isFinite(created)) return created;
  const day = extractSourceDay(content);
  if (day && /^\d{4}-\d{2}-\d{2}/.test(day)) {
    const y = Number(day.slice(0, 4));
    const mo = Number(day.slice(5, 7));
    const d = Number(day.slice(8, 10));
    if (y && mo && d) return new Date(y, mo - 1, d, 12, 0, 0, 0).getTime();
  }
  return fileMtimeMs;
}

/** True when `created` is day-only (needs within-day order backfill). */
export function isDayOnlyCreated(content: string): boolean {
  if (!content.startsWith("---")) return false;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 800) : content.slice(0, end + 4);
  const m = fm.match(CREATED_RE);
  if (!m?.[1]) return false;
  const raw = m[1].trim().replace(/^["']|["']$/g, "");
  return /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

/**
 * Capture text first line from atom body (before link-prose blank line).
 * Used to body-match the source daily — not the ↳ marker title.
 */
export function atomCaptureFirstLine(content: string): string {
  const body = bodyAfterFrontmatter(content);
  const capturePart = (body.split(/\n\n/)[0] ?? body).trimEnd();
  return (capturePart.split("\n")[0] ?? "").trim();
}

/** Rewrite only the `created:` frontmatter line; body untouched. */
export function rewriteCreatedFrontmatter(
  content: string,
  created: string,
): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  const fm = content.slice(0, end + 4);
  const rest = content.slice(end + 4);
  if (!CREATED_RE.test(fm)) return content;
  const nextFm = fm.replace(CREATED_RE, `created: ${created}`);
  return nextFm + rest;
}

/**
 * If atom has day-only `created`, re-stamp from source daily bullet position
 * (body match). Null when no change or no unique match.
 */
export function planCreatedOrderBackfill(
  atomContent: string,
  dailyContent: string,
  dailyDate: string,
): { content: string; created: string } | null {
  if (!isDayOnlyCreated(atomContent)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dailyDate)) return null;
  const needle = atomCaptureFirstLine(atomContent);
  if (!needle) return null;

  const caps = parseCaptures(dailyContent);
  const matches = caps.filter(
    (c) => (c.text.split("\n")[0] ?? "").trim() === needle,
  );
  if (matches.length !== 1) return null;
  const cap = matches[0]!;
  const created = resolveCreatedField(
    dailyDate,
    cap.timestamp,
    cap.startLine,
  );
  const content = rewriteCreatedFrontmatter(atomContent, created);
  if (content === atomContent) return null;
  return { content, created };
}

/** Body after frontmatter (or full content if none). */
export function bodyAfterFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\s*\n/, "");
}

/**
 * Wikilinks in body; exclude self-title; dedupe case-insensitively; preserve first casing.
 */
export function extractLinkChips(body: string, selfTitle: string): string[] {
  const self = selfTitle.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const note = (m[1] ?? "").trim();
    if (!note) continue;
    const key = note.toLowerCase();
    if (key === self) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out;
}

/** Tags from frontmatter list (for chip typing hints). */
export function extractFrontmatterTags(content: string): string[] {
  if (!content.startsWith("---")) return [];
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 800) : content.slice(0, end + 4);
  const tags: string[] = [];
  const lines = fm.split(/\r?\n/);
  let inTags = false;
  for (const line of lines) {
    if (/^tags:\s*\[\]\s*$/.test(line)) return [];
    if (/^tags:\s*$/.test(line)) {
      inTags = true;
      continue;
    }
    if (inTags) {
      const item = line.match(/^\s*-\s+(.+)$/);
      if (item) {
        tags.push(item[1]!.trim().replace(/^#/, "").toLowerCase());
        continue;
      }
      if (/^\w/.test(line)) break;
    }
  }
  return tags;
}

/**
 * "Ning is the strong Asian guy…" → "Ning" for a glance chip.
 * Full claim title still lives in the note / backlinks.
 */
export function personNameFromClaimTitle(note: string): string | null {
  const n = note.trim();
  if (!n) return null;
  // Name is/was/has/'s …
  const m = n.match(
    /^([A-Za-z][A-Za-z'-]{1,24})(?:\s+([A-Za-z][A-Za-z'-]{1,24}))?\s+(is|was|has|'s)\b/i,
  );
  if (m) {
    return m[2] ? `${m[1]} ${m[2]}` : m[1]!;
  }
  return null;
}

function isPersonContext(contextBefore: string, tags: string[]): boolean {
  const ctx = (contextBefore ?? "").toLowerCase();
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  return (
    tagSet.has("person") ||
    /\b(person|people|friend|about |preference about|matched|told me|recommended|hub|relates to this note about)\b/.test(
      ctx,
    )
  );
}

function isMediaContext(contextBefore: string, tags: string[]): boolean {
  const ctx = (contextBefore ?? "").toLowerCase();
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  return (
    tagSet.has("watch") ||
    tagSet.has("show") ||
    tagSet.has("movie") ||
    tagSet.has("media") ||
    /\b(media work|watch|show|movie|anime|film|series|listen|read)\b/.test(ctx)
  );
}

/**
 * Coarse role for home chips from surrounding reason prose + tags.
 * Returns null = demote (related claim / junk / date) — not shown on home.
 * Long person-claim titles are handled in extractDisplayLinkChips via short name.
 */
export function classifyLinkRole(
  note: string,
  contextBefore: string,
  tags: string[] = [],
): LinkChipRole | null {
  const n = note.trim();
  const key = n.toLowerCase();
  if (!n) return null;
  if (DATE_TITLE_RE.test(n)) return null;
  if (JUNK_TITLES.has(key)) return null;

  const mediaCtx = isMediaContext(contextBefore, tags);
  const personCtx = isPersonContext(contextBefore, tags);
  const long = n.length > 32 || n.split(/\s+/).length > 4;

  if (long) {
    // Long titles are not full chips — person short-name handled by caller
    return null;
  }

  if (mediaCtx && !personCtx) return "work";
  if (personCtx && !mediaCtx) return "person";
  if (mediaCtx && personCtx) {
    if (n.split(/\s+/).length <= 2 && !/\b(the|a|an)\b/i.test(n))
      return "person";
    return "work";
  }

  if (n.split(/\s+/).length <= 2) return "person";
  return "work";
}

/**
 * Home chips: model/body order, type person|work only, max HOME_CHIP_MAX.
 * Long claim titles usually demoted — except person claims shortened to a name
 * (Sherry → [[Ning is the strong…]] shows as chip "Ning").
 */
export function extractDisplayLinkChips(
  body: string,
  selfTitle: string,
  tags: string[] = [],
  max: number = HOME_CHIP_MAX,
): DisplayLinkChip[] {
  const self = selfTitle.trim().toLowerCase();
  const seen = new Set<string>();
  const out: DisplayLinkChip[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    const note = (m[1] ?? "").trim();
    if (!note) continue;
    const key = note.toLowerCase();
    if (key === self) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const start = Math.max(0, (m.index ?? 0) - 100);
    const contextBefore = body.slice(start, m.index ?? 0);
    const role = classifyLinkRole(note, contextBefore, tags);
    if (role) {
      out.push({ label: note, role });
    } else {
      // Person-claim atom titles: surface short name when context is social
      const short = personNameFromClaimTitle(note);
      if (
        short &&
        short.toLowerCase() !== self &&
        isPersonContext(contextBefore, tags)
      ) {
        const sk = short.toLowerCase();
        if (!seen.has(`person:${sk}`)) {
          seen.add(`person:${sk}`);
          out.push({ label: short, role: "person" });
        }
      }
    }
    if (out.length >= max) break;
  }
  return out;
}

export function parseAtomLibraryEntry(
  path: string,
  content: string,
  mtime: number,
): AtomLibraryEntry {
  const title = titleFromAtomPath(path);
  const body = bodyAfterFrontmatter(content);
  const tags = extractFrontmatterTags(content);
  return {
    path,
    title,
    sourceDay: extractSourceDay(content),
    linkChips: extractLinkChips(body, title),
    displayChips: extractDisplayLinkChips(body, title, tags),
    mtime: libraryTimeMs(content, mtime),
  };
}

export function listAtomLibraryEntries(
  files: AtomFileInput[],
  atomFolder: string,
  opts?: { max?: number; requireGeneratedBy?: boolean },
): AtomLibraryEntry[] {
  const max = opts?.max ?? 100;
  const requireGenerated = opts?.requireGeneratedBy !== false;
  const entries: AtomLibraryEntry[] = [];
  for (const f of files) {
    if (!f.path.toLowerCase().endsWith(".md")) continue;
    if (!isUnderAtomFolder(f.path, atomFolder)) continue;
    if (requireGenerated && !isGeneratedAtomContent(f.content)) continue;
    entries.push(parseAtomLibraryEntry(f.path, f.content, f.mtime));
  }
  entries.sort((a, b) => b.mtime - a.mtime || a.title.localeCompare(b.title));
  return entries.slice(0, max);
}

export function filterLinkedOnly(entries: AtomLibraryEntry[]): AtomLibraryEntry[] {
  // "Linked" = has a home-surfaceable person/work chip (not demoted claims)
  return entries.filter((e) => e.displayChips.length > 0);
}

export function shouldShowWaitCard(unprocessedCount: number): boolean {
  return unprocessedCount > 0;
}

export interface InboxStuckSummary {
  /** Calm one-liner naming each stuck state, load-bearing states first. */
  text: string;
}

/**
 * What to surface in Atoms home for captures stuck in the inbox. Returns null
 * when nothing is stuck — silence is the healthy state.
 *
 * Only **held** (future-dated) and **pending** (waiting to file) are stuck.
 * Inferred dates / missing times are not: the drain intentionally files without
 * a time when the stamp is absent or unreadable, and untimed bullets are a
 * normal daily shape. Times from the capture shortcut are a nice-to-have, not
 * a requirement — never alarm on them here.
 */
export function inboxStuckSummary(counts: {
  pending: number;
  held: number;
  /** Ignored — kept so callers may pass full InboxCounts without stripping. */
  inferredDates?: number;
}): InboxStuckSummary | null {
  const pending = Math.max(0, counts.pending);
  const held = Math.max(0, counts.held);
  if (pending + held === 0) return null;

  const parts: string[] = [];
  if (held > 0) {
    parts.push(
      held === 1 ? "1 held for a future day" : `${held} held for a future day`,
    );
  }
  if (pending > 0) {
    parts.push(
      pending === 1 ? "1 waiting to file" : `${pending} waiting to file`,
    );
  }
  return { text: parts.join(" · ") };
}

/** Count linker atoms with atoms-quality missing or below CURRENT (batch cap separate). */
export function countEligibleUpdateNotes(
  contents: string[],
  current: number = CURRENT_ATOMS_QUALITY,
): number {
  let n = 0;
  for (const c of contents) {
    if (isEligibleForUpdate(c, current)) n += 1;
  }
  return n;
}

/**
 * Work remaining for Update strip: refile debt (q < CURRENT) + polishable links.
 * Does not double-count for display when both — total = refile + polishable.
 */
export function countUpdateWorkRemaining(
  entries: Array<{ content: string; title: string }>,
  current: number = CURRENT_ATOMS_QUALITY,
): { refile: number; polishable: number; total: number } {
  let refile = 0;
  let polishable = 0;
  for (const e of entries) {
    if (isEligibleForUpdate(e.content, current)) refile += 1;
    if (isPolishableContent(e.content, e.title)) polishable += 1;
  }
  return { refile, polishable, total: refile + polishable };
}

/** Quoted confirm N: min(refile debt, batch cap). */
export function updateNotesQuotedN(
  refileCount: number,
  batchLimit: number = UPDATE_NOTES_BATCH_LIMIT,
): number {
  return Math.min(Math.max(0, refileCount), Math.max(1, batchLimit));
}

/** Strip copy for Update notes. Body is this quality's reason, never a count. */
export function updateNotesStripCopy(
  reason: string = CURRENT_ATOMS_QUALITY_REASON,
): {
  title: string;
  body: string;
  button: string;
} {
  return {
    title: "Update notes",
    body: reason,
    button: "Update",
  };
}

/** Settings File-group value: short quality answer, or current. */
export function updateNotesSettingsAnswer(
  refileCount: number,
  answer: string = CURRENT_ATOMS_QUALITY_ANSWER,
): string {
  return refileCount > 0 ? answer : "Up to date";
}

/**
 * Confirm billing path. Same cases as `FilingPathKind` so Home/Settings can
 * pass `filingPathFromAuth` without remapping exhausted Plus onto none.
 */
export type UpdateNotesBilling =
  | "plus_active"
  | "plus_exhausted"
  | "plus_lapsed"
  | "byok"
  | "none";

const UPDATE_NOTES_SACRED =
  "Titles and links may change. Your original capture text will not.";

function updateNotesNoun(n: number): string {
  return n === 1 ? "note" : "notes";
}

/** Spend-only confirm chrome. Does not repeat the quality reason. */
export function updateNotesConfirmCopy(opts: {
  n: number;
  billing: UpdateNotesBilling;
}): { title: string; body: string } {
  const n = Math.max(0, opts.n);
  const title =
    n <= 0 ? "Update notes?" : `Update ${n} ${updateNotesNoun(n)}?`;
  switch (opts.billing) {
    case "plus_active":
      return {
        title,
        body: `Uses Atoms Plus (${n} of this month’s filings). ${UPDATE_NOTES_SACRED}`,
      };
    case "plus_exhausted":
      return {
        title,
        body: "This month’s included Atoms Plus filings are used up.",
      };
    case "plus_lapsed":
      return {
        title,
        body: "Your Atoms Plus period ended. Subscribe in Settings.",
      };
    case "byok":
      return {
        title,
        body: `Uses your Anthropic API key. ${UPDATE_NOTES_SACRED}`,
      };
    case "none":
      return {
        title,
        body: "Sign in to Atoms Plus or add an API key in Settings first.",
      };
  }
}

/** True when this device will file past captures without a Process tap. */
export function isAutomaticFilingReady(snap: {
  enabled: boolean;
  egressAcked: boolean;
  hasKey: boolean;
}): boolean {
  return snap.enabled && snap.egressAcked && snap.hasKey;
}

/**
 * Home wait-surface story when past captures remain.
 * Plus modes from approved mock docs/design-handoff/atoms-plus/index.html (v3).
 */
export type FilingHeroMode =
  | "need_key"
  | "plus_limit"
  | "enable_auto"
  | "auto_on"
  | "auto_running";

/** Filing path for wait-card branching (from resolveFilingAuth + status). */
export type FilingPathKind =
  | "none"
  | "byok"
  | "plus_active"
  | "plus_exhausted"
  | "plus_lapsed";

export type FilingHeroAction =
  | "open_settings"
  | "open_plus"
  | "open_byok_settings"
  | "get_more"
  | "subscribe"
  | "dismiss_limit"
  | "enable_auto"
  | "process"
  | "preview"
  | null;

export type FilingHeroCopy = {
  mode: FilingHeroMode;
  eyebrow: string;
  title: string;
  body: string;
  /** Primary button label (null = no primary). */
  primaryLabel: string | null;
  primaryAction: FilingHeroAction;
  /** Quiet / secondary control (mock: often quiet text button). */
  secondaryLabel: string | null;
  secondaryAction: FilingHeroAction;
  /** Prefer quiet grade for secondary (Apple-style). */
  secondaryQuiet?: boolean;
};

/**
 * Pure: how the wait card should speak when pastUnprocessed > 0.
 * Returns null when there is no past queue (caller uses calm home).
 *
 * `filingPath` optional for back-compat: when omitted, uses hasKey → byok | none.
 */
export function filingHeroCopy(input: {
  pastUnprocessed: number;
  /**
   * Captures inside the filing window — what unattended auto-run will actually file (KTD2).
   * Defaults to `pastUnprocessed` so a caller with no window bound reads as before.
   */
  windowUnprocessed?: number;
  hasKey: boolean;
  autoEnabled: boolean;
  egressAcked: boolean;
  inFlight?: boolean;
  /** Prefer this over hasKey when provided (Atoms Plus). */
  filingPath?: FilingPathKind;
  /**
   * When true, plus_exhausted uses a quieter card (after Not Now).
   * Device-local dismiss day handled by caller.
   */
  plusLimitDismissedToday?: boolean;
  /** Which kind of period ended, when `filingPath` is `plus_lapsed`. */
  plusLapseKind?: PlusLapseKind;
}): FilingHeroCopy | null {
  if (input.pastUnprocessed <= 0) return null;

  const n = input.pastUnprocessed;
  const countLabel = capturesWaitingLabel(n);

  const path: FilingPathKind =
    input.filingPath ?? (input.hasKey ? "byok" : "none");

  if (path === "none") {
    return {
      mode: "need_key",
      eyebrow: "Ready",
      title: countLabel,
      body: "Turn past notes into linked atoms with Atoms Plus, or use your own Anthropic API key for free.",
      primaryLabel: "Try Atoms Plus",
      primaryAction: "open_plus",
      secondaryLabel: "Use My Own Key",
      secondaryAction: "open_byok_settings",
      secondaryQuiet: true,
    };
  }

  if (path === "plus_lapsed") {
    const what = input.plusLapseKind === "trial" ? "trial" : "subscription";
    // No "Not Now": the limit card can be dismissed because waiting genuinely fixes it, and
    // this one nothing fixes but subscribing. Offering a dismissal would put the card back
    // tomorrow saying the same thing, which is how the expiry stayed quiet in the first place.
    return {
      mode: "plus_limit",
      eyebrow: "Atoms Plus",
      title: `Your ${what} has ended`,
      body: `${capturesWaitingSentence(n)}. Filing is paused, and Claude and ChatGPT can’t reach your atoms. Subscribe to pick up where you left off.`,
      primaryLabel: "Subscribe",
      primaryAction: "subscribe",
      secondaryLabel: null,
      secondaryAction: null,
    };
  }

  if (path === "plus_exhausted") {
    if (input.plusLimitDismissedToday) {
      // Quieter follow-up after Not Now — still actionable, not a no-op re-render.
      return {
        mode: "plus_limit",
        eyebrow: "Atoms Plus",
        title: countLabel,
        body: "You’ve used this month’s included AI filings. Get More in Settings, or wait until your next billing date.",
        primaryLabel: "Get More",
        primaryAction: "get_more",
        secondaryLabel: null,
        secondaryAction: null,
      };
    }
    return {
      mode: "plus_limit",
      eyebrow: "Atoms Plus",
      title: "Monthly Limit Reached",
      body: "You’ve used this month’s included AI filings. Your allotment starts over on your next billing date. If you need more before then, you can buy additional filings.",
      primaryLabel: "Get More",
      primaryAction: "get_more",
      secondaryLabel: "Not Now",
      secondaryAction: "dismiss_limit",
      secondaryQuiet: true,
    };
  }

  // Everything below is the byok / plus_active automatic-filing story. This annotation is the
  // guard: a `FilingPathKind` added without a branch above fails to narrow here and breaks the
  // build, rather than silently inheriting a card about automatic filing. `plus_lapsed` would
  // have fallen through exactly that way — the same class `accountRowDescriptor` closes with
  // its `never`, which this if-chain had no equivalent of.
  const _story: "byok" | "plus_active" = path;
  void _story;

  const autoOn = input.autoEnabled && input.egressAcked;
  if (input.inFlight && autoOn) {
    return {
      mode: "auto_running",
      eyebrow: "Filing",
      title: "Filing past thoughts…",
      body: "Automatic filing is running. You can keep browsing. Nothing needs a tap.",
      primaryLabel: null,
      primaryAction: null,
      secondaryLabel: "Process now",
      secondaryAction: "process",
    };
  }

  // Enabling stamps the window at today (KTD2), so it reaches what comes next, never the
  // captures already sitting here. This is the card that sells automatic filing: it may
  // promise only what enabling actually does, and name Process for the rest.
  if (!autoOn) {
    return {
      mode: "enable_auto",
      eyebrow: "Ready",
      title: countLabel,
      body: "Turn on automatic filing so new captures file on their own from today on. Process files the ones already waiting, when you are ready.",
      primaryLabel: "Turn on automatic filing",
      primaryAction: "enable_auto",
      secondaryLabel: "Process",
      secondaryAction: "process",
    };
  }

  // Automatic filing is on, but the window holds none of what is waiting — every capture here
  // predates the day filing was enabled, and no unattended pass will reach it. Say what is
  // true (a tap files it) rather than a promise nothing keeps.
  const windowN = input.windowUnprocessed ?? n;
  if (windowN <= 0) {
    return {
      mode: "auto_on",
      eyebrow: "Ready",
      title: countLabel,
      body: "Process when you are ready.",
      primaryLabel: "Process now",
      primaryAction: "process",
      secondaryLabel: "Preview",
      secondaryAction: "preview",
    };
  }

  return {
    mode: "auto_on",
    eyebrow: "Automatic",
    // The window count, not the total: this card's body promises an unattended pass.
    title: capturesWaitingLabel(windowN),
    body: "Automatic filing is on for this device. Past days file when you open Obsidian. Process only if you want them sooner.",
    primaryLabel: "Process now",
    primaryAction: "process",
    secondaryLabel: "Preview",
    secondaryAction: "preview",
  };
}

function capturesWaitingLabel(n: number): string {
  return n === 1 ? "1 Capture Waiting" : `${n} Captures Waiting`;
}

/**
 * The same count as prose. {@link capturesWaitingLabel} is title-cased because every other
 * caller uses it as a card *title*; borrowed into a sentence it reads "33 Captures Waiting —
 * filing is paused", a proper noun where a clause belongs.
 */
function capturesWaitingSentence(n: number): string {
  return n === 1 ? "1 capture waiting" : `${n} captures waiting`;
}

/**
 * Captures inside the filing window, derived from an unbounded past scan.
 *
 * Filtering the scan the home view already made, rather than scanning the vault a second
 * time: the window bound is purely a date compare, so the two agree by construction.
 */
export function countUnprocessedSince(
  notes: ReadonlyArray<{ date: string; unprocessed: ReadonlyArray<unknown> }>,
  since: string,
): number {
  return notes.reduce(
    (sum, n) => (n.date >= since ? sum + n.unprocessed.length : sum),
    0,
  );
}

/**
 * The home subtitle while captures wait.
 *
 * Only the window count may carry the automatic-filing promise (KTD2). Captures older than
 * the day filing was enabled are still waiting and Process still files them — they are just
 * not something the device will do on its own, so they speak as "ready to file".
 */
export function waitingSubtitle(input: {
  pastUnprocessed: number;
  windowUnprocessed: number;
  automaticFilingReady: boolean;
}): string {
  if (input.automaticFilingReady && input.windowUnprocessed > 0) {
    return input.windowUnprocessed === 1
      ? "1 past thought will file automatically"
      : `${input.windowUnprocessed} past thoughts will file automatically`;
  }
  return input.pastUnprocessed === 1
    ? "1 thought ready to file"
    : `${input.pastUnprocessed} thoughts ready to file`;
}

/** Settings → Core plugins. Live tab id is `plugins` (Obsidian 1.13.6). Not `core-plugins`. */
export const CORE_PLUGINS_SETTINGS_TAB_ID = "plugins";

export type FirstDayPrimaryAction = "open_today" | "open_core_plugins";

/**
 * The one thing still unfinished, for the surface that shows a step rather than a card.
 *
 * `kind` is what a surface switches on to decide where the step sends the user: Obsidian's core
 * plugins pane, or the screen that asks who pays for filing. `name` is the words both surfaces
 * use, so the settings line and this card cannot drift apart (KTD11).
 */
export type SetupStep = {
  kind: "daily_notes" | "filing_owner";
  name: string;
};

/**
 * The noun the File row, its destination, and the unfinished setup step all share.
 *
 * #530 renamed the destination. #538 makes the Get started step use the same word so a new
 * install is not told to do a step whose name is not on the screen it lands on.
 */
export const FILING_NAME = "Filing";

/**
 * The words each step is asked for by, written once.
 *
 * Home's first-day card titles itself from this same record rather than repeating the sentence,
 * so the card and the settings line cannot say two different things (KTD11) — and a new kind
 * cannot be added without naming it, because the record is keyed by the union.
 */
const SETUP_STEP_NAMES: Record<SetupStep["kind"], string> = {
  daily_notes: "Turn on Daily Notes",
  filing_owner: FILING_NAME,
};

/**
 * The one step still outstanding, in the order that matters: Daily Notes first, because there is
 * nothing to file until captures have somewhere to land.
 */
function nextSetupStep(
  dailyNotesLoaded: boolean,
  filingChosen: boolean,
): SetupStep | null {
  if (!dailyNotesLoaded) {
    return { kind: "daily_notes", name: SETUP_STEP_NAMES.daily_notes };
  }
  if (!filingChosen) {
    return { kind: "filing_owner", name: SETUP_STEP_NAMES.filing_owner };
  }
  return null;
}

export type FirstDaySetupCopy = {
  subtitle: string;
  eyebrow: string;
  title: string;
  body: string;
  example: string | null;
  primaryLabel: string;
  primaryAction: FirstDayPrimaryAction;
  showShortcut: boolean;
  /** The step still outstanding, or `null` when Atoms can file. */
  nextStep: SetupStep | null;
};

/**
 * First-day home card, and the one unfinished step the settings status group renders.
 *
 * Daily Notes off is a setup wall, not an empty library. Existing on-path strings stay
 * byte-identical when the plugin is already loaded.
 *
 * Two surfaces read this, and only this, for what is not set up yet (KTD11): home draws it as a
 * card, settings draws it as a line above every control. Two hand-maintained lists is the shape
 * that produces "fixed one, forgot the twin", so `nextSetupStep` above owns the ordering once.
 *
 * `filingChosen` defaults to true because home does not pass it: home's card has never spoken
 * about who pays, and its wait card already owns that. The default keeps this card exactly as it
 * was while the settings line, which does ask, gets a real answer.
 */
export function firstDaySetupCopy(
  dailyNotesLoaded: boolean,
  filingChosen = true,
): FirstDaySetupCopy {
  const nextStep = nextSetupStep(dailyNotesLoaded, filingChosen);
  if (!dailyNotesLoaded) {
    return {
      subtitle: "Daily Notes is off",
      eyebrow: "Get started",
      // The step's own words, not a second copy of them: one string, two surfaces.
      title: SETUP_STEP_NAMES.daily_notes,
      body: "Atoms files thoughts from your daily notes. Enable the core Daily Notes plugin under Settings → Core plugins.",
      example: null,
      primaryLabel: "Open Core plugins",
      primaryAction: "open_core_plugins",
      showShortcut: false,
      nextStep,
    };
  }
  return {
    subtitle: "Capture starts in your daily note",
    eyebrow: "Get started",
    title: "Write one bullet today",
    body: "Atoms files thoughts from past days. Capture stays in Daily. This list shows what was filed.",
    example: "- Alex likes periwinkle\n- watch Past Lives",
    primaryLabel: "Open today",
    primaryAction: "open_today",
    showShortcut: true,
    nextStep,
  };
}

/**
 * Map resolveFilingAuth result → wait-card path.
 *
 * An ended period takes its own path rather than sharing `plus_exhausted`: the limit card's
 * whole offer — buy more filings, or wait for the next billing date — is addressed to someone
 * who still has a subscription (#442).
 */
export function filingPathFromAuth(
  auth: FilingAuth,
  now?: number,
): FilingPathKind {
  if (auth.mode === "none") return "none";
  if (auth.mode === "byok") return "byok";
  if (plusLapse(auth, now)) return "plus_lapsed";
  if (auth.status === "exhausted") return "plus_exhausted";
  return "plus_active";
}

/**
 * Offer / Get More copy. Dollar amounts and filing counts come from
 * repo-root `plus-pricing.json` via `src/shared/plusPricing.ts` (SSOT).
 */
export function atomsPlusOfferCopy(): {
  title: string;
  priceMonthly: string;
  priceYearly: string;
  bullets: string[];
  costReason: string;
  freePath: string;
  primaryLabel: string;
  secondaryLabel: string;
  finePrint: string;
} {
  return {
    title: "Atoms Plus",
    priceMonthly: monthlyPriceLabel(),
    priceYearly: yearlyPriceLabel(),
    bullets: [
      includedFilingsBullet(),
      "No API key setup on phone or desktop",
      "Your library stays free. Plus is optional. The rest of Atoms does not require a subscription",
    ],
    costReason:
      "AI usage has a real cost. Your subscription helps cover that and supports ongoing development.",
    freePath:
      "Prefer to stay free? Use your own Anthropic API key in Settings. No Plus required.",
    primaryLabel: "Start Free Trial",
    secondaryLabel: "Not Now",
    finePrint: trialFinePrint(),
  };
}

export function atomsPlusTopUpCopy(): {
  title: string;
  price: string;
  detail: string;
  body: string;
  primaryLabel: string;
  secondaryLabel: string;
} {
  const n = PLUS_PRICING.topUpFilings;
  return {
    title: "Additional Filings",
    price: topUpPriceLabel(),
    detail: topUpDetailLabel(),
    body: `One-time purchase. Adds ${n} filings to this month only. Does not change your subscription or renew automatically.`,
    primaryLabel: "Continue",
    secondaryLabel: "Cancel",
  };
}

/**
 * Relative time label for library rows (en-US-ish, compact).
 * `whenMs` should be libraryTimeMs (created), not raw file mtime after Update.
 */
export function formatRelativeTime(whenMs: number, nowMs: number = Date.now()): string {
  const sec = Math.max(0, Math.floor((nowMs - whenMs) / 1000));
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "Yest.";
  if (day < 7) return `${day}d`;
  return new Date(whenMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Also about strip copy — no em dashes. */
export const ALSO_ABOUT_BODY_NOTE =
  "Each note keeps its own body. This view only gathers titles.";

export function alsoAboutStripLabel(entityLabel: string, otherCount: number): string {
  const label = (entityLabel ?? "").trim() || "related";
  const n = Math.max(0, otherCount);
  return `Also about ${label} · ${n}`;
}

export type AlsoAboutStripModel = {
  label: string;
  otherCount: number;
  stripText: string;
};

export function buildAlsoAboutStripModel(
  entityLabel: string,
  otherCount: number,
): AlsoAboutStripModel | null {
  if (otherCount < 1) return null;
  const label = (entityLabel ?? "").trim();
  if (!label) return null;
  return {
    label,
    otherCount,
    stripText: alsoAboutStripLabel(label, otherCount),
  };
}

export function queuePeekTexts(
  notes: Array<{ unprocessed: Array<{ text: string }>; date: string }>,
  max = 3,
): Array<{ text: string; date: string }> {
  const out: Array<{ text: string; date: string }> = [];
  for (const n of notes) {
    for (const c of n.unprocessed) {
      out.push({
        text: c.text.split("\n")[0]?.slice(0, 120) ?? "",
        date: n.date,
      });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * The backfill offer card on home (U5).
 *
 * Home has never had a backfill affordance; the command palette was the only door. This card is
 * that door made visible, and it recurs every period on a vault that does not drain in one pass,
 * so it is held to a higher bar than a one-time strip: a quiet card, never a notification, never
 * a badge, and never a number that grows.
 */

/** Days a BYOK dismissal is scoped to. Matches the paid period so the drain resumes either way. */
export const BACKFILL_DISMISS_DAYS = 30;

/** `YYYY-MM-DD` plus whole days, via UTC midnights so a DST boundary cannot shift the answer. */
function addDays(day: string, days: number): string {
  const base = utcMidnight(day);
  return new Date((base ?? NaN) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Both bounds the card renders behind, in one place.
 *
 * `budget === 0` is not an edge: `remaining` sits at or below the reserve for roughly the last
 * third of a paid period at normal burn, and permanently for a heavy capturer. A card inviting a
 * tap into a flow that files nothing is a dead end, and offering nothing while selling something
 * contradicts quiet by default. In that state backfill stays in Settings, where the numbers are
 * explained plainly.
 *
 * A budget that no whole daily fits inside is **not** the same state and does not suppress. That
 * tap lands on the modal's top-up branch (KTD11: over budget offers a top-up, never a dead end),
 * and hiding the card would make that branch unreachable from the only discoverable surface.
 * What must not happen there is an empty *offer*, and that is prevented in `backfillOfferCopy`,
 * which names the situation rather than a count it cannot honor.
 */
export function shouldShowBackfillOffer(input: {
  /** Past captures outside the filing window. */
  total: number;
  /** Filings this period may spend on backfill. */
  budget: number;
  /** Day the card is suppressed through, device-local, or null. */
  dismissedUntil: string | null;
  /** Local `YYYY-MM-DD`. */
  today: string;
}): boolean {
  if (input.total <= 0) return false;
  if (input.budget <= 0) return false;
  const until = input.dismissedUntil;
  if (isCalendarDay(until) && input.today < until) return false;
  return true;
}

/**
 * The day a dismissal is suppressed through: the period end, or 30 days out when there is none.
 *
 * Dismissal is for the period, never forever. A permanent X would collapse a multi-period drain
 * into a single shot, stranding a multi-year vault on one tap, which is the opposite of the
 * design. BYOK has no period at all, so it takes the paid cadence: the drain still resumes.
 * A stored period end that has already passed is treated as absent for the same reason the
 * budget treats it as unknown.
 */
export function backfillDismissUntil(input: {
  today: string;
  periodEnd?: string;
}): string {
  const day = input.periodEnd?.slice(0, 10);
  if (isCalendarDay(day) && day > input.today) return day;
  return addDays(input.today, BACKFILL_DISMISS_DAYS);
}

export interface BackfillOfferCopy {
  title: string;
  body: string;
  /** What the run spends, in the currency this device actually spends. */
  meter: string;
  primary: string;
  dismiss: string;
}

/** Thousands separators, so 1847 reads as a count rather than a serial number. */
function count(n: number): string {
  return n.toLocaleString("en-US");
}

/** What the run covers — the budgeted range, or the over-budget situation named plainly. */
function rangeLine(
  currency: "filings" | "cost",
  budgeted: number,
  total: number,
  overBudget: boolean,
): string {
  if (overBudget) {
    return currency === "filings"
      ? "The next day back holds more captures than this period's filings cover."
      : "The next day back holds more captures than one run covers.";
  }
  if (total > budgeted) {
    return `Atoms can file your ${count(budgeted)} most recent, of ${count(total)}. Newest first.`;
  }
  if (budgeted === 1) {
    return "Atoms can file the one capture sitting further back. Newest first.";
  }
  return `Atoms can file all ${count(budgeted)} sitting further back. Newest first.`;
}

/** What the run spends, in the currency this device actually spends. */
function meterLine(
  currency: "filings" | "cost",
  budgeted: number,
  overBudget: boolean,
  filingsRemaining: number | undefined,
): string {
  if (currency !== "filings") {
    return "Runs on your own API key. You see the cost before anything starts.";
  }
  if (overBudget) {
    return filingsRemaining == null
      ? "More than this period's filings."
      : `More than the ${count(filingsRemaining)} filings left this period.`;
  }
  return filingsRemaining == null
    ? `Uses ${count(budgeted)} of this period's filings.`
    : `Uses ${count(budgeted)} of the ${count(filingsRemaining)} filings left this period.`;
}

/**
 * Card copy. The headline number is always the budgeted range, never the complement total.
 *
 * "1,847 past captures" above a run that files 100 is a broken promise, and on a real vault it is
 * the common case rather than an edge. The total appears only as the subordinate half of "your
 * 100 most recent, of 1,847".
 *
 * `budgeted === 0` is the over-budget variant: the newest day back does not fit the budget whole,
 * so there is no range to quote and the tap goes to the modal's top-up branch. It names the
 * situation and nothing else. No count, because there is no count it could honor, and no pitch,
 * because a user who never tops up meets this variant every period and a recurring card that
 * sells is a guilt queue with a price on it. The buying happens in the modal, once asked for.
 *
 * The migrated variant names the pause instead of reading as a new offer. A BRAT or Community
 * auto-update shows no release notes, so a device whose in-progress silent sweep stopped has no
 * other way to learn where that work went, and would otherwise watch filing stop and conclude
 * the plugin broke.
 */
export function backfillOfferCopy(input: {
  budgeted: number;
  total: number;
  migrated: boolean;
  currency: "filings" | "cost";
  /** Filings left this period, when the stored session knows. Plus only. */
  filingsRemaining?: number;
}): BackfillOfferCopy {
  const budgeted = Math.max(0, input.budgeted);
  const total = Math.max(budgeted, input.total);
  const overBudget = budgeted === 0;
  const lead = input.migrated
    ? "Automatic filing starts from the day you switched it on, so older captures stayed where they are. "
    : "";
  const range = rangeLine(input.currency, budgeted, total, overBudget);
  const meter = meterLine(
    input.currency,
    budgeted,
    overBudget,
    input.filingsRemaining,
  );
  return {
    title: input.migrated ? "Filing starts here now" : "Older captures",
    body: `${lead}${range}`,
    meter,
    primary: "Backfill…",
    dismiss: "Not now",
  };
}
