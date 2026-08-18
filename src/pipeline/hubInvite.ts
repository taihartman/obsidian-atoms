/**
 * One hub-association invite family — person + list, existing note first.
 * Collect is pure. Home accepts; never silent auto-create.
 */

import {
  collectEntityInvites,
  type AtomInviteInput,
} from "./entityInvite";
import { suggestEntityHubLabel } from "./enrich/entityLinks";
import { isListHubShaped, titleMatchesCapture } from "./enrich/listHubs";
import { watchlistWork } from "./enrich/media";
import { isJunkLinkReason } from "./enrich/linkQuality";
import { projectHubMarkdown } from "./hubProjection";
import { parseHubSections } from "./hubSections";
import { extractLinkProseRegion, parseLinkProse } from "./parseLinkProse";
import {
  collectPersonInvites,
  type PersonInviteCandidate,
} from "./personInvite";

export type HubAssociationKind = "person" | "list";

export type HubAssociationCandidate = {
  kind: HubAssociationKind;
  label: string;
  memberPaths: string[];
  memberTitles: string[];
  existingNote: boolean;
};

const LIST_NAMED =
  /^(show list|shows|movie list|movies|films|watch list|watchlist)$/i;

function listFamily(low: string): "show" | "movie" | "watch" | "other" {
  if (low.startsWith("show")) return "show";
  if (low.startsWith("movie") || low.startsWith("film")) return "movie";
  if (low.includes("watch")) return "watch";
  return "other";
}

function captureBody(content: string): string {
  const stripped = content.replace(/^---[\s\S]*?\n---\s*/, "");
  return (stripped.split("\n\n")[0] ?? stripped).trim();
}

export function pairingId(kind: HubAssociationKind, label: string): string {
  return `${kind}:${label.trim().toLowerCase()}`;
}

/** Vault notes Atoms may treat as list hubs even with no headings. */
export function pickListNamedHub(
  hay: string,
  vaultTitles: string[],
  body?: string,
): string | null {
  const named = vaultTitles
    .map((raw) => ({ raw, trim: raw.trim(), low: raw.trim().toLowerCase() }))
    .filter((e) => e.trim && LIST_NAMED.test(e.low));
  if (!named.length) return null;

  const mentioned = named.filter((e) => titleMatchesCapture(hay, e.trim));
  if (mentioned.length === 1) return mentioned[0]!.raw;
  if (mentioned.length > 1) return null;

  const work = watchlistWork(body ?? hay);
  if (!work?.family) return null;
  const hits = named.filter((e) => listFamily(e.low) === work.family);
  return hits.length === 1 ? hits[0]!.raw : null;
}

export function hasHardLinkToTitle(content: string, title: string): boolean {
  const want = title.trim().toLowerCase();
  if (!want) return false;
  const prose = extractLinkProseRegion(content);
  if (prose) {
    for (const l of parseLinkProse(prose)) {
      if (isJunkLinkReason(l.reason ?? "")) continue;
      if ((l.note ?? "").trim().toLowerCase() === want) return true;
    }
    const re = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(prose)) !== null) {
      if ((m[1] ?? "").trim().toLowerCase() === want) return true;
    }
  }
  return false;
}

function collectListPairings(
  atoms: AtomInviteInput[],
  vaultTitles: string[],
  snoozed: Set<string>,
): HubAssociationCandidate[] {
  const groups = new Map<string, HubAssociationCandidate>();

  for (const atom of atoms) {
    const body = captureBody(atom.content);
    const hay = `${body}\n${atom.title}`;
    if (!isListHubShaped(body) && !isListHubShaped(atom.title)) continue;

    const named = pickListNamedHub(hay, vaultTitles, body);
    const suggested = suggestEntityHubLabel(body) || suggestEntityHubLabel(atom.title);
    const suggestedHit = suggested
      ? vaultTitles.find(
          (t) => t.trim().toLowerCase() === suggested.trim().toLowerCase(),
        )
      : undefined;
    const label = named ?? suggestedHit;
    if (!label) continue;
    if (hasHardLinkToTitle(atom.content, label)) continue;
    const id = pairingId("list", label);
    if (snoozed.has(id) || snoozed.has(label.trim().toLowerCase())) continue;

    const key = label.trim().toLowerCase();
    const g = groups.get(key) ?? {
      kind: "list" as const,
      label: label.trim() || label,
      memberPaths: [],
      memberTitles: [],
      existingNote: true,
    };
    if (!g.memberPaths.includes(atom.path)) {
      g.memberPaths.push(atom.path);
      g.memberTitles.push(atom.title);
    }
    groups.set(key, g);
  }

  return [...groups.values()];
}

