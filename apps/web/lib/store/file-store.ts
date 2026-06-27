import { promises as fs } from "node:fs";
import path from "node:path";
import { foldOverrides, type CorrectionEvent, type Override, type Store } from "./types";

/* Local, zero-config persistence: an append-only JSONL of corrections.
 * Swap for Supabase/Postgres later by implementing the same Store interface. */

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "corrections.jsonl");

export class FileStore implements Store {
  async saveCorrection(e: CorrectionEvent): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.appendFile(FILE, JSON.stringify(e) + "\n", "utf8");
  }

  async loadOverrides(): Promise<Map<string, Override>> {
    let text: string;
    try {
      text = await fs.readFile(FILE, "utf8");
    } catch {
      return new Map(); // no corrections yet
    }
    const events: CorrectionEvent[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as CorrectionEvent);
      } catch {
        // skip a corrupt line rather than failing the whole load
      }
    }
    return foldOverrides(events);
  }
}
