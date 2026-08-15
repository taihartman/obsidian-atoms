import { requestUrl } from "obsidian";
import {
  isAllowedPlusBaseUrl,
  isSessionRejectedMessage,
  PLUS_BASE_URL_INVALID_MESSAGE,
  plusFetchRequest,
} from "../platform/plusClient";
import type {
  ClassificationPerson,
  ClassificationResult,
  ClassifyOutcome,
  ClassifyUsage,
  PersonRole,
  VaultContext,
} from "../shared/types";
import {
  captureMentionsKey,
  enrichPersonLinks,
  type PersonHub,
} from "./enrich/people";
import { isDeniedPersonName } from "./personInvite";
import { enrichMediaLinks } from "./enrich/media";
import { enrichListHubLinks } from "./enrich/listHubs";
import { enrichEntityLinks } from "./enrich/entityLinks";
import {
  improveClassificationLinks,
  maybeLinkPeopleIndex,
  stripSelfReferentialLinks,
} from "./enrich/linkQuality";
import { rescueKeepableIdea } from "./enrich/ideaRescue";
import { filterTagsToActive } from "./vocabulary";
import {
  buildContextPrefixBlock,
  buildTitlesBlock,
  CONTEXT_BLOCK_SEPARATOR,
  type ShortlistContext,
} from "./context";

/**
 * Titles-only payload for Plus (R6). Drops vault paths (`shortlist[]`) and local-only hub details.
 * The service ranks from `titles` order + `ranked`/`k`/`stats.returned` — it never needs bodies or paths.
 */
export function contextForPlus(context: VaultContext): Record<string, unknown> {
  const stats = (context as Partial<ShortlistContext>).stats;
  const out: Record<string, unknown> = {
    titles: context.titles,
    tags: context.tags,
    vocabulary: context.vocabulary,
    personHubs: context.personHubs ?? [],
    ranked: true,
    k: stats?.k ?? context.titles.length,
  };
  if (stats) {
    out.stats = {
      k: stats.k,
      returned: stats.returned,
      ...(stats.expanded === undefined ? {} : { expanded: stats.expanded }),
    };
  }
  const cp = context.continueParent;
  if (cp?.title?.trim()) {
    out.continueParent = {
      title: cp.title.trim(),
      ...(cp.path?.trim() ? { path: cp.path.trim() } : {}),
    };
  }
  return out;
}

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Prompt/schema phrases that must match plus-service `classifyTemplate.mjs`
 * (parity freeze — dual sources until generate-one-source).
 */
export const CLASSIFICATION_PARITY_PHRASES = [
  "You output ONLY: verdict, title, tags, proposed_tags, links, people, and optional hub_section.",
  "people[] — who is named, and how",
  "This product is NOT a task app",
  "The body is sacred and is written elsewhere, verbatim.",
  "task: **soft-retired / almost never**",
  "Continue parent (when present)",
] as const;

/**
 * Live `classifyCapture` post-parse enrich order (after JSON parse).
 * Invariants + active-tag filter sit between stages; see classifyCapture body.
 */
export const CLASSIFY_LIVE_ENRICH_ORDER = [
  "rescueKeepableIdea",
  "normalizePeople",
  "normalizeHubSection",
  "enrichPersonLinks",
  "enrichMediaLinks",
  "enrichListHubLinks",
  "maybeLinkPeopleIndex",
  "enrichEntityLinks",
  "improveClassificationLinks",
  "stripSelfReferentialLinks",
  "repairHubSection",
] as const;

/**
 * Offline `applyClassificationQuality` order (fixtures / backfill / refresh paths).
 * Intentionally differs from live: normalizePeople before rescue; hub repair only
 * when hub details provided; no normalizeHubSection / active-tag filter here.
 */
export const CLASSIFY_OFFLINE_QUALITY_ORDER = [
  "normalizePeople",
  "rescueKeepableIdea",
  "enrichPersonLinks",
  "enrichMediaLinks",
  "enrichListHubLinks",
  "maybeLinkPeopleIndex",
  "enrichEntityLinks",
  "improveClassificationLinks",
  "stripSelfReferentialLinks",
  "repairHubSection",
] as const;

