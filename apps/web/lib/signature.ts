/* ------------------------------------------------------------------ *
 * Description signature — a stable key for a transaction's narration,
 * so a correction the user makes once is recognised when the same kind
 * of transaction recurs (the compounding moat).
 *
 * Strips digits, punctuation and bank rails/noise, leaving the payer
 * words. Recurring identical narrations collapse to the same signature.
 * ------------------------------------------------------------------ */

const NOISE =
  /\b(neft|imps|rtgs|upi|cr|dr|cms|ach|inb|mb|ib|trf|transfer|payment|pymt|ref|from|to|via|ac|inr|usd|foreign|inward|remit|remittance|escrow|txn|tx|no|id|utr|cheque|chq)\b/g;

export function descSignature(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}
