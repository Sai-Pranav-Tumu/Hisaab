import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getAnthropic, hasApiKey, MODEL, messageText, parseJsonLoose } from "@/lib/anthropic";
import { IngestResponseSchema } from "@/lib/schemas";
import type { RawTxn } from "@/lib/sample";

export const runtime = "nodejs";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

const EXTRACT_PROMPT =
  "This is a bank statement. Extract every transaction. For each, return: " +
  "date (YYYY-MM-DD), a short description, amount as a positive number (no currency symbol " +
  "or commas), and dir ('credit' for money received, 'debit' for money spent). " +
  "Preserve statement order. If a value is unclear, make your best inference.";

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

export async function POST(req: Request) {
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: "PDF reading needs an API key (set ANTHROPIC_API_KEY). Try the sample data instead." },
      { status: 503 },
    );
  }

  // --- read + validate the upload ---
  let bytes: Buffer;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That PDF is too large (max 15 MB)." }, { status: 413 });
    }
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Couldn't read the uploaded file." }, { status: 400 });
  }

  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return NextResponse.json({ error: "That doesn't look like a PDF." }, { status: 400 });
  }

  // --- pull text first: detects password-protected + scanned PDFs, and feeds the fallback ---
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
      // Non-fatal: fall through and let the document API try the raw PDF.
    } finally {
      await parser.destroy();
    }
  } catch {
    // pdf-parse unavailable — non-fatal; the document API still tries the raw PDF.
  }

  const client = getAnthropic();

  try {
    // Primary: hand the raw PDF to Claude's document API (best with tables/layout).
    const base64 = bytes.toString("base64");
    let txns = await extract(client, [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      },
      { type: "text", text: EXTRACT_PROMPT },
    ]);

    // Fallback: if the document pass found nothing but we have extracted text, retry on the text.
    if (txns.length === 0 && pdfText.length > 0) {
      txns = await extract(client, `${EXTRACT_PROMPT}\n\nStatement text:\n${pdfText}`);
    }

    if (txns.length === 0) {
      if (pdfText.length === 0) {
        return NextResponse.json(
          {
            error:
              "This looks like a scanned or image-only statement — we can't read text from it yet. Upload a text-based PDF exported from your bank.",
          },
          { status: 422 },
        );
      }
      return NextResponse.json(
        { error: "Couldn't find any transactions in that statement." },
        { status: 422 },
      );
    }

    return NextResponse.json({ transactions: txns });
  } catch (err) {
    console.error("ingest failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      { error: "Couldn't read that statement. Try a text-based (non-scanned) PDF, or the sample." },
      { status: 502 },
    );
  }
}
