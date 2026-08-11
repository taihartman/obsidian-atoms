/** Open-loop FM model + open-now derivation (pure). */

export const OPEN_LOOP_KEY = "atoms-loop";
export const OPEN_LOOP_SOURCE_KEY = "atoms-loop-source";
export const OPEN_LOOP_CLOSE_ANSWER_KEY = "atoms-loop-close-answer";
export const REDEEMS_RELATION = "redeems";

const LOOP_STATE_RE = /^atoms-loop:\s*(\S+)\s*$/m;
const LOOP_SOURCE_RE = /^atoms-loop-source:\s*(\S+)\s*$/m;

export type OpenLoopState =
  | "active"
  | "not_a_loop"
  | "resolved_elsewhere"
  | "abandoned";

export type OpenLoopSource = "inferred" | "user";

export type OpenLoopFm = {
  state: OpenLoopState;
  source: OpenLoopSource;
};

const STATES = new Set<string>([
  "active",
  "not_a_loop",
  "resolved_elsewhere",
  "abandoned",
]);

const SOURCES = new Set<string>(["inferred", "user"]);

export function openNow(args: {
  state: OpenLoopState | null | undefined;
  hasRedeemingChild: boolean;
}): boolean {
  return args.state === "active" && !args.hasRedeemingChild;
}

/** Classifier/heuristics may write only when unset or still inferred. */
export function canClassifierWrite(
  current: OpenLoopFm | null | undefined,
): boolean {
  if (!current) return true;
  return current.source === "inferred";
}

export function formatOpenLoopFmLines(fm: OpenLoopFm): string[] {
  return [
    `${OPEN_LOOP_KEY}: ${fm.state}`,
    `${OPEN_LOOP_SOURCE_KEY}: ${fm.source}`,
  ];
}

/**
 * Read loop keys from a full markdown file or a frontmatter block body.
 * Requires both keys with valid enums; otherwise null (unset).
 */
export function parseOpenLoopFm(markdownOrFm: string): OpenLoopFm | null {
  const text = markdownOrFm ?? "";
  const state = text.match(LOOP_STATE_RE)?.[1]?.trim() ?? null;
  const source = text.match(LOOP_SOURCE_RE)?.[1]?.trim() ?? null;
  if (!state || !source) return null;
  if (!STATES.has(state) || !SOURCES.has(source)) return null;
  return {
    state: state as OpenLoopState,
    source: source as OpenLoopSource,
  };
}

export type LinkLike = {
  note?: string;
  relation?: string;
  reason?: string;
};

/** True if any link is a redeeming edge (relation or reason prose). */
export function linksIncludeRedeems(links: LinkLike[] | null | undefined): boolean {
  if (!links?.length) return false;
  for (const l of links) {
    const rel = (l.relation ?? "").trim().toLowerCase();
    if (rel === REDEEMS_RELATION) return true;
    const reason = (l.reason ?? "").trim().toLowerCase();
    if (reason.startsWith("redeems ") || reason.includes("redeems [[")) {
      return true;
    }
  }
  return false;
}