/** Grammar-constrained classification schema (KTD4). additionalProperties: false everywhere. */
export const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["atom", "task", "noise"],
      description:
        "Second-brain triage. Prefer atom for keepable memory (including list/media and product/app ideas). Prefer noise for pure logistics. task is rare/legacy — almost never use it.",
    },
    title: {
      type: "string",
      description:
        "Short declarative claim for atom verdicts (~8–12 words; e.g. 'Sleep debt doesn't accumulate linearly'). Full detail stays in the body. Empty string for task/noise.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Only tags from the Active vocabulary list provided in context.",
    },
    proposed_tags: {
      type: "array",
      items: { type: "string" },
      description:
        "New tags that would help but are not in Active vocabulary. Never auto-applied.",
    },
    links: {
      type: "array",
      items: {
        type: "object",
        properties: {
          note: {
            type: "string",
            description: "Exact existing note title to link (rendered even if unresolved).",
          },
          reason: {
            type: "string",
            description:
              "Substantive relationship: if wikilinks were stripped, the sentence still teaches something. Prefer 'revises [[…]]', 'contradicts [[…]]', career/gift/game cues. Never bare 'preference about X'.",
          },
        },
        required: ["note", "reason"],
        additionalProperties: false,
      },
    },
    hub_section: {
      type: "string",
      description:
        "Optional. Exact ## heading from a linked Person hub's section list for accumulating-list placement. Empty string when unsure or no fit. Never invent a section name.",
    },
    people: {
      type: "array",
      description:
        "People named in the capture. Empty array is correct and common — captures often drop the subject ('likes Annie's fruit tape snack' names Annie but never says who likes it). Never infer a name that is not written in the capture.",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The person's name exactly as written in the capture.",
          },
          role: {
            type: "string",
            enum: ["subject", "mentioned", "recommender"],
            description:
              "subject = the claim is about them ('Nichita likes long brown boots' → Nichita). mentioned = named but not what the claim is about, e.g. a possessive owner or bystander ('likes Annie's fruit tape snack' → Annie). recommender = they suggested a book/show/film.",
          },
        },
        required: ["name", "role"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "title", "tags", "proposed_tags", "links", "people"],
  additionalProperties: false,
} as const;

