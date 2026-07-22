import { Notice } from "obsidian";
import type AtomsPlugin from "./main";

/** Injected by esbuild: true in watch/dev, false in production Community builds. */
declare const ATOMS_DEV_COMMANDS: boolean;

export function registerAtomsCommands(plugin: AtomsPlugin): void {
  plugin.addCommand({
    id: "open-home",
    name: "Open home",
    callback: () => {
      void plugin.activateAtomsHome();
    },
  });

  // Spike / fixture / log-only probes — only when esbuild defines true (watch/dev).
  // Fail-closed: missing define → no spikes (safer for accidental packaging).
  if (typeof ATOMS_DEV_COMMANDS !== "undefined" && ATOMS_DEV_COMMANDS) {
    plugin.addCommand({
      id: "spike-classify-hardcoded",
      name: "Spike: classify hardcoded capture",
      callback: () => {
        void plugin.runSpikeClassify();
      },
    });

    plugin.addCommand({
      id: "spike-cache-and-batch-fork",
      name: "Spike: measure cache + per-day batch fork (KTD3)",
      callback: () => {
        void plugin.runSpikeCacheAndBatch();
      },
    });

    plugin.addCommand({
      id: "spike-secret-storage-probe",
      name: "Spike: probe SecretStorage read/write",
      callback: () => {
        plugin.runSecretStorageProbe();
      },
    });

    plugin.addCommand({
      id: "log-context-prefix",
      name: "Log vault context prefix (stable cache bytes)",
      callback: () => {
        plugin.runLogContextPrefix();
      },
    });

    plugin.addCommand({
      id: "classify-first-unprocessed",
      name: "Classify first unprocessed capture (log only)",
      callback: () => {
        void plugin.runClassifyFirstUnprocessed();
      },
    });

    plugin.addCommand({
      id: "process-fixture-sample",
      name: "Dev: write path with fixture classifications (test vault)",
      callback: () => {
        void plugin.runProcessFixtureSample();
      },
    });
  }

  plugin.addCommand({
    id: "list-unprocessed-captures",
    name: "List unprocessed captures (log only)",
    callback: () => {
      void plugin.runListUnprocessed();
    },
  });

  plugin.addCommand({
    id: "dry-run-preview",
    name: "Dry-run: preview classifications (no writes)",
    callback: () => {
      void plugin.runDryRunPreview();
    },
  });

  plugin.addCommand({
    id: "dry-run-preview-include-today",
    name: "Dry-run: preview including today (test)",
    callback: () => {
      void plugin.runDryRunPreview({ includeToday: true });
    },
  });

  plugin.addCommand({
    id: "process-unprocessed",
    name: "Process unprocessed captures (write + markers)",
    callback: () => {
      void plugin.runProcessUnprocessed();
    },
  });

  plugin.addCommand({
    id: "process-include-today",
    name: "Process including today (test)",
    callback: () => {
      void plugin.runProcessUnprocessed({ includeToday: true });
    },
  });

  plugin.addCommand({
    id: "auto-run-status",
    name: "Auto-run: show device-local status",
    callback: () => {
      void plugin.showAutoRunStatus();
    },
  });

  plugin.addCommand({
    id: "auto-run-now",
    name: "Auto-run: try now (respects device gates)",
    callback: () => {
      void plugin.maybeAutoRun("manual").then((r) => {
        new Notice(`Atoms auto-run: ${r.ran ? "ran" : "skipped"} (${r.reason})`);
      });
    },
  });

  plugin.addCommand({
    id: "test-connection",
    name: "Test connection (HTTPS + Anthropic)",
    callback: () => {
      void plugin.runTestConnection();
    },
  });

  plugin.addCommand({
    id: "backfill-estimate-confirm",
    name: "Backfill: estimate cost & confirm batch",
    callback: () => {
      void plugin.runBackfillFlow();
    },
  });

  plugin.addCommand({
    id: "update-notes",
    name: "Refresh older atoms to current quality",
    callback: () => {
      void plugin.runUpdateNotes();
    },
  });

  plugin.addCommand({
    id: "open-atom-graph",
    name: "Open atom graph",
    callback: () => {
      void plugin.runOpenAtomGraph();
    },
  });

  plugin.addCommand({
    id: "reconsider-capture",
    name: "Reconsider capture",
    callback: () => {
      void plugin.runReconsiderCapture();
    },
  });
}
