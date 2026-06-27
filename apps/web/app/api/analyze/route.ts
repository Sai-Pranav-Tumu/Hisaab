import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { computeEstimate } from "@hisaab/tax";
import { getAnthropic, hasApiKey, MODEL, messageText, parseJsonLoose } from "@/lib/anthropic";
import { EstimateRequestSchema, AnalysisSchema } from "@/lib/schemas";
import { computeInsights } from "@/lib/insights";
import { tierFromRequest } from "@/lib/tier";

export const runtime = "nodejs";

const SYSTEM =
  "You are a pragmatic CA-style advisor for an Indian freelancer (FY 2026-27, new regime). " +
  "You are given pre-computed figures from their bank statement — reason ONLY from these numbers. " +
  "Write a concise, specific analysis that cites the figures. Be honest about risk. " +
  "Keep each bullet to one sentence. This is planning guidance, not filed tax advice.";

const ANALYSIS_FORMAT = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: { type: "string" },
      strengths: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      actions: { type: "array", items: { type: "string" } },
    },
    required: ["headline", "strengths", "risks", "actions"],
  },
};

export async function POST(req: Request) {
  const tier = tierFromRequest(req);
  if (tier !== "pro") {
    return NextResponse.json(
      { error: "AI analysis is a Pro feature. Upgrade to Pro for realtime, tailored advice." },
      { status: 402 },
    );
  }
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: "Pro analysis requires ANTHROPIC_API_KEY to be configured on the server." },
      { status: 503 },
    );
  }

  let body;
  try {
    body = EstimateRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const today = body.today ? new Date(body.today) : new Date();
  const estimate = computeEstimate(body.rows, { basis: body.basis, annualize: body.annualize, today });
  if (!estimate) return NextResponse.json({ error: "No transactions to analyze." }, { status: 422 });
  const insights = computeInsights(body.rows);

  // Compact numeric context only — no raw descriptions beyond grouped payer keys.
  const context = JSON.stringify(
    {
      basis: body.basis,
      annualised: body.annualize,
      receipts: Math.round(estimate.receipts),
      annualReceipts: Math.round(estimate.annualReceipts),
      taxableIncome: Math.round(estimate.taxable),
      estimatedAnnualTax: Math.round(estimate.annualTax),
      advanceTaxApplies: estimate.applies,
      nextInstalment: { label: estimate.next.label, amount: Math.round(estimate.next.due) },
      totalExpensesDebited: Math.round(insights.expenseTotal),
      monthlyBusinessIncome: insights.months.map((m) => ({ month: m.month, amount: Math.round(m.business) })),
      topClientConcentrationPct: Math.round(insights.concentrationPct),
      incomeStabilityCV: insights.stability == null ? null : Number(insights.stability.toFixed(2)),
      topSources: insights.topSources.map((s) => ({ name: s.name, amount: Math.round(s.amount) })),
    },
    null,
    0,
  );

  try {
    const params = {
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: "user", content: `Figures:\n${context}\n\nWrite the analysis.` }],
      output_config: { format: ANALYSIS_FORMAT },
    };
    const res = (await getAnthropic().messages.create(params as never)) as Anthropic.Message;
    const analysis = AnalysisSchema.parse(parseJsonLoose(messageText(res)));
    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("analyze failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Analysis failed. Please try again." }, { status: 502 });
  }
}
