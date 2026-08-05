/** Relation → link-prose templates (Ask continue + home Continue SSOT). */

export type ContinueRelation =
  | "continues"
  | "revises"
  | "contradicts"
  | "adds_detail";

export function relationReasonProse(
  relation: string,
  parentTitle: string,
): string {
  const p = parentTitle.trim();
  const rel = (relation || "continues").trim();
  if (rel === "revises") return `revises [[${p}]]`;
  if (rel === "contradicts") return `contradicts [[${p}]]`;
  if (rel === "adds_detail") return `adds detail to [[${p}]]`;
  return `continues [[${p}]]`;
}
