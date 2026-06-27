# Hisaab — Claude Code handoff

You are taking over an in-progress product called **Hisaab**: an advance-tax estimator for
**Indian freelancers / creators / consultants**. It reads a bank statement, uses Claude to
separate real freelance income from noise (transfers from family, refunds, interest), and
estimates the quarterly **advance tax** due under India's **new regime, FY 2026-27**.

Your job: take it from a single-file browser demo to a real, production-shaped MVP — backend,
persistence, accounts — and leave the regulated pieces (Account Aggregator, actual ITR filing)
clearly stubbed as future work. Build incrementally, commit often, ask me before destructive
actions.

---

## 1. Where things stand — READ THIS FIRST

The entire current state is **one React file**: `reference/Hisaab.jsx`.

Before placing it: download `Hisaab.jsx` from the chat, create a project folder `hisaab/`, and
put the file at `hisaab/reference/Hisaab.jsx`. Then open Claude Code in `hisaab/` and read that
file in full — it is the source of truth for the current UI and logic.

### What the reference file already does
- Single `<Hisaab/>` React component (default export). Inline styles, Google Fonts
  (Space Grotesk / Inter / JetBrains Mono), `lucide-react` icons.
- Flow: load sample data **or** upload a PDF → classify each transaction → show a hero number
  (next advance-tax instalment + quarterly timeline) → income split → editable transaction table
  → assumptions panel.
- **Tax engine is production-correct** (`computeAnnualTax`): seven new-regime slabs, the ₹60,000
  §87A rebate (income ≤ ₹12L → zero tax), marginal relief above ₹12L, 4% cess, and the
  15/45/75/100% advance-tax schedule (due 15 Jun / 15 Sep / 15 Dec / 15 Mar). **Keep this math.**
- Low-confidence credits get flagged and are user-correctable; tax recomputes live.

### What is demo-grade and MUST change
- **API call is client-side with no key.** It `fetch`es `api.anthropic.com` directly and only
  works inside the Claude.ai artifact sandbox. In a real app this must move server-side behind a
  real `ANTHROPIC_API_KEY`. This is the single most important refactor.
- `max_tokens: 1000` + batches of 8 transactions → brittle for large statements. Backend should
  batch properly and not truncate.
- PDF extraction leans entirely on Claude reading the PDF; scanned/image or password-protected
  PDFs fail. Needs a real ingestion path + OCR fallback.
- "Net basis = 65% of receipts" is a hardcoded placeholder. Real net income = receipts minus
  *deductible business* expenses. The classifier already tags `expense` debits — but doesn't yet
  split business vs personal. Wire that in.
- No persistence, no auth, no accounts, and — critically — **no storage of user category
  corrections**. That correction history is the compounding moat; it must be saved.
- Out of scope but be aware: capital gains / other income heads, GST, salaried standard deduction
  (freelancers don't get it — current code correctly omits it).

---

## 2. Target architecture (MVP)

```
hisaab/
  apps/web/        Vite + React + TypeScript  (port the reference UI here)
  apps/api/        Node + TypeScript (Express or Next route handlers)
    /ingest        POST a PDF -> normalized transactions
    /classify      POST transactions -> {category, confidence}[] via Anthropic SDK
    /estimate      POST classified txns + assumptions -> tax + advance-tax schedule
  packages/tax/    the tax engine (ported from reference, with tests)
  .env             ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY  (never commit)
```

Keep the tax engine in its own package with unit tests — it's the part that must never silently
break.

---

## 3. Build order (phases)

1. **Scaffold + port.** Stand up the web app, drop in the reference UI, get it running locally.
2. **Move classification server-side.** `/classify` uses `@anthropic-ai/sdk` (model
   `claude-sonnet-4-6`), proper batching, key from env. Frontend calls your API, never Anthropic
   directly.
3. **Real PDF ingestion.** `/ingest` accepts a PDF, extracts transactions (Claude document API +
   a parser like `pdf-parse` as fallback), normalizes to `{date, desc, amount, dir}`, and returns
   clear errors for scanned/password PDFs.
4. **Persistence + accounts.** Supabase/Postgres. Tables: `users`, `statements`, `transactions`,
   `category_overrides`. Save **every** correction the user makes (the moat). Add auth (email OTP).
5. **Harden the estimate.** Keep the correct FY 2026-27 math; add proper net-basis using
   classified deductible business expenses; add "advance tax already paid" and "other income"
   inputs so it shows what's *actually* due now; add a clean PDF summary export to hand to a CA.
6. **Polish.** Due-date reminders (email), merge multiple statements across the year, simple
   dashboard.

**Future / flagged (do NOT build in MVP — needs partnerships + compliance):**
- Replace PDF uploads with **Account Aggregator** (Setu / Finvu) for consented bank data.
- Actual ITR filing via a partner (e.g. Quicko API). Regulated; out of scope.

---

## 4. Tools / MCP / extensions to set up

- **Filesystem** (built in) — scaffolding and edits.
- **GitHub MCP** — create the repo, commit per phase, open PRs.
- **Supabase MCP** (or Postgres MCP) — provision the DB, run migrations, manage schema.
- **npm packages:** `@anthropic-ai/sdk`, `vite`, `react`, `typescript`, `express` (or Next),
  `pdf-parse`, `zod`, `@supabase/supabase-js`, `lucide-react`, a test runner (`vitest`).
- **Node ≥ 18** required.
- Secrets in `.env`, add a `.gitignore`, never commit keys.

If a needed MCP connector isn't enabled, tell me which one and how to add it before proceeding.

---

## 5. Guardrails (non-negotiable)

- **Security:** never hardcode or commit API keys. Bank statements are sensitive financial PII —
  encrypt at rest, don't log raw statement contents, minimize retention, write honest privacy copy.
- **Tax accuracy:** keep the "estimate, not tax advice" disclaimer and state assumptions (new
  regime, no standard deduction, excludes capital gains/other heads). A CA verifies; we never
  auto-file.
- **Reference constants (do not re-derive incorrectly):** FY 2026-27 new-regime slabs are
  unchanged from 2025-26 — nil ≤ ₹4L, 5% ₹4–8L, 10% ₹8–12L, 15% ₹12–16L, 20% ₹16–20L,
  25% ₹20–24L, 30% > ₹24L; §87A rebate up to ₹60,000 makes taxable income ≤ ₹12L zero-tax;
  4% cess; advance tax applies when annual liability > ₹10,000; 44ADA presumptive = tax on 50% of
  receipts, payable in full by 15 Mar.

---

## 6. Start here

1. Read `reference/Hisaab.jsx` end to end.
2. Propose the scaffold and the DB schema, and wait for my OK.
3. Initialize the repo (GitHub MCP) and build Phase 1, then Phase 2.
4. After each phase: run it, show me, commit. Don't jump ahead to Account Aggregator or filing.

Begin by summarizing, in your own words, the current state and your Phase 1 plan.
