/* ------------------------------------------------------------------ *
 * Hisaab tax engine — FY 2026-27, new regime.
 *
 * This package is the part that must never silently break. The slab
 * math (`computeAnnualTax`) and the advance-tax schedule (`DUE_DATES`)
 * are copied VERBATIM from the original reference (reference/Hisaab.jsx).
 * Do not re-derive the constants — they are unit-tested in index.test.ts.
 * ------------------------------------------------------------------ */

export type Direction = "credit" | "debit";

/** Income basis for the taxable-income calculation. */
export type Basis = "presumptive" | "net";

/** A classified bank transaction. Only `business_income` credits count as receipts. */
export interface TxnRow {
  date: string; // ISO YYYY-MM-DD
  desc?: string;
  amount: number;
  dir: Direction;
  category: string;
  confidence: number;
}

/**
 * Annual income tax under the FY 2026-27 new regime.
 *
 * Seven slabs, the ₹60,000 §87A rebate (taxable ≤ ₹12L → zero tax),
 * marginal relief above ₹12L, and 4% cess. Ported verbatim from
 * reference/Hisaab.jsx (computeAnnualTax).
 */
export function computeAnnualTax(taxable: number): number {
  const slabs: Array<[number, number]> = [
    [400000, 0],
    [800000, 0.05],
    [1200000, 0.1],
    [1600000, 0.15],
    [2000000, 0.2],
    [2400000, 0.25],
    [Infinity, 0.3],
  ];
  let tax = 0;
  let prev = 0;
  for (const [cap, rate] of slabs) {
    if (taxable > prev) tax += (Math.min(taxable, cap) - prev) * rate;
    prev = cap;
    if (taxable <= cap) break;
  }
  // Section 87A: taxable up to 12L -> full rebate (effectively zero)
  if (taxable <= 1200000) tax = 0;
  else tax = Math.min(tax, taxable - 1200000); // marginal relief above 12L
  const cess = tax * 0.04;
  return tax + cess;
}

export interface DueDate {
  label: string;
  iso: string;
  /** Cumulative fraction of annual liability due by this date. */
  cum: number;
}

/** Advance-tax schedule: 15/45/75/100% due 15 Jun / 15 Sep / 15 Dec / 15 Mar. */
export const DUE_DATES: DueDate[] = [
  { label: "15 Jun", iso: "2026-06-15", cum: 0.15 },
  { label: "15 Sep", iso: "2026-09-15", cum: 0.45 },
  { label: "15 Dec", iso: "2026-12-15", cum: 0.75 },
  { label: "15 Mar", iso: "2027-03-15", cum: 1.0 },
];

export interface ScheduleEntry extends DueDate {
  /** Cumulative amount due by this date (cum × annual liability). */
  due: number;
  status: "past" | "upcoming";
  dt: Date;
}

export interface EstimateOptions {
  basis: Basis;
  annualize: boolean;
  /** Reference "today" — injected so the schedule is deterministic and testable. */
  today: Date;
}

export interface Estimate {
  totalCredits: number;
  receipts: number;
  noise: number;
  factor: number;
  spanDays: number;
  annualReceipts: number;
  taxable: number;
  annualTax: number;
  applies: boolean;
  schedule: ScheduleEntry[];
  next: ScheduleEntry;
  overdue: ScheduleEntry[];
  lowConf: number;
}

/**
 * Derive the full advance-tax estimate from a set of classified rows.
 *
 * Pure function lifted from the `calc` useMemo in reference/Hisaab.jsx so
 * the UI and the /estimate API share one implementation. Returns `null`
 * for an empty input (nothing to estimate yet).
 */
export function computeEstimate(rows: TxnRow[], opts: EstimateOptions): Estimate | null {
  if (rows.length === 0) return null;
  const { basis, annualize, today } = opts;

  const credits = rows.filter((r) => r.dir === "credit");
  const totalCredits = credits.reduce((s, r) => s + r.amount, 0);
  const receipts = rows
    .filter((r) => r.dir === "credit" && r.category === "business_income")
    .reduce((s, r) => s + r.amount, 0);
  const noise = totalCredits - receipts;

  const dates = rows.map((r) => +new Date(r.date)).filter(Boolean);
  const spanDays =
    dates.length > 1 ? Math.max(1, (Math.max(...dates) - Math.min(...dates)) / 86400000) : 30;
  const factor = annualize ? Math.min(12, 365 / spanDays) : 1;
  const annualReceipts = receipts * factor;

  // Presumptive 44ADA taxes 50% of receipts; net basis assumes 65% profit.
  const taxable = basis === "presumptive" ? annualReceipts * 0.5 : annualReceipts * 0.65;
  const annualTax = computeAnnualTax(taxable);
  const applies = annualTax > 10000; // advance tax applies when liability > ₹10,000

  const schedule: ScheduleEntry[] = DUE_DATES.map((d) => {
    const due = d.cum * annualTax;
    const dt = new Date(d.iso);
    return { ...d, due, status: dt < today ? "past" : "upcoming", dt };
  });
  const next = schedule.find((s) => s.status === "upcoming") ?? schedule[schedule.length - 1]!;
  const overdue = schedule.filter((s) => s.status === "past" && applies);

  return {
    totalCredits,
    receipts,
    noise,
    factor,
    spanDays,
    annualReceipts,
    taxable,
    annualTax,
    applies,
    schedule,
    next,
    overdue,
    lowConf: rows.filter((r) => r.confidence < 0.75 && r.dir === "credit").length,
  };
}
