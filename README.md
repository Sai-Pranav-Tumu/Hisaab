# Hisaab

**Know what you owe, before the taxman does.**

Hisaab is an advance-tax estimator for Indian freelancers / creators / consultants. It reads a
bank statement, uses Claude to separate real freelance income from noise (transfers from family,
refunds, interest), and estimates the quarterly **advance tax** due under India's **new regime,
FY 2026-27**.

This repo is the production-shaped MVP that grew out of a single-file browser demo
(`reference/Hisaab.jsx`, kept as the source-of-truth for the original UI and logic).

## Tiers

| | **Free** (normal) | **Pro** |
|---|---|---|
| Engine | Local heuristics + (planned) ML — **no API calls** | Claude API, realtime, format-robust |
| Statements | Structured CSV/Excel parsed locally | PDF + CSV + Excel, **any layout** (B2B/B2C, any bank) |
| Classification | Heuristic rules | Heuristic + Claude on the *uncertain rows only* |
| Analysis | Quantitative insights report | + realtime AI narrative (strengths/risks/actions) |

Claude is used **only when necessary** — even on Pro, the local heuristic and learned
corrections run first, and only ambiguous rows are sent to the model. Tier is a mock cookie
(`tier=pro`) today; real billing (Razorpay/Stripe) plugs in later. Free runs entirely without a
key; Pro lights up when `ANTHROPIC_API_KEY` is set.

## Status — Phases 1–6 complete ✅

- **Phase 1 — Scaffold + port.** Monorepo, UI ported to Next.js + TypeScript, tax engine in a
  unit-tested package.
- **Phase 2 — Server-side classification.** `/api/classify`; the browser never calls Anthropic.
- **Phase 3 — Real ingestion.** `/api/ingest` for PDF + CSV + Excel; clear errors for scanned /
  password PDFs.
- **Phase 4 — Persistence + the moat.** Every category correction is saved (swappable local store)
  and reused to pre-classify recurring transactions — improving accuracy and cutting API over time.
- **Phase 5 — Hardened estimate.** Real net basis from deductible business expenses (per-row
  Business/Personal toggle), an "advance tax already paid" input, and a CA-ready text export.
- **Phase 6 — Polish.** Multi-statement merge (de-dupes overlaps across the year) and a downloadable
  `.ics` calendar of upcoming due dates.
- ⏳ **Next (gated):** the **ML model** for the free tier (the planned final phase). Out of scope:
  email reminders (need a provider), real auth/billing, Supabase/Postgres swap, Account Aggregator,
  and actual ITR filing.

## Layout

```
hisaab/
  apps/web/        Next.js (App Router, TS) — UI + API route handlers
    app/api/ingest       POST PDF/CSV/XLSX -> normalized transactions (local parse or Claude)
    app/api/classify     POST transactions -> {category, confidence}[] (learned + heuristic + Claude)
    app/api/estimate     POST classified txns + assumptions -> tax + schedule
    app/api/analyze      POST txns -> AI narrative from computed figures (Pro)
    app/api/corrections  POST a category correction (the moat)
    lib/                 tier, heuristic classifier, parsers, insights, store, signature, merge
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

- `npm test` → **39 tests pass** (12 tax-engine: slabs, §87A cliff, marginal relief, cess,
  schedule, net-basis deductions, advance-tax-paid; 27 web: classifier, parsers, insights,
  signature, store fold, merge).
- `npm run build` → clean typecheck + production build (6 API routes + UI).
- Runtime (no API key): the full **free-tier** flow works — local CSV/XLSX parsing, heuristic
  classification, correct estimate math over HTTP, the correction→learning loop, and graceful
  Pro fallbacks.
- The live Claude paths (`/api/classify`, `/api/ingest`, `/api/analyze` with a real key) are wired
  to `claude-sonnet-4-6` with structured outputs; add a key (below) to exercise Pro.

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
- **PII:** bank statements are sensitive. The API routes don't log raw statement contents. The
  only thing persisted is the **category-correction log** (description signatures + category), in a
  local git-ignored `data/` store; the Pro AI analysis is sent only *computed figures*, not raw rows.
- **Tax accuracy:** the new-regime FY 2026-27 math is copied verbatim from the reference and
  locked by unit tests. The UI keeps the "estimate, not tax advice" disclaimer and states its
  assumptions (new regime, no salaried standard deduction, excludes capital gains and other heads).
  A CA verifies; Hisaab never auto-files.
