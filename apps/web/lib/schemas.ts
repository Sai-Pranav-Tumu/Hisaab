import { z } from "zod";
import { CATEGORY_KEYS } from "./categories";

/* ------------------------------------------------------------------ *
 * Shared request/response contracts for the API routes.
 *
 * The *Response schemas double as the Claude structured-output schemas
 * (via zodOutputFormat) so model output is validated at the tool-call
 * layer — no fragile regex-stripping of markdown fences.
 * ------------------------------------------------------------------ */

export const DirectionSchema = z.enum(["credit", "debit"]);

const categoryValues = CATEGORY_KEYS as [string, ...string[]];
export const CategorySchema = z.enum(categoryValues);

/** A raw (unclassified) transaction, as extracted from a statement. */
export const RawTxnSchema = z.object({
  date: z.string(),
  desc: z.string(),
  amount: z.number(),
  dir: DirectionSchema,
});

/* --- /api/classify --------------------------------------------------- */

/** Input: only the fields the classifier needs (no dates, to minimise data exposure). */
export const ClassifyRequestSchema = z.object({
  transactions: z
    .array(
      z.object({
        desc: z.string(),
        dir: DirectionSchema,
        amount: z.number(),
      }),
    )
    .min(1)
    .max(500),
});
export type ClassifyRequest = z.infer<typeof ClassifyRequestSchema>;

/** One classification, keyed by the transaction's index in the request batch. */
export const ClassificationSchema = z.object({
  i: z.number().int(),
  category: CategorySchema,
  confidence: z.number(),
});
export type Classification = z.infer<typeof ClassificationSchema>;

/** Structured-output / response shape for /api/classify. */
export const ClassifyResponseSchema = z.object({
  results: z.array(ClassificationSchema),
});
export type ClassifyResponse = z.infer<typeof ClassifyResponseSchema>;

/* --- /api/ingest ----------------------------------------------------- */

/** Structured-output / response shape for /api/ingest. */
export const IngestResponseSchema = z.object({
  transactions: z.array(RawTxnSchema),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;

/* --- /api/estimate --------------------------------------------------- */

export const TxnRowSchema = z.object({
  date: z.string(),
  desc: z.string().optional(),
  amount: z.number(),
  dir: DirectionSchema,
  category: z.string(),
  confidence: z.number(),
});

export const EstimateRequestSchema = z.object({
  rows: z.array(TxnRowSchema).min(1).max(5000),
  basis: z.enum(["presumptive", "net"]),
  annualize: z.boolean(),
  /** Optional ISO date for "today"; defaults to the server's current date. */
  today: z.string().optional(),
});
export type EstimateRequest = z.infer<typeof EstimateRequestSchema>;

/* --- /api/analyze (Pro) ---------------------------------------------- */

/** Structured-output / response shape for the Pro AI analysis. */
export const AnalysisSchema = z.object({
  headline: z.string(),
  strengths: z.array(z.string()),
  risks: z.array(z.string()),
  actions: z.array(z.string()),
});
export type Analysis = z.infer<typeof AnalysisSchema>;
