import type { Direction } from "@hisaab/tax";
import type { Classification } from "@/lib/schemas";

/* ------------------------------------------------------------------ *
 * Heuristic (non-API) transaction classifier.
 *
 * Powers the free tier on its own, and on the pro tier acts as a
 * pre-filter so only *uncertain* rows are sent to Claude — keeping API
 * usage to the minimum. Tuned for Indian bank-statement narrations.
 * ------------------------------------------------------------------ */

export interface ClassifiableTxn {
  desc: string;
  dir: Direction;
  amount: number;
}

interface Rule {
  test: RegExp;
  category: string;
  confidence: number;
}

// Order matters — first match wins. Only applied to credits.
const CREDIT_RULES: Rule[] = [
  // Platform payouts — very strong signal of professional income.
  { test: /\b(upwork|fiverr|toptal|freelancer\.?com|gusto|deel|wise|payoneer)\b/i, category: "business_income", confidence: 0.95 },
  // Invoice / retainer / consulting language. (No trailing \b: "INV-204" must match.)
  { test: /\b(invoice|inv[-\s#]?\d|retainer|milestone|consult\w*|professional fees|prof\.?\s*fees|services? rendered|contract)/i, category: "business_income", confidence: 0.9 },
  // Inbound foreign/wire remittance for services.
  { test: /\b(foreign\s+inward|inward\s+remit\w*|swift|wire transfer|remittance)\b/i, category: "business_income", confidence: 0.85 },
  // Refunds / reversals.
  { test: /\b(refund|reversal|rvsl|returned|chargeback|disput)\w*/i, category: "refund", confidence: 0.9 },
  // Bank interest.
  { test: /\b(interest|int\.?\s*(cr|credit|pd|paid)|savings?\s*int|fd\s*int)\b/i, category: "interest", confidence: 0.9 },
  // Cashback / rewards — not income.
  { test: /\b(cashback|reward points?|cred\b|loyalty)\b/i, category: "other", confidence: 0.8 },
  // Personal transfers from family/friends/self.
  { test: /\b(self|own\s*a\/?c|mom|dad|mummy|papa|family|friend|split|chip\s*in|settle\s*up)\b/i, category: "transfer_in", confidence: 0.7 },
];

/**
 * Classify each transaction with a heuristic. Debits are always treated as
 * expenses (high confidence); unmatched credits get a low-confidence guess so
 * the pro tier knows to escalate them to Claude and the free tier flags them.
 */
export function heuristicClassify(txns: ClassifiableTxn[]): Classification[] {
  return txns.map((t, i): Classification => {
    if (t.dir === "debit") return { i, category: "expense", confidence: 0.9 };

    const hit = CREDIT_RULES.find((r) => r.test.test(t.desc));
    if (hit) return { i, category: hit.category, confidence: hit.confidence };

    // Unmatched credit: a meaningful amount leans business income, but with low
    // confidence so it is reviewed (free) or sent to Claude (pro).
    const leanBusiness = t.amount >= 5000;
    return {
      i,
      category: leanBusiness ? "business_income" : "other",
      confidence: leanBusiness ? 0.5 : 0.45,
    };
  });
}

/** Indices the pro tier should escalate to Claude (below the review threshold). */
export function uncertainIndices(results: Classification[], threshold = 0.75): number[] {
  return results.filter((r) => r.confidence < threshold).map((r) => r.i);
}