export const SYSTEM_PROMPT = `You classify fleeting captures from a daily-note inbox into a personal knowledge graph (second brain). This product is NOT a task app — the user has Reminders/Things for chores.

## Output surface (hard rules)
- You output ONLY: verdict, title, tags, proposed_tags, links, people, and optional hub_section.
- You never rewrite, paraphrase, expand, or "improve" the capture body. The body is sacred and is written elsewhere, verbatim.
- You never choose folders or move files. Placement is not your job. One capture → at most one atom (never append into a Movies/list note).
- Titles (when atom) are **short declarative claims** (~8–12 words / under ~80 characters when possible), not topics and not a paste of the whole capture.
  Good: "Sleep debt doesn't accumulate linearly"
  Bad: "Sleep notes" / "Thoughts on sleep"
  Good (person): "Alex prefers periwinkle and soft pajamas"
  Bad (person): "Girlfriend notes" / "Alex stuff"
  Good (list/media): "Want to watch Past Lives" / "Severance season 2 is on the list"
  Bad (list/media): "Movies" / "Watchlist notes"
  Bad (too long): a full multi-clause comparison as the filename — put nuance in the body

## Triage (second brain)
- atom: anything worth meeting again in the graph — claims, observations, decisions, preferences, questions, **list/media dumps**, **and product/app/build ideas** (website pitches, game mashups, "create a …" product specs). If the user would want to find it later, it is an atom.
- noise: pure logistics, empty, or not worth keeping in a second brain ("buy milk", "email landlord", "call dentist at 3", lone timestamps). When in doubt between task and noise → **noise**. When in doubt between atom and noise for keepable content → **atom**.
- task: **soft-retired / almost never**. Do not use task for list items, media, preferences, people facts, or product ideas. Do not use task for ordinary chores (those are noise). Only emit task if nothing else fits and the capture is a pure to-do that somehow is not noise — prefer noise.
- Durable facts about people you know (likes, habits, stories that matter) are usually atoms, not noise.
- List dumps are **one atom per capture**, with a declarative title.
- Product idea test: multi-sentence "create a website/app/game" pitches are **atoms** (tag idea/project when in Active or structural), never task/noise.

## Media / watchlist dumps (high priority)
- Captures about watching/reading a named work are **media atoms**, not mere #preferences.
  Examples: "watch Past Lives", "Christian told me to watch my hero academia", "movie: Dune".
- Tags: include #watch and #show or #movie (and #media when it fits). You may also add #preferences if taste is central — but never only #preferences when a work is named.
- Links: put the **work title** in links[] **only if** that title already appears under Note titles in vault context. Do **not** invent hollow work notes. The work name can live in the atom title without a work link.
- If a person recommended it ("X told me to watch…") and X is a Person hub or Note title, ALSO link that person with a substantive reason (person repair may reinforce).

## Tags
- tags: ONLY from the Active vocabulary list in context **plus** product structural tags (person, preferences, relationship, watch, movie, show, media, list). Drop anything else.
- Always prefer these when they fit:
  - #person — capture is primarily about a real person
  - #preferences — tastes, likes, dislikes, habits, aesthetics (not a substitute for media tags)
  - #relationship — dynamics between people
  - #watch #movie #show #media #list — list/media dumps
- proposed_tags: only for genuinely useful new labels missing from Active. Never invent a flood of tags. Never put person or show display names as tags when a note title link works better.

## People (tasteful, automatic linking)
- When the context lists **Person hubs**, prefer those exact titles for people links (must-link when the capture is about that person).
- Otherwise, when a capture is about a named person and that name appears in **Note titles**, you MUST link that exact title in links[] with a **substantive** reason.
- Match names case-insensitively; use the vault's exact title string in links[].note (canonical hub title, not a nickname spelling).
- Do not invent a new person note title if a close existing title already fits.
- One atom can carry a person link, a work link, and preference/media tags together.
- Pure logistics that merely mention a name stay **noise** — do not force person atoms for chores.
- Do not invent entity links from speech typos (e.g. "Kloe") unless that exact title exists in Note titles.
- **people[] — who is named, and how.** List every person the capture names, each with a role:
  - \`subject\` — the claim is about them. "Nichita likes long brown boots" → Nichita.
  - \`mentioned\` — named, but not what the claim is about: a possessive owner, a bystander. "likes Annie's fruit tape snack" → Annie is **mentioned**, not the subject; nobody said who likes it.
  - \`recommender\` — they suggested a book/show/film. "Christian told me to watch MHA" → Christian.
  A kinship word standing in for a name is a person, not a common noun — \`mom\`, \`dad\`, \`mother\`, \`father\`, \`mama\`, \`papa\`, \`mum\`. "mom wants to celebrate her birthday" → \`Mom\`, subject. Capitalise it. The possessive rule still applies: "mom's lasagna recipe is unbeatable" makes Mom **mentioned**, because the claim is about the recipe.
  Captures routinely drop their subject because the writer knew who they meant. When that happens, return no \`subject\` — an empty people[] is a correct answer, never a failure. Only ever use a name written in the capture; never infer one from surrounding notes, and never put a verb, a determiner, or a weekday in \`name\`.
- **hub_section (optional but important for list/gift/date facts):** when the capture is an accumulating list or want about a person **or list hub** and Person hubs / List hubs list indented ## section names under that hub, set hub_section to one **exact** section string from that list (e.g. Gift Ideas, or Want to watch under Movies). Prefer a real section over leaving empty. Omit or use "" only when unsure or no section fits. Never invent a section name that is not listed.

## Links + supersession (reason quality is load-bearing)
- Link to existing notes when the capture relates, revises, continues, or contradicts them.
- Always fill \`reason\` with readable prose that names the **relationship**.
- **Reason must still teach something if wikilinks were stripped.**
  Bad: "preference about [[Alex]]" / "update about [[Alex]]" / "media work to watch"
  Good: "concrete aesthetic preference for gifts / clothes ([[Alex]])"
  Good: "career status: interview loop — waiting to hear back ([[Alex]])"
  Good: "adds a game they like for the detective feel ([[Alex]])"
  Good: "revises [[Old claim]]" / "contradicts [[Old claim]]"
  Good: "same product thread — settlement timing after split ([[Expense app — final settlement]])"
- **When a Note title is clearly the same thread, prefer a substantive link over silence.**
  Same person, same named work, same app/product/project, same trip, or an explicit revise/continue/contradict of an earlier claim — if that exact title is under Note titles, link it with a reason that teaches the relationship. A plausible, title-exact link is better than an island. Do not skip an obvious same-thread title just to stay sparse.
- Still never invent titles, never link on a vague shared vibe alone, and never force a junk edge with an empty reason. People must-link and media work-title rules above still apply; this section adds the missing *do link* pressure for real threads.
- If a Movies/Shows hub title already exists in Note titles, you may also link it; still link the specific work only when that work title exists.

## Trip / packing / project / document lists (entity links)
- Packing dumps, trip prep lists, and **numbered document/checklist dumps** are usually **atoms** (tag #list), not noise — keepable memory of what you need, packed, or must bring.
  Examples that are **atoms**: "Documents - 1. valid id, 2. receipt, 3. PayPal screenshot"; "packing list: passport, adapter".
- Link an **existing** entity note title when it appears under Note titles (exact title), e.g. "Yosemite packing".
- Do **not** invent hollow trip/project notes in links[]. Soft buckets alone (Camping, Travel) are not enough when a more specific title exists.
- Prefer one hard entity link with a substantive reason over only a broad hub.
- Pure one-off logistics with no keepable list ("buy milk", lone "call dentist at 3") stay noise. A multi-item checklist is not pure logistics.

## Continue parent (when present)
- When the user context includes a **### Continue parent** block, the user intentionally continued that note.
- You MUST include that exact title in links[] with reason continues/revises/contradicts/adds detail to [[…]] (pick the best fit; default continues).
- Never reuse the parent title as this atom's title — invent a new short declarative claim.
- Never rewrite or modify the parent body (you only output schema fields).

## title
- Required non-empty string iff verdict is atom.
- Empty string for task and noise.
- Prefer short claims; never use the entire capture as the title when it is long.`;

