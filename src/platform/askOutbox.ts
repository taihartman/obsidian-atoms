/**
 * Ask outbox apply planner — create new Atoms/ files from Claude queue.
 */
import type { ClassificationLink } from "../shared/types";
import { relationReasonProse } from "../shared/relationReason";
import {
  OPEN_LOOP_CLOSE_ANSWER_KEY,
  applyOpenLoopFm,
  formatOpenLoopFmLines,
  parseOpenLoopFm,
  type OpenLoopFm,
  type OpenLoopState,
} from "../shared/openLoop";
import { looksLikeOpenLoop } from "../pipeline/openLoopHeuristic";
import {
  atomPathForTitle,
  clampAtomFolder,
  formatLinkProse,
  normalizeCaptureText,
  sanitizeFilename,
} from "../pipeline/render";
import { localDateTimeStamp } from "../pipeline/atomQuality";

export type AskOutboxPayload = {
  title: string;
  body?: string;
  tags?: string[];
  links?: { note: string; reason?: string }[];
  parent_title?: string;
  relation?: string;
  client_request_id?: string;
  /** Agent-asserted intention → atoms-loop active + source user. */
  open_loop?: boolean;
  /** Free-text answer to “what would closing look like?” on redeeming child. */
  close_answer?: string;
  /** set_loop: atoms-loop state (source always user on apply). */
  state?: string;
};

export type AskOutboxPlan =
  | { action: "create"; path: string; content: string; title: string }
  | { action: "modify"; path: string; content: string; title: string }
  | { action: "applied_idempotent"; path: string; title: string }
  | {
      action: "reject";
      reason: "path_exists" | "missing" | "invalid_state";
      path: string;
      title: string;
    };

const LOOP_STATES = new Set<string>([
  "active",
  "not_a_loop",
  "resolved_elsewhere",
  "abandoned",
]);

function yamlQuote(s: string): string {
  return JSON.stringify(String(s));
}

/**
 * Build Ask-origin atom markdown (Process parity for the note the user reads).
 * Capture body is sacred/verbatim. Links = formatLinkProse after a blank line.
 * Mirror recovers structured links from that prose (no FM atom-links).
 */
export function buildAskAtomMarkdown(opts: {
  title: string;
  body: string;
  tags?: string[];
  links?: { note: string; reason?: string }[];
  created?: string;
  parent?: string;
  relation?: string;
  /** Agent-asserted open loop → source user; else heuristic may mark inferred. */
  openLoop?: boolean;
  /** Optional close-answer log on redeeming child. */
  closeAnswer?: string;
}): { pathSegment: string; content: string; title: string } {
  const { filename, alias } = sanitizeFilename(opts.title);
  const title = filename;
  const created = opts.created ?? localDateTimeStamp();
  const tags = (opts.tags ?? [])
    .map((t) => String(t).replace(/^#/, "").replace(/[\r\n]/g, "").trim())
    .filter(Boolean)
    .slice(0, 20);
  const links: ClassificationLink[] = (opts.links ?? [])
    .filter((l) => l.note?.trim())
    .map((l) => ({
      note: sanitizeFilename(l.note).filename,
      reason: (l.reason || "").trim(),
    }));

  // continue: ensure parent edge in link prose
  if (opts.parent?.trim()) {
    const p = sanitizeFilename(opts.parent.trim()).filename;
    const rel = (opts.relation || "continues").trim();
    const reason = relationReasonProse(rel, p);
    if (!links.some((l) => l.note.toLowerCase() === p.toLowerCase())) {
      links.unshift({ note: p, reason });
    } else {
      const hit = links.find((l) => l.note.toLowerCase() === p.toLowerCase())!;
      if (!hit.reason) hit.reason = reason;
    }
  }

  const fm: string[] = ["---", `created: ${created}`];
  if (alias) {
    fm.push("aliases:");
    fm.push(`  - ${yamlQuote(alias)}`);
  }
  fm.push(`source: "[[Ask]]"`);
  fm.push("generated-by: ask-mcp");
  if (opts.parent?.trim()) {
    fm.push(`parent: ${yamlQuote(opts.parent.trim())}`);
  }
  if (opts.relation?.trim()) {
    fm.push(`relation: ${opts.relation.trim()}`);
  }
  if (tags.length) {
    fm.push("tags:");
    for (const t of tags) fm.push(`  - ${t}`);
  } else {
    fm.push("tags: []");
  }
  let loop: OpenLoopFm | null = null;
  if (opts.openLoop === true) {
    loop = { state: "active", source: "user" };
  } else if (
    opts.openLoop !== false &&
    looksLikeOpenLoop(String(opts.body ?? ""), title)
  ) {
    loop = { state: "active", source: "inferred" };
  }
  if (loop) fm.push(...formatOpenLoopFmLines(loop));
  const closeAns = (opts.closeAnswer ?? "").trim();
  if (closeAns) {
    fm.push(
      `${OPEN_LOOP_CLOSE_ANSWER_KEY}: ${yamlQuote(closeAns.slice(0, 500))}`,
    );
  }
  fm.push("---", "");

  const body = String(opts.body ?? "").replace(/\s+$/, "");
  const prose = formatLinkProse(links);
  const fullBody = prose ? `${body}\n\n${prose}` : body;
  const content =
    fm.join("\n") + fullBody + (fullBody.endsWith("\n") ? "" : "\n");
  return { pathSegment: title, content, title };
}

/** Extract body after frontmatter for equality checks. */
export function bodyAfterFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\n/, "");
}

