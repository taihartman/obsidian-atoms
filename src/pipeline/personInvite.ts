/**
 * Person hub invite — Add {Name}? candidates, copy, hub markdown, peers.
 * Never auto-creates. Pure helpers; home consumes.
 */

import type {
  ClassificationPerson,
  ClassificationResult,
} from "../shared/types";
import { parseAtomsPeople } from "./atomQuality";
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

/**
 * Words that are never a person name, however capitalised.
 *
 * A capture / title can drop its subject (“likes Annie's fruit tape snack”),
 * so the leading capitalised token is often a verb or determiner — and the very
 * preference verb that makes the atom person-shaped would otherwise qualify
 * itself as the name (“Add Likes?”). Under-invite beats a fake person hub.
 */
export const PERSON_INVITE_NON_NAME_WORDS = new Set(
  [
    // determiners / pronouns / conjunctions / prepositions
    "the", "a", "an", "this", "that", "these", "those", "my", "our", "your",
    "his", "her", "their", "its", "i", "he", "she", "they", "we", "you", "it",
    "and", "but", "or", "so", "for", "with", "without", "from", "about",
    "after", "before", "when", "while", "into", "onto", "over", "under", "at",
    "in", "on", "of", "to", "by", "as", "there", "here", "what", "which",
    "who", "whose", "why", "how", "if", "then", "than",
    // quantifiers / adverbs / adjectives that lead subject-less lines
    "all", "both", "each", "every", "some", "any", "no", "not", "only",
    "just", "still", "maybe", "probably", "again", "new", "old", "next",
    "last", "first", "best", "worst", "good", "bad", "more", "less", "most",
    "very", "really", "actually", "definitely",
    // preference / relation verbs (mirror PREFERENCE_OR_RELATION_RE)
    "like", "likes", "liked", "prefer", "prefers", "preferred", "favorite",
    "favourite", "hate", "hates", "hated", "love", "loves", "loved", "enjoy",
    "enjoys", "enjoyed", "dislike", "dislikes", "disliked", "always", "never",
    "usually", "sometimes", "tends", "tend",
    // other common subject-less leading verbs
    "want", "wants", "wanted", "need", "needs", "needed", "got", "get",
    "gets", "met", "meet", "meets", "went", "go", "goes", "made", "make",
    "makes", "said", "say", "says", "think", "thinks", "thought", "try",
    "tries", "tried", "keep", "keeps", "kept", "use", "uses", "used", "ask",
    "asks", "asked", "told", "tell", "tells", "gave", "give", "gives",
    "took", "take", "takes", "saw", "see", "sees", "feel", "feels", "felt",
    "start", "starts", "started", "stop", "stops", "stopped", "wear",
    "wears", "wore", "buy", "buys", "bought", "brought", "bring", "plan",
    "plans", "planned", "remember", "remembers", "remembered", "notice",
    "notices", "noticed", "learn", "learns", "learned", "find", "finds",
    "found", "finish", "finished", "decide", "decides", "decided", "avoid",
    "avoids", "watch", "watches", "watched", "read", "reads", "reading",
    "wonder", "wonders", "wondered", "believe", "believes", "believed",
    "is", "was", "are", "were", "be", "been", "has", "have", "had", "do",
    "does", "did", "can", "could", "should", "would", "might", "must",
    // "will" / "may" stay allowed — common first names, and a modal there is
    // followed by a bare verb the name branches do not match.
    // time words that look like names at the start of a line
    "today", "tomorrow", "yesterday", "tonight", "monday", "tuesday",
    "wednesday", "thursday", "friday", "saturday", "sunday", "january",
    "february", "march", "september", "october", "november", "december",
    "morning", "afternoon", "evening", "night", "week", "weekend", "month",
    "year",
  ],
);

/** True when the token can never be a person name (verb, determiner, weekday…). */
export function isNonNameWord(word: string): boolean {
  return PERSON_INVITE_NON_NAME_WORDS.has(word.trim().toLowerCase());
}

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
 * Invite name from model-named people (KTD1/KTD2) — the `subject` role only.
 *
 * A possessive owner or bystander is `mentioned` and never invites; a media
 * `recommender` never invites. Two subjects invite nobody: multi-person dumps
 * under-invite by design, and a fake hub costs more than a missed one.
 */
