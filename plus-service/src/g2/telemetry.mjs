const OPERATIONS = new Set(["transcription", "preparation", "query"]);
const STATUS = new Set(["ok", "blocked", "retryable", "failed"]);

export function g2Metric(input) {
  const operation = OPERATIONS.has(input?.operation) ? input.operation : "query";
  const statusClass = STATUS.has(input?.statusClass) ? input.statusClass : "failed";
  const metric = {
    event: "g2_operation",
    operation,
    count: Math.max(1, Math.min(1000, Number(input?.count) || 1)),
    statusClass,
    durationMs: Math.max(0, Math.round(Number(input?.durationMs) || 0)),
  };
  if (Number.isFinite(input?.providerLatencyMs)) metric.providerLatencyMs = Math.max(0, Math.round(input.providerLatencyMs));
  return Object.freeze(metric);
}

export function createG2Metrics(sink = () => {}) {
  return { record(input) { const metric = g2Metric(input); sink(metric); return metric; } };
}

export function g2ResultStatusClass(operation, result) {
  if (operation === "query") {
    if (result?.state === "answered") return "ok";
    if (["setup_required", "limit_reached"].includes(result?.state)) return "blocked";
    return "failed";
  }
  if (operation === "preparation") {
    if (result?.preparationId) return "ok";
    return result?.state === "setup_required" ? "blocked" : "failed";
  }
  return result?.state === "completed" ? "ok" : "failed";
}
