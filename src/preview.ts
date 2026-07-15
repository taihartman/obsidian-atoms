import type { App } from "obsidian";
import { Modal, Notice, Setting } from "obsidian";
import { classifyCapture, type ClassifyDeps } from "./classify";
import type { MetadataContextProvider } from "./context";
import {
  getPastDailyNotesWithUnmarkedCaptures,
  type PastDailyNotesResult,
} from "./daily";
import { formatAtomBodyPreview, markerLineForDecision } from "./render";
import type {
  Capture,
  ClassificationResult,
  ClassifyOutcome,
  ClassifyUsage,
  DailyNoteWithCaptures,
  VaultContext,
} from "./types";
import { mergeProposedTags } from "./vocabulary";

export interface PreviewEntry {
  dailyPath: string;
  date: string;
  capture: Capture;
  outcome: ClassifyOutcome;
  /** Marker line that *would* be written (only when classification succeeded). */
  wouldWriteMarker: string | null;
  /** Atom path that *would* be created (atom verdict only). */
  wouldCreateAtomPath: string | null;
}

export interface DryRunReport {
  entries: PreviewEntry[];
  totalUnprocessedScanned: number;
  classified: number;
  failed: number;
  /** True when no vault write APIs were invoked by this path. */
  wroteNothing: true;
  generatedAt: string;
}

export function emptyUsage(): ClassifyUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

/**
 * Build one preview entry from a successful/failed classification.
 * Pure — no I/O.
 */
