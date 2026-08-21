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
  // Return / completion intents (#589): a stated trip back is unfinished
  // business. An intent lead or a line-initial imperative is required, so
  // past tense ("came back") and descriptive prose ("customers come back to
  // brands", "the function should return the value to the caller") never open.
  /\b(?:need to|have to|got to|gotta|should|will|i'll|going to|gonna)\b[^.\n]{0,60}?\b(?:(?:come|go|head) back|(?:bring|take)\b[^.\n]{0,24}?\bback)\b/,
  /^\s*(?:bring|take) (?:it|this|that|(?:the|my|our) \w+(?: \w+){0,2}) back\b/m,
  /^\s*return (?:it|this|that|(?:the|my|our) \w+(?: \w+){0,2}) to\b/m,
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
