/* ------------------------------------------------------------------ *
 * Tiers.
 *   free  — no Claude API. Local heuristics + (future) ML generate the
 *           report. This is the "normal" tier.
 *   pro   — Claude API: realtime, format-robust analysis of raw data.
 *
 * Entitlement is a mock cookie for now (`tier=pro`). Real billing
 * (Razorpay/Stripe/Play) swaps in here later without touching callers.
 * ------------------------------------------------------------------ */

export type Tier = "free" | "pro";

export const TIER_COOKIE = "tier";

/** Read the tier from a request's Cookie header (defaults to free). */
export function tierFromRequest(req: Request): Tier {
  const cookie = req.headers.get("cookie") ?? "";
  return /(?:^|;\s*)tier=pro(?:;|$)/.test(cookie) ? "pro" : "free";
}
