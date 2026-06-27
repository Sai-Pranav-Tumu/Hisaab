import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getAnthropic, hasApiKey, MODEL, messageText, parseJsonLoose } from "@/lib/anthropic";
import { ClassifyRequestSchema, ClassifyResponseSchema, type Classification } from "@/lib/schemas";
import { CATS, CATEGORY_KEYS } from "@/lib/categories";
import { tierFromRequest } from "@/lib/tier";
import { heuristicClassify, uncertainIndices } from "@/lib/classify-heuristic";

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
  let body;
  try {
    body = ClassifyRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const tier = tierFromRequest(req);
  const heuristic = heuristicClassify(body.transactions);

  // Free tier (or pro without a key configured): local heuristics only, no API call.
  if (tier !== "pro" || !hasApiKey()) {
    return NextResponse.json({ results: heuristic, engine: "heuristic" });
  }

  // Pro: send ONLY the uncertain rows to Claude, then merge over the heuristic.
  const uncertain = uncertainIndices(heuristic);
  if (uncertain.length === 0) {
    return NextResponse.json({ results: heuristic, engine: "heuristic" });
  }

  try {
    const client = getAnthropic();
    const subset = uncertain.map((globalIndex) => ({
      globalIndex,
      ...body.transactions[globalIndex]!,
    }));
    const refined = new Map<number, Classification>();

    for (let b = 0; b < subset.length; b += BATCH) {
      const chunk = subset.slice(b, b + BATCH);
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
        const original = chunk[item.i];
        if (!original) continue; // model returned an out-of-range index — ignore
        refined.set(original.globalIndex, {
          i: original.globalIndex,
          category: CATS[item.category] ? item.category : "other",
          confidence: typeof item.confidence === "number" ? item.confidence : 0.6,
        });
      }
    }

    const merged = heuristic.map((h) => refined.get(h.i) ?? h);
    return NextResponse.json({ results: merged, engine: "hybrid" });
  } catch (err) {
    // Never log raw statement contents — only a terse cause. Degrade to heuristic.
    console.error("classify (pro) failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ results: heuristic, engine: "heuristic-fallback" });
  }
}
