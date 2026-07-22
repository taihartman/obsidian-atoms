/** Classification verdict — `append` deliberately cut (KTD2). */
export type Verdict = "atom" | "task" | "noise";

export type MarkerKind = "atom" | "task" | "noise";

export interface ClassificationLink {
  note: string;
  reason: string;
}

/**
 * Model output surface. Body is never produced by the model (R2).
 * `title` is required iff verdict === "atom" (enforced post-parse, KTD4 layer 2).
 */
export interface ClassificationResult {
  verdict: Verdict;
  title: string;
  tags: string[];
  proposed_tags: string[];
  links: ClassificationLink[];
}

export interface ClassifyUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ClassifySuccess {
  ok: true;
  result: ClassificationResult;
  usage: ClassifyUsage;
  /** Redacted key fingerprint for safe logging. */
  keyFingerprint: string;
}

export type ClassifyFailureReason =
  | "missing_key"
  | "auth"
  | "rate_limit"
  | "server"
  | "offline"
  | "invariant"
  | "unknown";

export interface ClassifyFailure {
  ok: false;
  reason: ClassifyFailureReason;
  status?: number;
  /** Safe, non-sensitive message for Notices / logs. */
  message: string;
}

export type ClassifyOutcome = ClassifySuccess | ClassifyFailure;

/** Client-side hub match data (paths never included). */
export interface PersonHubDetail {
  canonicalTitle: string;
  matchKeys: string[];
}

export interface VaultContext {
  titles: string[];
  tags: string[];
  vocabulary: string[];
  /** Canonical person-hub titles (sorted). Never paths. Empty when none. */
  personHubs: string[];
  /** Alias-aware match keys for enrichPersonLinks (local only). */
  personHubDetails: PersonHubDetail[];
}

/**
 * One capture from a daily note (U3).
 * Line numbers are 0-based indexes into the note's split lines.
 */
export interface Capture {
  /** Capture body text (bullet prefix / optional timestamp stripped from first line). */
  text: string;
  /** Optional HH:mm (or similar) from a timestamped bullet. */
  timestamp: string | null;
  /** First line of the capture (top-level bullet). */
  startLine: number;
  /** Last line of the capture extent (inclusive), before any marker. */
  endLine: number;
  /** True iff a sentinel marker follows the capture extent (KTD1). */
  processed: boolean;
  /** Which sentinel, when processed. */
  markerKind: MarkerKind | null;
  /** Line index of the marker, if present. */
  markerLine: number | null;
}

/** A past daily note that still has at least one unmarked capture. */
export interface DailyNoteWithCaptures {
  path: string;
  /** YYYY-MM-DD (local) derived from the daily-note filename/settings. */
  date: string;
  captures: Capture[];
  unprocessed: Capture[];
}

export interface LinkerSettings {
  /** SecretStorage secret *id* (name), never the key value itself. */
  apiKeySecretId: string;
  /** Anthropic model id. Default Sonnet 5 per plan. */
  model: string;
  /** Flat folder for atom files (R3). */
  atomFolder: string;
  /** Active tag vocabulary (syncs via data.json — KTD7). */
  activeVocabulary: string[];
  /** Proposed tags awaiting one-tap approval (H3). */
  proposedTags: string[];
  /**
   * True when user accepted the device-local key fallback (KTD5 contingency).
   * The actual key, if falling back, lives in loadLocalStorage — never data.json.
   */
  useDeviceLocalKeyFallback: boolean;
  /**
   * Optional iCloud/GitHub install URL for the capture Shortcut.
   * Synced via data.json so phone/desktop share the same link.
   * Empty → fall back to built-in CAPTURE_SHORTCUT_INSTALL_URL constant.
   */
  captureShortcutInstallUrl: string;
  /**
   * Feature flag: Reconsider capture (soft-unfreeze noise/task → reclassify).
   * Off by default until dogfood-ready.
   */
  enableReconsiderCapture: boolean;
}

export const DEFAULT_SETTINGS: LinkerSettings = {
  apiKeySecretId: "",
  model: "claude-sonnet-5",
  atomFolder: "Atoms",
  activeVocabulary: [
    "idea",
    "question",
    "observation",
    "reference",
    "decision",
    "person",
    "preferences",
    "relationship",
    "watch",
    "movie",
    "show",
    "media",
    "list",
  ],
  proposedTags: [],
  useDeviceLocalKeyFallback: false,
  captureShortcutInstallUrl: "",
  enableReconsiderCapture: false,
};

/** SecretStorage / localStorage keys — lowercase-dashed (KTD5). */
export const API_KEY_SECRET_ID_DEFAULT = "atoms-anthropic-api-key";
export const LOCAL_STORAGE_API_KEY = "atoms-device-local-api-key";

/** Hardcoded capture for the U1 spike command. */
export const SPIKE_CAPTURE =
  "sleep debt seems to plateau after a few nights, not accumulate forever the way people say";

/** Stable vault context used by the spike so cache prefixes clear the floor. */
export const SPIKE_CONTEXT: VaultContext = {
  titles: [
    "Sleep debt doesn't accumulate linearly",
    "Deep work requires unbroken morning blocks",
    "Capture is cheap; review is the scarce resource",
    "Declarative titles beat topic titles for retrieval",
    "Knowledge rot is a rehearsal problem not a retrieval problem",
    "Supersession links record a changed mind without rewriting",
    "Daily notes are the chronological spine of a second brain",
    "Atomic notes should keep the original phrasing intact",
    "Tags are a small vocabulary not an open taxonomy",
    "Unresolved wikilinks are first-class and self-heal",
    // Pad so the stable prefix reliably exceeds Sonnet's ~1024-token cache floor (AE6).
    ...Array.from({ length: 80 }, (_, i) => `Vault note placeholder ${i + 1}`),
  ],
  tags: ["idea", "question", "observation", "reference", "decision", "health"],
  vocabulary: ["idea", "question", "observation", "reference", "decision"],
  personHubs: [],
  personHubDetails: [],
};
