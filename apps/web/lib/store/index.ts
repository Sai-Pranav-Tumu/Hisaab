import { FileStore } from "./file-store";
import type { Store } from "./types";

let store: Store | null = null;

/** The configured store. Local file-backed today; swap for Supabase/Postgres later. */
export function getStore(): Store {
  if (!store) store = new FileStore();
  return store;
}

export type { Store, CorrectionEvent, Override } from "./types";
