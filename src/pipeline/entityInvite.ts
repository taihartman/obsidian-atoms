/**
 * Entity hub invite — suggest creating a trip/list hub the user can accept.
 * Never auto-creates. Pure helpers + home consumes.
 */

import { extractLinkProseRegion, parseLinkProse } from "./parseLinkProse";
import { isEntityShaped, suggestEntityHubLabel } from "./enrich/entityLinks";
import { isSoftEntityKey } from "./softKeys";
import { isJunkLinkReason } from "./enrich/linkQuality";

export type EntityInviteCandidate = {
  label: string;
  memberPaths: string[];
  memberTitles: string[];
};

export type AtomInviteInput = {
  path: string;
  title: string;
  content: string;
};

function titleCaseLabel(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Suggest a hub title from capture/title text when no vault hub exists yet.
 * High precision — empty when unclear.
 */
export function suggestEntityHubLabelFromText(text: string): string | null {
  return suggestEntityHubLabel(text);
}

/** Re-export shape check for home. */
export { isEntityShaped };

function hasHardEntityLink(
  content: string,
  vaultTitlesLower: Set<string>,
): boolean {
  const prose = extractLinkProseRegion(content);
  if (!prose) return false;
  const links = parseLinkProse(prose);
  for (const l of links) {
    if (isJunkLinkReason(l.reason ?? "")) continue;
    const n = (l.note ?? "").trim().toLowerCase();
    if (!n || isSoftEntityKey(n)) continue;
    if (vaultTitlesLower.has(n)) return true;
  }
  // also any wikilink in prose to vault title
  const re = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prose)) !== null) {
    const n = (m[1] ?? "").trim().toLowerCase();
    if (n && !isSoftEntityKey(n) && vaultTitlesLower.has(n)) return true;
  }
  return false;
}

/**
 * Group recent entity-shaped atoms that lack a hard hub link but share a
 * suggested label not yet in the vault → invite candidates.
 */
export function collectEntityInvites(
  atoms: AtomInviteInput[],
  vaultTitles: string[],
  opts: { snoozedLabels?: Set<string> | string[]; minMembers?: number } = {},
): EntityInviteCandidate[] {
  const minMembers = opts.minMembers ?? 1;
  const vaultLower = new Set(
    vaultTitles.map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  const snoozed = new Set(
    [...(opts.snoozedLabels ?? [])].map((s) => s.trim().toLowerCase()),
  );

  const groups = new Map<string, EntityInviteCandidate>();

  for (const atom of atoms) {
    const body = atom.content.includes("\n\n")
      ? atom.content.split("\n\n")[0] ?? atom.content
      : atom.content;
    // strip frontmatter for shape check
    const bodyOnly = body.replace(/^---[\s\S]*?\n---\s*/, "");
    const captureish = bodyOnly.split("\n\n")[0] ?? bodyOnly;
    if (!isEntityShaped(captureish) && !isEntityShaped(atom.title)) continue;
    if (hasHardEntityLink(atom.content, vaultLower)) continue;

    const label =
      suggestEntityHubLabel(captureish) ||
      suggestEntityHubLabel(atom.title) ||
      null;
    if (!label) continue;
    const id = label.trim().toLowerCase();
    if (!id || isSoftEntityKey(id) || snoozed.has(id)) continue;
    if (vaultLower.has(id)) continue; // already exists — Also about path

    const g = groups.get(id) ?? {
      label: titleCaseLabel(label),
      memberPaths: [],
      memberTitles: [],
    };
    if (!g.memberPaths.includes(atom.path)) {
      g.memberPaths.push(atom.path);
      g.memberTitles.push(atom.title);
    }
    groups.set(id, g);
  }

  return [...groups.values()]
    .filter((g) => g.memberPaths.length >= minMembers)
    .sort((a, b) => b.memberPaths.length - a.memberPaths.length);
}

/** Minimal hub note body (user-owned; not an atom). */
export function formatEntityHubMarkdown(label: string): string {
  const t = label.trim() || "List";
  return `# ${t}\n\n`;
}

export function entityInviteCopy(label: string, memberCount: number): {
  kicker: string;
  title: string;
  body: string;
  createLabel: string;
  dismissLabel: string;
} {
  const n = Math.max(1, memberCount);
  return {
    kicker: "Together",
    title: `Make ${label}?`,
    body:
      n === 1
        ? "One note already points at this. Create a list note so related captures can gather here."
        : `${n} notes already point at this. Create a list note so you can open them together.`,
    createLabel: "Create",
    dismissLabel: "Not now",
  };
}

export const ENTITY_INVITE_SNOOZE_DAYS = 14;
