/**
 * Conservative open-loop detector for capture bodies.
 * Prefer miss over false open (R8).
 */

/** Strong pointer / future-intent only — no bare title "idea" traps. */
const STRONG_INTENT: RegExp[] = [
  /\bi will share\b/,
  /\bi'll share\b/,
  /\bi will write\b/,
  /\bi'll write\b/,
  /\bneed to write\b/,
  /\bshould write (about|up|down|this)\b/,
  /\bto write (about|up|down)\b/,
  /\bidea to (write|share|post)\b/,
  /\bnewsletter idea\b/,
  /\bfor (the )?newsletter\b.*\b(will|share|write)\b/,
  /\b(will|i'll) .*\bfor (the )?newsletter\b/,
  /\bremind me to\b/,
  /\bi should (look into|research|try)\b/,
  /\bwant to (write|share|document)\b/,
  /\bgoing to (write|share|document)\b/,
  /\bleave (this )?for later\b/,
  /\bcapture (this )?later\b/,
  /\bwrite (this )?up later\b/,
];

/** True when body is predominantly an intention / IOU, not substance. */
export function looksLikeOpenLoop(text: string, title = ""): boolean {
  const body = (text ?? "").trim();
  if (body.length < 12) return false;
  if (body.length > 900) return false;
  const lines = body.split(/\n/).filter((l) => l.trim());
  if (lines.length > 12) return false;

  const blob = `${title}\n${body}`.toLowerCase();
  return STRONG_INTENT.some((re) => re.test(blob));
}
