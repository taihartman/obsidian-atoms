/** Open-loop FM model + open-now derivation (pure). */

export const OPEN_LOOP_KEY = "atoms-loop";
export const OPEN_LOOP_SOURCE_KEY = "atoms-loop-source";
export const REDEEMS_RELATION = "redeems";

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
  const state = matchFmValue(text, OPEN_LOOP_KEY);
  const source = matchFmValue(text, OPEN_LOOP_SOURCE_KEY);
  if (!state || !source) return null;
  if (!STATES.has(state) || !SOURCES.has(source)) return null;
  return {
    state: state as OpenLoopState,
    source: source as OpenLoopSource,
  };
}

function matchFmValue(text: string, key: string): string | null {
  const re = new RegExp(`^${escapeReg(key)}:\\s*(\\S+)\\s*$`, "m");
  const m = text.match(re);
  return m?.[1]?.trim() ?? null;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function openNowFromFmAndLinks(
  markdownOrFm: string,
  links: LinkLike[] | null | undefined,
): boolean {
  const fm = parseOpenLoopFm(markdownOrFm);
  return openNow({
    state: fm?.state ?? null,
    hasRedeemingChild: linksIncludeRedeems(links),
  });
}
