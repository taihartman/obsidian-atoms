import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { measuredCost, reservationCost, reserveBudget, settleBudget, summarize } from '../scripts/lib/effort-eval.mjs';

describe('model evaluation accounting and scoring', () => {
  it('charges thinking output and the actual Sonnet cache-read price', () => {
    assert.equal(measuredCost({ input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 3000, output_tokens: 4000 }, 'claude-sonnet-5-5'), 0.0473);
    assert.equal(measuredCost({ input_tokens: 100001, output_tokens: 10 }, 'claude-haiku-5-5'), (100001 * 0.5 + 10 * 2.5) / 1e6);
  });
  it('includes concurrent reservations in the hard spend limit', () => {
    const ledger = { spent: 0.1, cap: 1, pending: {} };
    reserveBudget(ledger, 'a', 0.5);
    assert.throws(() => reserveBudget(ledger, 'b', 0.5), /budget exhausted/);
    settleBudget(ledger, 'a', null, 'claude-sonnet-5-5');
    assert.equal(ledger.spent, 0.6);
    assert.deepEqual(ledger.pending, {});
  });
  it('uses the incumbent Sonnet cache rate without changing Sonnet 5.5 accounting', () => {
    const usage = { input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 3000, output_tokens: 4000 };
    assert.equal(measuredCost(usage, 'claude-sonnet-5'), 0.0476);
    assert.equal(measuredCost(usage, 'claude-sonnet-5-5'), 0.0473);
    assert.ok(reservationCost({max_tokens:2048}, 'claude-sonnet-5') > 0.02);
  });
  it('keeps failed classifications in accuracy and separates retrieval misses', () => {
    const cases = [{ id:'a', verdict:'atom', context:{titles:['Known']}, goldTitles:['Known','Missing'] },{id:'b',verdict:'noise',context:{titles:[]},goldTitles:[]}];
    const score = summarize([{id:'a',ms:10,result:{verdict:'atom',links:[{note:'Known'},{note:'Invented'}]},usd:0.01},{id:'b',ms:20,result:null}], cases);
    assert.equal(score.verdictAccuracy, 0.5);
    assert.equal(score.retrievalRecall, 0.5);
    assert.equal(score.recallGivenRetrieval, 1);
    assert.equal(score.precision, 0.5);
    assert.equal(score.unknownLinks, 1);
    assert.equal(score.errors, 1);
  });
  it('does not invent gold accuracy for an unlabeled real-data sample', () => {
    const score = summarize([{id:'private-1',ms:10,result:{verdict:'atom',links:[]}}], [{id:'private-1',context:{titles:[]}}]);
    assert.equal(score.precision, null);
    assert.equal(score.verdictAccuracy, null);
  });
  it('reserves output headroom rather than assuming a 250-token answer', () => {
    const low = reservationCost({max_tokens:1024}, 'claude-sonnet-5-5');
    const high = reservationCost({max_tokens:8192}, 'claude-sonnet-5-5');
    assert.ok(high - low > 0.07);
  });
});
