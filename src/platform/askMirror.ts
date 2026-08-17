/**
 * Ask mirror push planner — Atoms/ paths only, hash skip.
 * Structured links prefer frontmatter `atom-links:`; body is not mined for reasons.
 */
import { parseLinkProse } from "../pipeline/parseLinkProse";
import type { PlusLapseKind } from "./filingAuth";
import { parseOpenLoopFm, type OpenLoopFm } from "../shared/openLoop";
import {
  CONTINUE_RELATIONS,
  relationReasonProse,
} from "../shared/relationReason";
import type {
  ConfirmRequest,
  ConfirmVerdict,
  DeletionConfirmation,
  MirrorDeletionRefusal,
} from "../shared/confirm";

export type { MirrorDeletionRefusal };

/** Device-local (not data.json) — multi-device safe evidence map. */
export const LS_ASK_MIRROR_HASHES = "atoms-ask-mirror-hashes-v1";
export const LS_ASK_MIRROR_LAST_SUCCESS = "atoms-ask-mirror-last-success-v1";
export const LS_ASK_MIRROR_LAST_ERROR = "atoms-ask-mirror-last-error-v1";
export const LS_ASK_MIRROR_SERVER_COUNT = "atoms-ask-mirror-server-count-v1";
/** Last known Plus email from mirror status (device-local). */
export const LS_ASK_MIRROR_EMAIL = "atoms-ask-mirror-email-v1";
/** Pre-shrinkage baseline for the completeness floor — device-local only. */
export const LS_ASK_MIRROR_SCAN_HIGHWATER =
  "atoms-ask-mirror-scan-highwater-v1";
/** Consecutive refused passes + whether the escalation Notice already fired. */
export const LS_ASK_MIRROR_REFUSAL = "atoms-ask-mirror-refusal-v1";

/**
 * Why a pass stopped when the mirror was disarmed underneath it. Deliberately the same sentence
 * the entry gate refuses with: to the caller these are one fact — this device is not mirroring —
 * and the only difference is which side of an await it was learned on.
 */
export const ASK_MIRROR_STOPPED = "Ask mirror is off";

/**
 * The retired `data.json` field. Still present in every already-synced
 * `data.json`, so it is stripped on load — deleted, never read back as
 * evidence (CLAUDE.md non-negotiable 12).
 */
export const LEGACY_SETTINGS_HASH_KEY = "askMirrorHashes";

/**
 * Drop the retired synced hash map from a freshly loaded settings object.
 * Mutates `raw`; returns true when the key was actually there, so the caller
 * can persist the removal immediately instead of waiting for the next
 * unrelated settings write.
 */
export function stripLegacyAskMirrorHashes(raw: object): boolean {
  const had = Object.prototype.hasOwnProperty.call(raw, LEGACY_SETTINGS_HASH_KEY);
  delete (raw as Record<string, unknown>)[LEGACY_SETTINGS_HASH_KEY];
  return had;
}

/**
 * Hash evidence is device-local, never `data.json` (CLAUDE.md non-negotiable
 * 12). The synced-settings fallback is deliberately gone: a fresh phone must
 * not inherit a desktop's deletion evidence. No local evidence plans no
 * deletes, which fails safe.
 */
export function readAskMirrorHashes(
  load: (k: string) => unknown,
): Record<string, string> {
  const raw = load(LS_ASK_MIRROR_HASHES);
  if (raw && typeof raw === "string" && raw.trim()) {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) {
        return o as Record<string, string>;
      }
    } catch {
      /* fall through */
    }
  }
  return {};
}

export function writeAskMirrorHashes(
  save: (k: string, v: string) => void,
  hashes: Record<string, string>,
): void {
  save(LS_ASK_MIRROR_HASHES, JSON.stringify(hashes));
}

export type AskMirrorAtomPayload = {
  path: string;
  title: string;
  body: string;
  tags: string[];
  links: { note: string; reason?: string }[];
  /** atom = Atoms/*.md; hub = vault note linked from atoms (outside Atoms/). */
  kind?: "atom" | "hub";
  /** Frontmatter `created` when present (day or local datetime). */
  created?: string;
  /** Open-loop FM when present. */
  loop?: OpenLoopFm;
};

export type VaultFileRead = {
  path: string;
  basename: string;
  content: string;
};

type FmLink = { note: string; reason?: string };

