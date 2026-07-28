/**
 * Pure decisions for the inbox bootstrap step (F3). Kept separate from the
 * plugin shell so the "should we nag about a missing bookmark?" logic is
 * unit-testable without loading `main.ts` (which pulls the whole plugin graph).
 */

import type { InboxBookmarkResult } from "../pipeline/inbox";

/**
 * Device-local ack (never data.json) — mirrors LS_CAPTURE_SHORTCUT_ACK. Set once
 * the setup notice has fired so a permanently-disabled Bookmarks plugin does not
 * nag on every load.
 */
export const LS_INBOX_BOOKMARK_NOTICE_ACK = "atoms-inbox-bookmark-notice-acked";

/**
 * Surface the one-time "bookmark the inbox by hand" setup notice only when the
 * bookmark could not be created ("unavailable") and the user has not already
 * acked it. "created"/"already-present" never nag.
 */
export function shouldShowBookmarkSetupNotice(
  result: InboxBookmarkResult,
  acked: boolean,
): boolean {
  return result === "unavailable" && !acked;
}
