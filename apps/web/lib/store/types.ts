import type { Direction } from "@hisaab/tax";

/* ------------------------------------------------------------------ *
 * Store abstraction. The file-backed implementation is the local
 * default; a Supabase/Postgres implementation can be dropped in behind
 * the same `Store` interface without touching callers.
 * ------------------------------------------------------------------ */

/** One append-only correction the user made (the moat is the log of these). */
export interface CorrectionEvent {
  signature: string;
  category: string;
  dir: Direction;
  at: string; // ISO timestamp
}

/** The current learned override for a signature (folded from the event log). */
export interface Override {
  signature: string;
  category: string;
  dir: Direction;
  count: number; // how many times this signature has been corrected/confirmed
  updatedAt: string;
}

export interface Store {
  saveCorrection(e: CorrectionEvent): Promise<void>;
  loadOverrides(): Promise<Map<string, Override>>;
}

/** Fold a correction event log into current overrides (latest wins; count accumulates). */
export function foldOverrides(events: CorrectionEvent[]): Map<string, Override> {
  const map = new Map<string, Override>();
  for (const e of events) {
    if (!e.signature) continue;
    const prev = map.get(e.signature);
    map.set(e.signature, {
      signature: e.signature,
      category: e.category,
      dir: e.dir,
      count: (prev?.count ?? 0) + 1,
      updatedAt: e.at,
    });
  }
  return map;
}
