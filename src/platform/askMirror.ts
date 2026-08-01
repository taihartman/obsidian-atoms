/**
 * Ask mirror push planner — Atoms/ paths only, hash skip.
 * Structured links prefer frontmatter `atom-links:`; body is not mined for reasons.
 */
import { parseLinkProse } from "../pipeline/parseLinkProse";
import type {
  ConfirmRequest,
  ConfirmVerdict,
  DeletionConfirmation,
} from "../shared/confirm";

/** Device-local (not data.json) — multi-device safe evidence map. */
export const LS_ASK_MIRROR_HASHES = "atoms-ask-mirror-hashes-v1";
export const LS_ASK_MIRROR_LAST_SUCCESS = "atoms-ask-mirror-last-success-v1";
export const LS_ASK_MIRROR_LAST_ERROR = "atoms-ask-mirror-last-error-v1";
export const LS_ASK_MIRROR_SERVER_COUNT = "atoms-ask-mirror-server-count-v1";
/** Pre-shrinkage baseline for the completeness floor — device-local only. */
export const LS_ASK_MIRROR_SCAN_HIGHWATER = "atoms-mirror-scan-highwater-v1";
/** Consecutive refused passes + whether the escalation Notice already fired. */
export const LS_ASK_MIRROR_REFUSAL = "atoms-mirror-refusal-v1";

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
};

export type VaultFileRead = {
  path: string;
  basename: string;
  content: string;
};

type FmLink = { note: string; reason?: string };

