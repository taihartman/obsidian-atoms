/**
 * Atoms Plus commercial numbers — loaded from repo-root plus-pricing.json (SSOT).
 * Do not hardcode $ amounts in UI copy; format via helpers below.
 */

import pricing from "../../plus-pricing.json";

export type PlusPricing = {
  monthlyUsd: number;
  yearlyUsd: number;
  yearlyDiscountNote: string;
  topUpUsd: number;
  includedFilingsPerPeriod: number;
  topUpFilings: number;
  trialDays: number;
  rollover: boolean;
  currency: string;
};

export const PLUS_PRICING: PlusPricing = {
  monthlyUsd: pricing.monthlyUsd,
  yearlyUsd: pricing.yearlyUsd,
  yearlyDiscountNote: pricing.yearlyDiscountNote,
  topUpUsd: pricing.topUpUsd,
  includedFilingsPerPeriod: pricing.includedFilingsPerPeriod,
  topUpFilings: pricing.topUpFilings,
  trialDays: pricing.trialDays,
  rollover: pricing.rollover,
  currency: pricing.currency,
};

export function formatUsd(n: number): string {
  return `$${n}`;
}

export function monthlyPriceLabel(): string {
  return `${formatUsd(PLUS_PRICING.monthlyUsd)} per month`;
}

export function yearlyPriceLabel(): string {
  const note = PLUS_PRICING.yearlyDiscountNote?.trim();
  return note
    ? `${formatUsd(PLUS_PRICING.yearlyUsd)} per year · ${note}`
    : `${formatUsd(PLUS_PRICING.yearlyUsd)} per year`;
}

export function topUpPriceLabel(): string {
  return formatUsd(PLUS_PRICING.topUpUsd);
}

export function trialFinePrint(): string {
  return `${PLUS_PRICING.trialDays} days free, then ${formatUsd(PLUS_PRICING.monthlyUsd)}/month. Cancel anytime. Card required for trial.`;
}

export function includedFilingsBullet(): string {
  const n = PLUS_PRICING.includedFilingsPerPeriod;
  const roll = PLUS_PRICING.rollover
    ? ""
    : " Unused filings don’t roll over";
  return `${n} AI filings each month for classifying and updating notes.${roll}`;
}

export function topUpDetailLabel(): string {
  return `${PLUS_PRICING.topUpFilings} AI filings · one-time`;
}
