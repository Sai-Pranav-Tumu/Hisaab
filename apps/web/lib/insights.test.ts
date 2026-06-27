import { describe, it, expect } from "vitest";
import { computeInsights, payerKey } from "@/lib/insights";
import type { TxnRow } from "@hisaab/tax";

const rows: TxnRow[] = [
  { date: "2026-04-03", desc: "NEFT CR ACME TECH PVT LTD INV-204", amount: 185000, dir: "credit", category: "business_income", confidence: 0.9 },
  { date: "2026-04-11", desc: "Rent UPI landlord", amount: 18000, dir: "debit", category: "expense", confidence: 0.9 },
  { date: "2026-05-02", desc: "FOREIGN INWARD REMIT UPWORK ESCROW", amount: 95000, dir: "credit", category: "business_income", confidence: 0.9 },
  { date: "2026-05-14", desc: "Interest credit savings", amount: 842, dir: "credit", category: "interest", confidence: 0.9 },
  { date: "2026-05-21", desc: "Figma subscription", amount: 9100, dir: "debit", category: "expense", confidence: 0.9 },
  { date: "2026-06-13", desc: "IMPS ACME TECH PVT LTD milestone 2", amount: 50000, dir: "credit", category: "business_income", confidence: 0.9 },
];

describe("payerKey", () => {
  it("strips bank rails/noise so the same payer groups together", () => {
    expect(payerKey("NEFT CR ACME TECH PVT LTD INV-204")).toBe(
      payerKey("IMPS ACME TECH PVT LTD milestone 2"),
    );
  });
});

describe("computeInsights", () => {
  const ins = computeInsights(rows);

  it("totals receipts and expenses correctly", () => {
    expect(ins.receipts).toBe(330000); // 185000 + 95000 + 50000
    expect(ins.expenseTotal).toBe(27100); // 18000 + 9100
    expect(ins.creditCount).toBe(4);
    expect(ins.debitCount).toBe(2);
  });

  it("builds a sorted monthly business-income series", () => {
    expect(ins.months.map((m) => m.month)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(ins.months.map((m) => m.business)).toEqual([185000, 95000, 50000]);
    // May credits include the interest, business does not
    const may = ins.months.find((m) => m.month === "2026-05")!;
    expect(may.credits).toBe(95842);
    expect(may.business).toBe(95000);
  });

  it("groups top sources and computes client concentration", () => {
    // ACME (185000 + 50000 = 235000) is the top source.
    expect(ins.topSources[0]!.amount).toBe(235000);
    expect(ins.topSources[0]!.count).toBe(2);
    expect(ins.concentrationPct).toBeCloseTo((235000 / 330000) * 100, 4);
  });

  it("reports a non-negative stability coefficient when >= 2 months", () => {
    expect(ins.stability).not.toBeNull();
    expect(ins.stability!).toBeGreaterThan(0);
  });
});
