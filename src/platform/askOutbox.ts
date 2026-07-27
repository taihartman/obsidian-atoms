/**
 * Ask outbox apply planner — create new Atoms/ files from Claude queue.
 */
import type { ClassificationLink } from "../shared/types";
import {
  atomPathForTitle,
  clampAtomFolder,
  formatLinkProse,
  normalizeCaptureText,
  sanitizeFilename,
} from "../pipeline/render";
import { localDateYmd } from "../pipeline/atomQuality";

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
 * Build Ask-origin atom markdown (not Process buildAtomMarkdown).
 */
export function buildAskAtomMarkdown(opts: {
  title: string;
  body: string;
  tags?: string[];
  links?: { note: string; reason?: string }[];
  created?: string;
}): { pathSegment: string; content: string; title: string } {
  const { filename, alias } = sanitizeFilename(opts.title);
  const title = filename;
  const created = opts.created ?? localDateYmd();
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
  const fm: string[] = ["---", `created: ${created}`];
  if (alias) {
    fm.push("aliases:");
    fm.push(`  - ${yamlQuote(alias)}`);
  }
  fm.push(`source: "[[Ask]]"`);
  fm.push("generated-by: ask-mcp");
  if (tags.length) {
    fm.push("tags:");
    for (const t of tags) fm.push(`  - ${t}`);
  } else {
    fm.push("tags: []");
  }
  fm.push("---", "");
  const body = String(opts.body ?? "").replace(/\s+$/, "");
  const prose = formatLinkProse(links);
  const fullBody = prose ? `${body}\n\n${prose}` : body;
  const content = fm.join("\n") + fullBody + (fullBody.endsWith("\n") ? "" : "\n");
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
