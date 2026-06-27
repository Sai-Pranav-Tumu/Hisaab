import { describe, it, expect } from "vitest";
import { foldOverrides, type CorrectionEvent } from "@/lib/store/types";

describe("foldOverrides", () => {
  it("keeps the latest category per signature and accumulates the count", () => {
    const events: CorrectionEvent[] = [
      { signature: "acme tech", category: "transfer_in", dir: "credit", at: "2026-06-01T00:00:00Z" },
      { signature: "acme tech", category: "business_income", dir: "credit", at: "2026-06-02T00:00:00Z" },
      { signature: "swiggy", category: "expense", dir: "debit", at: "2026-06-03T00:00:00Z" },
    ];
    const map = foldOverrides(events);
    expect(map.get("acme tech")).toEqual({
      signature: "acme tech",
      category: "business_income", // latest wins
      dir: "credit",
      count: 2,
      updatedAt: "2026-06-02T00:00:00Z",
    });
    expect(map.get("swiggy")!.category).toBe("expense");
    expect(map.size).toBe(2);
  });

  it("skips events with an empty signature", () => {
    const map = foldOverrides([
      { signature: "", category: "other", dir: "credit", at: "2026-06-01T00:00:00Z" },
    ]);
    expect(map.size).toBe(0);
  });
});