function personToAssoc(p: PersonInviteCandidate): HubAssociationCandidate {
  return {
    kind: "person",
    label: p.displayName,
    memberPaths: p.memberPaths,
    memberTitles: p.memberTitles,
    existingNote: p.existingNote,
  };
}

export function collectHubAssociationInvites(opts: {
  atoms: AtomInviteInput[];
  vaultTitles: string[];
  personHubTitles: string[];
  snoozedIds?: Set<string> | string[];
  snoozedPersonNames?: Set<string> | string[];
  enableHubProjection?: boolean;
}): HubAssociationCandidate[] {
  const people = collectPersonInvites(opts.atoms, {
    personHubTitles: opts.personHubTitles,
    vaultTitles: opts.vaultTitles,
    snoozedNames: opts.snoozedPersonNames,
  }).map(personToAssoc);

  if (opts.enableHubProjection === false) {
    return people;
  }

  const snoozed = new Set(
    [...(opts.snoozedIds ?? [])].map((s) => s.trim().toLowerCase()),
  );
  const pairings = collectListPairings(opts.atoms, opts.vaultTitles, snoozed);
  const pairingKeys = new Set(pairings.map((p) => p.label.trim().toLowerCase()));

  const creates = collectEntityInvites(opts.atoms, opts.vaultTitles, {
    snoozedLabels: snoozed,
    minMembers: 1,
  })
    .filter((e) => !pairingKeys.has(e.label.trim().toLowerCase()))
    .filter((e) => {
      const id = pairingId("list", e.label);
      return !snoozed.has(id);
    })
    .map(
      (e): HubAssociationCandidate => ({
        kind: "list",
        label: e.label,
        memberPaths: e.memberPaths,
        memberTitles: e.memberTitles,
        existingNote: false,
      }),
    );

  const lists = [...pairings, ...creates];
  return [...people, ...lists];
}

export function hubAssociationInviteCopy(opts: {
  kind: HubAssociationKind;
  label: string;
  memberCount: number;
  existingNote: boolean;
}): {
  kicker: string;
  title: string;
  body: string;
  createLabel: string;
  dismissLabel: string;
  alreadyLabel: string;
} {
  const n = Math.max(1, opts.memberCount);
  const display = opts.label.trim() || "this note";
  if (opts.kind === "person") {
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
  if (opts.existingNote) {
    return {
      kicker: "Lists",
      title: `Add to ${display}?`,
      body:
        n === 1
          ? `Add this memory to ${display}. Your writing on that note stays yours.`
          : `Add ${n} memories to ${display}. Your writing on that note stays yours.`,
      createLabel: `Add to ${display}`,
      dismissLabel: "Not now",
      alreadyLabel: "Choose different note…",
    };
  }
  return {
    kicker: "Lists",
    title: `Make ${display}?`,
    body:
      n === 1
        ? "One note already points at this. Create a list note so related captures can gather here."
        : `${n} notes already point at this. Create a list note so you can open them together.`,
    createLabel: "Create",
    dismissLabel: "Not now",
    alreadyLabel: "Choose different note…",
  };
}

/** First accept: splice a marked block even when the write brake would skip. */
export function seedHubListMarkdown(
  hubContent: string,
  titles: string[],
): string {
  const entries = titles
    .map((title) => title.trim())
    .filter(Boolean)
    .map((title) => ({ title }));
  const sections = parseHubSections(hubContent);
  const projected = projectHubMarkdown(hubContent, entries, sections);
  return projected.ok ? projected.content : hubContent;
}

export function listLinkReason(label: string): string {
  return `belongs with [[${label.trim()}]]`;
}
