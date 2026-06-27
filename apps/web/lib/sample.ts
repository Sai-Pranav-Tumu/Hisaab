import type { Direction } from "@hisaab/tax";

export interface RawTxn {
  date: string;
  desc: string;
  amount: number;
  dir: Direction;
}

/** Sample: an Apr–Jun 2026 freelance designer/dev statement (from reference/Hisaab.jsx). */
export const SAMPLE: RawTxn[] = [
  { date: "2026-04-03", desc: "NEFT CR ACME TECH PVT LTD INV-204", amount: 185000, dir: "credit" },
  { date: "2026-04-08", desc: "UPI/MOM/transfer for stuff", amount: 10000, dir: "credit" },
  { date: "2026-04-11", desc: "Rent UPI landlord Ramesh", amount: 18000, dir: "debit" },
  { date: "2026-04-15", desc: "IMPS Pixel Labs monthly retainer", amount: 120000, dir: "credit" },
  { date: "2026-04-19", desc: "AWS cloud charges INR", amount: 2300, dir: "debit" },
  { date: "2026-04-22", desc: "REFUND Amazon order cancelled", amount: 1499, dir: "credit" },
  { date: "2026-05-02", desc: "FOREIGN INWARD REMIT UPWORK ESCROW", amount: 95000, dir: "credit" },
  { date: "2026-05-06", desc: "UPI/designco@okhdfc logo project", amount: 60000, dir: "credit" },
  { date: "2026-05-09", desc: "Swiggy order", amount: 540, dir: "debit" },
  { date: "2026-05-14", desc: "Interest credit savings a/c", amount: 842, dir: "credit" },
  { date: "2026-05-18", desc: "NEFT CR Brightwave Media Pvt Ltd", amount: 110000, dir: "credit" },
  { date: "2026-05-21", desc: "Figma annual subscription USD", amount: 9100, dir: "debit" },
  { date: "2026-05-27", desc: "UPI/rohan split dinner", amount: 600, dir: "credit" },
  { date: "2026-06-04", desc: "UPI client Rohan website final", amount: 80000, dir: "credit" },
  { date: "2026-06-09", desc: "Electricity bill TSSPDCL", amount: 1400, dir: "debit" },
  { date: "2026-06-13", desc: "IMPS Stellar Apps milestone 2", amount: 50000, dir: "credit" },
  { date: "2026-06-17", desc: "Adobe Creative Cloud", amount: 4230, dir: "debit" },
  { date: "2026-06-20", desc: "Cashback Cred", amount: 200, dir: "credit" },
];

/** Built-in categories used when the classifier can't be reached, so the demo never dead-ends. */
export const SAMPLE_FALLBACK: string[] = [
  "business_income", "transfer_in", "expense", "business_income", "expense", "refund",
  "business_income", "business_income", "expense", "interest", "business_income", "expense",
  "transfer_in", "business_income", "expense", "business_income", "expense", "other",
];