/**
 * The whole vault-context message as one string: block A, then the note titles.
 *
 * `buildMessagesRequest` sends the same bytes as two content blocks so the cache breakpoint can sit
 * between them; the day-batch fork and the diagnostics still want the single string.
 */
export function buildContextUserMessage(context: VaultContext): string {
  return (
    buildContextPrefixBlock(context) +
    CONTEXT_BLOCK_SEPARATOR +
    buildTitlesBlock(context)
  );
}

function hubsForEnrich(context: VaultContext): PersonHub[] {
  if (context.personHubDetails?.length) {
    return context.personHubDetails.map((d) => ({
      canonicalTitle: d.canonicalTitle,
      matchKeys: d.matchKeys,
      path: "",
    }));
  }
  return (context.personHubs ?? []).map((t) => ({
    canonicalTitle: t,
    matchKeys: [t],
    path: "",
  }));
}

export function buildCaptureUserMessage(
  capture: string,
  continueParent?: { title: string; path?: string } | null,
): string {
  const parts = ["## Capture to classify", "", capture, ""];
  const title = continueParent?.title?.trim();
  if (title) {
    parts.push("### Continue parent", `Title: ${title}`);
    const path = continueParent?.path?.trim();
    if (path) parts.push(`Path: ${path}`);
    parts.push("");
  }
  parts.push("Classify this single capture. Return only the schema fields.");
  return parts.join("\n");
}

/**
 * Redact a key to a short fingerprint for safe logging.
 * Never log the raw key, headers, or request bodies (U1 log-safety).
 */
export function fingerprintKey(apiKey: string): string {
  if (!apiKey) return "none";
  const tail = apiKey.slice(-4);
  return `…${tail} (len=${apiKey.length})`;
}

export function emptyUsage(): ClassifyUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

export function parseUsage(raw: unknown): ClassifyUsage {
  const u = (raw ?? {}) as Record<string, unknown>;
  return {
    input_tokens: Number(u.input_tokens ?? 0),
    output_tokens: Number(u.output_tokens ?? 0),
    cache_creation_input_tokens: Number(u.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: Number(u.cache_read_input_tokens ?? 0),
  };
}

function dropHubSection(result: ClassificationResult): ClassificationResult {
  if (result.hub_section === undefined) return result;
  const next: ClassificationResult = { ...result };
  delete next.hub_section;
  return next;
}

const PERSON_ROLES = new Set<PersonRole>([
  "subject",
  "mentioned",
  "recommender",
]);

/**
 * Post-parse guard on model-named people (KTD4 layer 2, R4 + R5).
 *
 * Schema shape is trusted; the *content* is not. A name the capture never
 * wrote is invented, and the 0.6.60 deny list stays as a backstop for slips.
 * Drops offending entries, never the whole classification. Leaves `people`
 * absent when the model did not send it — absent and `[]` differ (KTD6).
 */
export function normalizePeople(
  capture: string,
  result: ClassificationResult,
): ClassificationResult {
  if (result.people === undefined) return result;
  const raw = Array.isArray(result.people) ? result.people : [];
  const people: ClassificationPerson[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const role = entry?.role;
    if (!name || !PERSON_ROLES.has(role)) continue;
    if (!captureMentionsKey(capture, name)) continue; // R4 — verbatim only
    if (isDeniedPersonName(name)) continue; // R5 — backstop
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ name, role });
  }
  return { ...result, people };
}

/**
 * Post-parse business invariants (KTD4 layer 2).
 * Schema well-formedness is trusted; conditional-required is not.
 */
export function normalizeHubSection(
  result: ClassificationResult,
  context: VaultContext,
): ClassificationResult {
  const raw = (result.hub_section ?? "").trim();
  if (!raw) {
    return result.hub_section !== undefined ? dropHubSection(result) : result;
  }
  if (result.verdict !== "atom") {
    return dropHubSection(result);
  }
  const details = hubDetailsForSection(context);
  const allowedExact = new Map<string, string>(); // lower → canonical
  for (const d of details) {
    for (const sec of d.sections ?? []) {
      const t = sec.trim();
      if (t) allowedExact.set(t.toLowerCase(), t);
    }
  }
  const canon = allowedExact.get(raw.toLowerCase());
  if (!canon) {
    return dropHubSection(result);
  }
  return { ...result, hub_section: canon };
}

/** Person + list hub details for hub_section allow-list / repair. */
export function hubDetailsForSection(
  context: VaultContext,
): Array<{ canonicalTitle: string; matchKeys?: string[]; sections?: string[] }> {
  return [
    ...(context.personHubDetails ?? []),
    ...(context.listHubDetails ?? []),
  ];
}

