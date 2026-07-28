/**
 * Atoms Plus commercial numbers — loaded from repo-root plus-pricing.json (SSOT).
 * Do not hardcode $ amounts in UI copy; format via helpers below.
 */

import pricingJson from "../../plus-pricing.json";

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

function readPlusPricing(raw: unknown): PlusPricing {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("plus-pricing.json: expected object");
  }
  const o = raw as Record<string, unknown>;
  const num = (k: string): number => {
    const v = o[k];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`plus-pricing.json: ${k} must be a number`);
    }
    return v;
  };
  const str = (k: string): string => {
    const v = o[k];
    if (typeof v !== "string") {
      throw new Error(`plus-pricing.json: ${k} must be a string`);
    }
    return v;
  };
  const bool = (k: string): boolean => {
    const v = o[k];
    if (typeof v !== "boolean") {
      throw new Error(`plus-pricing.json: ${k} must be a boolean`);
    }
    return v;
  };
  return {
    monthlyUsd: num("monthlyUsd"),
    yearlyUsd: num("yearlyUsd"),
    yearlyDiscountNote: str("yearlyDiscountNote"),
    topUpUsd: num("topUpUsd"),
    includedFilingsPerPeriod: num("includedFilingsPerPeriod"),
    topUpFilings: num("topUpFilings"),
    trialDays: num("trialDays"),
    rollover: bool("rollover"),
    currency: str("currency"),
  };
}

export const PLUS_PRICING: PlusPricing = readPlusPricing(pricingJson);

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
