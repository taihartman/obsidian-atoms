/**
 * Person hub invite — Add {Name}? candidates, copy, hub markdown, peers.
 * Never auto-creates. Pure helpers; home consumes.
 */

import type { ClassificationResult } from "../shared/types";
import {
  isPersonShapedCapture,
  PERSON_HUB_DENY_TITLES,
} from "./enrich/people";
import { isSoftEntityKey } from "./softKeys";
import { extractLinkProseRegion, parseLinkProse } from "./parseLinkProse";
import { isJunkLinkReason } from "./enrich/linkQuality";
import { formatLinkProse } from "./render";

export const PERSON_INVITE_SNOOZE_DAYS = 14;
export const PERSON_INVITE_RECENT_DAYS = 14;

export type PersonInviteCandidate = {
  displayName: string;
  memberPaths: string[];
  memberTitles: string[];
  /** True when vault already has this title — upgrade only, no create. */
  existingNote: boolean;
};

export type PersonAtomInput = {
  path: string;
  title: string;
  content: string;
  sourceDate?: string | null;
};

const KINSHIP = new Set([
  "mom",
  "dad",
  "mother",
  "father",
  "mama",
  "papa",
  "mum",
]);

/** Place / show / brand tokens that must never become person invites. */
export const PERSON_INVITE_DENY_NAMES = new Set(
  [
    "crg",
    "high school musical",
    "my hero academia",
    "demon slayer",
    "house of the dragon",
    "house of dragons",
    "seoul drop",
    "paypal",
    "claude",
    "grok",
    "codex",
    "obsidian",
    "aploma",
    "veld",
    "penfield",
  ].map((s) => s.toLowerCase()),
);

const RECOMMENDER_RE =
  /\b(?:told me|recommended|suggested|said (?:to|i should)|wants? me to)\b/i;

const SOLE_KINSHIP_RE =
  /^(?:my\s+)?(mom|dad|mother|father|mama|papa|mum)\b/i;

function titleCaseName(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\r?\n/, "");
}

function captureBody(content: string): string {
  const body = stripFrontmatter(content);
  return (body.split(/\n\n/)[0] ?? body).trim();
}

function hasHardPersonHubLink(
  content: string,
  hubTitlesLower: Set<string>,
): boolean {
  const prose = extractLinkProseRegion(content);
  if (!prose) return false;
  for (const l of parseLinkProse(prose)) {
    if (isJunkLinkReason(l.reason ?? "")) continue;
    const n = (l.note ?? "").trim().toLowerCase();
    if (n && hubTitlesLower.has(n)) return true;
  }
  return false;
}

/**
 * High-confidence person display name for invite, or null.
 */