/** Parse frontmatter tags, atom-links, parent/relation, body. */
export function splitAtomMarkdown(content: string): {
  body: string;
  tags: string[];
  parent?: string;
  relation?: string;
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

  return {
    body,
    tags,
    fmLinks,
    ...(parent ? { parent } : {}),
    ...(relation ? { relation } : {}),
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
    const reason =
      rel === "revises"
        ? `revises [[${p}]]`
        : rel === "contradicts"
          ? `contradicts [[${p}]]`
          : rel === "adds_detail"
            ? `adds detail to [[${p}]]`
            : rel === "continues"
              ? `continues [[${p}]]`
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
    const { body, tags, parent, relation, fmLinks } = splitAtomMarkdown(
      f.content,
    );
    const title = f.basename.replace(/\.md$/i, "");
    const links = linksFromAtomFile({ body, fmLinks, parent, relation });
    const hash = contentHash([
      title,
      body,
      JSON.stringify(tags),
      JSON.stringify(links),
      kind,
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
  return `Ask mirror: ${serverCount} · sync refused — vault scan incomplete · Sync now to retry`;
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
  return Math.ceil(lastKnownServerCount * MIRROR_COMPLETENESS_FLOOR_RATIO);
}

export type MirrorScanHighWater = {
  count: number;
  setAt: string;
  lastRefusalAt?: string;
};

export function readMirrorHighWater(
  load: (k: string) => unknown,
): MirrorScanHighWater | null {
  const raw = load(LS_ASK_MIRROR_SCAN_HIGHWATER);
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  try {
    const o = JSON.parse(raw) as Partial<MirrorScanHighWater>;
    if (!o || typeof o.count !== "number" || !Number.isFinite(o.count)) {
      return null;
    }
    return {
      count: o.count,
      setAt: typeof o.setAt === "string" ? o.setAt : "",
      ...(typeof o.lastRefusalAt === "string"
        ? { lastRefusalAt: o.lastRefusalAt }
        : {}),
    };
  } catch {
    return null;
  }
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

export function readAskMirrorServerCount(
  load: (k: string) => unknown,
): number | null {
  const raw = load(LS_ASK_MIRROR_SERVER_COUNT);
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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

export type MirrorDeletionRefusal =
  | "scan-incomplete"
  | "no-server-count"
  | "server-count-tripwire";

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
  scannedCount: number;
  evidenceCount: number;
  highWaterCount: number;
  lastKnownServerCount: number | null;
  /** True for the forced full-keepPaths reconcile, false for delta deletes. */
  reconcile?: boolean;
  confirmation?: DeletionConfirmation | null;
}): MirrorDeletionDecision {
  const floor = mirrorCompletenessFloor(
    input.evidenceCount,
    input.highWaterCount,
  );
  if (input.confirmation) return { allowed: true };
  if (input.lastKnownServerCount == null) {
    return { allowed: false, reason: "no-server-count", floor };
  }
  if (input.scannedCount < floor) {
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
    { ok: true; count: number } | { ok: false; message: string }
  >;
  confirm(request: ConfirmRequest): Promise<ConfirmVerdict>;
  /** Transient user-facing message (escalation only). */
  notice(message: string): void;
  now?(): number;
};

export type AskMirrorSyncResult = {
  /** Atoms upserted, or -1 when the run failed (matches the old contract). */
  uploaded: number;
  deleted: number;
  refused: boolean;
  failureMessage?: string;
};

export async function runAskMirrorSync(
  host: AskMirrorHost,
  opts: { force: boolean },
): Promise<AskMirrorSyncResult> {
  const force = opts.force;
  const folder = host.atomFolder?.replace(/\/$/, "") || "Atoms";
  const load = (k: string) => host.load(k);
  const save = (k: string, v: string) => host.save(k, v);

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
  const upsertNext = { ...atomNext, ...hubNext };
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
    return { uploaded: -1, deleted, refused: false, failureMessage: msg };
  };

  // Upsert dirty (chunk 100) — never skip solely because atoms is empty
  for (let i = 0; i < atoms.length; i += 100) {
    const chunk = atoms.slice(i, i + 100);
    const r = await host.upsert(chunk);
    if (!r.ok) return fail(r.message);
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
  const nowMs = host.now?.() ?? Date.now();
  const highWater = readMirrorHighWater(load);
  const highWaterCount = effectiveHighWaterCount(highWater, nowMs);
  const lastKnownServerCount = readAskMirrorServerCount(load);

  let confirmation: DeletionConfirmation | null = null;
  let decision: MirrorDeletionDecision = { allowed: true };
  if (deletePaths.length > 0 || force) {
    decision = decideMirrorDeletion({
      scannedCount,
      evidenceCount,
      highWaterCount,
      lastKnownServerCount,
      reconcile: force,
    });
    // The refusal's release valve: an explicit gesture the user is already
    // attending to ("Sync now"), never a silent delta pass.
    if (!decision.allowed && force) {
      const verdict = await host.confirm({
        kind: "ask-mirror-deletion",
        evidenceCount,
        scannedCount,
        lastKnownServerCount,
      });
      if (verdict === "confirmed") {
        confirmation = mintDeletionConfirmation({
          scannedCount,
          evidenceCount,
        });
        decision = decideMirrorDeletion({
          scannedCount,
          evidenceCount,
          highWaterCount,
          lastKnownServerCount,
          reconcile: force,
          confirmation,
        });
      }
    }
  }

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
    // not stuck refusing forever.
    const st = await host.status();
    if (st.ok) save(LS_ASK_MIRROR_SERVER_COUNT, String(st.count));
    return { uploaded, deleted: 0, refused: true };
  }

  // Delete hash-evidence missing paths (chunk 100). Delete-then-persist is
  // deliberate: a crash leaves evidence naming a deleted path and the next
  // pass re-issues an idempotent delete. Reversed, the row is unreachable.
  for (let i = 0; i < deletePaths.length; i += 100) {
    const chunk = deletePaths.slice(i, i + 100);
    const r = await host.deletePaths(chunk);
    if (!r.ok) return fail(r.message);
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
    if (keepPaths.length <= 500) {
      const r = await host.reconcile({
        keepPaths,
        done: true,
        confirmEmpty,
      });
      if (!r.ok) return fail(r.message);
    } else {
      const sid = `rec-${(host.now?.() ?? Date.now())}`;
      for (let i = 0; i < keepPaths.length; i += 500) {
        const chunk = keepPaths.slice(i, i + 500);
        const last = i + 500 >= keepPaths.length;
        const r = await host.reconcile({
          keepPaths: chunk,
          done: last,
          reconcileSessionId: sid,
          confirmEmpty: last ? confirmEmpty : false,
        });
        if (!r.ok) return fail(r.message);
      }
    }
    // After force, evidence map = exact vault set (upsertNext has all when force)
    const rebuilt: Record<string, string> = {};
    for (const p of keepPaths) {
      const h = upsertNext[p] ?? workingHashes[p] ?? hashSnapshot[p];
      if (h) rebuilt[p] = h;
    }
    workingHashes = rebuilt;
    writeAskMirrorHashes(save, workingHashes);
  }

  // Success: clear error + refresh server count. Only stamp "last pushed"
  // when this run mutated the mirror (or user forced Sync now).
  save(LS_ASK_MIRROR_LAST_ERROR, "");
  writeAskMirrorRefusal(save, { count: 0, noticed: false });
  // The mark tracks the pre-shrinkage baseline: raised by any complete pass,
  // lowered only by an explicitly confirmed reconcile (or by decay above).
  writeMirrorHighWater(save, {
    count: confirmation
      ? scannedCount
      : Math.max(highWaterCount, scannedCount, evidenceCount),
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
    save(LS_ASK_MIRROR_SERVER_COUNT, String(st.count));
  }
  return { uploaded, deleted, refused: false };
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
