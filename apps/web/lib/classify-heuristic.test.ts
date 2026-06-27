import { describe, it, expect } from "vitest";
import { heuristicClassify, uncertainIndices, isBusinessExpense } from "@/lib/classify-heuristic";

describe("heuristicClassify", () => {
  it("treats every debit as a high-confidence expense", () => {
    const r = heuristicClassify([{ desc: "Rent UPI landlord", dir: "debit", amount: 18000 }]);
    expect(r[0]).toEqual({ i: 0, category: "expense", confidence: 0.9 });
  });

  it("flags platform payouts and invoices as business income", () => {
    const r = heuristicClassify([
      { desc: "FOREIGN INWARD REMIT UPWORK ESCROW", dir: "credit", amount: 95000 },
      { desc: "NEFT CR ACME TECH INV-204", dir: "credit", amount: 185000 },
      { desc: "IMPS Pixel Labs monthly retainer", dir: "credit", amount: 120000 },
    ]);
    expect(r.map((x) => x.category)).toEqual([
      "business_income",
      "business_income",
      "business_income",
    ]);
    expect(r.every((x) => x.confidence >= 0.85)).toBe(true);
  });

  it("recognises refunds, interest, cashback and personal transfers", () => {
    const r = heuristicClassify([
      { desc: "REFUND Amazon order cancelled", dir: "credit", amount: 1499 },
      { desc: "Interest credit savings a/c", dir: "credit", amount: 842 },
      { desc: "Cashback Cred", dir: "credit", amount: 200 },
      { desc: "UPI/MOM/transfer for stuff", dir: "credit", amount: 10000 },
    ]);
    expect(r.map((x) => x.category)).toEqual(["refund", "interest", "other", "transfer_in"]);
  });

  it("gives unmatched credits a low-confidence guess (so they get reviewed/escalated)", () => {
    const big = heuristicClassify([{ desc: "RANDOM CR XYZ", dir: "credit", amount: 60000 }])[0]!;
    const small = heuristicClassify([{ desc: "RANDOM CR XYZ", dir: "credit", amount: 300 }])[0]!;
    expect(big.category).toBe("business_income");
    expect(big.confidence).toBeLessThan(0.75);
    expect(small.category).toBe("other");
    expect(small.confidence).toBeLessThan(0.75);
  });

  it("flags SaaS/cloud/professional debits as deductible, personal spend as not", () => {
    expect(isBusinessExpense("Figma annual subscription USD")).toBe(true);
    expect(isBusinessExpense("AWS cloud charges INR")).toBe(true);
    expect(isBusinessExpense("Adobe Creative Cloud")).toBe(true);
    expect(isBusinessExpense("Swiggy order")).toBe(false);
    expect(isBusinessExpense("Rent UPI landlord Ramesh")).toBe(false);
    expect(isBusinessExpense("Electricity bill TSSPDCL")).toBe(false);
  });

  it("uncertainIndices returns only rows below the review threshold", () => {
    const results = heuristicClassify([
      { desc: "UPWORK ESCROW", dir: "credit", amount: 95000 }, // 0.95 -> certain
      { desc: "RANDOM CR", dir: "credit", amount: 50000 }, // 0.5 -> uncertain
      { desc: "Swiggy", dir: "debit", amount: 540 }, // 0.9 -> certain
    ]);
    expect(uncertainIndices(results)).toEqual([1]);
  });
});
