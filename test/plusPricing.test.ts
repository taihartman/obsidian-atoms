import { describe, expect, it } from "vitest";
import {
  PLUS_PRICING,
  includedFilingsBullet,
  monthlyPriceLabel,
  topUpDetailLabel,
  topUpPriceLabel,
  trialFinePrint,
  yearlyPriceLabel,
} from "../src/shared/plusPricing";
import { atomsPlusOfferCopy, atomsPlusTopUpCopy } from "../src/home/atomsHomeData";
import rootPricing from "../plus-pricing.json";

describe("plus-pricing SSOT", () => {
  it("matches plus-pricing.json", () => {
    expect(PLUS_PRICING.monthlyUsd).toBe(rootPricing.monthlyUsd);
    expect(PLUS_PRICING.yearlyUsd).toBe(rootPricing.yearlyUsd);
    expect(PLUS_PRICING.topUpUsd).toBe(rootPricing.topUpUsd);
    expect(PLUS_PRICING.includedFilingsPerPeriod).toBe(
      rootPricing.includedFilingsPerPeriod,
    );
  });

  it("formats offer/top-up from SSOT (no hardcoded $ elsewhere in helpers)", () => {
    expect(monthlyPriceLabel()).toBe(`$${rootPricing.monthlyUsd} per month`);
    expect(yearlyPriceLabel()).toContain(`$${rootPricing.yearlyUsd}`);
    expect(topUpPriceLabel()).toBe(`$${rootPricing.topUpUsd}`);
    expect(includedFilingsBullet()).toContain(
      String(rootPricing.includedFilingsPerPeriod),
    );
    expect(topUpDetailLabel()).toContain(String(rootPricing.topUpFilings));
    expect(trialFinePrint()).toContain(`$${rootPricing.monthlyUsd}/month`);
    expect(trialFinePrint()).toContain(String(rootPricing.trialDays));
  });

  it("UI copy functions pull from SSOT", () => {
    const o = atomsPlusOfferCopy();
    expect(o.priceMonthly).toBe(monthlyPriceLabel());
    expect(o.finePrint).toBe(trialFinePrint());
    const t = atomsPlusTopUpCopy();
    expect(t.price).toBe(topUpPriceLabel());
    expect(t.detail).toBe(topUpDetailLabel());
  });
});
