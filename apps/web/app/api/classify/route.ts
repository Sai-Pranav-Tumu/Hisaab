import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getAnthropic, hasApiKey, MODEL, messageText, parseJsonLoose } from "@/lib/anthropic";
import { ClassifyRequestSchema, ClassifyResponseSchema, type Classification } from "@/lib/schemas";
import { CATS, CATEGORY_KEYS } from "@/lib/categories";

export const runtime = "nodejs";

const SYSTEM =
  "You categorize Indian bank transactions for a freelancer's tax estimate. " +
  "Categories: business_income (payment received for freelance/professional/consulting " +
  "work — client invoices, retainers, platform payouts like Upwork/Fiverr, foreign inward " +
  "remittance for services), transfer_in (money from family/friends/self), refund, interest, " +
  "expense (any money going out), other. Only credits can be income. " +
  'Return one result per transaction, keyed by the 0-based index shown ("i"), with a ' +
  "confidence between 0 and 1.";

// Batch size — far above the demo's 8, comfortably within one structured response.
const BATCH = 25;

// Structured-output schema (mirrors ClassifyResponseSchema in lib/schemas.ts).
const CLASSIFY_FORMAT = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            i: { type: "integer" },
            category: { type: "string", enum: CATEGORY_KEYS },
            confidence: { type: "number" },
          },
          required: ["i", "category", "confidence"],
        },
      },
    },
    required: ["results"],
  },
};

export async function POST(req: Request) {
  if (!hasApiKey()) {
    // The client falls back to built-in sample categories on a non-OK response.
    return NextResponse.json(
      { error: "Classifier not configured (set ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  let body;
  try {
    body = ClassifyRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const client = getAnthropic();
  const results: Classification[] = [];

  try {
    for (let b = 0; b < body.transactions.length; b += BATCH) {
      const chunk = body.transactions.slice(b, b + BATCH);
      const lines = chunk
        .map((r, j) => `${j}: "${r.desc}" | ${r.dir} | ₹${r.amount}`)
        .join("\n");

      const params = {
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM,
        messages: [{ role: "user", content: `Transactions:\n${lines}` }],
        output_config: { format: CLASSIFY_FORMAT },
      };
      const res = (await client.messages.create(params as never)) as Anthropic.Message;

      const parsed = ClassifyResponseSchema.parse(parseJsonLoose(messageText(res)));
      for (const item of parsed.results) {
        results.push({
          i: b + item.i, // offset chunk-local index back to the global index
          category: CATS[item.category] ? item.category : "other",
          confidence: typeof item.confidence === "number" ? item.confidence : 0.5,
        });
      }
    }
    return NextResponse.json({ results });
  } catch (err) {
    // Never log raw statement contents — only a terse cause.
    console.error("classify failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Classification failed." }, { status: 502 });
  }
}
