/** Pure accounting/scoring for the paired Sonnet/Haiku effort evaluation. */
export const MODEL_PRICES = {
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export function measuredCost(usage, model) {
  const rate = MODEL_PRICES[model];
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const multiplier = model === "claude-haiku-5-5" && input > 100_000 ? 5 : 1;
  return multiplier * (
    (usage.input_tokens ?? 0) * rate.input +
    (usage.cache_creation_input_tokens ?? 0) * rate.input * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * rate.cacheRead +
    (usage.output_tokens ?? 0) * rate.output
  ) / 1e6;
}

export function reservationCost(body, model) {
  const rate = MODEL_PRICES[model];
  const bytes = Buffer.byteLength(JSON.stringify(body));
  // A byte-per-token upper bound, including JSON/schema overhead, is intentionally conservative.
  const multiplier = model === "claude-haiku-5-5" && bytes > 100_000 ? 5 : 1;
  return multiplier * (bytes * rate.input * 1.25 + body.max_tokens * rate.output) / 1e6;
}

export function reserveBudget(ledger, id, amount) {
  if (ledger.pending[id] !== undefined) throw new Error("request already pending; inspect its accounting before retrying");
  const reserved = Object.values(ledger.pending).reduce((a, b) => a + b, 0);
  if (ledger.spent + reserved + amount > ledger.cap + 1e-9) throw new Error("evaluation budget exhausted");
  ledger.pending[id] = amount;
}

export function settleBudget(ledger, id, usage, model, knownUnbilled = false) {
  const reserved = ledger.pending[id];
  if (reserved === undefined) throw new Error("request has no reservation");
  // An unanswered request may have been billed. Charge its full reservation rather than retrying blindly.
  const amount = usage ? measuredCost(usage, model) : knownUnbilled ? 0 : reserved;
  ledger.spent += amount;
  delete ledger.pending[id];
  return amount;
}

const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const ratio = (a, b) => b ? a / b : 0;
export function summarize(records, cases) {
  const byId = new Map(cases.map(c => [c.id, c]));
  let expected = 0, available = 0, trueLinks = 0, proposed = 0, unknown = 0;
  let correctVerdicts = 0, labeled = 0, errors = 0, truncated = 0, rawBodyFields = 0;
  let atomGold = 0, atomRetrieved = 0, atomTrue = 0, atomProposed = 0, hubGold = 0, hubTrue = 0;
  for (const rec of records) {
    const c = byId.get(rec.id);
    if (!c) continue;
    const offered = new Set([...c.context.titles, ...(c.context.personHubs ?? [])].map(norm));
    const gold = new Set((c.goldTitles ?? []).map(norm));
    if (c.verdict) { labeled++; correctVerdicts += rec.result?.verdict === c.verdict ? 1 : 0; }
    expected += gold.size;
    available += [...gold].filter(t => offered.has(t)).length;
    if (!rec.result) errors++;
    if (rec.stopReason === "max_tokens") truncated++;
    rawBodyFields += rec.rawBodyField ? 1 : 0;
    const links = new Set((rec.result?.links ?? []).map(l => norm(l.note)).filter(Boolean));
    const goldAtoms = new Set((c.goldAtomTitles ?? []).map(norm));
    const goldHubs = new Set((c.goldHubTitles ?? []).map(norm));
    const hubs = new Set((c.hubTitles ?? []).map(norm));
    atomGold += goldAtoms.size;
    atomRetrieved += [...goldAtoms].filter(t => offered.has(t)).length;
    atomTrue += [...links].filter(t => goldAtoms.has(t)).length;
    atomProposed += [...links].filter(t => !hubs.has(t)).length;
    hubGold += goldHubs.size;
    hubTrue += [...links].filter(t => goldHubs.has(t)).length;
    proposed += links.size;
    trueLinks += [...links].filter(t => gold.has(t)).length;
    unknown += [...links].filter(t => !offered.has(t)).length;
  }
  const precision = ratio(trueLinks, proposed), recall = ratio(trueLinks, expected);
  const latencies = records.map(r => r.ms).sort((a, b) => a - b);
  const at = p => latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(p * latencies.length) - 1)] : 0;
  return {
    captures: records.length, labeled, errors, truncated, rawBodyFields,
    verdictAccuracy: labeled ? correctVerdicts / labeled : null,
    goldLinks: expected, retrievedGoldLinks: available, proposedLinks: proposed, trueLinks,
    precision: expected ? precision : null, recall: expected ? recall : null,
    f1: expected ? ratio(2 * precision * recall, precision + recall) : null,
    retrievalRecall: expected ? ratio(available, expected) : null,
    recallGivenRetrieval: available ? ratio(trueLinks, available) : null,
    atomGold, atomRetrieved, atomTrue, atomProposed,
    atomPrecision: atomGold ? ratio(atomTrue, atomProposed) : null,
    atomRecall: atomGold ? ratio(atomTrue, atomGold) : null,
    atomF1: atomGold ? ratio(2 * ratio(atomTrue, atomProposed) * ratio(atomTrue, atomGold), ratio(atomTrue, atomProposed) + ratio(atomTrue, atomGold)) : null,
    atomRecallGivenRetrieval: atomRetrieved ? ratio(atomTrue, atomRetrieved) : null,
    hubGold, hubTrue, hubRecall: hubGold ? ratio(hubTrue, hubGold) : null,
    unknownLinks: unknown,
    medianMs: at(0.5), p95Ms: at(0.95),
    usd: records.reduce((s, r) => s + (r.usd ?? 0), 0),
    inputTokens: records.reduce((s,r) => s + (r.usage?.input_tokens ?? 0) + (r.usage?.cache_creation_input_tokens ?? 0) + (r.usage?.cache_read_input_tokens ?? 0),0),
    outputTokens: records.reduce((s,r) => s + (r.usage?.output_tokens ?? 0),0),
    thinkingTokens: records.reduce((s,r) => s + (r.usage?.output_tokens_details?.thinking_tokens ?? 0),0),
  };
}
