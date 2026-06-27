import { describe, it, expect } from "vitest";
import { computeAnnualTax, computeEstimate, DUE_DATES, type TxnRow } from "./index";

describe("computeAnnualTax — FY 2026-27 new regime", () => {
  it("is zero up to and including the ₹12L §87A rebate cutoff", () => {
    expect(computeAnnualTax(0)).toBe(0);
    expect(computeAnnualTax(400000)).toBe(0); // top of nil slab
    expect(computeAnnualTax(800000)).toBe(0); // within rebate
    expect(computeAnnualTax(1200000)).toBe(0); // exactly the cliff -> still zero
  });

  it("applies marginal relief just above ₹12L (tax capped to the excess, + cess)", () => {
    // Slab tax on 1,210,000 = 20000 + 40000 + 1500 = 61500, but marginal relief
    // caps it to the ₹10,000 above 12L, then 4% cess -> 10,400.
    expect(computeAnnualTax(1210000)).toBe(10400);
    // Exactly ₹1 above the cliff: relief caps tax at ₹1, +cess -> ~1.04.
    expect(computeAnnualTax(1200001)).toBeCloseTo(1.04, 5);
  });

  it("computes the 15% slab band correctly (₹13L)", () => {
    // 5%·400k + 10%·400k + 15%·100k = 75000; relief min(75000, 100000)=75000; +4% cess.
    expect(computeAnnualTax(1300000)).toBe(78000);
  });

  it("computes the top 30% slab (₹25L)", () => {
    // 20000 + 40000 + 60000 + 80000 + 100000 + 30%·100k(30000) = 330000; +4% cess.
    expect(computeAnnualTax(2500000)).toBe(343200);
  });

  it("adds exactly 4% cess", () => {
    const taxable = 2000000;
    // pre-cess: 20000 + 40000 + 60000 + 20%·400k(80000) = 200000; relief no-op; +4% = 208000.
    expect(computeAnnualTax(taxable)).toBe(208000);
  });
});

describe("DUE_DATES — advance-tax schedule", () => {
  it("is the 15/45/75/100% Jun/Sep/Dec/Mar schedule", () => {
    expect(DUE_DATES.map((d) => d.cum)).toEqual([0.15, 0.45, 0.75, 1.0]);
    expect(DUE_DATES.map((d) => d.label)).toEqual(["15 Jun", "15 Sep", "15 Dec", "15 Mar"]);
    expect(DUE_DATES.map((d) => d.iso)).toEqual([
      "2026-06-15",
      "2026-09-15",
      "2026-12-15",
      "2027-03-15",
    ]);
  });
});

// Apr–Jun 2026 sample with built-in fallback categories (mirrors reference/Hisaab.jsx).
const SAMPLE: TxnRow[] = [
  { date: "2026-04-03", desc: "ACME TECH INV-204", amount: 185000, dir: "credit", category: "business_income", confidence: 0.9 },
  { date: "2026-04-08", desc: "MOM transfer", amount: 10000, dir: "credit", category: "transfer_in", confidence: 0.9 },
  { date: "2026-04-11", desc: "Rent landlord", amount: 18000, dir: "debit", category: "expense", confidence: 0.9 },
  { date: "2026-04-15", desc: "Pixel Labs retainer", amount: 120000, dir: "credit", category: "business_income", confidence: 0.9 },
  { date: "2026-04-19", desc: "AWS", amount: 2300, dir: "debit", category: "expense", confidence: 0.9 },
  { date: "2026-04-22", desc: "Amazon refund", amount: 1499, dir: "credit", category: "refund", confidence: 0.9 },
  { date: "2026-05-02", desc: "Upwork escrow", amount: 95000, dir: "credit", category: "business_income", confidence: 0.9 },
  { date: "2026-05-06", desc: "logo project", amount: 60000, dir: "credit", category: "business_income", confidence: 0.9 },
  { date: "2026-05-09", desc: "Swiggy", amount: 540, dir: "debit", category: "expense", confidence: 0.9 },
  { date: "2026-05-14", desc: "Interest", amount: 842, dir: "credit", category: "interest", confidence: 0.9 },
  { date: "2026-05-18", desc: "Brightwave Media", amount: 110000, dir: "credit", category: "business_income", confidence: 0.9 },
  { date: "2026-05-21", desc: "Figma", amount: 9100, dir: "debit", category: "expense", confidence: 0.9 },
  { date: "2026-05-27", desc: "split dinner", amount: 600, dir: "credit", category: "transfer_in", confidence: 0.9 },
  { date: "2026-06-04", desc: "Rohan website", amount: 80000, dir: "credit", category: "business_income", confidence: 0.9 },
  { date: "2026-06-09", desc: "Electricity", amount: 1400, dir: "debit", category: "expense", confidence: 0.9 },
  { date: "2026-06-13", desc: "Stellar Apps", amount: 50000, dir: "credit", category: "business_income", confidence: 0.9 },
  { date: "2026-06-17", desc: "Adobe", amount: 4230, dir: "debit", category: "expense", confidence: 0.9 },
  { date: "2026-06-20", desc: "Cashback", amount: 200, dir: "credit", category: "other", confidence: 0.9 },
];

describe("computeEstimate", () => {
  const today = new Date("2026-06-27");

  it("returns null for no rows", () => {
    expect(computeEstimate([], { basis: "presumptive", annualize: true, today })).toBeNull();
  });

  it("separates business receipts from noise on the sample", () => {
    const est = computeEstimate(SAMPLE, { basis: "presumptive", annualize: true, today })!;
    expect(est.receipts).toBe(700000); // only the 7 business_income credits
    expect(est.totalCredits).toBe(713141); // all credits
    expect(est.noise).toBe(13141); // transfers + refund + interest + cashback
    expect(est.lowConf).toBe(0); // all fallback rows are confidence 0.9
  });

  it("annualises across the statement span and produces a valid schedule", () => {
    const est = computeEstimate(SAMPLE, { basis: "presumptive", annualize: true, today })!;
    // Span 2026-04-03 .. 2026-06-20 = 78 days; factor = min(12, 365/78).
    expect(est.spanDays).toBe(78);
    expect(est.factor).toBeCloseTo(365 / 78, 6);
    expect(est.applies).toBe(true);
    // Schedule cumulatives match the due fractions, scaled to annual tax.
    expect(est.schedule.map((s) => s.cum)).toEqual([0.15, 0.45, 0.75, 1.0]);
    est.schedule.forEach((s) => expect(s.due).toBeCloseTo(s.cum * est.annualTax, 6));
    // On 2026-06-27, only 15 Jun is past; 15 Sep is the next instalment.
    expect(est.next.label).toBe("15 Sep");
    expect(est.overdue.map((s) => s.label)).toEqual(["15 Jun"]);
  });

  it("net basis taxes more than presumptive (65% vs 50% of receipts)", () => {
    const p = computeEstimate(SAMPLE, { basis: "presumptive", annualize: true, today })!;
    const n = computeEstimate(SAMPLE, { basis: "net", annualize: true, today })!;
    expect(n.taxable).toBeCloseTo(p.annualReceipts * 0.65, 6);
    expect(p.taxable).toBeCloseTo(p.annualReceipts * 0.5, 6);
    expect(n.annualTax).toBeGreaterThan(p.annualTax);
  });

  it("annualize:false uses the period as-is (factor 1)", () => {
    const est = computeEstimate(SAMPLE, { basis: "presumptive", annualize: false, today })!;
    expect(est.factor).toBe(1);
    expect(est.annualReceipts).toBe(700000);
  });
});