/**
 * After person-link enrich: if hub_section still empty, place only when a
 * linked person hub's existing H2 is an unambiguous match (exact name in
 * text, or unique keyword cue). Never invent section names.
 */
export function repairHubSection(
  capture: string,
  result: ClassificationResult,
  context: VaultContext,
): ClassificationResult {
  if (result.verdict !== "atom") return result;
  let r = normalizeHubSection(result, context);
  if ((r.hub_section ?? "").trim()) return r;

  const details = hubDetailsForSection(context);
  if (!details.length) return r;

  const linkNotes = new Set(
    (r.links ?? [])
      .map((l) => (l.note ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (!linkNotes.size) return r;

  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const d of details) {
    const keys = [
      d.canonicalTitle,
      ...(d.matchKeys ?? []),
    ].map((k) => k.trim().toLowerCase());
    if (!keys.some((k) => k && linkNotes.has(k))) continue;
    for (const sec of d.sections ?? []) {
      const t = sec.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      candidates.push(t);
    }
  }
  if (!candidates.length) return r;

  const hay = `${capture ?? ""}\n${r.title ?? ""}`.toLowerCase();

  // Exact section title in capture/title (longest first).
  const byLen = [...candidates].sort((a, b) => b.length - a.length);
  for (const sec of byLen) {
    if (hay.includes(sec.toLowerCase())) {
      return { ...r, hub_section: sec };
    }
  }

  // Keyword cues → sections whose names share the cue token; unique only.
  const cueHits = new Set<string>();
  const rules: Array<{ re: RegExp; tokens: string[] }> = [
    {
      re: /\b(gift|presents?|wishlist|want(?:s|ed)?\b.*\b(?:case|pc|phone|bag|shoes?|clothes?))\b/i,
      tokens: ["gift"],
    },
    { re: /\b(date night|date idea|dinner date)\b/i, tokens: ["date"] },
    {
      re: /\b(travel|trip|vacation|flight|hotel)\b/i,
      tokens: ["travel", "trip"],
    },
    {
      re: /\b(movie|watchlist|show to watch|book to read)\b/i,
      tokens: ["movie", "show", "book", "watch", "experience"],
    },
    {
      re: /\b(mentioned wanting|things? (?:she|he|they)'?s? mentioned)\b/i,
      tokens: ["mention", "wanting"],
    },
  ];
  for (const rule of rules) {
    if (!rule.re.test(hay)) continue;
    for (const sec of candidates) {
      const low = sec.toLowerCase();
      if (rule.tokens.some((t) => low.includes(t))) cueHits.add(sec);
    }
  }
  if (cueHits.size === 1) {
    return { ...r, hub_section: [...cueHits][0]! };
  }

  return r;
}

export function checkInvariants(
  result: ClassificationResult,
): { ok: true } | { ok: false; message: string } {
  const verdict = result.verdict;
  if (verdict === "atom") {
    if (!result.title || !result.title.trim()) {
      return { ok: false, message: "invariant: atom verdict requires a non-empty title" };
    }
  } else if (result.title && result.title.trim()) {
    return {
      ok: false,
      message: `invariant: non-atom verdict must not carry a title (got "${result.title.slice(0, 40)}")`,
    };
  }
  return { ok: true };
}

export interface BuildRequestOptions {
  model: string;
  capture: string;
  context: VaultContext;
  /** Interactive default `5m`; batch uses `1h` (KTD3). */
  cacheTtl?: "5m" | "1h";
  /**
   * Extend the cached prefix over the note-title block too (U5).
   *
   * Off by default, and daily filing must leave it off: there the titles are *this capture's*
   * shortlist, so a breakpoint after them writes an entry nothing ever reads back — a write premium
   * for nothing. A catch-up chunk is the opposite case. Every capture in the chunk is handed the
   * same titles byte for byte, so the entry is written once and read back by the rest of the chunk.
   *
   * This flag is the whole reason chunking is cheaper than today's frozen full-vault list. Without
   * it the titles sit *after* the only breakpoint and are re-billed at full rate on every request,
   * however stable they are — byte-identity alone buys nothing.
   */
  cacheTitles?: boolean;
  maxTokens?: number;
}

/**
 * Whether a chunk's titles block has earned a cache breakpoint.
 *
 * Two or more captures: yes, the write amortises over every request after the first. Exactly one:
 * no — a solo chunk would pay the cache *write* premium on a block nothing ever reads back, which
 * is strictly worse than leaving it uncached.
 */
export function shouldCacheChunkTitles(captureCount: number): boolean {
  return captureCount > 1;
}

/**
 * Request body per KTD3:
 * system (stable) → user context (stable block + volatile titles) → user capture (volatile).
 *
 * The context message is **two** blocks. Block A — vocabulary, tags, person hubs — is identical for
 * every capture of a run, and always carries `cache_control`. Block B is the note titles: volatile
 * per capture on the daily path (so uncached), byte-stable across a catch-up chunk (so cached when
 * the caller passes `cacheTitles`).
 */
export function buildMessagesRequest(opts: BuildRequestOptions): Record<string, unknown> {
  const cacheTtl = opts.cacheTtl ?? "5m";
  const stableText = buildContextPrefixBlock(opts.context) + CONTEXT_BLOCK_SEPARATOR;
  const titlesText = buildTitlesBlock(opts.context);
  const captureText = buildCaptureUserMessage(
    opts.capture,
    opts.context.continueParent,
  );

  return {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          // Index 0 is load-bearing: backfill's assertBatchUsesHourCache gates on
          // messages[0].content[0].cache_control.ttl.
          {
            type: "text",
            text: stableText,
            cache_control: { type: "ephemeral", ttl: cacheTtl },
          },
          {
            type: "text",
            text: titlesText,
            // Index 1 stays a plain block unless asked: omitting the key entirely keeps the daily
            // path's bytes exactly what they were before chunking existed.
            ...(opts.cacheTitles
              ? { cache_control: { type: "ephemeral", ttl: cacheTtl } }
              : {}),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: captureText,
          },
        ],
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: CLASSIFICATION_SCHEMA,
      },
    },
  };
}

