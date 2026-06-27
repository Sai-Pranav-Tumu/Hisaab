import { NextResponse } from "next/server";
import { computeEstimate } from "@hisaab/tax";
import { EstimateRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";

/**
 * Server-authoritative estimate. The UI computes the same figures live via
 * @hisaab/tax for instant feedback; this endpoint exposes the identical
 * calculation over HTTP (one implementation, no drift).
 */
export async function POST(req: Request) {
  let body;
  try {
    body = EstimateRequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const today = body.today ? new Date(body.today) : new Date();
  const estimate = computeEstimate(body.rows, {
    basis: body.basis,
    annualize: body.annualize,
    today,
  });

  if (!estimate) {
    return NextResponse.json({ error: "No transactions to estimate." }, { status: 422 });
  }

  return NextResponse.json({ estimate });
}
