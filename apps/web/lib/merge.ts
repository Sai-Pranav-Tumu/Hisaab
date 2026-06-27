import type { TxnRow } from "@hisaab/tax";
import { descSignature } from "@/lib/signature";

/* Merge transactions from multiple statements across the year, de-duplicating
 * overlapping rows (same date + direction + amount + payer signature) and
 * returning a single date-sorted ledger. */
export function mergeRows(rows: TxnRow[]): TxnRow[] {
  const seen = new Set<string>();
  const out: TxnRow[] = [];
  for (const r of rows) {
    const key = `${r.date}|${r.dir}|${r.amount}|${descSignature(r.desc ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
