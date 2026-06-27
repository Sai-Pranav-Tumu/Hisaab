import type { RawTxn } from "@/lib/sample";

/* ------------------------------------------------------------------ *
 * Local (non-API) statement parsing.
 *
 * - detectKind: classify an upload as pdf / csv / xlsx.
 * - flattenXlsxToText / parseDelimited: turn a spreadsheet or CSV into a
 *   text grid. On pro this text is handed to Claude (any layout); the
 *   pure parsers below let the free tier read well-structured exports
 *   with no API at all.
 * - rowsToTransactions: best-effort column detection for the free tier.
 * ------------------------------------------------------------------ */

export type FileKind = "pdf" | "csv" | "xlsx" | "unknown";

export function detectKind(filename: string, bytes: Buffer): FileKind {
  const name = filename.toLowerCase();
  const head = bytes.subarray(0, 8);
  // PDF: "%PDF-"
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  // XLSX (and any OOXML) is a ZIP container: "PK\x03\x04".
  if (head[0] === 0x50 && head[1] === 0x4b && (name.endsWith(".xlsx") || name.endsWith(".xlsm"))) {
    return "xlsx";
  }
  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) return "csv";
  // Fallback: printable-ASCII-ish content with delimiters looks like CSV.
  const sample = bytes.subarray(0, 4096).toString("utf8");
  if (/[\r\n]/.test(sample) && /[,;\t]/.test(sample) && !/�/.test(sample)) return "csv";
  return "unknown";
}

/** Pick the most likely delimiter from the first few lines. */
export function detectDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts: Record<string, number> = {
    ",": (firstLines.match(/,/g) || []).length,
    "\t": (firstLines.match(/\t/g) || []).length,
    ";": (firstLines.match(/;/g) || []).length,
    "|": (firstLines.match(/\|/g) || []).length,
  };
  let best = ",";
  let max = -1;
  for (const [d, c] of Object.entries(counts)) {
    if (c > max) {
      max = c;
      best = d;
    }
  }
  return best;
}

/** RFC4180-ish parser: handles quoted fields, escaped quotes, and CRLF. */
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // strip a UTF-8 BOM if present
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // handled by the \n branch; ignore lone CR
    } else {
      field += ch;
    }
  }
  // flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop fully-empty rows
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Normalise a date string to YYYY-MM-DD, or return null if unrecognised. */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // Already ISO (YYYY-MM-DD or YYYY/MM/DD)
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);

  // DD/MM/YYYY or DD-MM-YYYY (Indian convention) or DD.MM.YY
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const day = +m[1]!;
    const mon = +m[2]!;
    let year = +m[3]!;
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return iso(year, mon, day);
  }

  // DD MMM YYYY (e.g. "03 Apr 2026", "3-Apr-26")
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{2,4})/);
  if (m) {
    const day = +m[1]!;
    const mon = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
    let year = +m[3]!;
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (mon) return iso(year, mon, day);
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y.toString().padStart(4, "0")}-${mo.toString().padStart(2, "0")}-${d
    .toString()
    .padStart(2, "0")}`;
}

/** Parse an amount cell ("₹1,85,000.00", "(2,300)", "-540") to a positive number. */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[₹$,\s]/g, "").replace(/[()]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

const COL = {
  date: /\b(date|txn date|value date|transaction date|posting date)\b/i,
  desc: /\b(desc|description|narration|particular|details|remark|transaction|payee|reference)\b/i,
  debit: /\b(debit|withdrawal|withdrawl|paid out|dr\b|outflow)\b/i,
  credit: /\b(credit|deposit|paid in|cr\b|inflow)\b/i,
  amount: /\b(amount|amt|value)\b/i,
  type: /\b(type|dr\/cr|cr\/dr|drcr|indicator)\b/i,
};

/**
 * Best-effort: detect a header row, map columns, and emit transactions.
 * Returns [] when columns can't be confidently identified — the caller
 * then routes to Claude (pro) or surfaces a "needs pro/ML" message (free).
 */
export function rowsToTransactions(rows: string[][]): RawTxn[] {
  if (rows.length < 2) return [];

  // Find the header: the row in the first 10 that names a date AND a desc.
  let headerIdx = -1;
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cells = rows[r]!;
    const hasDate = cells.some((c) => COL.date.test(c));
    const hasDesc = cells.some((c) => COL.desc.test(c));
    if (hasDate && hasDesc) {
      headerIdx = r;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const header = rows[headerIdx]!.map((c) => c.trim());
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const dateCol = find(COL.date);
  const descCol = find(COL.desc);
  const amountCol = find(COL.amount);
  const typeCol = find(COL.type);
  // Detect separate debit/credit columns, excluding a combined type column
  // (e.g. "Dr/Cr") which would otherwise match BOTH patterns.
  let debitCol = header.findIndex((h, idx) => idx !== typeCol && COL.debit.test(h));
  let creditCol = header.findIndex((h, idx) => idx !== typeCol && COL.credit.test(h));
  if (debitCol === creditCol) {
    // Same column matched both (a combined indicator, not real amounts).
    debitCol = -1;
    creditCol = -1;
  }
  const hasSplitColumns = debitCol !== -1 && creditCol !== -1;
  if (dateCol === -1 || descCol === -1) return [];

  const out: RawTxn[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const date = normalizeDate(cells[dateCol] ?? "");
    const desc = (cells[descCol] ?? "").trim();
    if (!date || !desc) continue;

    let amount: number | null = null;
    let dir: "credit" | "debit" | null = null;

    if (hasSplitColumns) {
      const dr = debitCol !== -1 ? parseAmount(cells[debitCol] ?? "") : null;
      const cr = creditCol !== -1 ? parseAmount(cells[creditCol] ?? "") : null;
      if (cr && cr > 0) {
        amount = cr;
        dir = "credit";
      } else if (dr && dr > 0) {
        amount = dr;
        dir = "debit";
      }
    } else if (amountCol !== -1) {
      const raw = cells[amountCol] ?? "";
      amount = parseAmount(raw);
      const negative = /^\s*[-(]/.test(raw);
      const typeVal = typeCol !== -1 ? (cells[typeCol] ?? "").toLowerCase() : "";
      if (typeVal) dir = /^(cr|credit|c)\b/.test(typeVal) ? "credit" : "debit";
      else dir = negative ? "debit" : "credit";
    }

    if (amount && amount > 0 && dir) out.push({ date, desc, amount, dir });
  }
  return out;
}

/** Flatten the first worksheet of an XLSX buffer to delimited text (server-only). */
export async function flattenXlsxToText(bytes: Buffer): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return "";
  const lines: string[] = [];
  ws.eachRow((row) => {
    const values = (row.values as unknown[]).slice(1).map((v) => {
      if (v == null) return "";
      if (typeof v === "object" && v !== null && "text" in (v as Record<string, unknown>)) {
        return String((v as { text: unknown }).text);
      }
      return String(v);
    });
    lines.push(values.join(","));
  });
  return lines.join("\n");
}
