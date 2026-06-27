import { describe, it, expect } from "vitest";
import { descSignature } from "@/lib/signature";

describe("descSignature", () => {
  it("strips rails, digits and punctuation down to payer words", () => {
    expect(descSignature("NEFT CR ACME TECH PVT LTD INV-204")).toBe("acme tech pvt ltd inv");
  });

  it("matches a recurring identical narration regardless of rail prefix", () => {
    const a = descSignature("IMPS Pixel Labs monthly retainer");
    const b = descSignature("UPI Pixel Labs monthly retainer");
    expect(a).toBe(b);
    expect(a).toBe("pixel labs monthly retainer");
  });

  it("ignores the changing transaction number on otherwise-identical lines", () => {
    expect(descSignature("Stellar Apps milestone 2")).toBe(
      descSignature("Stellar Apps milestone 7"),
    );
  });
});
