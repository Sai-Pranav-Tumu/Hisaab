# Hisaab

**Know what you owe, before the taxman does.**

Hisaab is an advance-tax estimator for Indian freelancers / creators / consultants. It reads a
bank statement, uses Claude to separate real freelance income from noise (transfers from family,
refunds, interest), and estimates the quarterly **advance tax** due under India's **new regime,
FY 2026-27**.

This repo is the production-shaped MVP that grew out of a single-file browser demo
(`reference/Hisaab.jsx`, kept as the source-of-truth for the original UI and logic).

## Status — Phases 1–3 of the handoff

- ✅ **Phase 1 — Scaffold + port.** Monorepo, UI ported to Next.js + TypeScript, tax engine
  extracted into a unit-tested package.
- ✅ **Phase 2 — Server-side classification.** `/api/classify` calls Claude with a real
  `ANTHROPIC_API_KEY` (proper batching, structured outputs). The browser never calls Anthropic.
- ✅ **Phase 3 — Real PDF ingestion.** `/api/ingest` uses Claude's document API with a `pdf-parse`
  text fallback and clear errors for scanned / password-protected PDFs.
- ⏳ **Not built yet:** Phase 4 (Supabase persistence + auth, saving category corrections),
  Phase 5 (hardened estimate: deductible-expense net basis, advance-tax-already-paid input,
  CA-ready PDF export), Phase 6 (reminders, multi-statement merge, dashboard). Account Aggregator
  and actual ITR filing remain out of scope (need partnerships + compliance).

## Layout

```
hisaab/
  apps/web/        Next.js (App Router, TS) — UI + API route handlers
    app/api/classify   POST transactions -> {category, confidence}[]   (Claude, server-side)
    app/api/ingest     POST a PDF -> normalized transactions            (Claude doc API + pdf-parse)
    app/api/estimate   POST classified txns + assumptions -> tax + schedule
  packages/tax/    FY 2026-27 tax engine + estimate math (framework-agnostic, unit-tested)
  reference/       the original single-file demo (Hisaab.jsx)
```

The tax engine lives in its own package with tests — it is the part that must never silently break.

## Getting started

Requires **Node ≥ 18** (developed on Node 24).

```bash
npm install                 # installs all workspaces

npm test                    # run the tax-engine unit tests
npm run dev                 # start the web app at http://localhost:3000
npm run build               # typecheck + production build
npm run verify              # tests + build in one go (CI-style gate)
```

### Verified

- `npm test` → 11/11 tax-engine tests pass (slab boundaries, §87A cliff, marginal
  relief, cess, advance-tax schedule).
- `npm run build` → clean typecheck + production build of all three API routes and the UI.
- Runtime (no API key): homepage serves, `/api/estimate` returns correct figures over HTTP,
  and `/api/classify` + `/api/ingest` return clear 503s so the UI falls back to the built-in
  sample categories — i.e. the sample-data flow works end-to-end without a key.
- The live Claude path (`/api/classify`, `/api/ingest` with a real key) is wired to
  `claude-sonnet-4-6` with structured outputs; add a key (below) to exercise it.

Open http://localhost:3000 and click **"Try it with sample data"**. Without an API key it
classifies using built-in fallback categories so you can still see the full flow and the math.

## Configuration

Live Claude classification (`/api/classify`) and PDF extraction (`/api/ingest`) need an API key:

```bash
cp .env.example apps/web/.env.local
# then edit apps/web/.env.local and set:
# ANTHROPIC_API_KEY=sk-ant-...
```

Get a key at <https://console.anthropic.com/settings/keys>. Classification/extraction use
`claude-sonnet-4-6`.

## Guardrails

- **Secrets:** `ANTHROPIC_API_KEY` is server-side only and lives in `apps/web/.env.local`.
  `.gitignore` excludes all `.env*` files — never commit a real key.
- **PII:** bank statements are sensitive. The API routes don't log raw statement contents, and
  nothing is persisted yet (persistence arrives in Phase 4).
- **Tax accuracy:** the new-regime FY 2026-27 math is copied verbatim from the reference and
  locked by unit tests. The UI keeps the "estimate, not tax advice" disclaimer and states its
  assumptions (new regime, no salaried standard deduction, excludes capital gains and other heads).
  A CA verifies; Hisaab never auto-files.
