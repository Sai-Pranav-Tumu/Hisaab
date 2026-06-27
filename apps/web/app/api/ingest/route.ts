import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getAnthropic, hasApiKey, MODEL, messageText, parseJsonLoose } from "@/lib/anthropic";
import { IngestResponseSchema } from "@/lib/schemas";
import type { RawTxn } from "@/lib/sample";
import { tierFromRequest } from "@/lib/tier";
import {
  detectKind,
  detectDelimiter,
  parseDelimited,
  rowsToTransactions,
  flattenXlsxToText,
} from "@/lib/parse-statement";

export const runtime = "nodejs";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

const EXTRACT_PROMPT =
  "This is a bank statement (or a business report containing transactions). " +
  "Extract every transaction. For each, return: date (YYYY-MM-DD), a short description, " +
  "amount as a positive number (no currency symbol or commas), and dir ('credit' for money " +
  "received, 'debit' for money spent). Preserve order. Statements come in many layouts and " +
  "from many banks (HDFC, ICICI, SBI, Axis, Kotak, etc.) and from B2B/B2C exports — infer the " +
  "columns regardless of layout. If a value is unclear, make your best inference.";

// Structured-output schema (mirrors IngestResponseSchema in lib/schemas.ts).
const INGEST_FORMAT = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      transactions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string" },
            desc: { type: "string" },
            amount: { type: "number" },
            dir: { type: "string", enum: ["credit", "debit"] },
          },
          required: ["date", "desc", "amount", "dir"],
        },
      },
    },
    required: ["transactions"],
  },
};

type MessageContent = Anthropic.MessageParam["content"];

async function extract(client: Anthropic, content: MessageContent): Promise<RawTxn[]> {
  const params = {
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: "user", content }],
    output_config: { format: INGEST_FORMAT },
  };
  const res = (await client.messages.create(params as never)) as Anthropic.Message;
  const parsed = IngestResponseSchema.parse(parseJsonLoose(messageText(res)));
  return parsed.transactions;
}

const proRequired = (what: string) =>
  NextResponse.json(
    {
      error: `${what} needs Pro (realtime AI extraction). Upgrade to Pro, upload a structured CSV/Excel export, or try the sample — a free-tier ML reader is coming.`,
    },
    { status: 402 },
  );

export async function POST(req: Request) {
  const tier = tierFromRequest(req);

  // --- read + validate the upload ---
  let bytes: Buffer;
  let filename = "upload";
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That file is too large (max 15 MB)." }, { status: 413 });
    }
    filename = file.name || "upload";
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Couldn't read the uploaded file." }, { status: 400 });
  }

  const kind = detectKind(filename, bytes);

  // --- CSV / TSV ---------------------------------------------------------
  if (kind === "csv") {
    const text = bytes.toString("utf8");
    const local = rowsToTransactions(parseDelimited(text, detectDelimiter(text)));
    if (local.length > 0) {
      return NextResponse.json({ transactions: local, engine: "local-csv" });
    }
    // Couldn't detect columns locally.
    if (tier === "pro" && hasApiKey()) {
      try {
        const txns = await extract(getAnthropic(), `${EXTRACT_PROMPT}\n\nStatement text:\n${text}`);
        if (txns.length > 0) return NextResponse.json({ transactions: txns, engine: "claude-csv" });
      } catch (err) {
        console.error("ingest csv (pro) failed:", err instanceof Error ? err.message : "unknown");
      }
      return NextResponse.json(
        { error: "Couldn't find transactions in that CSV." },
        { status: 422 },
      );
    }
    return proRequired("Reading this CSV layout");
  }

  // --- XLSX --------------------------------------------------------------
  if (kind === "xlsx") {
    let flat = "";
    try {
      flat = await flattenXlsxToText(bytes);
    } catch (err) {
      console.error("xlsx parse failed:", err instanceof Error ? err.message : "unknown");
      return NextResponse.json({ error: "Couldn't open that Excel file." }, { status: 422 });
    }
    const local = rowsToTransactions(parseDelimited(flat, ","));
    if (local.length > 0) {
      return NextResponse.json({ transactions: local, engine: "local-xlsx" });
    }
    if (tier === "pro" && hasApiKey()) {
      try {
        const txns = await extract(getAnthropic(), `${EXTRACT_PROMPT}\n\nStatement text:\n${flat}`);
        if (txns.length > 0) return NextResponse.json({ transactions: txns, engine: "claude-xlsx" });
      } catch (err) {
        console.error("ingest xlsx (pro) failed:", err instanceof Error ? err.message : "unknown");
      }
      return NextResponse.json(
        { error: "Couldn't find transactions in that spreadsheet." },
        { status: 422 },
      );
    }
    return proRequired("Reading this spreadsheet layout");
  }

  // --- PDF ---------------------------------------------------------------
  if (kind === "pdf") {
    if (tier !== "pro") return proRequired("Reading PDF statements");
    if (!hasApiKey()) {
      return NextResponse.json(
        { error: "Pro PDF reading requires ANTHROPIC_API_KEY to be configured on the server." },
        { status: 503 },
      );
    }

    // Pull text first: detects password-protected + scanned PDFs, and feeds the fallback.
    let pdfText = "";
    try {
      const { PDFParse, PasswordException } = await import("pdf-parse");
      const parser = new PDFParse({ data: bytes });
      try {
        const out = await parser.getText();
        pdfText = (out.text || "").trim();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (err instanceof PasswordException || /password|encrypt/i.test(msg)) {
          return NextResponse.json(
            { error: "This PDF is password-protected. Remove the password and upload it again." },
            { status: 422 },
          );
        }
      } finally {
        await parser.destroy();
      }
    } catch {
      // pdf-parse unavailable — non-fatal; the document API still tries the raw PDF.
    }

    try {
      const client = getAnthropic();
      const base64 = bytes.toString("base64");
      let txns = await extract(client, [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        },
        { type: "text", text: EXTRACT_PROMPT },
      ]);

      if (txns.length === 0 && pdfText.length > 0) {
        txns = await extract(client, `${EXTRACT_PROMPT}\n\nStatement text:\n${pdfText}`);
      }

      if (txns.length === 0) {
        if (pdfText.length === 0) {
          return NextResponse.json(
            {
              error:
                "This looks like a scanned or image-only statement — we can't read text from it yet. Upload a text-based PDF, CSV, or Excel export from your bank.",
            },
            { status: 422 },
          );
        }
        return NextResponse.json(
          { error: "Couldn't find any transactions in that statement." },
          { status: 422 },
        );
      }

      return NextResponse.json({ transactions: txns, engine: "claude-pdf" });
    } catch (err) {
      console.error("ingest pdf (pro) failed:", err instanceof Error ? err.message : "unknown");
      return NextResponse.json(
        { error: "Couldn't read that statement. Try a CSV/Excel export, or the sample." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    { error: "Unsupported file type. Upload a PDF, CSV, or Excel statement." },
    { status: 400 },
  );
}
