/**
 * Qualifying hub helpers — safety denylist, list candidates, non-person write brake.
 * Person discovery keeps its fuller denylist via pathInPersonHubDenylist.
 */

import {
  GENERATED_CLOSE,
  GENERATED_OPEN,
  parseHubSections,
} from "./hubSections";
import {
  pathInDenylistFolder,
  PERSON_HUB_DENY_FOLDER_PARTS,
} from "./enrich/people";

/** Shared safety deny for projection list path + classify list targets. */
export const SAFETY_DENY_FOLDER_PARTS = [
  "Atoms",
  "Quick Notes",
  "Daily",
  "Excalidraw",
  "Templates",
  "Tags",
  "Archive",
] as const;

export function pathInSafetyDenylist(path: string): boolean {
  const parts = path.split("/");
  for (const part of parts.slice(0, -1)) {
    if (part.startsWith(".")) return true;
    if (
      SAFETY_DENY_FOLDER_PARTS.some(
        (d) => d.toLowerCase() === part.toLowerCase(),
      )
    ) {
      return true;
    }
  }
  if (parts.length === 1 && parts[0]?.startsWith(".")) return true;
  return false;
}

/** Person hub discovery denylist (includes Projects/Recipes/Plans extras). */
export function pathInPersonHubDenylist(path: string): boolean {
  return pathInDenylistFolder(path);
}

export function shouldWriteNonPersonHub(opts: {
  memberCount: number;
  hasMatchingHubSection: boolean;
  hubHasGeneratedDelimiters: boolean;
}): boolean {
  if (opts.hubHasGeneratedDelimiters) return true;
  if (opts.hasMatchingHubSection) return true;
  if (opts.memberCount >= 2) return true;
  return false;
}

export function hubHasGeneratedDelimiters(content: string): boolean {
  const c = content ?? "";
  return c.includes(GENERATED_OPEN) && c.includes(GENERATED_CLOSE);
}

/**
 * Non-person list hub candidate: outside safety deny and has ≥1 human H2
 * (or sections already parsed).
 */
export function isListHubCandidate(opts: {
  path: string;
  sections?: string[];
  content?: string;
}): boolean {
  if (pathInSafetyDenylist(opts.path)) return false;
  const sections =
    opts.sections ??
    (opts.content != null ? parseHubSections(opts.content) : []);
  if (sections.length > 0) return true;
  if (opts.content != null && hubHasGeneratedDelimiters(opts.content)) {
    return true;
  }
  return false;
}

/** Re-export person folder parts for callers that need person extras list. */
export { PERSON_HUB_DENY_FOLDER_PARTS };