export function isAskMcpContent(content: string): boolean {
  if (!content.startsWith("---")) return false;
  const end = content.indexOf("\n---", 3);
  const fm = end === -1 ? content.slice(0, 400) : content.slice(0, end + 4);
  return /^generated-by:\s*ask-mcp\s*$/m.test(fm);
}

/**
 * Plan one outbox item against current vault file text (if any).
 */
export function planAskOutboxApply(
  payload: AskOutboxPayload,
  atomFolder: string,
  existingContent: string | null,
): AskOutboxPlan {
  const built = buildAskAtomMarkdown({
    title: payload.title,
    body: payload.body ?? "",
    tags: payload.tags,
    links: payload.links,
    parent: payload.parent_title,
    relation: payload.relation,
    openLoop: payload.open_loop === true ? true : undefined,
    closeAnswer: payload.close_answer,
  });
  const path = atomPathForTitle(atomFolder, built.title);
  const folder = clampAtomFolder(atomFolder);
  if (!path.startsWith(`${folder}/`)) {
    return { action: "reject", reason: "path_exists", path, title: built.title };
  }
  if (existingContent == null) {
    return {
      action: "create",
      path,
      content: built.content,
      title: built.title,
    };
  }
  if (
    isAskMcpContent(existingContent) &&
    normalizeCaptureText(bodyAfterFrontmatter(existingContent)) ===
      normalizeCaptureText(bodyAfterFrontmatter(built.content))
  ) {
    return {
      action: "applied_idempotent",
      path,
      title: built.title,
    };
  }
  return {
    action: "reject",
    reason: "path_exists",
    path,
    title: built.title,
  };
}

/**
 * Plan FM-only loop mark on an existing atom (set_loop outbox kind).
 */
export function planSetLoopApply(
  payload: AskOutboxPayload,
  atomFolder: string,
  existingContent: string | null,
): AskOutboxPlan {
  const title = String(payload.title || "").trim();
  const stateRaw = String(payload.state || "").trim();
  const path = atomPathForTitle(atomFolder, title || "untitled");
  const folder = clampAtomFolder(atomFolder);
  if (!title || !path.startsWith(`${folder}/`)) {
    return {
      action: "reject",
      reason: "missing",
      path,
      title: title || "untitled",
    };
  }
  if (!LOOP_STATES.has(stateRaw)) {
    return {
      action: "reject",
      reason: "invalid_state",
      path,
      title,
    };
  }
  const state = stateRaw as OpenLoopState;
  if (existingContent == null) {
    return { action: "reject", reason: "missing", path, title };
  }
  const desired: OpenLoopFm = { state, source: "user" };
  const cur = parseOpenLoopFm(existingContent);
  if (cur?.state === desired.state && cur.source === desired.source) {
    return { action: "applied_idempotent", path, title };
  }
  const next = applyOpenLoopFm(existingContent, desired);
  if (next === existingContent) {
    return { action: "applied_idempotent", path, title };
  }
  return { action: "modify", path, content: next, title };
}
