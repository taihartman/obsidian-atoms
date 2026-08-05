import type { ClassificationResult } from "../shared/types";
import { relationReasonProse } from "../shared/relationReason";
import { atomPathForTitle, sanitizeFilename } from "../pipeline/render";

export const LS_CONTINUE_PARENT = "atoms-continue-parent-v1";

export type ContinueParentPending = {
  title: string;
  path: string;
  setAt: number;
};

export function parseContinueParent(raw: unknown): ContinueParentPending | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    try {
      obj = JSON.parse(t);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) return null;
  const path = typeof o.path === "string" ? o.path.trim() : "";
  const setAt =
    typeof o.setAt === "number" && Number.isFinite(o.setAt)
      ? o.setAt
      : Date.now();
  return { title, path, setAt };
}

export function readContinueParent(
  load: (key: string) => unknown,
): ContinueParentPending | null {
  return parseContinueParent(load(LS_CONTINUE_PARENT));
}

export function writeContinueParent(
  save: (key: string, value: unknown) => void,
  pending: ContinueParentPending,
): void {
  save(LS_CONTINUE_PARENT, JSON.stringify(pending));
}

export function clearContinueParent(
  save: (key: string, value: unknown) => void,
): void {
  save(LS_CONTINUE_PARENT, null);
}

/** Volatile classify context block (with capture, not cache-stable titles). */
export function buildContinueParentBlock(parent: {
  title: string;
  path?: string;
}): string {
  const title = parent.title.trim();
  if (!title) return "";
  const lines = ["### Continue parent", `Title: ${title}`];
  const path = (parent.path ?? "").trim();
  if (path) lines.push(`Path: ${path}`);
  return lines.join("\n");
}

/**
 * Force a title distinct from parent and free in existingAtomPaths.
 * One rule: `${parent} — continued`, then ` (2)`, ` (3)`, …
 */
export function ensureContinueDistinctTitle(
  result: ClassificationResult,
  parentTitle: string,
  existingAtomPaths: ReadonlySet<string>,
  atomFolder = "Atoms",
): ClassificationResult {
  if (result.verdict !== "atom") return result;
  const parent = sanitizeFilename(parentTitle).filename;
  if (!parent) return result;
  let title = sanitizeFilename(result.title || "").filename;
  const pathOf = (t: string) => atomPathForTitle(atomFolder, t);
  const taken = (t: string) => {
    const p = pathOf(t);
    if (existingAtomPaths.has(p)) return true;
    if (t.toLowerCase() === parent.toLowerCase()) return true;
    return false;
  };
  if (!taken(title)) return result.title === title ? result : { ...result, title };

  let next = `${parent} — continued`;
  if (!taken(next)) return { ...result, title: next };
  for (let n = 2; n < 50; n++) {
    next = `${parent} — continued (${n})`;
    if (!taken(next)) return { ...result, title: next };
  }
  return { ...result, title: `${parent} — continued (${Date.now()})` };
}

/** If atom has no link to parent, unshift continues [[Parent]]. */
export function ensureContinueParentLink(
  result: ClassificationResult,
  parentTitle: string,
): ClassificationResult {
  if (result.verdict !== "atom") return result;
  const parent = sanitizeFilename(parentTitle).filename;
  if (!parent) return result;
  const links = [...(result.links ?? [])];
  const hit = links.find(
    (l) => (l.note || "").trim().toLowerCase() === parent.toLowerCase(),
  );
  if (hit) {
    if (!(hit.reason || "").trim()) {
      hit.reason = relationReasonProse("continues", parent);
      return { ...result, links };
    }
    return result;
  }
  links.unshift({
    note: parent,
    reason: relationReasonProse("continues", parent),
  });
  return { ...result, links };
}

export function continueChipLabel(title: string, maxLen = 36): string {
  const t = title.trim() || "atom";
  if (t.length <= maxLen) return `Continuing ${t}`;
  return `Continuing ${t.slice(0, maxLen - 1)}…`;
}
