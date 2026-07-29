# chrono-corpus-*.json — capture schema

The brief the corpus-authoring agents were given, kept so the corpus can be extended
consistently. Used by scripts/measure-chrono-linking.mjs.

Each capture is an object:

{
  "id": "A0042",
  "date": "2024-03-17",
  "thread": "kitchen-renovation",
  "capture": "rough thumb-typed note, lowercase, fragments, typos fine",
  "verdict": "atom",
  "linksToEarlier": ["A0018", "A0031"],
  "linksToExisting": ["A pre-run note title"]
}

Rules:
- `id`: your assigned prefix + 4 digits, ascending.
- `date`: ISO, between 2023-01-01 and 2025-12-31. Captures must appear in ASCENDING date order in the file.
- `capture`: how a real person thumbs a note into their phone — lowercase, fragments, typos fine. Never prefix with "remember:".
- `verdict`: "atom" for a real thought worth keeping, "noise" for chores/one-offs. Make ~20% noise.
- `linksToEarlier`: ids of EARLIER captures in THIS corpus that this capture genuinely belongs with — a thought it continues, contradicts, or refers back to. Only ids with an earlier date. Empty array when there is nothing. THIS IS THE MOST IMPORTANT FIELD — it is the ground truth for whether notes created during a catch-up can find each other.
- `linksToExisting`: titles of notes that already existed before the run (people, places, projects). Keep to a handful of recurring titles per thread; reuse the same strings exactly.
- `noise` captures link to nothing: both arrays empty.
