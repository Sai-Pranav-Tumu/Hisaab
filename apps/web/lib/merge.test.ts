import { describe, it, expect } from "vitest";
import { mergeRows } from "@/lib/merge";
import type { TxnRow } from "@hisaab/tax";

const row = (date: string, amount: number, desc: string, dir: "credit" | "debit" = "credit"): TxnRow => ({
  date,
  amount,
  desc,
  dir,
  category: dir === "credit" ? "business_income" : "expense",
  confidence: 0.9,
});

describe("mergeRows", () => {
  it("drops duplicates that overlap between statements and sorts by date", () => {
    const a = [row("2026-05-02", 95000, "UPWORK ESCROW"), row("2026-04-03", 185000, "ACME INV-204")];
    const b = [row("2026-05-02", 95000, "UPWORK ESCROW"), row("2026-06-13", 50000, "STELLAR APPS")];
    const merged = mergeRows([...a, ...b]);
    expect(merged.map((r) => r.date)).toEqual(["2026-04-03", "2026-05-02", "2026-06-13"]);
    expect(merged).toHaveLength(3); // the duplicate UPWORK row collapses
  });

  it("keeps same-day different-amount rows distinct", () => {
    const merged = mergeRows([
      row("2026-05-02", 95000, "UPWORK ESCROW"),
      row("2026-05-02", 60000, "UPWORK ESCROW"),
    ]);
    expect(merged).toHaveLength(2);
  });
});