export function personInviteNameFromPeople(
  people: ClassificationPerson[],
): string | null {
  const subjects = people
    .filter((p) => p.role === "subject")
    .map((p) => p.name.trim())
    .filter((n) => n && !isDeniedPersonName(n));
  return subjects.length === 1 ? subjects[0]! : null;
}

/**
 * The invite name for a rendered atom: the model's `people` when the atom
 * carries it, else the legacy heuristic (R7 — atoms written before the field
 * keep 0.6.60 behaviour exactly until `atoms:update-notes` refreshes them).
 *
 * Every consumer goes through here; none re-derives a name from prose.
 */
export function resolveAtomPersonName(
  content: string,
  captureText: string,
  title: string,
  tags: string[] = [],
): string | null {
  const people = parseAtomsPeople(content);
  if (people !== null) return personInviteNameFromPeople(people);
  return resolvePersonInviteName(captureText, title, tags);
}

/**
 * Legacy heuristic name resolver — guesses from capture/title text.
 *
 * Prefer {@link resolveAtomPersonName}. Retained only for atoms rendered before
 * `atoms-people` existed; the guessing this does is what #224 was about.
 */
export function resolvePersonInviteName(
  captureText: string,
  title: string,
  tags: string[] = [],
): string | null {
  const text = (captureText ?? "").trim();
  const t = (title ?? "").trim();
  const blob = `${t}\n${text}`;

  // "X told me to watch Y" — X is the recommender, not the subject. Kinship
  // captures fall through to their own branch below.
  const recommender = /\b[A-Z][a-z]{1,20}\s+(?:told me|recommended|suggested)\b/;
  if (
    RECOMMENDER_RE.test(blob) &&
    recommender.test(blob) &&
    /\b(?:watch|see|read|play)\b/i.test(blob) &&
    !SOLE_KINSHIP_RE.test(text) &&
    !SOLE_KINSHIP_RE.test(t)
  ) {
    return null;
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
  // Subject-less titles lead with a verb / determiner, never a name.
  if (isNonNameWord(n.split(/\s+/)[0] ?? n)) return true;
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
  /** Full atom markdown — routes through `atoms-people` when present. */
  content?: string;
}): { name: string; existingNote: boolean } | null {
  const name =
    opts.content === undefined
      ? resolvePersonInviteName(opts.captureText, opts.title, opts.tags ?? [])
      : resolveAtomPersonName(
          opts.content,
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
      content: atom.content,
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
          ? `A note named ${display} already exists. Link this memory to it. No new person note.`
          : `${n} memories mention ${display}. Link them to the existing note. No new person note.`,
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
  return `same person: related claim ([[${t}]])`;
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
  opts: { dropSoft?: boolean; upgradeReason?: boolean } = {},
): string | null {
  const want = note.trim();
  if (!want) return null;
  const prose = extractLinkProseRegion(content);
  const parsed = parseLinkProse(prose);
  let next = parsed;
  if (opts.dropSoft) {
    next = next.filter((l) => {
      const n = l.note.trim().toLowerCase();
      return n !== "people" && !isSoftEntityKey(n);
    });
  }
  let has = false;
  next = next.map((l) => {
    if (l.note.trim().toLowerCase() !== want.toLowerCase()) return l;
    has = true;
    // upgradeReason: an existing link to this note gets the new reason in
    // place (redeems writes need this; a dedup skip would write nothing).
    return opts.upgradeReason ? { note: l.note, reason } : l;
  });
  if (!has) next = [...next, { note: want, reason }];
  const newProse = formatLinkProse(next);
  // Replace the region only when it really is a link block. A trailing
  // paragraph of capture text also splits off as a "prose region", and
  // rewriting it would destroy verbatim body (non-negotiable #1).
  if (prose && parsed.length) {
    const out = content.replace(prose, newProse);
    return out === content ? null : out;
  }
  if (has && !opts.dropSoft) return null;
  // Append below the full body — never re-slice it (a first-paragraph split
  // here silently dropped every later paragraph).
  return `${content.replace(/\s+$/, "")}\n\n${newProse}\n`;
}