/** Per-day batching fork (KTD3 open fork) — array output for N captures in one call. */
export const BATCH_CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: CLASSIFICATION_SCHEMA,
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

export function buildDayBatchRequest(opts: {
  model: string;
  captures: string[];
  context: VaultContext;
  maxTokens?: number;
}): Record<string, unknown> {
  const contextText = buildContextUserMessage(opts.context);
  const capturesBlock = opts.captures
    .map((c, i) => `### Capture ${i + 1}\n${c}`)
    .join("\n\n");

  return {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: contextText,
      },
      {
        role: "user",
        content: [
          "## Captures to classify (one day)",
          "",
          "Return one result per capture, same order, in `results`.",
          "",
          capturesBlock,
        ].join("\n"),
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: BATCH_CLASSIFICATION_SCHEMA,
      },
    },
  };
}

export interface ClassifyDeps {
  /**
   * BYOK Anthropic key. Ignored when `plus` is set (proxy holds the key).
   * Empty string allowed when classifying via Plus only.
   */
  apiKey: string;
  model: string;
  /** Injected for tests; defaults to Obsidian requestUrl. */
  request?: typeof requestUrl;
  /** Active vocabulary — model tags filtered to this set (R11). */
  activeVocabulary?: string[];
  /** Max attempts for 429/5xx (default 3). */
  maxAttempts?: number;
  /** Backoff sleeper (ms); inject no-op in tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Cache the note-title block as well (U5). Only a caller sending the *same* titles to several
   * captures in a row — a catch-up chunk — may set this. Ignored on the Plus path, which renders
   * its own request server-side.
   */
  cacheTitles?: boolean;
  /** Called once on 401/403 so UI can Notice (KTD4). */
  onAuthFailure?: (message: string) => void;
  /**
   * Atoms Plus managed path (U3). When set, classify goes to Plus proxy
   * with Bearer session — never sends Anthropic x-api-key.
   */
  plus?: {
    baseUrl: string;
    sessionToken: string;
    /** Called after successful classify with updated remaining. */
    onRemaining?: (remaining: number) => void;
  };
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Classify a single capture. Request-layer defended (KTD4 layer 3).
 * Parse layer trusts schema — no try/catch around JSON.parse of completion content.
 */
export async function classifyCapture(
  capture: string,
  context: VaultContext,
  deps: ClassifyDeps,
): Promise<ClassifyOutcome> {
  const plus = deps.plus;
  const apiKey = deps.apiKey?.trim();
  if (!plus && !apiKey) {
    return {
      ok: false,
      reason: "missing_key",
      message: "Set your API key in settings",
    };
  }
  // #500. This is the only Plus path that builds its own request — capture body
  // and session token both leave from here — so the predicate gets a home on the
  // call that egresses, not only on `resolveClassifyAuth` one function above.
  // Today every `deps.plus` comes from there and carries a base already checked,
  // so this is unreachable; the repo has been bitten by a gate placed one
  // function too early before (docs/solutions/security/consent-gate-must-be-
  // checked-at-egress-not-at-entry.md), and a future caller building `plus` from
  // settings directly would reopen #500 for note text without failing a test.
  if (plus && !isAllowedPlusBaseUrl(plus.baseUrl)) {
    return {
      ok: false,
      reason: "auth",
      message: PLUS_BASE_URL_INVALID_MESSAGE,
    };
  }

  // Plus builds its own Anthropic request server-side (KTD-B3), so the device does not
  // render one at all — sending it duplicated the whole context for a field the proxy
  // explicitly ignores.
  const body = plus
    ? null
    : buildMessagesRequest({
        model: deps.model,
        capture,
        context,
        cacheTitles: deps.cacheTitles,
      });

  // Plus: fetch (localhost dogfood + CORS host). BYOK: requestUrl (no CORS to Anthropic).
  const request = deps.request ?? (plus ? plusFetchRequest : requestUrl);
  const sleep = deps.sleep ?? defaultSleep;
  const maxAttempts = deps.maxAttempts ?? 3;

  let status = 0;
  let json: Record<string, unknown> = {};
  let lastTransient: ClassifyOutcome | null = null;
  let plusErrorMessage: string | undefined;
  let keyFingerprint = plus
    ? "plus"
    : fingerprintKey(apiKey ?? "");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    plusErrorMessage = undefined;
    try {
      if (plus) {
        const base = plus.baseUrl.replace(/\/+$/, "");
        // One key per logical classify attempt; retries reuse attempt slot via outer loop
        // only for transient failures — new UUID each attempt so transport refunds stay fair.
        const idem = `cls_${Date.now().toString(36)}_${attempt}_${Math.random().toString(36).slice(2, 9)}`;
        const res = await request({
          url: `${base}/v1/classify`,
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            authorization: `Bearer ${plus.sessionToken.trim()}`,
            "Idempotency-Key": idem,
          },
          body: JSON.stringify({ capture, context: contextForPlus(context) }),
          throw: false,
        });
        status = res.status;
        const outer =
          typeof res.json === "object" && res.json !== null
            ? (res.json as Record<string, unknown>)
            : {};
        // Keep proxy error text (session vs upstream key) before unwrapping result.
        if (typeof outer.message === "string" && outer.message.trim()) {
          plusErrorMessage = outer.message.trim().slice(0, 200);
        }
        // Proxy may wrap Anthropic response in { result, remaining } or return Anthropic shape.
        if (
          typeof outer.result === "object" &&
          outer.result !== null &&
          !Array.isArray(outer.result)
        ) {
          json = outer.result as Record<string, unknown>;
        } else {
          json = outer;
        }
        if (typeof outer.remaining === "number") {
          plus.onRemaining?.(outer.remaining);
        }
      } else {
        if (!apiKey) {
          return {
            ok: false,
            reason: "missing_key",
            message: "Set your API key in settings",
          };
        }
        const res = await request({
          url: ANTHROPIC_MESSAGES_URL,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify(body),
          throw: false,
        });
        status = res.status;
        json = (typeof res.json === "object" && res.json !== null
          ? res.json
          : {}) as Record<string, unknown>;
      }
    } catch (err) {
      // Offline / network throw — never log full error objects (may carry headers).
      const name = err instanceof Error ? err.name : "Error";
      const msg = err instanceof Error ? err.message : "unknown";
      // Strip anything that looks like a key if a proxy embeds it.
      const safe = msg
        .replace(/sk-ant-[a-zA-Z0-9_-]+/g, "[redacted]")
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .slice(0, 160);
      return {
        ok: false,
        reason: "offline",
        message: `Network error calling ${plus ? "Plus" : "Anthropic"} API (${name}: ${safe})`,
      };
    }

