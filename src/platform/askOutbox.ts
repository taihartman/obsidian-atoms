/**
 * Ask outbox apply planner — create new Atoms/ files from Claude queue.
 */
import type { ClassificationLink } from "../shared/types";
import {
  atomPathForTitle,
  clampAtomFolder,
  normalizeCaptureText,
  sanitizeFilename,
} from "../pipeline/render";
import { localDateTimeStamp } from "../pipeline/atomQuality";

export type AskOutboxPayload = {
  title: string;
  body: string;
  tags?: string[];
  links?: { note: string; reason?: string }[];
  parent_title?: string;
  relation?: string;
  client_request_id?: string;
};

export type AskOutboxPlan =
  | { action: "create"; path: string; content: string; title: string }
  | { action: "applied_idempotent"; path: string; title: string }
  | { action: "reject"; reason: "path_exists"; path: string; title: string };

function yamlQuote(s: string): string {
  return JSON.stringify(String(s));
}

/**
 * Build Ask-origin atom markdown.
 * Capture body is sacred/verbatim — NO reason prose flattened into body.
 * Structured links + parent/relation live in frontmatter; bare [[wikilinks]]
 * at end keep Obsidian graph edges without duplicating reason text.
 */
export function buildAskAtomMarkdown(opts: {
  title: string;
  body: string;
  tags?: string[];
  links?: { note: string; reason?: string }[];
  created?: string;
  parent?: string;
  relation?: string;
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

  // continue: ensure parent edge in structured links
  if (opts.parent?.trim()) {
    const p = sanitizeFilename(opts.parent.trim()).filename;
    const rel = (opts.relation || "continues").trim();
    const reason =
      rel === "revises"
        ? `revises [[${p}]]`
        : rel === "contradicts"
          ? `contradicts [[${p}]]`
          : rel === "adds_detail"
            ? `adds detail to [[${p}]]`
            : `continues [[${p}]]`;
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
  // Structured edge data (MCP reads this via mirror push — not body parse)
  if (links.length) {
    fm.push("atom-links:");
    for (const l of links) {
      fm.push(`  - note: ${yamlQuote(l.note)}`);
      if (l.reason) fm.push(`    reason: ${yamlQuote(l.reason)}`);
    }
  }
  fm.push("---", "");

  const body = String(opts.body ?? "").replace(/\s+$/, "");
  // Bare wikilinks only (graph); reasons stay in FM atom-links
  const wikiLines = links.map((l) => `[[${l.note}]]`);
  const uniqueWiki = [...new Set(wikiLines)];
  const fullBody =
    uniqueWiki.length > 0
      ? `${body}\n\n${uniqueWiki.join("\n")}`
      : body;
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
    body: payload.body,
    tags: payload.tags,
    links: payload.links,
    parent: payload.parent_title,
    relation: payload.relation,
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
