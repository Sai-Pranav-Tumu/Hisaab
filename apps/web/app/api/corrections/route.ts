import { NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";
import { descSignature } from "@/lib/signature";
import { DirectionSchema, CategorySchema } from "@/lib/schemas";

export const runtime = "nodejs";

const Body = z.object({
  desc: z.string(),
  dir: DirectionSchema,
  category: CategorySchema,
});

/** Save a user category correction (the moat). Fire-and-forget from the UI. */
export async function POST(req: Request) {
  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const signature = descSignature(body.desc);
  if (!signature) return NextResponse.json({ ok: true, learned: false });

  try {
    await getStore().saveCorrection({
      signature,
      category: body.category,
      dir: body.dir,
      at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, learned: true });
  } catch (err) {
    console.error("save correction failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