export function resolvePersonInviteName(
  captureText: string,
  title: string,
  tags: string[] = [],
): string | null {
  const text = (captureText ?? "").trim();
  const t = (title ?? "").trim();
  const blob = `${t}\n${text}`;

  // Media recommender only — skip unless name is clear sole subject elsewhere
  if (RECOMMENDER_RE.test(blob) && !SOLE_KINSHIP_RE.test(text) && !SOLE_KINSHIP_RE.test(t)) {
    // "X told me to watch Y" — first capital name is recommender
    const rec = blob.match(
      /\b([A-Z][a-z]{1,20})\s+(?:told me|recommended|suggested)\b/,
    );
    if (rec?.[1]) {
      // only invite if the subject is that person, not the work
      if (!/\b(?:watch|see|read|play)\b/i.test(blob)) {
        /* fall through */
      } else {
        return null;
      }
    }
  }

  // Kinship sole-subject
  const kin =
    text.match(SOLE_KINSHIP_RE) ??
    t.match(/^(?:my\s+)?(mom|dad|mother|father|mama|papa|mum)\b/i);
  if (kin?.[1]) {
    const name = titleCaseName(kin[1]);
    if (!isDeniedPersonName(name)) return name;
  }

  // Leading proper name in title (person claim shape)
  const titleName = t.match(/^([A-Z][a-z]{1,24})(?:\s|'s\b|’s\b)/);
  if (titleName?.[1] && isPersonShapedCapture(text, fakeResult(t, tags))) {
    const name = titleName[1];
    if (!isDeniedPersonName(name)) return name;
  }

  // Capture starts with name + identity / preference
  const capName = text.match(
    /^(?:my friend\s+)?([A-Z][a-z]{1,24})(?:\s+(?:is|was|that|who|loves?|likes?|wants?|got|met)|'s|’s)\b/,
  );
  if (capName?.[1]) {
    const name = capName[1];
    if (
      !isDeniedPersonName(name) &&
      (isPersonShapedCapture(text, fakeResult(t, tags)) ||
        /\b(?:is|was|met|name|dude|guy|person)\b/i.test(text))
    ) {
      return name;
    }
  }

  // Title starts with Name is/was…
  const titleLead = t.match(
    /^([A-Z][a-z]{1,24})\s+(?:is|was|likes?|loves?|wants?|met)\b/,
  );
  if (titleLead?.[1] && !isDeniedPersonName(titleLead[1])) {
    return titleLead[1];
  }

  // "Mom wants…" mid-sentence kinship subject
  const midKin = blob.match(
    /\b(Mom|Dad|Mother|Father|Mama|Papa|Mum)\b/,
  );
  if (midKin?.[1] && !/\band\b.+\b(Mom|Dad)\b/i.test(blob)) {
    // multi-person dump with "and" — under-invite if both kinship
    if (/\b(?:and|with)\s+(?:my\s+)?(?:mom|dad)\b/i.test(blob) && midKin) {
      /* still allow single kinship mention */
    }
    const name = titleCaseName(midKin[1]);
    if (!isDeniedPersonName(name)) return name;
  }

  return null;
}

function fakeResult(
  title: string,
  tags: string[],
): ClassificationResult {
  return {
    verdict: "atom",
    title,
    tags,
    proposed_tags: [],
    links: [],
  };
}

export function isDeniedPersonName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  if (isSoftEntityKey(n)) return true;
  if (PERSON_HUB_DENY_TITLES.has(n)) return true;
  if (PERSON_INVITE_DENY_NAMES.has(n)) return true;
  if (KINSHIP.has(n)) return false;
  // multi-word show titles
  for (const d of PERSON_INVITE_DENY_NAMES) {
    if (d.includes(" ") && n.includes(d)) return true;
  }
  return false;
}

export function isPersonInviteEligible(opts: {
  captureText: string;
  title: string;
  tags?: string[];
  personHubTitles: string[];
  vaultTitles?: string[];
}): { name: string; existingNote: boolean } | null {
  const name = resolvePersonInviteName(
    opts.captureText,
    opts.title,
    opts.tags ?? [],
  );
  if (!name) return null;
  const low = name.toLowerCase();
  const hubs = new Set(
    opts.personHubTitles.map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  if (hubs.has(low)) return null;
  const vault = new Set(
    (opts.vaultTitles ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  const existingNote = vault.has(low);
  return { name, existingNote };
}

/**
 * Collect ranked person invite candidates from generated atoms.
 */
export function collectPersonInvites(
  atoms: PersonAtomInput[],
  opts: {
    personHubTitles: string[];
    vaultTitles: string[];
    snoozedNames?: Set<string> | string[];
    recentDays?: number;
    now?: Date;
  },
): PersonInviteCandidate[] {
  const recentDays = opts.recentDays ?? PERSON_INVITE_RECENT_DAYS;
  const now = opts.now ?? new Date();
  const hubLower = new Set(
    opts.personHubTitles.map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  const snoozed = new Set(
    [...(opts.snoozedNames ?? [])].map((s) => s.trim().toLowerCase()),
  );
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - recentDays);
  const cutoffYmd = cutoff.toISOString().slice(0, 10);

  type Acc = {
    displayName: string;
    memberPaths: string[];
    memberTitles: string[];
    existingNote: boolean;
    latestSource: string;
    count: number;
    kinship: boolean;
  };
  const groups = new Map<string, Acc>();

  for (const atom of atoms) {
    if (atom.sourceDate && atom.sourceDate < cutoffYmd) continue;
    if (hasHardPersonHubLink(atom.content, hubLower)) continue;

    const body = captureBody(atom.content);
    const elig = isPersonInviteEligible({
      captureText: body,
      title: atom.title,
      personHubTitles: opts.personHubTitles,
      vaultTitles: opts.vaultTitles,
    });
    if (!elig) continue;
    const id = elig.name.toLowerCase();
    if (snoozed.has(id)) continue;

    const g = groups.get(id) ?? {
      displayName: elig.name,
      memberPaths: [],
      memberTitles: [],
      existingNote: elig.existingNote,
      latestSource: atom.sourceDate ?? "",
      count: 0,
      kinship: KINSHIP.has(id),
    };
    if (!g.memberPaths.includes(atom.path)) {
      g.memberPaths.push(atom.path);
      g.memberTitles.push(atom.title);
      g.count += 1;
    }
    if ((atom.sourceDate ?? "") > g.latestSource) {
      g.latestSource = atom.sourceDate ?? g.latestSource;
    }
    g.existingNote = g.existingNote || elig.existingNote;
    groups.set(id, g);
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (a.latestSource !== b.latestSource) {
        return a.latestSource < b.latestSource ? 1 : -1;
      }
      if (a.count !== b.count) return b.count - a.count;
      if (a.kinship !== b.kinship) return a.kinship ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    })
    .map((g) => ({
      displayName: g.displayName,
      memberPaths: g.memberPaths,
      memberTitles: g.memberTitles,
      existingNote: g.existingNote,
    }));
}

export function formatPersonNoteMarkdown(name: string): string {
  const t = name.trim() || "Person";
  return `---\ntags:\n  - person\n---\n# ${t}\n\n`;
}

export function personInviteCopy(
  name: string,
  memberCount: number,
  opts: { existingNote?: boolean } = {},
): {
  kicker: string;
  title: string;
  body: string;
  createLabel: string;
  dismissLabel: string;
  alreadyLabel: string;
} {
  const n = Math.max(1, memberCount);
  const display = name.trim() || "them";
  if (opts.existingNote) {
    return {
      kicker: "People",
      title: `Link to ${display}?`,
      body:
        n === 1
          ? `A note named ${display} already exists. Link this memory to it — no new person note.`
          : `${n} memories mention ${display}. Link them to the existing note — no new person note.`,
      createLabel: `Link to ${display}`,
      dismissLabel: "Not now",
      alreadyLabel: "Choose different note…",
    };
  }
  return {
    kicker: "People",
    title: `Add ${display}?`,
    body:
      n === 1
        ? `You filed a note about ${display}, but there’s no person note yet. Backlinks will collect here.`
        : `You filed ${n} notes about ${display}, but there’s no person note yet. Backlinks will collect here.`,
    createLabel: `Add ${display}`,
    dismissLabel: "Not now",
    alreadyLabel: "Already have them…",
  };
}

/** Peer link reason (pre-hub). */
export function personPeerReason(peerTitle: string): string {
  const t = peerTitle.trim() || "related claim";
  return `same person — related claim ([[${t}]])`;
}

/**
 * For each path in a multi-member same-name group without a hub, return
 * updated content with peer links to the other members (orbit-safe titles).
 * Input map path → full atom markdown. Only paths with ≥2 members produce edges.
 */
export function applyPersonPeerLinksToContents(
  members: { path: string; title: string; content: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (members.length < 2) return out;
  for (const self of members) {
    let content = self.content;
    let changed = false;
    for (const other of members) {
      if (other.path === self.path) continue;
      const peerTitle = other.title.trim();
      if (!peerTitle) continue;
      const next = applyHardLinkToAtomContent(
        content,
        peerTitle,
        personPeerReason(peerTitle),
        { dropSoft: false },
      );
      if (next) {
        content = next;
        changed = true;
      }
    }
    if (changed) out.set(self.path, content);
  }
  return out;
}

/** Prefer Social/People family for new person notes. */
export function resolvePeopleFolderPrefix(folderPaths: string[]): string {
  const norms = folderPaths.map((p) => p.replace(/\\/g, "/"));
  const prefer = [
    "Personal notes/Social",
    "Social",
    "People",
    "Personal notes/People",
  ];
  for (const pref of prefer) {
    const hit = norms.find(
      (p) =>
        p === pref ||
        p.startsWith(pref + "/") ||
        p.includes("/" + pref + "/") ||
        p.endsWith("/" + pref),
    );
    if (hit) {
      // return the preferred prefix itself
      return pref;
    }
  }
  // if any path contains Social
  for (const p of norms) {
    const m = p.match(/^(.*\/Social)\//);
    if (m?.[1]) return m[1];
  }
  return "Personal notes/Social";
}

export function personNotePath(folderPrefix: string, name: string): string {
  const folder = folderPrefix.replace(/\/$/, "");
  const safe = name.trim().replace(/[\\/:*?"<>|]/g, "").slice(0, 80);
  return folder ? `${folder}/${safe}.md` : `${safe}.md`;
}

/**
 * Pure: rewrite atom markdown link-prose to hard-link `note` with reason.
 * Drops soft-bucket links when dropSoft is true. Returns null if unchanged.
 */
export function applyHardLinkToAtomContent(
  content: string,
  note: string,
  reason: string,
  opts: { dropSoft?: boolean } = {},
): string | null {
  const want = note.trim();
  if (!want) return null;
  const prose = extractLinkProseRegion(content);
  let next = parseLinkProse(prose);
  if (opts.dropSoft) {
    next = next.filter((l) => {
      const n = l.note.trim().toLowerCase();
      return n !== "people" && !isSoftEntityKey(n);
    });
  }
  const has = next.some(
    (l) => l.note.trim().toLowerCase() === want.toLowerCase(),
  );
  if (!has) next = [...next, { note: want, reason }];
  const newProse = formatLinkProse(next);
  if (prose) {
    const out = content.replace(prose, newProse);
    return out === content ? null : out;
  }
  if (has && !opts.dropSoft) return null;
  // append after capture body
  if (content.startsWith("---")) {
    const fmEnd = content.indexOf("\n---", 3);
    if (fmEnd !== -1) {
      const fm = content.slice(0, fmEnd + 4);
      const rest = content.slice(fmEnd + 4).replace(/^\r?\n/, "");
      const capture = rest.split(/\n\n/)[0] ?? rest;
      return `${fm}\n${capture.trimEnd()}\n\n${newProse}\n`;
    }
  }
  return `${content.trimEnd()}\n\n${newProse}\n`;
}