/** Parse frontmatter tags, atom-links, parent/relation, created, loop, body. */
export function splitAtomMarkdown(content: string): {
  body: string;
  tags: string[];
  parent?: string;
  relation?: string;
  created?: string;
  loop?: OpenLoopFm;
  fmLinks: FmLink[];
} {
  if (!content.startsWith("---")) {
    return { body: content, tags: [], fmLinks: [] };
  }
  const end = content.indexOf("\n---", 3);
  if (end < 0) return { body: content, tags: [], fmLinks: [] };
  const fm = content.slice(3, end);
  const body = content.slice(end + 4).replace(/^\n/, "");
  const tags: string[] = [];
  const list = fm.match(/^tags:\s*\n((?:\s*-\s+.+\n?)*)/m);
  if (list?.[1]) {
    for (const line of list[1].split("\n")) {
      const m = line.match(/^\s*-\s+(.+)/);
      if (m?.[1]) tags.push(m[1].trim().replace(/^["']|["']$/g, ""));
    }
  } else {
    const one = fm.match(/^tags:\s*\[([^\]]*)\]/m);
    if (one?.[1]) {
      for (const p of one[1].split(",")) {
        const t = p.trim().replace(/^["']|["']$/g, "");
        if (t) tags.push(t);
      }
    }
  }
  const parentM = fm.match(/^parent:\s*["']?(.+?)["']?\s*$/m);
  const relationM = fm.match(/^relation:\s*["']?(\w+)["']?\s*$/m);
  const parent = parentM?.[1]?.trim().replace(/^\[\[|\]\]$/g, "");
  const relation = relationM?.[1]?.trim();
  const createdM = fm.match(/^created:\s*(.+)$/m);
  const createdRaw = createdM?.[1]?.trim().replace(/^["']|["']$/g, "");
  const created =
    createdRaw &&
    (/^\d{4}-\d{2}-\d{2}$/.test(createdRaw) ||
      /^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}/.test(createdRaw) ||
      Number.isFinite(Date.parse(createdRaw)))
      ? createdRaw
      : undefined;

  const fmLinks: FmLink[] = [];
  // atom-links:
  //   - note: "X"
  //     reason: "Y"
  const block = fm.match(
    /^atom-links:\s*\n((?:[ \t]+.+\n?)*)/m,
  );
  if (block?.[1]) {
    let cur: FmLink | null = null;
    for (const line of block[1].split("\n")) {
      const noteM = line.match(/^\s*-\s+note:\s*(.+)$/);
      const reasonM = line.match(/^\s+reason:\s*(.+)$/);
      if (noteM) {
        if (cur) fmLinks.push(cur);
        const note = noteM[1]!.trim().replace(/^["']|["']$/g, "");
        cur = note ? { note } : null;
      } else if (reasonM && cur) {
        cur.reason = reasonM[1]!.trim().replace(/^["']|["']$/g, "");
      }
    }
    if (cur) fmLinks.push(cur);
  }

  const loopParsed = parseOpenLoopFm(fm);
  const loop = loopParsed
    ? { state: loopParsed.state, source: loopParsed.source }
    : undefined;

  return {
    body,
    tags,
    fmLinks,
    ...(parent ? { parent } : {}),
    ...(relation ? { relation } : {}),
    ...(created ? { created } : {}),
    ...(loop ? { loop } : {}),
  };
}

export function contentHash(parts: string[]): string {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p ?? "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0xff;
  }
  return (h >>> 0).toString(16);
}

export function extractWikilinks(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || "")) !== null) {
    const note = (m[1] ?? "").trim();
    if (!note) continue;
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out;
}

/**
 * Link-prose region only (after first blank line) — Process atoms legacy.
 * Never treat capture paragraph as reason.
 */
function linkProseRegion(body: string): string {
  const text = (body || "").replace(/\s+$/, "");
  const m = text.match(/^([\s\S]*?)\n\n([\s\S]+)$/);
  return m ? m[2]!.replace(/\s+$/, "") : "";
}

/**
 * Build structured links for mirror:
 * 1. FM atom-links (authoritative)
 * 2. parent/relation FM
 * 3. Process-style short link-prose region only (≤280 chars / segment)
 * 4. bare wikilinks → note only
 */
export function linksFromAtomFile(opts: {
  body: string;
  fmLinks?: FmLink[];
  parent?: string;
  relation?: string;
}): { note: string; reason?: string }[] {
  const byNote = new Map<string, { note: string; reason?: string }>();

  for (const l of opts.fmLinks || []) {
    const note = (l.note || "").trim();
    if (!note) continue;
    const reason = (l.reason || "").trim();
    byNote.set(
      note.toLowerCase(),
      reason ? { note, reason } : { note },
    );
  }

  if (opts.parent?.trim()) {
    const p = opts.parent.trim();
    const key = p.toLowerCase();
    const rel = (opts.relation || "").trim();
    const reason = (CONTINUE_RELATIONS as readonly string[]).includes(rel)
      ? relationReasonProse(rel, p)
      : undefined;
    const prev = byNote.get(key);
    if (!prev) {
      byNote.set(key, reason ? { note: p, reason } : { note: p });
    } else if (reason && !prev.reason) {
      byNote.set(key, { note: prev.note, reason });
    }
  }

  // Legacy Process: only parse short link-prose segments (not capture)
  if (byNote.size === 0 || ![...byNote.values()].some((l) => l.reason)) {
    const region = linkProseRegion(opts.body);
    for (const l of parseLinkProse(region)) {
      const note = (l.note || "").trim();
      if (!note) continue;
      const reason = (l.reason || "").trim();
      const key = note.toLowerCase();
      if (reason.length > 280) {
        if (!byNote.has(key)) byNote.set(key, { note });
        continue;
      }
      const prev = byNote.get(key);
      if (!prev) {
        byNote.set(key, reason ? { note, reason } : { note });
      } else if (reason && !prev.reason) {
        byNote.set(key, { note: prev.note, reason });
      }
    }
  }

  for (const note of extractWikilinks(opts.body)) {
    const key = note.toLowerCase();
    if (!byNote.has(key)) byNote.set(key, { note });
  }

  return [...byNote.values()];
}

/** @deprecated use linksFromAtomFile — kept name for tests */
export function linksFromAtomBody(
  body: string,
): { note: string; reason?: string }[] {
  return linksFromAtomFile({ body });
}

/** Flat `{folder}/{name}.md` only — no nested segments. */
export function isFlatAtomPath(folder: string, path: string): boolean {
  const f = folder.replace(/\/$/, "") || "Atoms";
  const p = String(path || "").trim();
  if (!p.endsWith(".md")) return false;
  if (p.includes("..") || p.includes("\\") || p.includes("\0")) return false;
  if (!p.startsWith(f + "/")) return false;
  const rest = p.slice(f.length + 1);
  if (!rest || rest.includes("/")) return false;
  return true;
}

/**
 * Paths in lastHashes missing from vault → candidates for mirror delete.
 */
export function planAskMirrorDeletes(
  vaultPaths: Set<string>,
  lastHashes: Record<string, string>,
): { deletePaths: string[]; nextHashes: Record<string, string> } {
  const deletePaths: string[] = [];
  const nextHashes = { ...lastHashes };
  for (const p of Object.keys(lastHashes)) {
    if (!vaultPaths.has(p)) {
      deletePaths.push(p);
      delete nextHashes[p];
    }
  }
  return { deletePaths, nextHashes };
}

/** Hub path: vault .md not under Atoms/, max 4 segments, no traversal. */
export function isHubMirrorPath(path: string, atomFolder = "Atoms"): boolean {
  const p = String(path || "").trim();
  const f = atomFolder.replace(/\/$/, "") || "Atoms";
  if (!p.endsWith(".md")) return false;
  if (p.includes("..") || p.includes("\\") || p.includes("\0")) return false;
  if (p.startsWith("/")) return false;
  if (p.startsWith(f + "/")) return false;
  const parts = p.split("/");
  if (parts.length < 1 || parts.length > 4) return false;
  if (parts.some((s) => !s || s === "." || s === "..")) return false;
  return true;
}

/**
 * Paths that should schedule a mirror sync when the vault changes.
 * Flat atoms always. Hub-shaped notes only when already in this device's
 * mirror evidence map (or when no map is passed — pure allowlist checks).
 * New hubs from Process/Update land via end-of-run push, which seeds hashes.
 * Upsert still filters hubs to linked titles only.
 */
export function isAskMirrorWatchPath(
  path: string,
  atomFolder = "Atoms",
  mirroredPaths?: ReadonlySet<string> | Readonly<Record<string, unknown>>,
): boolean {
  const p = String(path || "").trim();
  if (!p.endsWith(".md")) return false;
  if (p.includes("..") || p.includes("\\") || p.includes("\0")) return false;
  if (isFlatAtomPath(atomFolder, p)) return true;
  if (!isHubMirrorPath(p, atomFolder)) return false;
  if (mirroredPaths == null) return true;
  if (mirroredPaths instanceof Set) return mirroredPaths.has(p);
  return Object.prototype.hasOwnProperty.call(mirroredPaths, p);
}

export function planAskMirrorUpsert(
  files: VaultFileRead[],
  atomFolder: string,
  lastHashes: Record<string, string> = {},
  opts?: { kind?: "atom" | "hub" },
): { atoms: AskMirrorAtomPayload[]; nextHashes: Record<string, string> } {
  const folder = atomFolder.replace(/\/$/, "");
  const kind = opts?.kind === "hub" ? "hub" : "atom";
  const atoms: AskMirrorAtomPayload[] = [];
  const nextHashes = { ...lastHashes };
  for (const f of files) {
    if (kind === "atom" && !isFlatAtomPath(folder, f.path)) continue;
    if (kind === "hub" && !isHubMirrorPath(f.path, folder)) continue;
    const { body, tags, parent, relation, created, loop, fmLinks } =
      splitAtomMarkdown(f.content);
    const title = f.basename.replace(/\.md$/i, "");
    const links = linksFromAtomFile({ body, fmLinks, parent, relation });
    const hash = contentHash([
      title,
      body,
      JSON.stringify(tags),
      JSON.stringify(links),
      kind,
      created || "",
      loop ? JSON.stringify(loop) : "",
    ]);
    if (lastHashes[f.path] === hash) continue;
    nextHashes[f.path] = hash;
    atoms.push({
      path: f.path,
      title,
      body,
      tags,
      links,
      kind,
      ...(created ? { created } : {}),
      ...(loop ? { loop } : {}),
    });
  }
  return { atoms, nextHashes };
}

// ---------------------------------------------------------------------------
// Mirror sync run — extracted from plugin/main.ts so the delete gate is
// testable against a fake host (KTD15). No Obsidian types cross this seam.
// ---------------------------------------------------------------------------

// --- Completeness floor (R8) ----------------------------------------------

/**
 * `MIRROR_COMPLETENESS_FLOOR` = `min(baseline, max(5, baseline × 0.8))`, where
 * `baseline = max(highWaterMark, evidenceSize)`. The ratio discriminates "the
 * user pruned" from "this device has not synced yet". The inner `max` is what
 * keeps the floor non-vacuous on a device with no recorded high-water mark —
 * the mark is never seeded from the scan being judged, or the ratio is
 * self-referential.
 *
 * The outer `min(baseline, …)` is what keeps a genuinely tiny vault from being
 * wedged: the absolute-5 arm exists to stop rounding from making the floor
 * trivially small, not to demand more atoms than the vault can supply. A
 * 3-atom vault whose scan finds all 3 is complete by definition, so its floor
 * is 3 — without the clamp its floor was 5 and *every* forced pass refused.
 */
export const MIRROR_COMPLETENESS_FLOOR_MIN = 5;
export const MIRROR_COMPLETENESS_FLOOR_RATIO = 0.8;
/** The mark decays to the current scan after this long with no refusal. */
export const MIRROR_HIGHWATER_DECAY_DAYS = 30;
/** Consecutive refused passes before the single escalation Notice. */
export const MIRROR_REFUSAL_ESCALATION_PASSES = 3;

/**
 * How long the deletion dialog may go unanswered before it reads as
 * `dismissed`. It is awaited holding the single-flight lock, so a modal left
 * open — backgrounding the app on mobile is the ordinary way that happens —
 * would otherwise park every later sync as `joined` for the app's lifetime.
 * Long enough that a user actually reading it is not cut off; short enough
 * that a forgotten dialog does not wedge the device.
 */
export const MIRROR_CONFIRM_TIMEOUT_MS = 2 * 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const ASK_MIRROR_REFUSAL_ESCALATION_NOTICE =
  "Atoms has not synced your cloud mirror for the last three passes. Your " +
  "vault scan looks incomplete, so nothing was deleted. Open Settings → " +
  'Atoms and tap "Sync now" once your vault has finished downloading.';

/**
 * Pure formatter — `test/askMirror.test.ts` runs under node with no jsdom, so
 * the string is asserted here and the two surfaces that render it (Ask mirror
 * status line, Atoms home) are a CLI/device row.
 */
export function formatAskMirrorRefusalLine(serverCount: string): string {
  return `Ask mirror: ${serverCount} · sync refused, vault scan incomplete · Sync now to retry`;
}

export function mirrorCompletenessFloor(
  evidenceCount: number,
  highWaterCount: number,
): number {
  const baseline = Math.max(highWaterCount, evidenceCount);
  return Math.min(
    baseline,
    Math.max(
      MIRROR_COMPLETENESS_FLOOR_MIN,
      Math.ceil(baseline * MIRROR_COMPLETENESS_FLOOR_RATIO),
    ),
  );
}

/**
 * The reconcile tripwire (Finding 1). A forced reconcile replaces the whole
 * server-side set with this scan, so its blast radius is the *server* count,
 * not this device's evidence — a fresh phone with 10 of 400 atoms downloaded
 * has no evidence to refuse against and would hard-delete 390 rows.
 *
 * This is strictly additive to `mirrorCompletenessFloor`, never a replacement:
 * it only ever refuses more. The plan's objection to a server-count
 * denominator is a permissiveness argument (60 evidence paths against a
 * 400-row server would pass `400 × 0.2`), and it applies to a rule that
 * *allows* deletes. A reconcile must clear both thresholds.
 */
export function mirrorServerTripwireFloor(lastKnownServerCount: number): number {
  // `Math.max(0, …)` is not cosmetic: `Math.ceil(-1 × 0.8)` is `-0`, and no
  // scan is ever `< -0`, so a stray negative silently disabled the tripwire.
  return Math.max(
    0,
    Math.ceil(lastKnownServerCount * MIRROR_COMPLETENESS_FLOOR_RATIO),
  );
}

export type MirrorScanHighWater = {
  count: number;
  setAt: string;
  lastRefusalAt?: string;
};

/**
 * Absence and corruption are different facts and must not collapse.
 *
 * *Absent* is the honest state of a device that has never refused: the baseline
 * falls back to this device's evidence, which is correct. *Present but
 * unparseable* is a tampered or truncated mark, and reading it as absence
 * silently drops the ratchet's baseline to the already-shrunken evidence — so
 * each pass re-bases on the last one and a staged 400 → 350 → 330 → 300 walk
 * that the ratchet is built to refuse proceeds instead.
 */
export type MirrorHighWaterRead =
  | { state: "absent" }
  | { state: "corrupt" }
  | { state: "ok"; mark: MirrorScanHighWater };

export function readMirrorHighWaterState(
  load: (k: string) => unknown,
): MirrorHighWaterRead {
  const raw = load(LS_ASK_MIRROR_SCAN_HIGHWATER);
  if (raw == null || typeof raw !== "string" || !raw.trim()) {
    return { state: "absent" };
  }
  let o: Partial<MirrorScanHighWater> | null;
  try {
    o = JSON.parse(raw) as Partial<MirrorScanHighWater>;
  } catch {
    return { state: "corrupt" };
  }
  if (
    !o ||
    typeof o !== "object" ||
    typeof o.count !== "number" ||
    !Number.isFinite(o.count) ||
    o.count < 0
  ) {
    return { state: "corrupt" };
  }
  return {
    state: "ok",
    mark: {
      count: o.count,
      setAt: typeof o.setAt === "string" ? o.setAt : "",
      ...(typeof o.lastRefusalAt === "string"
        ? { lastRefusalAt: o.lastRefusalAt }
        : {}),
    },
  };
}

/** The mark when it reads cleanly; null for both absent and corrupt. */
export function readMirrorHighWater(
  load: (k: string) => unknown,
): MirrorScanHighWater | null {
  const read = readMirrorHighWaterState(load);
  return read.state === "ok" ? read.mark : null;
}

export function writeMirrorHighWater(
  save: (k: string, v: string) => void,
  hw: MirrorScanHighWater,
): void {
  save(LS_ASK_MIRROR_SCAN_HIGHWATER, JSON.stringify(hw));
}

/** The mark, or 0 once it has decayed (30 days with no refusal). */
export function effectiveHighWaterCount(
  hw: MirrorScanHighWater | null,
  now: number,
): number {
  if (!hw) return 0;
  const since = Date.parse(hw.lastRefusalAt || hw.setAt);
  if (
    Number.isFinite(since) &&
    now - since >= MIRROR_HIGHWATER_DECAY_DAYS * DAY_MS
  ) {
    return 0;
  }
  return hw.count;
}

/**
 * The stored server count, or null when this device has no *usable* one.
 *
 * A count is a cardinality of rows, so only a positive integer is one. `0` and
 * negatives are rejected for the same reason an unparseable value is: they are
 * not evidence of anything, and admitting them fails open on both arms of the
 * gate at once — `0` makes `lastKnownServerCount == null` false while
 * `mirrorServerTripwireFloor(0)` is 0, so nothing refuses and no modal opens.
 * Neither value is hypothetical: the Wipe button used to store `"0"` literally,
 * and any 2xx with no numeric `count` used to be coerced to it.
 */
export function readAskMirrorServerCount(
  load: (k: string) => unknown,
): number | null {
  const raw = load(LS_ASK_MIRROR_SERVER_COUNT);
  const s = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The stored server count as a label, for the surfaces that show it verbatim.
 * Unparseable or whitespace-only values still render, exactly as stored; only a
 * missing/blank value becomes the dash. Kept beside the numeric read so the two
 * Ask surfaces cannot drift apart.
 */
export const ASK_MIRROR_COUNT_UNKNOWN = "—";

export function formatAskMirrorServerCount(
  load: (k: string) => unknown,
): string {
  const raw = load(LS_ASK_MIRROR_SERVER_COUNT);
  if (typeof raw === "string" && raw.trim() !== "") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return ASK_MIRROR_COUNT_UNKNOWN;
}

/** Plus email from last status, or empty. */
export function readAskMirrorEmail(load: (k: string) => unknown): string {
  const raw = load(LS_ASK_MIRROR_EMAIL);
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Why the mirror is not running, in the caller's terms rather than this module's.
 *
 * `no-ack` covers a withdrawn grant and a never-granted one alike: withdrawal clears the stamp
 * and the version together (#360), so nothing on the device can tell those two apart, and a line
 * that guessed would be wrong for whichever one it guessed against.
 */
export type AskMirrorOffReason = "disabled" | "no-ack" | "stale-ack";

/**
 * A stale ack is the only one of the three the user can undo from the row beside this line, so it
 * is the only one that names a way out. Withdrawal also turned the toggle off, so `Review` alone
 * would not resume it.
 */
const ASK_MIRROR_OFF_WHY: Record<AskMirrorOffReason, string> = {
  disabled: "",
  "no-ack": " · no current privacy acknowledgment",
  "stale-ack": " · privacy acknowledgment out of date, Review to resume",
};

/**
 * One service message, shortened to fit a surface, without lying about where it stopped.
 *
 * Both callers used a bare character cut, which reads as a complete sentence that happens to end
 * badly: an 85-character session-rejected message cut at 72 became "…Sign in again to reconnect
 * t", losing the second half of the only instruction it was giving (#446). Cutting is fine — the
 * status line is width-constrained on mobile and the Notice is shorter still — but a reader has
 * to be able to tell that something was removed.
 *
 * The ellipsis is the honesty, and it is appended only when text was actually dropped, so a
 * message that fits is never dressed up as an excerpt. A single token longer than the budget has
 * no word boundary to fall back to and is cut mid-token deliberately: an empty string would be
 * worse than a truncated one, since the caller renders the clause only when this is non-empty.
 *
 * @param raw service-authored text, possibly absent
 * @param limit character budget for the message body, before the ellipsis
 */
export function truncateMessage(
  raw: string | undefined | null,
  limit: number,
): string {
  const text = (raw || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  // Trailing punctuation left dangling by the cut reads as a typo next to the ellipsis.
  const kept = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(
    /[\s.,;:!?—-]+$/,
    "",
  );
  return kept ? `${kept}…` : "";
}

/**
 * Status line with optional Plus email (R9).
 * Happy: `Ask mirror: N · as you@… · last pushed …`
 * Error: `Ask mirror: N · as you@… · push failed — …`
 * Gated: `Ask mirror: off · <why> · N in the cloud at last check, Wipe cloud copy to delete`
 *
 * The gated arm exists because this line renders on the consent surface itself (#374). Reading
 * only device-local stamps let a device whose gate was shut report a count, an identity, a push
 * failure and a retry call-to-action, which is four true-looking facts about a mirror that is not
 * running. It reports the cloud copy that outlives the gate, because disclosure clause (7) says
 * turning Ask off does not wipe, and Wipe is the gesture that does.
 */
export function formatAskMirrorStatusLine(opts: {
  serverCount: string;
  email: string;
  relativeLastOk: string;
  lastErr?: string;
  refused?: boolean;
  off?: AskMirrorOffReason;
  /** Set when the Plus period has ended, naming which kind it was. */
  lapsed?: PlusLapseKind;
}): string {
  if (opts.off) {
    // Only a positive count earns the clause. Cleared is not zeroed — a wipe leaves no count,
    // and an absence may not be rendered as a sentence about atoms that are still there — and
    // a recorded zero is a cloud that is already empty, which must not be handed a call to
    // action for deleting it. Same `> 0` rule `readAskMirrorServerCount` gates on.
    const n = Number(opts.serverCount);
    const cloud =
      Number.isInteger(n) && n > 0
        ? ` · ${opts.serverCount} in the cloud at last check, Wipe cloud copy to delete`
        : "";
    return `Ask mirror: off${ASK_MIRROR_OFF_WHY[opts.off]}${cloud}`;
  }
  const as = opts.email ? ` · as ${opts.email}` : "";
  // Outranks both the refusal and the push error, and for the same reason it outranks the
  // cheerful "last pushed" this used to show alone: a lapsed account is *why* those happened,
  // and it is the only one of the three the user can act on. Above it sits `off`, which is a
  // choice the user made rather than something that happened to them.
  if (opts.lapsed) {
    return `Ask mirror: ${opts.serverCount}${as} · ${opts.lapsed} ended. Claude and ChatGPT can’t reach these until you subscribe`;
  }
  if (opts.refused) {
    return `Ask mirror: ${opts.serverCount}${as} · sync refused, vault scan incomplete · Sync now to retry`;
  }
  const err = truncateMessage(opts.lastErr, 96);
  if (err) {
    return `Ask mirror: ${opts.serverCount}${as} · push failed${err ? ` (${err})` : ""} · Sync now to retry`;
  }
  return `Ask mirror: ${opts.serverCount}${as} · last pushed ${opts.relativeLastOk}`;
}

export function saveAskMirrorStatus(
  save: (k: string, v: string) => void,
  st: { count: number; email?: string },
): void {
  save(LS_ASK_MIRROR_SERVER_COUNT, String(st.count));
  if (st.email && st.email.includes("@")) {
    save(LS_ASK_MIRROR_EMAIL, st.email.trim().toLowerCase());
  }
}

/**
 * Every device-local Ask key back to its "this device knows nothing" state.
 * Owned here rather than inline in the Wipe button so the reset and the readers
 * cannot drift: a wipe that leaves a *parseable* count behind hands the gate a
 * fabricated authority for the cloud it just emptied.
 */
export function clearAskMirrorDeviceState(
  save: (k: string, v: string) => void,
): void {
  save(LS_ASK_MIRROR_HASHES, "{}");
  save(LS_ASK_MIRROR_LAST_ERROR, "");
  save(LS_ASK_MIRROR_LAST_SUCCESS, "");
  // Cleared, not zeroed. A wipe empties the cloud, so this device knows
  // nothing about the row count — and "0" is a *claim*, not an absence.
  save(LS_ASK_MIRROR_SERVER_COUNT, "");
  save(LS_ASK_MIRROR_EMAIL, "");
  save(LS_ASK_MIRROR_REFUSAL, "");
  save(LS_ASK_MIRROR_SCAN_HIGHWATER, "");
}

/**
 * Host surface for the sign-out / wipe / identity-swap teardown. Settings owned the first
 * copy (#372); session install needs the same sequence without a Settings tab (#393).
 */
export type AskMirrorDisarmHost = {
  settings: { askEnabled: boolean };
  saveSettings: () => Promise<void>;
  mirrorPermitted: () => boolean;
  cancelPendingSync: () => void;
  saveLocalStorage: (k: string, v: string) => void;
};

/**
 * The one owner of "this device is no longer mirroring, but the consent record stands":
 * disarm, persist, drop owed pushes, then forget the baseline. Order is the invariant —
 * clear-then-disarm is #371 (armed mirror over empty baseline).
 *
 * Acks are left standing: withdrawal keys off the ack timestamp.
 */
export async function disarmAskMirror(host: AskMirrorDisarmHost): Promise<void> {
  host.settings.askEnabled = false;
  await host.saveSettings();
  if (!host.mirrorPermitted()) host.cancelPendingSync();
  clearAskMirrorDeviceState((k, v) => host.saveLocalStorage(k, v));
}

/**
 * Whether installing `nextEmail` would hand a different identity the previous account's
 * arming/baseline. Compares against the live Plus session *and* residual mirror email
 * (lapsed session clears Sign out but leaves device-local mirror state).
 *
 * Same-email re-auth returns false so the baseline survives (#396 owns durable keying).
 */
export function plusSessionIdentityChanged(
  previousSessionEmail: string | null | undefined,
  mirrorEmail: string | null | undefined,
  nextEmail: string,
): boolean {
  const next = nextEmail.trim().toLowerCase();
  if (!next) return false;
  const prev = (previousSessionEmail ?? "").trim().toLowerCase();
  const mir = (mirrorEmail ?? "").trim().toLowerCase();
  if (prev && prev !== next) return true;
  if (mir && mir !== next) return true;
  return false;
}

/**
 * Modal heading for a refusal. The dialog authorising an irreversible delete
 * hard-coded "Vault scan looks incomplete" for every reason, which is simply
 * untrue for two of the four.
 */
export function mirrorRefusalTitle(reason?: MirrorDeletionRefusal): string {
  switch (reason) {
    case "no-server-count":
      return "Cloud count unknown";
    case "server-count-tripwire":
      return "Fewer atoms here than in the cloud";
    case "baseline-unreadable":
      return "Sync baseline unreadable";
    default:
      return "Vault scan looks incomplete";
  }
}

/** Modal explanation for a refusal — the paragraph under the heading. */
export function mirrorRefusalBody(reason?: MirrorDeletionRefusal): string {
  const kept = "Atoms did not delete anything from your cloud mirror.";
  switch (reason) {
    case "no-server-count":
      return `${kept} This device has never seen the cloud count, so it cannot tell how much a delete would remove.`;
    case "server-count-tripwire":
      return `${kept} This vault holds far fewer atoms than the cloud does, which usually means the vault is still downloading.`;
    case "baseline-unreadable":
      return `${kept} This device's sync baseline is unreadable, so it cannot tell whether the vault has finished downloading.`;
    default:
      return `${kept} This device found fewer atoms than it has synced before, which usually means the vault is still downloading.`;
  }
}

export type MirrorRefusalState = { count: number; noticed: boolean };

export function readAskMirrorRefusal(
  load: (k: string) => unknown,
): MirrorRefusalState {
  const raw = load(LS_ASK_MIRROR_REFUSAL);
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return { count: 0, noticed: false };
  }
  try {
    const o = JSON.parse(raw) as Partial<MirrorRefusalState>;
    return {
      count: typeof o?.count === "number" && o.count > 0 ? o.count : 0,
      noticed: o?.noticed === true,
    };
  } catch {
    return { count: 0, noticed: false };
  }
}

function writeAskMirrorRefusal(
  save: (k: string, v: string) => void,
  state: MirrorRefusalState,
): void {
  save(LS_ASK_MIRROR_REFUSAL, JSON.stringify(state));
}

export type MirrorDeletionDecision =
  | { allowed: true }
  /** `floor` is the threshold this pass failed to clear, per `reason`. */
  | { allowed: false; reason: MirrorDeletionRefusal; floor: number };

/**
 * The gate. Deletion is allowed only when the scan is credibly complete, or
 * when a human confirmed it against the concrete counts.
 *
 * Two independent thresholds, and a delete must clear both:
 *
 * 1. The completeness floor, whose denominator is *this device's* evidence —
 *    never the server count, which is the total across all devices and would
 *    make the floor a no-op on exactly the devices at risk.
 * 2. On the reconcile path only (`reconcile: true`), the server tripwire. A
 *    reconcile deletes every row this scan does not name, so a device with
 *    little or no evidence has nothing for the floor to bite on and the
 *    server count is the only measure of what is about to be destroyed.
 */
export function decideMirrorDeletion(input: {
  /**
   * Paths the vault scan found now — the exact set a forced reconcile sends as
   * `keepPaths`, and therefore the only honest measure of what survives on the
   * server. The tripwire arm uses this; the completeness arm must not.
   */
  scannedCount: number;
  /**
   * How many of *this device's own* evidence paths the scan still found.
   *
   * The completeness floor's denominator is evidence, so its numerator has to
   * be evidence too. Measuring the raw scan against an evidence-derived floor
   * compares two different sets, and a newly created atom then pays for a
   * missing one: 50 surviving evidence paths plus 50 brand-new atoms scores
   * 100 against a floor of 80 and deletes the 50 rows that were only missing
   * because the vault had not finished downloading.
   */
  survivingEvidenceCount: number;
  evidenceCount: number;
  highWaterCount: number;
  lastKnownServerCount: number | null;
  /** True for the forced full-keepPaths reconcile, false for delta deletes. */
  reconcile?: boolean;
  /** The stored mark is present but unreadable — the ratchet has no baseline. */
  highWaterCorrupt?: boolean;
  confirmation?: DeletionConfirmation | null;
}): MirrorDeletionDecision {
  const floor = mirrorCompletenessFloor(
    input.evidenceCount,
    input.highWaterCount,
  );
  if (input.confirmation) return { allowed: true };
  if (input.highWaterCorrupt) {
    // The baseline every other threshold is measured against is gone. Nothing
    // below can be trusted, so refuse before consulting any of it.
    return { allowed: false, reason: "baseline-unreadable", floor };
  }
  if (input.lastKnownServerCount == null) {
    return { allowed: false, reason: "no-server-count", floor };
  }
  if (input.survivingEvidenceCount < floor) {
    return { allowed: false, reason: "scan-incomplete", floor };
  }
  if (input.reconcile) {
    const serverFloor = mirrorServerTripwireFloor(input.lastKnownServerCount);
    if (input.scannedCount < serverFloor) {
      return {
        allowed: false,
        reason: "server-count-tripwire",
        floor: serverFloor,
      };
    }
  }
  return { allowed: true };
}

/**
 * The only constructor for a `DeletionConfirmation`, called from exactly one
 * branch below — the `confirmed` verdict returned by the host's modal. It is
 * not exported: `force`, an empty scan, or an invoked command cannot mint one.
 */
function mintDeletionConfirmation(input: {
  scannedCount: number;
  evidenceCount: number;
}): DeletionConfirmation {
  return {
    confirmEmpty: input.scannedCount === 0,
    scannedCount: input.scannedCount,
    evidenceCount: input.evidenceCount,
  } as unknown as DeletionConfirmation;
}

export type AskMirrorCallResult = { ok: true } | { ok: false; message: string };

export type AskMirrorHost = {
  atomFolder?: string;
  /** Flat atom files, already read. */
  scanAtoms(): Promise<VaultFileRead[]>;
  /** Hub notes for the given linked titles, already read + allowlisted. */
  resolveHubs(titles: string[]): Promise<VaultFileRead[]>;
  load(key: string): unknown;
  save(key: string, value: string): void;
  upsert(
    atoms: AskMirrorAtomPayload[],
  ): Promise<{ ok: true; upserted: number } | { ok: false; message: string }>;
  deletePaths(paths: string[]): Promise<AskMirrorCallResult>;
  reconcile(opts: {
    keepPaths: string[];
    done: boolean;
    reconcileSessionId?: string;
    confirmEmpty: boolean;
  }): Promise<AskMirrorCallResult>;
  status(): Promise<
    | { ok: true; count: number; email?: string }
    | { ok: false; message: string }
  >;
  confirm(request: ConfirmRequest): Promise<ConfirmVerdict>;
  /**
   * Withdraw a `confirm` the gate has stopped waiting for. Optional so a host
   * that cannot cancel still compiles, but a host whose `confirm` shows UI must
   * implement it: the timeout below abandons the race, and an abandoned dialog
   * left on screen still offers "Delete from cloud". Tapping it resolves an
   * already-settled promise, so the user authorises an irreversible delete and
   * nothing at all happens — the one outcome an irreversible-delete prompt must
   * never produce.
   */
  cancelConfirm?(): void;
  /**
   * Whether this device may *still* mirror, asked live between the pass's awaits rather than
   * once at the top. A pass snapshots the hash baseline at its start and persists a copy after
   * every chunk, so a sign-out teardown landing mid-flight — which disarms first and empties the
   * baseline second — would be undone by the next chunk restoring the whole map, and the account
   * signing in next would inherit a baseline naming rows it never pushed (#372).
   *
   * Optional, defaulting to permitted, so a host with no teardown to race still compiles and an
   * uninterrupted pass behaves exactly as before.
   */
  stillPermitted?(): boolean;
  /** Transient user-facing message (escalation only). */
  notice(message: string): void;
  now?(): number;
  /** Override for `MIRROR_CONFIRM_TIMEOUT_MS` (tests). */
  confirmTimeoutMs?: number;
};

/**
 * What one push did. Failure is a `kind`, never a magic count: a sentinel in a
 * number field is one missed comparison away from reading a hard failure as a
 * clean zero-upload success (the same reason `MirrorSyncOutcome` is tagged).
 */
export type AskMirrorSyncResult =
  | {
      kind: "ok";
      /** Atoms upserted this pass; legitimately 0. */
      uploaded: number;
      deleted: number;
      refused: boolean;
      /** Which threshold refused, so callers report the reason instead of "0 synced". */
      refusalReason?: MirrorDeletionRefusal;
    }
  | {
      kind: "failed";
      deleted: number;
      /** Never refused — the run stopped before, or instead of, a gate verdict. */
      refused: false;
      failureMessage: string;
    };

/**
 * The completeness gate (R8) plus its one release valve. A refused *forced*
 * push asks the user, and only a `confirmed` verdict mints the token that the
 * gate is re-run against — the sole path to a lowered bar.
 */
async function resolveMirrorDeletionGate(
  host: AskMirrorHost,
  save: (k: string, v: string) => void,
  args: {
    scannedCount: number;
    survivingEvidenceCount: number;
    evidenceCount: number;
    highWaterCount: number;
    highWaterCorrupt: boolean;
    lastKnownServerCount: number | null;
    force: boolean;
  },
): Promise<{
  decision: MirrorDeletionDecision;
  confirmation: DeletionConfirmation | null;
  /** True once `status()` ran here, so the caller does not ask twice. */
  serverCountRefreshed: boolean;
}> {
  const {
    scannedCount,
    survivingEvidenceCount,
    evidenceCount,
    highWaterCount,
    highWaterCorrupt,
  } = args;
  const force = args.force;
  let serverCount = args.lastKnownServerCount;
  const judge = (confirmation?: DeletionConfirmation) =>
    decideMirrorDeletion({
      scannedCount,
      survivingEvidenceCount,
      evidenceCount,
      highWaterCount,
      highWaterCorrupt,
      lastKnownServerCount: serverCount,
      reconcile: force,
      ...(confirmation ? { confirmation } : {}),
    });

  // The server tripwire is consulted on the reconcile path only, and there it
  // is the sole measure of the blast radius: a reconcile deletes every row
  // this scan does not name. So the count it judges — and the number any
  // dialog shows — must be *this moment's*, asked before the verdict and not
  // only after a stale one has already refused. The stored count is old by
  // definition on exactly the device at risk: it was written when this device
  // last synced, and another device pushing 395 atoms since is invisible to
  // it. Trusting it on the *allow* path is how a phone holding 3 of 400 atoms
  // talks itself into deleting the other 397.
  let serverCountRefreshed = false;
  if (force) {
    const st = await host.status();
    // A fresh `0` is authoritative — the cloud really is empty, and nothing
    // can be deleted from it. Only a *stored* `0` is untrustworthy (it is what
    // a wipe and a bodyless 2xx both used to leave behind). Anything that is
    // not a whole non-negative count is not a count at all.
    if (!st.ok || !Number.isInteger(st.count) || st.count < 0) {
      // Fail closed. Never fall back to the stale value, and never reconcile
      // — nor pose an irreversible question — on a count we could not get.
      //
      // Route the refusal through `judge()` rather than hand-building it. The
      // hand-built copy had already drifted: it reported `no-server-count`
      // even when the real reason was a corrupt baseline, which
      // `decideMirrorDeletion` checks *first* and reports differently. One
      // author for the refusal shape, so the reason cannot lie again.
      serverCount = null;
      return {
        decision: judge(),
        confirmation: null,
        serverCountRefreshed: false,
      };
    }
    saveAskMirrorStatus(save, st);
    serverCount = st.count;
    serverCountRefreshed = true;
  }

  // The fresh count decides both ways: it can clear the gate as well as close
  // it — a first sync against an empty cloud has nothing to delete, and a
  // delete dialog there is misinformation.
  let decision = judge();
  if (decision.allowed || !force) {
    return { decision, confirmation: null, serverCountRefreshed };
  }

  // Neither can hold here — the refresh above either produced a count or
  // returned. Asserting it rather than asserting *about* it means a future
  // path that reaches the dialog without a count fails closed instead of
  // posing a question the user cannot answer informedly.
  if (serverCount == null || decision.reason === "no-server-count") {
    return { decision, confirmation: null, serverCountRefreshed };
  }

  // The refusal's release valve: an explicit gesture the user is already
  // attending to ("Sync now"), never a silent delta pass.
  const verdict = await confirmWithTimeout(host, {
    kind: "ask-mirror-deletion",
    evidenceCount,
    scannedCount,
    lastKnownServerCount: serverCount,
    reason: decision.reason,
  });
  let confirmation: DeletionConfirmation | null = null;
  if (verdict === "confirmed") {
    confirmation = mintDeletionConfirmation({ scannedCount, evidenceCount });
    decision = judge(confirmation);
  }
  return { decision, confirmation, serverCountRefreshed };
}

/**
 * Ask, but never wait forever. Backgrounding the app on mobile with the modal
 * open resolves no branch, and the gate is awaited holding the single-flight
 * lock — so an unanswered dialog parks every later sync as `joined` and stalls
 * every queued Ask write for the app's lifetime. Timing out reads as
 * `dismissed`, which already means leave the mirror untouched.
 */
async function confirmWithTimeout(
  host: AskMirrorHost,
  request: ConfirmRequest,
): Promise<ConfirmVerdict> {
  const ms = host.confirmTimeoutMs ?? MIRROR_CONFIRM_TIMEOUT_MS;
  let timer: number | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      host.confirm(request),
      new Promise<ConfirmVerdict>((resolve) => {
        timer = window.setTimeout(() => {
          timedOut = true;
          resolve("dismissed");
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    // Losing the race is not the same as the question going away. Tell the
    // host to take the dialog down, or it keeps offering a delete this pass
    // has already stopped listening for.
    if (timedOut) host.cancelConfirm?.();
  }
}

/**
 * Full keepPaths reconcile (orphan delete), single call under the chunk bar and
 * a session-tagged sequence above it. `confirmEmpty` rides only the final call,
 * so a partial sequence can never authorise an empty-vault wipe.
 */
async function applyMirrorReconcile(
  host: AskMirrorHost,
  keepPaths: string[],
  confirmEmpty: boolean,
): Promise<AskMirrorCallResult> {
  if (keepPaths.length <= 500) {
    return host.reconcile({ keepPaths, done: true, confirmEmpty });
  }
  // The server keys staging sessions per *account*, not per device, and a bare
  // millisecond collides: two of the user's own devices starting a chunked
  // reconcile in the same tick share one staging set, and whichever commits
  // first deletes what the other had not yet staged. The suffix stays well
  // inside the server's 80-char slice.
  const rand = Math.random().toString(36).slice(2, 10);
  const sid = `rec-${host.now?.() ?? Date.now()}-${rand}`;
  for (let i = 0; i < keepPaths.length; i += 500) {
    const chunk = keepPaths.slice(i, i + 500);
    const last = i + 500 >= keepPaths.length;
    const r = await host.reconcile({
      keepPaths: chunk,
      done: last,
      reconcileSessionId: sid,
      confirmEmpty: last ? confirmEmpty : false,
    });
    if (!r.ok) return r;
  }
  return { ok: true };
}

export async function runAskMirrorSync(
  host: AskMirrorHost,
  opts: { force: boolean },
): Promise<AskMirrorSyncResult> {
  const force = opts.force;
  const folder = host.atomFolder?.replace(/\/$/, "") || "Atoms";
  const load = (k: string) => host.load(k);
  // Every device-local write this pass makes goes through here, so the teardown check sits on
  // the seam rather than on each of the dozen call sites — including the ones a later change
  // adds. Read live at each write, never captured: the whole point is that the answer changes
  // underneath a pass that is already running.
  const permitted = () => host.stillPermitted?.() ?? true;
  const save = (k: string, v: string) => {
    if (!permitted()) return;
    host.save(k, v);
  };

  const atomReads = await host.scanAtoms();
  const hashSnapshot = readAskMirrorHashes(load);

  const hashesForUpsert = force ? {} : hashSnapshot;
  const { atoms: atomPayloads, nextHashes: atomNext } = planAskMirrorUpsert(
    atomReads,
    folder,
    hashesForUpsert,
    { kind: "atom" },
  );

  // Hubs: vault notes outside Atoms/ that atoms wikilink to
  const allAtomLinks = planAskMirrorUpsert(atomReads, folder, {}, {
    kind: "atom",
  }).atoms;
  const hubReads = await host.resolveHubs(collectHubLinkTitles(allAtomLinks));
  const { atoms: hubPayloads, nextHashes: hubNext } = planAskMirrorUpsert(
    hubReads,
    folder,
    hashesForUpsert,
    { kind: "hub" },
  );

  const atoms = [...atomPayloads, ...hubPayloads];
  // `planAskMirrorUpsert` returns a full copy of the map it was seeded with, not just the entries
  // it freshened. Both planners are seeded from the same `hashesForUpsert`, so a plain
  // `{ ...atomNext, ...hubNext }` let the hub planner's *stale* atom entries overwrite the atom
  // planner's freshened ones: the atom uploaded, its old hash persisted, and the next pass found it
  // dirty again — background syncs never converged (#397). Reversing the spread only moves the bug,
  // because `atomNext` carries stale hub entries in exactly the same way.
  //
  // So apply only what each planner actually freshened, using its payload list as the authority.
  // Seeding from `hashesForUpsert` keeps the force path delta-only (it is `{}` there), which the
  // orphan sweep below relies on — see "upsertNext has all when force".
  const upsertNext = { ...hashesForUpsert };
  for (const p of atomPayloads) {
    const h = atomNext[p.path];
    if (h) upsertNext[p.path] = h;
  }
  for (const p of hubPayloads) {
    const h = hubNext[p.path];
    if (h) upsertNext[p.path] = h;
  }
  const vaultPaths = new Set([
    ...atomReads.map((f) => f.path),
    ...hubReads.map((f) => f.path),
  ]);
  const { deletePaths } = planAskMirrorDeletes(vaultPaths, hashSnapshot);

  let workingHashes = { ...hashSnapshot };
  let uploaded = 0;
  let deleted = 0;

  const fail = (msg: string): AskMirrorSyncResult => {
    save(LS_ASK_MIRROR_LAST_ERROR, msg);
    return { kind: "failed", deleted, refused: false, failureMessage: msg };
  };

  /**
   * Torn down while this pass was in the air. Not `fail()`: that records an error against a
   * mirror that no longer exists on this device, and the guarded `save` would drop it anyway.
   * Leaving *nothing* behind is the contract — the device stays exactly as the teardown left it.
   */
  const stopped = (): AskMirrorSyncResult => ({
    kind: "failed",
    deleted,
    refused: false,
    failureMessage: ASK_MIRROR_STOPPED,
  });

  // Upsert dirty (chunk 100) — never skip solely because atoms is empty
  for (let i = 0; i < atoms.length; i += 100) {
    const chunk = atoms.slice(i, i + 100);
    const r = await host.upsert(chunk);
    if (!r.ok) return fail(r.message);
    // One check, two jobs: nothing is persisted from this chunk, and the loop does not push the
    // next one. The upload above already left the cloud, which is why the next line down —
    // persisting evidence of it — is the thing that must not happen.
    if (!permitted()) return stopped();
    uploaded += r.upserted;
    for (const a of chunk) {
      const h = upsertNext[a.path];
      if (h) workingHashes[a.path] = h;
    }
    writeAskMirrorHashes(save, workingHashes);
  }

  // --- Completeness gate (R8) ---------------------------------------------
  // Nothing above this line deletes; everything below it can.
  const scannedCount = vaultPaths.size;
  const evidenceCount = Object.keys(hashSnapshot).length;
  // Two different questions, so two different numbers. `scannedCount` answers
  // "how much survives a reconcile" (it is keepPaths). This answers "did my own
  // prior evidence survive the scan" — the only one the completeness floor can
  // honestly ask, because its denominator is that same evidence. Every path the
  // delete planner named is an evidence path the scan did not find.
  const survivingEvidenceCount = evidenceCount - deletePaths.length;
  const nowMs = host.now?.() ?? Date.now();
  // Absent and corrupt are different facts. Absent means this device has no
  // prior mark, so the evidence count is the honest baseline. Corrupt means a
  // mark exists and cannot be read — losing it silently re-bases the floor on
  // an already-shrunken scan, which is exactly how the ratchet gets defeated.
  const highWaterRead = readMirrorHighWaterState(load);
  const highWater = highWaterRead.state === "ok" ? highWaterRead.mark : null;
  const highWaterCorrupt = highWaterRead.state === "corrupt";
  const highWaterCount = effectiveHighWaterCount(highWater, nowMs);
  const lastKnownServerCount = readAskMirrorServerCount(load);

  // Whether the gate actually judged anything. A pass with nothing to delete
  // and no force proves the vault is complete no more than it proves the
  // opposite — it simply never asked.
  const gateEvaluated = deletePaths.length > 0 || force;

  const { decision, confirmation, serverCountRefreshed } = gateEvaluated
    ? await resolveMirrorDeletionGate(host, save, {
          scannedCount,
          survivingEvidenceCount,
          evidenceCount,
          highWaterCount,
          highWaterCorrupt,
          lastKnownServerCount,
          force,
        })
      : {
          decision: { allowed: true } as MirrorDeletionDecision,
          confirmation: null as DeletionConfirmation | null,
          serverCountRefreshed: false,
        };

  if (!decision.allowed) {
    save(LS_ASK_MIRROR_LAST_ERROR, "");
    const prev = readAskMirrorRefusal(load);
    const next: MirrorRefusalState = {
      count: prev.count + 1,
      noticed: prev.noticed,
    };
    if (next.count >= MIRROR_REFUSAL_ESCALATION_PASSES && !next.noticed) {
      next.noticed = true;
      host.notice(ASK_MIRROR_REFUSAL_ESCALATION_NOTICE);
    }
    writeAskMirrorRefusal(save, next);
    // Refusing does not touch the mark, and never creates one from a scan
    // being judged — only stamps that a refusal happened, to hold off decay.
    if (highWater) {
      writeMirrorHighWater(save, {
        ...highWater,
        lastRefusalAt: new Date(nowMs).toISOString(),
      });
    }
    // Still refresh the server count so a device whose first sync failed is
    // not stuck refusing forever — unless the gate already refreshed it just
    // now to decide, in which case asking again is a wasted round trip.
    if (!serverCountRefreshed) {
      const st = await host.status();
      if (st.ok) saveAskMirrorStatus(save, st);
    }
    return {
      kind: "ok",
      uploaded,
      deleted: 0,
      refused: true,
      refusalReason: decision.reason,
    };
  }

  // Delete hash-evidence missing paths (chunk 100). Delete-then-persist is
  // deliberate: a crash leaves evidence naming a deleted path and the next
  // pass re-issues an idempotent delete. Reversed, the row is unreachable.
  for (let i = 0; i < deletePaths.length; i += 100) {
    const chunk = deletePaths.slice(i, i + 100);
    const r = await host.deletePaths(chunk);
    if (!r.ok) return fail(r.message);
    if (!permitted()) return stopped();
    deleted += chunk.length;
    for (const p of chunk) delete workingHashes[p];
    writeAskMirrorHashes(save, workingHashes);
  }

  // Force: full keepPaths reconcile (orphan delete)
  if (force) {
    const keepPaths = [...vaultPaths];
    // Carried by the confirmation token — never derived from emptiness, from
    // `force`, or from the fact that a command was invoked.
    const confirmEmpty = confirmation?.confirmEmpty === true;
    const r = await applyMirrorReconcile(host, keepPaths, confirmEmpty);
    if (!r.ok) return fail(r.message);
    if (!permitted()) return stopped();
    // After force, evidence map = exact vault set (upsertNext has all when force)
    const rebuilt: Record<string, string> = {};
    for (const p of keepPaths) {
      const h = upsertNext[p] ?? workingHashes[p] ?? hashSnapshot[p];
      if (h) rebuilt[p] = h;
    }
    workingHashes = rebuilt;
    writeAskMirrorHashes(save, workingHashes);
  }

  // The tail is all device state — the refusal reset, the high-water ratchet, "last pushed", and
  // the server count and email `status()` brings back. The guarded `save` would drop every one of
  // them; checking here says so up front and spares the round trip.
  if (!permitted()) return stopped();

  // Success: clear error + refresh server count. Only stamp "last pushed"
  // when this run mutated the mirror (or user forced Sync now).
  save(LS_ASK_MIRROR_LAST_ERROR, "");
  // Clear on a pass that *passes the floor*, which is a statement about scan
  // completeness — not about whether this pass happened to have deletes. Two
  // ways to get this wrong, and both bite:
  //   - reset unconditionally, and an incomplete-scan pass with nothing to
  //     delete silently retracts the escalation notice while the vault is
  //     still missing atoms;
  //   - reset only when the gate ran, and a user who never deleted anything
  //     stays wedged forever — once their vault finishes syncing there are no
  //     deletes to plan, so the gate stops being consulted at all.
  // A confirmed prune is converged by definition — the user was shown the
  // counts and authorised them — but it reaches here *below* the floor, since
  // being below the floor is why it had to ask. Without the confirmation arm
  // the banner keeps saying "sync refused" while this same click's toast says
  // "reconciled". Measured against surviving evidence, like the gate itself.
  if (
    confirmation ||
    survivingEvidenceCount >=
      mirrorCompletenessFloor(evidenceCount, highWaterCount)
  ) {
    writeAskMirrorRefusal(save, { count: 0, noticed: false });
  }
  // The mark tracks the pre-shrinkage baseline: raised by any complete pass,
  // lowered only by an explicitly confirmed reconcile (or by decay above).
  //
  // It ratchets on *evidence*, not on vault cardinality, because the floor it
  // feeds is now measured against surviving evidence. Mixing the two wedges an
  // ordinary user: a vault of 500 files with 400 evidence paths would set the
  // mark to 500, pushing the floor to exactly 400 — so a single legitimately
  // deleted atom could never clear it. On a confirmed reconcile the evidence
  // map is rebuilt to the exact vault set below, so `scannedCount` is the
  // evidence count this pass ends with.
  writeMirrorHighWater(save, {
    count: confirmation
      ? scannedCount
      : Math.max(highWaterCount, evidenceCount),
    setAt: new Date(nowMs).toISOString(),
  });
  const mutated = uploaded > 0 || deleted > 0 || force;
  if (mutated) {
    save(
      LS_ASK_MIRROR_LAST_SUCCESS,
      new Date(host.now?.() ?? Date.now()).toISOString(),
    );
  }
  const st = await host.status();
  if (st.ok) {
    saveAskMirrorStatus(save, st);
  }
  return { kind: "ok", uploaded, deleted, refused: false };
}

/**
 * Titles referenced from atom payloads that should be resolved to hub notes.
 */
export function collectHubLinkTitles(
  atomPayloads: AskMirrorAtomPayload[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of atomPayloads) {
    for (const l of a.links || []) {
      const t = String(l.note || "").trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}
