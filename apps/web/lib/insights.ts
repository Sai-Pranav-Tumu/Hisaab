import type { TxnRow } from "@hisaab/tax";

/* ------------------------------------------------------------------ *
 * Quantitative statement insights — pure, no API.
 *
 * Available to BOTH tiers (this is the precisa-style report). The pro
 * tier layers Claude's qualitative narrative/advice on top of these
 * numbers, so the expensive model never recomputes what code can.
 * ------------------------------------------------------------------ */

export interface MonthPoint {
  month: string; // YYYY-MM
  business: number; // business_income credits
  credits: number; // all credits
}

export interface IncomeSource {
  name: string;
  amount: number;
  count: number;
}

export interface Insights {
  receipts: number; // total business income
  expenseTotal: number; // total debits
  creditCount: number;
  debitCount: number;
  months: MonthPoint[];
  topSources: IncomeSource[];
  /** Largest single source as a % of receipts (client-concentration risk). */
  concentrationPct: number;
  /** Coefficient of variation of monthly business income (lower = steadier); null if < 2 months. */
  stability: number | null;
}

/** Reduce a noisy narration to a stable payer key for grouping. */
export function payerKey(desc: string): string {
  let s = desc.toUpperCase();
  s = s.replace(
    /\b(NEFT|IMPS|RTGS|UPI|CR|DR|CMS|ACH|INB|MB|IB|TRF|TRANSFER|PAYMENT|PYMT|REF|FROM|TO|VIA|A\/C|AC|INR|USD|FOREIGN|INWARD|REMIT|REMITTANCE|ESCROW|MONTHLY|FINAL)\b/g,
    " ",
  );
  s = s.replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter((w) => w.length >= 3);
  return words.slice(0, 3).join(" ") || desc.toUpperCase().slice(0, 20).trim();
}

export function computeInsights(rows: TxnRow[]): Insights {
  const business = rows.filter((r) => r.dir === "credit" && r.category === "business_income");
  const credits = rows.filter((r) => r.dir === "credit");
  const debits = rows.filter((r) => r.dir === "debit");

  const receipts = business.reduce((s, r) => s + r.amount, 0);
  const expenseTotal = debits.reduce((s, r) => s + r.amount, 0);

  // Monthly series
  const byMonth = new Map<string, MonthPoint>();
  for (const r of credits) {
    const month = r.date.slice(0, 7); // YYYY-MM
    const pt = byMonth.get(month) ?? { month, business: 0, credits: 0 };
    pt.credits += r.amount;
    if (r.category === "business_income") pt.business += r.amount;
    byMonth.set(month, pt);
  }
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

  // Top income sources
  const bySource = new Map<string, IncomeSource>();
  for (const r of business) {
    const name = payerKey(r.desc ?? "");
    const src = bySource.get(name) ?? { name, amount: 0, count: 0 };
    src.amount += r.amount;
    src.count += 1;
    bySource.set(name, src);
  }
  const topSources = [...bySource.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const concentrationPct = receipts > 0 && topSources[0] ? (topSources[0].amount / receipts) * 100 : 0;

  // Income stability: coefficient of variation across months (business income).
  let stability: number | null = null;
  const series = months.map((m) => m.business);
  if (series.length >= 2) {
    const mean = series.reduce((s, v) => s + v, 0) / series.length;
    if (mean > 0) {
      const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length;
      stability = Math.sqrt(variance) / mean;
    }
  }

  return {
    receipts,
    expenseTotal,
    creditCount: credits.length,
    debitCount: debits.length,
    months,
    topSources,
    concentrationPct,
    stability,
  };
}
