import { GENERATED_CLOSE, GENERATED_OPEN } from "./hubSections";

export type HubProjectionEntry = {
  title: string;
  /** Placement hint; missing/unknown → Unsorted */
  section?: string;
};

export type ProjectHubOk = { ok: true; content: string };
export type ProjectHubErr = {
  ok: false;
  reason: "unclosed-generated-block" | "orphan-close-generated-block";
};
export type ProjectHubResult = ProjectHubOk | ProjectHubErr;

const UNSORTED = "Unsorted";

function delimiterError(content: string): ProjectHubErr | null {
  const openIdx = content.indexOf(GENERATED_OPEN);
  const closeIdx = content.indexOf(GENERATED_CLOSE);
  if (openIdx >= 0 && closeIdx < 0) {
    return { ok: false, reason: "unclosed-generated-block" };
  }
  if (openIdx < 0 && closeIdx >= 0) {
    return { ok: false, reason: "orphan-close-generated-block" };
  }
  if (openIdx >= 0 && closeIdx >= 0 && closeIdx < openIdx) {
    return { ok: false, reason: "unclosed-generated-block" };
  }
  return null;
}

/**
 * Render the interior of the managed block (no outer delimiters).
 */
export function renderGeneratedBlock(
  entries: HubProjectionEntry[],
  hubSections: string[],
): string {
  const sectionSet = new Set(hubSections);
  const buckets = new Map<string, string[]>();

  const ensure = (key: string) => {
    if (!buckets.has(key)) buckets.set(key, []);
    return buckets.get(key)!;
  };

  for (const e of entries) {
    const title = (e.title ?? "").trim();
    if (!title) continue;
    const sec = (e.section ?? "").trim();
    const key = sec && sectionSet.has(sec) ? sec : UNSORTED;
    ensure(key).push(title);
  }

  for (const titles of buckets.values()) {
    titles.sort((a, b) => a.localeCompare(b));
  }

  const parts: string[] = [];
  // If the hub already has a human ## Unsorted, that pass emits the bucket —
  // do not append a second ## Unsorted at the end (duplicate heading bug).
  const hubHasUnsorted = hubSections.some(
    (s) => s.trim().toLowerCase() === UNSORTED.toLowerCase(),
  );
  for (const sec of hubSections) {
    const titles = buckets.get(sec);
    if (!titles?.length) continue;
    parts.push(`## ${sec}`);
    for (const t of titles) parts.push(`- [[${t}]]`);
  }
  const unsorted = buckets.get(UNSORTED);
  if (unsorted?.length && !hubHasUnsorted) {
    parts.push(`## ${UNSORTED}`);
    for (const t of unsorted) parts.push(`- [[${t}]]`);
  }
  return parts.join("\n");
}

function stripTrailingBlankLines(s: string): string {
  return s.replace(/(?:\r?\n)+$/u, "");
}

function ensureTrailingNewline(s: string): string {
  if (!s) return "\n";
  return s.endsWith("\n") ? s : s + "\n";
}

/**
 * Splice managed block into hub markdown. Preserves all bytes outside delimiters.
 */
export function projectHubMarkdown(
  hubContent: string,
  entries: HubProjectionEntry[],
  hubSections: string[],
): ProjectHubResult {
  const content = hubContent ?? "";
  const err = delimiterError(content);
  if (err) return err;

  const interior = renderGeneratedBlock(entries, hubSections);
  const hasEntries = interior.length > 0;
  const openIdx = content.indexOf(GENERATED_OPEN);
  const closeIdx = content.indexOf(GENERATED_CLOSE);

  if (openIdx < 0) {
    if (!hasEntries) return { ok: true, content };
    const base = stripTrailingBlankLines(content);
    const block = `${GENERATED_OPEN}\n${interior}\n${GENERATED_CLOSE}\n`;
    if (!base) return { ok: true, content: block };
    return { ok: true, content: ensureTrailingNewline(base) + "\n" + block };
  }

  const prefix = content.slice(0, openIdx);
  let suffix = content.slice(closeIdx + GENERATED_CLOSE.length);
  if (suffix.startsWith("\r\n")) suffix = suffix.slice(2);
  else if (suffix.startsWith("\n")) suffix = suffix.slice(1);

  if (!hasEntries) {
    const left = stripTrailingBlankLines(prefix);
    const right = suffix.replace(/^(?:\r?\n)+/, "");
    if (!left && !right) return { ok: true, content: "" };
    if (!left) return { ok: true, content: ensureTrailingNewline(right) };
    if (!right) return { ok: true, content: ensureTrailingNewline(left) };
    return {
      ok: true,
      content: ensureTrailingNewline(left) + "\n" + ensureTrailingNewline(right),
    };
  }

  const block = `${GENERATED_OPEN}\n${interior}\n${GENERATED_CLOSE}`;
  let before = prefix;
  if (before.length && !before.endsWith("\n")) before += "\n";
  const body =
    before + block + (suffix ? "\n" + suffix.replace(/^\n+/, "") : "\n");
  return {
    ok: true,
    content: ensureTrailingNewline(body.replace(/\n{3,}/g, "\n\n")),
  };
}