    if (status === 402 && plus) {
      return {
        ok: false,
        reason: "quota",
        status,
        message:
          "Included filings used up this period. Wait for reset or buy a top-up.",
      };
    }

    if (status === 401 || status === 403) {
      const upstream = (plusErrorMessage ?? "").toLowerCase();
      const message = !plus
        ? "API key rejected (401/403). Check the key in settings."
        : upstream.includes("upstream") || upstream.includes("model auth")
          ? "Plus service cannot reach Anthropic (managed API key invalid). Operator: fix ANTHROPIC_API_KEY on the Plus server."
          : isSessionRejectedMessage(plusErrorMessage)
            ? "Plus session rejected. Sign in again from Settings → Atoms Plus."
            : // An explained refusal (entitlement required, …) is accurate as-is;
              // an unexplained one (gateway, proxy, WAF) must not blame the
              // session, which is probably fine.
              plusErrorMessage?.trim() ||
              `Atoms Plus refused this request (HTTP ${status}) for an unexpected reason. Nothing was filed. Try again in a moment.`;
      deps.onAuthFailure?.(message);
      return { ok: false, reason: "auth", status, message };
    }

    if (status === 429 || status >= 500) {
      lastTransient = {
        ok: false,
        reason: status === 429 ? "rate_limit" : "server",
        status,
        message:
          status === 429
            ? "Rate limited (429)"
            : `Anthropic server error (${status})`,
      };
      if (attempt < maxAttempts) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
        continue;
      }
      return lastTransient;
    }

    if (status < 200 || status >= 300) {
      return {
        ok: false,
        reason: "unknown",
        status,
        message: `Anthropic request failed (${status})`,
      };
    }

    break; // 2xx
  }

  const content = json.content as
    | Array<{ type?: string; text?: string }>
    | undefined;
  const textBlock = content?.find(
    (b) => b.type === "text" && typeof b.text === "string",
  );
  if (!textBlock?.text) {
    return {
      ok: false,
      reason: "unknown",
      message: "Response missing text content",
    };
  }

  // Parse structured output. Schema usually yields valid JSON; still fail closed
  // on truncate/escape errors so one bad completion does not kill the batch.
  let parsed: ClassificationResult;
  try {
    parsed = JSON.parse(textBlock.text) as ClassificationResult;
  } catch {
    return {
      ok: false,
      reason: "invariant",
      message: "Model returned invalid JSON (try Update again)",
    };
  }

  // Keepable product ideas must not soft-delete as task/noise (before invariants need title).
  parsed = rescueKeepableIdea(capture, parsed, context.titles ?? []);

  const inv = checkInvariants(parsed);
  if (!inv.ok) {
    return { ok: false, reason: "invariant", message: inv.message };
  }

  parsed = normalizePeople(capture, parsed);
  parsed = normalizeHubSection(parsed, context);

  // R11 — never apply non-Active tags; proposed_tags stay for approval.
  if (deps.activeVocabulary) {
    parsed.tags = filterTagsToActive(parsed.tags ?? [], deps.activeVocabulary);
  }

  // People repair (atom-only, person-shaped) — single choke-point for live classify.
  let result = enrichPersonLinks(capture, parsed, hubsForEnrich(context));
  // Media/watchlist shape — tags + work link only when title exists in vault.
  result = enrichMediaLinks(capture, result, context.titles ?? []);
  // List hub (Movies etc.) hard-link when unique title match.
  result = enrichListHubLinks(
    capture,
    result,
    context.listHubDetails ?? [],
  );
  // Optional People index when workplace-shaped and no person hub linked.
  result = maybeLinkPeopleIndex(
    capture,
    result,
    context.titles ?? [],
    context.personHubs ?? [],
  );
  // Trip/list/project entity reinforce — exact vault titles only.
  result = enrichEntityLinks(capture, result, context.titles ?? []);
  // Rewrite boilerplate reasons into substantive prose.
  result = improveClassificationLinks(capture, result);
  // Never self-link / self-duplicate the atom title in graph prose.
  result = stripSelfReferentialLinks(result);
  // Placement after links exist: fill hub_section when unambiguous.
  result = repairHubSection(capture, result, context);

  return {
    ok: true,
    result,
    usage: parseUsage(json.usage),
    keyFingerprint,
  };
}

