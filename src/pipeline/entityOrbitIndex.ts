/**
 * Pure hard-key orbit index over generated atoms' link-prose.
 */

import { isJunkLinkReason } from "./enrich/linkQuality";
import { extractLinkProseRegion, parseLinkProse } from "./parseLinkProse";
import { isDailyBasenameKey, isSoftEntityKey } from "./softKeys";

const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;

export type AtomOrbitInput = {
  path: string;
  title: string;
  content: string;
  sourceDate?: string | null;
};

export type OrbitMember = {
  path: string;
  title: string;
  sourceDate: string | null;
};

export type EntityOrbit = {
  id: string;
  label: string;
  members: OrbitMember[];
};

export function normalizeOrbitId(title: string): string {
  return (title ?? "").trim().toLowerCase();
}

/** All wikilink targets in link-prose region (not capture body). */
export function extractLinkProseWikiTitles(content: string): string[] {
  const prose = extractLinkProseRegion(content);
  if (!prose) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(prose)) !== null) {
    const t = (m[1] ?? "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Membership keys for one atom: link-prose wikilinks, minus junk-reason edges
 * when parseLinkProse provides a reason for that note.
 */
export function membershipKeysForAtom(content: string): string[] {
  const titles = extractLinkProseWikiTitles(content);
  if (!titles.length) return [];
  const parsed = parseLinkProse(extractLinkProseRegion(content));
  const junkNotes = new Set(
    parsed
      .filter((l) => isJunkLinkReason(l.reason ?? ""))
      .map((l) => l.note.trim().toLowerCase()),
  );
  return titles.filter((t) => !junkNotes.has(t.toLowerCase()));
}

function resolveVaultLabel(id: string, vaultTitles: string[]): string | null {
  const hit = vaultTitles.find((t) => t.trim().toLowerCase() === id);
  return hit ? hit.trim() : null;
}

export type BuildOrbitsOpts = {
  vaultTitles: string[];
  personHubTitles?: Set<string> | string[];
};

/**
 * Invert hard link-prose keys → orbits. Soft / missing / daily keys omitted.
 */
export function buildOrbits(
  atoms: AtomOrbitInput[],
  opts: BuildOrbitsOpts,
): EntityOrbit[] {
  const vaultTitles = opts.vaultTitles ?? [];
  const map = new Map<string, OrbitMember[]>();
  const labels = new Map<string, string>();

  for (const atom of atoms) {
    const self = atom.title.trim().toLowerCase();
    const keys = membershipKeysForAtom(atom.content);
    for (const key of keys) {
      const id = normalizeOrbitId(key);
      if (!id || id === self) continue;
      if (isSoftEntityKey(key)) continue;
      if (isDailyBasenameKey(key)) continue;
      const label = resolveVaultLabel(id, vaultTitles);
      if (!label) continue;
      labels.set(id, label);
      const list = map.get(id) ?? [];
      if (!list.some((m) => m.path === atom.path)) {
        list.push({
          path: atom.path,
          title: atom.title,
          sourceDate: atom.sourceDate ?? null,
        });
      }
      map.set(id, list);
    }
  }

  const out: EntityOrbit[] = [];
  for (const [id, members] of map) {
    out.push({
      id,
      label: labels.get(id) ?? id,
      members,
    });
  }
  return out;
}
