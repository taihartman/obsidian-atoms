/**
 * Conservative open-loop detector for capture bodies.
 * Prefer miss over false open (R8).
 */

/** True when body is predominantly an intention / IOU, not substance. */
export function looksLikeOpenLoop(text: string, title = ""): boolean {
  const body = (text ?? "").trim();
  if (body.length < 12) return false;
  // Long multi-paragraph substance is rarely a pure IOU
  if (body.length > 900) return false;
  const lines = body.split(/\n/).filter((l) => l.trim());
  if (lines.length > 12) return false;

  const blob = `${title}\n${body}`.toLowerCase();

  // Strong pointer / future-intent shapes
  const strong = [
    /\bi will share\b/,
    /\bi'll share\b/,
    /\bi will write\b/,
    /\bi'll write\b/,
    /\bneed to write\b/,
    /\bshould write\b/,
    /\bto write (about|up|down)\b/,
    /\bidea to (write|share|post)\b/,
    /\bnewsletter idea\b/,
    /\bfor (the )?newsletter\b/,
    /\bremind me to\b/,
    /\btodo:?\s/,
    /\bi should (look into|research|try)\b/,
    /\bwant to (write|share|document)\b/,
    /\bgoing to (write|share|document)\b/,
    /\bleave (this )?for later\b/,
    /\bcapture (this )?later\b/,
    /\bwrite (this )?up later\b/,
  ];
  if (strong.some((re) => re.test(blob))) return true;

  // Title-heavy IOU with thin body
  const titleL = title.toLowerCase();
  if (
    /\b(idea|todo|later|should|newsletter)\b/.test(titleL) &&
    body.length < 220 &&
    /\b(will|should|later|idea|share|write)\b/.test(blob)
  ) {
    return true;
  }

  return false;
}