/**
 * Shared post-classify quality pass for fixture / offline paths
 * (write fixtures, backfill) — mirrors classifyCapture enrich chain.
 */
export function applyClassificationQuality(
  capture: string,
  result: ClassificationResult,
  opts: {
    titles?: string[];
    personHubs?: PersonHub[];
    personHubTitles?: string[];
    personHubDetails?: VaultContext["personHubDetails"];
    listHubDetails?: VaultContext["listHubDetails"];
  } = {},
): ClassificationResult {
  const titles = opts.titles ?? [];
  const hubs = opts.personHubs ?? [];
  // Batch (backfill) and refresh parse model JSON on their own paths — guard
  // people here too, or unvetted names reach frontmatter (R4/R5). Idempotent.
  let r = normalizePeople(capture, result);
  r = rescueKeepableIdea(capture, r, titles);
  r = enrichPersonLinks(capture, r, hubs);
  r = enrichMediaLinks(capture, r, titles);
  r = enrichListHubLinks(capture, r, opts.listHubDetails ?? []);
  r = maybeLinkPeopleIndex(
    capture,
    r,
    titles,
    opts.personHubTitles ?? hubs.map((h) => h.canonicalTitle),
  );
  r = enrichEntityLinks(capture, r, titles);
  r = improveClassificationLinks(capture, r);
  r = stripSelfReferentialLinks(r);
  const details = opts.personHubDetails;
  const listDetails = opts.listHubDetails;
  if (details?.length || listDetails?.length) {
    r = repairHubSection(capture, r, {
      titles,
      tags: [],
      vocabulary: [],
      personHubs: opts.personHubTitles ?? hubs.map((h) => h.canonicalTitle),
      personHubDetails: details ?? [],
      listHubDetails: listDetails ?? [],
    });
  }
  return r;
}

/**
 * Dev diagnostics hook. Always a no-op — Community plugin scan forbids console
 * and eslint-disable no-console. Keep the call sites so spike wiring stays stable.
 */
export function logClassifyOutcome(
  _label: string,
  _outcome: ClassifyOutcome,
): void {
  void _label;
  void _outcome;
}