export function buildPreviewEntry(opts: {
  note: DailyNoteWithCaptures;
  capture: Capture;
  outcome: ClassifyOutcome;
  atomFolder: string;
}): PreviewEntry {
  const { note, capture, outcome, atomFolder } = opts;
  let wouldWriteMarker: string | null = null;
  let wouldCreateAtomPath: string | null = null;

  if (outcome.ok) {
    const r = outcome.result;
    wouldWriteMarker = markerLineForDecision(r.verdict, r.title);
    if (r.verdict === "atom" && r.title.trim()) {
      // Preview only — full sanitize lands in U8.
      const safe = r.title.trim().replace(/[/:\\?%*|"]/g, "-");
      wouldCreateAtomPath = `${atomFolder.replace(/\/$/, "")}/${safe}.md`;
    }
  }

  return {
    dailyPath: note.path,
    date: note.date,
    capture,
    outcome,
    wouldWriteMarker,
    wouldCreateAtomPath,
  };
}

/** Markdown report for modal / console (AE5: one entry per capture). */
export function renderPreviewMarkdown(report: DryRunReport): string {
  const lines: string[] = [
    "# Atoms — dry-run preview",
    "",
    `Generated: ${report.generatedAt}`,
    `Unprocessed scanned: ${report.totalUnprocessedScanned}`,
    `Classified ok: ${report.classified} · failed: ${report.failed}`,
    "",
    "> **Dry-run:** nothing was written. No atom files, no daily-note markers.",
    "",
  ];

  if (report.entries.length === 0) {
    lines.push("_No unprocessed past captures._");
    return lines.join("\n");
  }

  let i = 0;
  for (const e of report.entries) {
    i += 1;
    lines.push(`## ${i}. ${e.date} · \`${e.dailyPath}\``);
    lines.push("");
    lines.push("**Capture**");
    lines.push("");
    lines.push("```");
    lines.push(e.capture.text);
    lines.push("```");
    lines.push("");

    if (!e.outcome.ok) {
      lines.push(
        `**Result:** FAILED — ${e.outcome.reason}: ${e.outcome.message}`,
      );
      lines.push("");
      continue;
    }

    const r: ClassificationResult = e.outcome.result;
    lines.push(`**Verdict:** \`${r.verdict}\``);
    if (r.verdict === "atom") {
      lines.push(`**Title:** ${r.title}`);
      if (e.wouldCreateAtomPath) {
        lines.push(`**Would create:** \`${e.wouldCreateAtomPath}\``);
      }
    }
    if (r.tags?.length) {
      lines.push(`**Tags:** ${r.tags.map((t) => `#${t}`).join(" ")}`);
    }
    if (r.proposed_tags?.length) {
      lines.push(
        `**Proposed tags (not applied):** ${r.proposed_tags.map((t) => `#${t}`).join(" ")}`,
      );
    }
    if (r.links?.length) {
      lines.push("**Links**");
      for (const link of r.links) {
        lines.push(`- ${link.reason || link.note}`);
      }
    }
    if (r.verdict === "atom") {
      lines.push("");
      lines.push("**Atom body (would write)**");
      lines.push("");
      lines.push(formatAtomBodyPreview(e.capture.text, r));
    }
    if (e.wouldWriteMarker) {
      lines.push("");
      lines.push("**Marker (would append under capture)**");
      lines.push("");
      lines.push("```");
      lines.push(e.wouldWriteMarker);
      lines.push("```");
    }
    if (e.outcome.ok) {
      lines.push("");
      lines.push(
        `_usage: in=${e.outcome.usage.input_tokens} out=${e.outcome.usage.output_tokens} cache_read=${e.outcome.usage.cache_read_input_tokens}_`,
      );
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

export interface RunDryRunOptions {
  app: App;
  contextProvider: MetadataContextProvider;
  apiKey: string;
  model: string;
  activeVocabulary: string[];
  atomFolder: string;
  /** Cap API calls this run (default: all unprocessed). */
  maxCaptures?: number;
  classifyDeps?: Partial<ClassifyDeps>;
  onProgress?: (done: number, total: number) => void;
  /** Manual force: include today's daily. Default false. */
  includeToday?: boolean;
}

/**
 * Dry-run pipeline: classify unmarked captures; never write vault files.
 */
export async function runDryRun(
  opts: RunDryRunOptions,
): Promise<DryRunReport> {
  const listed: PastDailyNotesResult =
    await getPastDailyNotesWithUnmarkedCaptures(opts.app, {
      includeToday: opts.includeToday,
    });

  const work: Array<{ note: DailyNoteWithCaptures; capture: Capture }> = [];
  for (const note of listed.notes) {
    for (const capture of note.unprocessed) {
      work.push({ note, capture });
    }
  }

  const max = opts.maxCaptures ?? work.length;
  const slice = work.slice(0, max);
  const ctx: VaultContext = opts.contextProvider.buildContext();
  const entries: PreviewEntry[] = [];

  for (let i = 0; i < slice.length; i++) {
    const { note, capture } = slice[i]!;
    opts.onProgress?.(i + 1, slice.length);
    const outcome = await classifyCapture(capture.text, ctx, {
      apiKey: opts.apiKey,
      model: opts.model,
      activeVocabulary: opts.activeVocabulary,
      ...opts.classifyDeps,
    });
    entries.push(
      buildPreviewEntry({
        note,
        capture,
        outcome,
        atomFolder: opts.atomFolder,
      }),
    );
  }

  const classified = entries.filter((e) => e.outcome.ok).length;
  return {
    entries,
    totalUnprocessedScanned: work.length,
    classified,
    failed: entries.length - classified,
    wroteNothing: true,
    generatedAt: new Date().toISOString(),
  };
}

/** Collect proposed tags from a successful dry-run (still not auto-applied). */
export function proposedTagsFromReport(report: DryRunReport): string[] {
  const incoming: string[] = [];
  for (const e of report.entries) {
    if (e.outcome.ok && e.outcome.result.proposed_tags?.length) {
      incoming.push(...e.outcome.result.proposed_tags);
    }
  }
  return incoming;
}

export function mergeProposedFromReport(
  existing: string[],
  report: DryRunReport,
  activeVocabulary: string[],
): string[] {
  return mergeProposedTags(
    existing,
    proposedTagsFromReport(report),
    activeVocabulary,
  );
}

/**
 * Scrollable modal — no vault writes (AE5 filesystem stays clean).
 */
export class DryRunPreviewModal extends Modal {
  constructor(
    app: App,
    private readonly markdown: string,
    private readonly summary: string,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("atoms-dry-run-modal");

    contentEl.createEl("h2", { text: "Atoms — dry-run preview" });
    contentEl.createEl("p", { text: this.summary });

    new Setting(contentEl)
      .setName("Vault writes")
      .setDesc("None. This is preview only — markers and atoms are not created.")
      .addButton((btn) =>
        btn.setButtonText("Close").setCta().onClick(() => this.close()),
      );

    const pre = contentEl.createEl("pre", {
      cls: "atoms-dry-run-body",
    });
    pre.setText(this.markdown);
    pre.style.maxHeight = "60vh";
    pre.style.overflow = "auto";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.userSelect = "text";
    pre.style.fontSize = "12px";
  }

  onClose() {
    this.contentEl.empty();
  }
}

export function showDryRunNotice(report: DryRunReport): void {
  new Notice(
    `Atoms dry-run: ${report.classified} ok, ${report.failed} failed of ${report.entries.length} (scanned ${report.totalUnprocessedScanned}) — nothing written`,
  );
}
