import { describe, it, expect } from "vitest";
import {
  detectDelimiter,
  parseDelimited,
  normalizeDate,
  parseAmount,
  rowsToTransactions,
} from "@/lib/parse-statement";

describe("parseDelimited", () => {
  it("parses quoted fields with embedded commas and escaped quotes", () => {
    const csv = 'a,b,c\n1,"hello, world","say ""hi"""\n2,x,y';
    expect(parseDelimited(csv)).toEqual([
      ["a", "b", "c"],
      ["1", "hello, world", 'say "hi"'],
      ["2", "x", "y"],
    ]);
  });

  it("handles CRLF and strips a BOM and blank lines", () => {
    const csv = "﻿a,b\r\n1,2\r\n\r\n3,4\r\n";
    expect(parseDelimited(csv)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("detects tab and semicolon delimiters", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
  });
});

describe("normalizeDate", () => {
  it("normalises common Indian/ISO formats to YYYY-MM-DD", () => {
    expect(normalizeDate("2026-04-03")).toBe("2026-04-03");
    expect(normalizeDate("03/04/2026")).toBe("2026-04-03"); // DD/MM/YYYY
    expect(normalizeDate("3-4-26")).toBe("2026-04-03");
    expect(normalizeDate("03 Apr 2026")).toBe("2026-04-03");
    expect(normalizeDate("3-Apr-26")).toBe("2026-04-03");
  });

  it("returns null for unrecognised input", () => {
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("not a date")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("strips currency symbols, commas, and parens", () => {
    expect(parseAmount("₹1,85,000.00")).toBe(185000);
    expect(parseAmount("(2,300)")).toBe(2300);
    expect(parseAmount("-540")).toBe(540);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("rowsToTransactions", () => {
  it("reads a separate debit/credit-column statement", () => {
    const rows = parseDelimited(
      [
        "Date,Narration,Withdrawal,Deposit",
        "03/04/2026,NEFT CR ACME TECH INV-204,,185000",
        "11/04/2026,Rent UPI landlord,18000,",
        "15/04/2026,IMPS Pixel Labs retainer,,120000",
      ].join("\n"),
    );
    expect(rowsToTransactions(rows)).toEqual([
      { date: "2026-04-03", desc: "NEFT CR ACME TECH INV-204", amount: 185000, dir: "credit" },
      { date: "2026-04-11", desc: "Rent UPI landlord", amount: 18000, dir: "debit" },
      { date: "2026-04-15", desc: "IMPS Pixel Labs retainer", amount: 120000, dir: "credit" },
    ]);
  });

  it("reads a single signed-amount column with a type indicator", () => {
    const rows = parseDelimited(
      [
        "Txn Date,Description,Amount,Dr/Cr",
        "2026-05-02,Upwork escrow,95000,CR",
        "2026-05-09,Swiggy order,540,DR",
      ].join("\n"),
    );
    expect(rowsToTransactions(rows)).toEqual([
      { date: "2026-05-02", desc: "Upwork escrow", amount: 95000, dir: "credit" },
      { date: "2026-05-09", desc: "Swiggy order", amount: 540, dir: "debit" },
    ]);
  });

  it("returns [] when no header with date+description is found", () => {
    const rows = parseDelimited("foo,bar\n1,2\n3,4");
    expect(rowsToTransactions(rows)).toEqual([]);
  });
});
