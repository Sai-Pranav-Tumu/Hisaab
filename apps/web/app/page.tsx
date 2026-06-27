"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Upload, Sparkles, AlertTriangle, RotateCcw, Zap, Download, CalendarPlus } from "lucide-react";
import type { Tier } from "@/lib/tier";
import { isBusinessExpense } from "@/lib/classify-heuristic";
import { mergeRows } from "@/lib/merge";
import { computeEstimate, type Basis, type TxnRow } from "@hisaab/tax";
import { CATS } from "@/lib/categories";
import { fmtINR, fmtDate } from "@/lib/format";
import { SAMPLE, SAMPLE_FALLBACK, type RawTxn } from "@/lib/sample";
import type { Classification } from "@/lib/schemas";
import { Field } from "@/components/Field";
import { Toggle } from "@/components/Toggle";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import {
  INK,
  PAPER,
  SURFACE,
  ACCENT,
  WARN,
  WARN_SOFT,
  MUTED,
  LINE,
  MONO,
  DISPLAY,
  BODY,
} from "@/lib/theme";

/* ------------------------------------------------------------------ *
 * Hisaab — advance-tax clarity for freelancers (FY 2026-27, new regime)
 * Upload a statement (or load sample) -> Claude (server-side) separates
 * real business income from noise -> estimates quarterly advance tax.
 * ------------------------------------------------------------------ */

type Phase = "idle" | "working" | "done" | "error";

/** Call the server classifier (which batches + validates). Never hits Anthropic directly. */
async function classify(raw: RawTxn[]): Promise<Classification[]> {
  const res = await fetch("/api/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactions: raw.map((r) => ({ desc: r.desc, dir: r.dir, amount: r.amount })),
    }),
  });
  if (!res.ok) throw new Error("classify failed");
  const data = (await res.json()) as { results: Classification[] };
  return data.results;
}

export default function Hisaab() {
  const [rows, setRows] = useState<TxnRow[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const [basis, setBasis] = useState<Basis>("presumptive");
  const [annualize, setAnnualize] = useState(true);
  const [advancePaid, setAdvancePaid] = useState(0);
  const [tier, setTier] = useState<Tier>("free");
  const fileRef = useRef<HTMLInputElement>(null);
  const appendRef = useRef(false); // whether the next upload merges into existing rows

  // Read the mock entitlement on mount (real billing swaps in later).
  useEffect(() => {
    setTier(/(?:^|;\s*)tier=pro(?:;|$)/.test(document.cookie) ? "pro" : "free");
  }, []);

  function toggleTier() {
    const next: Tier = tier === "pro" ? "free" : "pro";
    document.cookie = `tier=${next}; path=/; max-age=${60 * 60 * 24 * 365}`;
    setTier(next);
  }

  async function run(raw: RawTxn[], fallback: string[] | null, append = false) {
    const hadRows = rows.length > 0;
    setPhase("working");
    setNote("");
    try {
      const cls = await classify(raw);
      const out: TxnRow[] = raw.map((r, i) => {
        const hit = cls.find((c) => c.i === i);
        return {
          ...r,
          category: hit && CATS[hit.category] ? hit.category : "other",
          confidence: typeof hit?.confidence === "number" ? hit.confidence : 0.5,
          deductible: r.dir === "debit" ? isBusinessExpense(r.desc) : undefined,
        };
      });
      setRows((prev) => (append && prev.length ? mergeRows([...prev, ...out]) : out));
      setPhase("done");
    } catch {
      if (fallback) {
        const fb: TxnRow[] = raw.map((r, i) => ({
          ...r,
          category: fallback[i] ?? "other",
          confidence: 0.9,
          deductible: r.dir === "debit" ? isBusinessExpense(r.desc) : undefined,
        }));
        setRows((prev) => (append && prev.length ? mergeRows([...prev, ...fb]) : fb));
        setNote(
          "Couldn't reach the classifier — showing the sample with built-in categories so you can still see the math.",
        );
        setPhase("done");
      } else if (append && hadRows) {
        setNote("Couldn't read that statement — kept your existing data.");
        setPhase("done");
      } else {
        setNote(
          "Couldn't read that file. Bank-statement PDFs vary a lot; try the sample to see the flow, or a text-based (non-scanned, non-password) PDF.",
        );
        setPhase("error");
      }
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const append = appendRef.current;
    const hadRows = rows.length > 0;
    setPhase("working");
    setNote("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/ingest", { method: "POST", body: fd });
      const data = (await r.json().catch(() => ({}))) as {
        transactions?: RawTxn[];
        error?: string;
      };
      if (!r.ok) throw new Error(data.error || "ingest failed");
      const parsed = data.transactions;
      if (!parsed || parsed.length === 0) throw new Error("No transactions found in that file.");
      await run(parsed, null, append);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Couldn't read that file. Bank-statement PDFs vary a lot; try the sample, or a text-based (non-scanned, non-password) PDF.";
      setNote(append && hadRows ? `${message} Kept your existing data.` : message);
      setPhase(append && hadRows ? "done" : "error");
    } finally {
      // allow re-selecting the same file
      e.target.value = "";
      appendRef.current = false;
    }
  }

  function setCategory(idx: number, cat: string) {
    const row = rows[idx];
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, category: cat, confidence: 1 } : r)));
    // Persist the correction (the moat) — fire-and-forget. Recurs apply automatically next time.
    if (row?.desc) {
      void fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ desc: row.desc, dir: row.dir, category: cat }),
      }).catch(() => {});
    }
  }

  function setDeductible(idx: number, value: boolean) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, deductible: value } : r)));
  }

  function reset() {
    setRows([]);
    setPhase("idle");
    setNote("");
  }

  // --- derived figures (shared engine in @hisaab/tax) -----------------
  const calc = useMemo(() => {
    if (rows.length === 0) return null;
    return computeEstimate(rows, { basis, annualize, today: new Date(), advanceTaxPaid: advancePaid });
  }, [rows, basis, annualize, advancePaid]);

  function downloadSummary() {
    if (!calc) return;
    const lines = [
      "HISAAB — Advance-tax estimate (FY 2026-27, new regime)",
      `Generated: ${new Date().toLocaleDateString("en-IN")}`,
      "",
      `Income basis: ${
        basis === "presumptive"
          ? "Presumptive 44ADA (tax on 50% of receipts)"
          : "Net basis (receipts minus deductible business expenses)"
      }`,
      `Annualised: ${annualize ? `yes (×${calc.factor.toFixed(2)} from ${Math.round(calc.spanDays)} days)` : "no"}`,
      "",
      `Total credits: ${fmtINR(calc.totalCredits)}`,
      `Business income (receipts): ${fmtINR(calc.receipts)}`,
      `Ignored (transfers/refunds/interest): ${fmtINR(calc.noise)}`,
      `Estimated annual receipts: ${fmtINR(calc.annualReceipts)}`,
      ...(basis === "net"
        ? [`Deductible business expenses (annual): ${fmtINR(calc.annualDeductibleExpenses)}`]
        : []),
      `Taxable income: ${fmtINR(calc.taxable)}`,
      `Estimated annual tax: ${fmtINR(calc.annualTax)}`,
      `Advance tax already paid: ${fmtINR(calc.advanceTaxPaid)}`,
      `Remaining for the year: ${fmtINR(calc.totalRemaining)}`,
      "",
      "Advance-tax schedule:",
      ...calc.schedule.map(
        (s) =>
          `  ${s.label} (${Math.round(s.cum * 100)}%): ${fmtINR(s.due)}${s.status === "past" ? " [past]" : ""}`,
      ),
      "",
      "Transactions:",
      ...rows.map(
        (r) =>
          `  ${r.date}  ${r.dir === "credit" ? "+" : "-"}${fmtINR(r.amount)}  ${(CATS[r.category] || CATS.other).label}${
            r.dir === "debit" ? (r.deductible ? " (business)" : " (personal)") : ""
          }  ${r.desc ?? ""}`,
      ),
      "",
      "This is an estimate to help you plan, not tax advice or a filed return. New regime; no",
      "salaried standard deduction; excludes capital gains and other heads. Confirm with a CA",
      "and pay through the income-tax portal.",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hisaab-tax-summary.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadCalendar() {
    if (!calc || !calc.applies) return;
    const upcoming = calc.schedule.filter((s) => s.status === "upcoming");
    const events = upcoming.map((s) =>
      [
        "BEGIN:VEVENT",
        `UID:hisaab-${s.iso}@hisaab.app`,
        `DTSTART;VALUE=DATE:${s.iso.replace(/-/g, "")}`,
        `SUMMARY:Advance tax due ${fmtINR(s.due)} (Hisaab estimate)`,
        `DESCRIPTION:Cumulative ${Math.round(s.cum * 100)}% instalment for FY 2026-27 — estimate from Hisaab. Confirm with your CA and pay via the income-tax portal.`,
        "END:VEVENT",
      ].join("\r\n"),
    );
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Hisaab//Advance Tax//EN",
      "CALSCALE:GREGORIAN",
      ...events,
      "END:VCALENDAR",
    ].join("\r\n");
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hisaab-advance-tax.ics";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      style={{
        background: PAPER,
        color: INK,
        fontFamily: BODY,
        minHeight: "100%",
        borderRadius: 16,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');
        .hb-num{font-family:${MONO};font-variant-numeric:tabular-nums;letter-spacing:-.02em}
        .hb-btn{transition:transform .12s ease, box-shadow .12s ease}
        .hb-btn:hover{transform:translateY(-1px)}
        .hb-btn:active{transform:translateY(0)}
        .hb-row{transition:background .12s ease}
        .hb-row:hover{background:#FAFBFA}
        select{font-family:${BODY}}
        @media (prefers-reduced-motion: reduce){.hb-btn,.hb-row{transition:none}}
      `}</style>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 22px 40px" }}>
        {/* masthead */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: DISPLAY,
                fontWeight: 700,
                fontSize: 30,
                letterSpacing: "-.02em",
              }}
            >
              Hisaab
            </div>
            <div style={{ color: MUTED, fontSize: 14, marginTop: 2 }}>
              Know what you owe, before the taxman does.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={toggleTier}
              className="hb-btn"
              title={
                tier === "pro"
                  ? "Pro: realtime Claude analysis of any statement format. Click to switch to Free."
                  : "Free: local + ML report, no AI calls. Click to enable Pro."
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                borderRadius: 999,
                padding: "4px 10px",
                border: tier === "pro" ? "none" : `1px solid ${LINE}`,
                background: tier === "pro" ? ACCENT : SURFACE,
                color: tier === "pro" ? "#fff" : MUTED,
              }}
            >
              <Zap size={12} /> {tier === "pro" ? "PRO" : "FREE"}
            </button>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: MUTED,
                border: `1px solid ${LINE}`,
                borderRadius: 999,
                padding: "4px 10px",
              }}
            >
              FY 2026-27 · new regime
            </div>
          </div>
        </div>

        {/* intake */}
        {phase === "idle" || phase === "error" ? (
          <div
            style={{
              marginTop: 22,
              background: SURFACE,
              border: `1px solid ${LINE}`,
              borderRadius: 14,
              padding: 22,
            }}
          >
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 17 }}>
              Start with one bank statement
            </div>
            <p style={{ color: MUTED, fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
              Your income lives in a pile of UPI and bank credits — mixed with refunds, interest, and
              money from family. Hisaab pulls out the part that&apos;s actually taxable and works out
              your advance tax for the year.
            </p>

            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <button
                className="hb-btn"
                onClick={() => {
                  appendRef.current = false;
                  fileRef.current?.click();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: SURFACE,
                  color: INK,
                  border: `1px solid ${LINE}`,
                  borderRadius: 10,
                  padding: "11px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Upload size={16} /> Upload statement (PDF, CSV, Excel)
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.csv,.tsv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={onFile}
                style={{ display: "none" }}
              />
              <button
                className="hb-btn"
                onClick={() => run(SAMPLE, SAMPLE_FALLBACK)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: ACCENT,
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: "11px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 1px 0 rgba(0,0,0,.04)",
                }}
              >
                <Sparkles size={16} /> Try it with sample data
              </button>
            </div>

            {note && (
              <div
                style={{
                  marginTop: 14,
                  display: "flex",
                  gap: 8,
                  color: WARN,
                  background: WARN_SOFT,
                  border: `1px solid ${WARN}33`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 13,
                }}
              >
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {note}
              </div>
            )}
            <div style={{ marginTop: 14, fontSize: 12, color: MUTED }}>
              {tier === "pro"
                ? "Pro: PDFs and any layout are read in realtime by Claude; CSV & Excel parse locally."
                : "Free: CSV & Excel parse locally (no AI). PDFs and unusual layouts need Pro."}{" "}
              Nothing is stored — the statement is read once to classify transactions.
            </div>
          </div>
        ) : null}

        {/* working */}
        {phase === "working" && (
          <div
            style={{
              marginTop: 22,
              background: SURFACE,
              border: `1px solid ${LINE}`,
              borderRadius: 14,
              padding: 30,
              textAlign: "center",
            }}
          >
            <div style={{ fontFamily: DISPLAY, fontWeight: 600 }}>Reading the statement…</div>
            <div style={{ color: MUTED, fontSize: 13, marginTop: 6 }}>
              Separating real income from the noise.
            </div>
          </div>
        )}

        {/* result */}
        {phase === "done" && calc && (
          <>
            {note && (
              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  gap: 8,
                  color: WARN,
                  background: WARN_SOFT,
                  border: `1px solid ${WARN}33`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 13,
                }}
              >
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {note}
              </div>
            )}

            {/* HERO — the number + the quarterly timeline (the signature) */}
            <div
              style={{
                marginTop: 18,
                background: INK,
                color: "#fff",
                borderRadius: 16,
                padding: "26px 24px",
              }}
            >
              {calc.applies ? (
                <>
                  <div
                    style={{
                      fontSize: 12,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "#9CA6B0",
                    }}
                  >
                    Next advance-tax instalment · due {calc.next.label}{" "}
                    {calc.next.iso.startsWith("2027") ? "'27" : "'26"}
                  </div>
                  <div
                    className="hb-num"
                    style={{ fontSize: 52, fontWeight: 700, marginTop: 6, lineHeight: 1 }}
                  >
                    {fmtINR(calc.nextNetDue)}
                  </div>
                  <div style={{ color: "#9CA6B0", fontSize: 13, marginTop: 8 }}>
                    cumulative {Math.round(calc.next.cum * 100)}% of an estimated{" "}
                    <span className="hb-num" style={{ color: "#fff" }}>
                      {fmtINR(calc.annualTax)}
                    </span>{" "}
                    for the year
                    {calc.advanceTaxPaid > 0 && (
                      <>
                        {" "}
                        ·{" "}
                        <span className="hb-num" style={{ color: "#fff" }}>
                          {fmtINR(calc.advanceTaxPaid)}
                        </span>{" "}
                        already paid, {fmtINR(calc.totalRemaining)} left
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div
                    style={{
                      fontSize: 12,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "#9CA6B0",
                    }}
                  >
                    Estimated advance tax
                  </div>
                  <div
                    className="hb-num"
                    style={{ fontSize: 52, fontWeight: 700, marginTop: 6, lineHeight: 1 }}
                  >
                    ₹0
                  </div>
                  <div style={{ color: "#9CA6B0", fontSize: 13, marginTop: 8 }}>
                    Your estimated income keeps you under the ₹12L rebate — no advance tax due. Keep
                    an eye on it as receipts grow.
                  </div>
                </>
              )}

              {/* quarter timeline */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4,1fr)",
                  gap: 8,
                  marginTop: 20,
                }}
              >
                {calc.schedule.map((s) => {
                  const isNext = calc.applies && s.label === calc.next.label;
                  const missed = calc.applies && s.status === "past";
                  return (
                    <div
                      key={s.label}
                      style={{
                        borderRadius: 10,
                        padding: "10px 10px 11px",
                        background: isNext ? ACCENT : "rgba(255,255,255,.06)",
                        border: missed ? `1px solid ${WARN}` : "1px solid transparent",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          color: isNext ? "#EAF7F2" : "#9CA6B0",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>{s.label}</span>
                        <span>{Math.round(s.cum * 100)}%</span>
                      </div>
                      <div
                        className="hb-num"
                        style={{ fontSize: 14, fontWeight: 700, marginTop: 4, color: "#fff" }}
                      >
                        {calc.applies ? fmtINR(s.due) : "—"}
                      </div>
                      {missed && (
                        <div style={{ fontSize: 10, color: WARN, marginTop: 2 }}>
                          missed · 234C interest
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* income clarity */}
            <div
              style={{
                marginTop: 16,
                background: SURFACE,
                border: `1px solid ${LINE}`,
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 15 }}>
                What&apos;s actually taxable
              </div>
              <p style={{ color: MUTED, fontSize: 13, marginTop: 4 }}>
                Out of <span className="hb-num">{fmtINR(calc.totalCredits)}</span> credited, only the
                freelance income counts.
              </p>
              <div
                style={{
                  display: "flex",
                  height: 12,
                  borderRadius: 999,
                  overflow: "hidden",
                  marginTop: 14,
                  border: `1px solid ${LINE}`,
                }}
              >
                <div
                  style={{
                    width: `${calc.totalCredits ? (calc.receipts / calc.totalCredits) * 100 : 0}%`,
                    background: ACCENT,
                  }}
                />
                <div
                  style={{
                    width: `${calc.totalCredits ? (calc.noise / calc.totalCredits) * 100 : 0}%`,
                    background: "#D7DAD5",
                  }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 10,
                  fontSize: 13,
                }}
              >
                <span>
                  <span style={{ color: ACCENT, fontWeight: 600 }}>● </span>Business income{" "}
                  <span className="hb-num">{fmtINR(calc.receipts)}</span>
                </span>
                <span style={{ color: MUTED }}>
                  <span style={{ color: "#C2C6C0" }}>● </span>Ignored (transfers, refunds, interest){" "}
                  <span className="hb-num">{fmtINR(calc.noise)}</span>
                </span>
              </div>

              {/* assumptions */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
                  gap: 12,
                  marginTop: 18,
                  paddingTop: 16,
                  borderTop: `1px dashed ${LINE}`,
                }}
              >
                <Field label="Annualise from this period">
                  <Toggle
                    on={annualize}
                    setOn={setAnnualize}
                    onLabel={`×${calc.factor.toFixed(1)} (${Math.round(calc.spanDays)}d)`}
                    offLabel="as-is"
                  />
                </Field>
                <Field label="Income basis">
                  <select
                    value={basis}
                    onChange={(e) => setBasis(e.target.value as Basis)}
                    style={{
                      width: "100%",
                      padding: "7px 8px",
                      borderRadius: 8,
                      border: `1px solid ${LINE}`,
                      fontSize: 13,
                      background: "#fff",
                    }}
                  >
                    <option value="presumptive">Presumptive 44ADA — tax on 50%</option>
                    <option value="net">Net basis — receipts minus expenses</option>
                  </select>
                </Field>
                <Field label="Advance tax already paid">
                  <input
                    type="number"
                    min={0}
                    value={advancePaid || ""}
                    onChange={(e) => setAdvancePaid(Math.max(0, Number(e.target.value) || 0))}
                    placeholder="₹0"
                    style={{
                      width: "100%",
                      padding: "7px 8px",
                      borderRadius: 8,
                      border: `1px solid ${LINE}`,
                      fontSize: 13,
                      background: "#fff",
                    }}
                  />
                </Field>
                <Field label="Est. annual receipts">
                  <div className="hb-num" style={{ fontSize: 15, fontWeight: 700, paddingTop: 6 }}>
                    {fmtINR(calc.annualReceipts)}
                  </div>
                </Field>
                {basis === "net" && (
                  <Field label="Deductible expenses (annual)">
                    <div className="hb-num" style={{ fontSize: 15, fontWeight: 700, paddingTop: 6 }}>
                      {fmtINR(calc.annualDeductibleExpenses)}
                    </div>
                  </Field>
                )}
                <Field label="Taxable income">
                  <div className="hb-num" style={{ fontSize: 15, fontWeight: 700, paddingTop: 6 }}>
                    {fmtINR(calc.taxable)}
                  </div>
                </Field>
              </div>
            </div>

            {/* transactions */}
            <div
              style={{
                marginTop: 16,
                background: SURFACE,
                border: `1px solid ${LINE}`,
                borderRadius: 14,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "14px 18px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: `1px solid ${LINE}`,
                }}
              >
                <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 15 }}>
                  Transactions
                  {calc.lowConf > 0 && (
                    <span style={{ color: WARN, fontSize: 12, fontWeight: 500, marginLeft: 8 }}>
                      · {calc.lowConf} need a quick look
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      appendRef.current = true;
                      fileRef.current?.click();
                    }}
                    className="hb-btn"
                    title="Add another statement and merge (dedupes overlaps)"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      color: MUTED,
                      background: "none",
                      border: `1px solid ${LINE}`,
                      borderRadius: 8,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    <Upload size={13} /> Add statement
                  </button>
                  {calc.applies && (
                    <button
                      onClick={downloadCalendar}
                      className="hb-btn"
                      title="Download .ics reminders for the upcoming due dates"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 13,
                        color: MUTED,
                        background: "none",
                        border: `1px solid ${LINE}`,
                        borderRadius: 8,
                        padding: "6px 10px",
                        cursor: "pointer",
                      }}
                    >
                      <CalendarPlus size={13} /> Calendar
                    </button>
                  )}
                  <button
                    onClick={downloadSummary}
                    className="hb-btn"
                    title="Download a CA-ready text summary"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      color: MUTED,
                      background: "none",
                      border: `1px solid ${LINE}`,
                      borderRadius: 8,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    <Download size={13} /> Summary
                  </button>
                  <button
                    onClick={reset}
                    className="hb-btn"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      color: MUTED,
                      background: "none",
                      border: `1px solid ${LINE}`,
                      borderRadius: 8,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    <RotateCcw size={13} /> Start over
                  </button>
                </div>
              </div>
              <div>
                {rows.map((r, i) => {
                  const c = CATS[r.category] || CATS.other;
                  const flag = r.confidence < 0.75 && r.dir === "credit";
                  return (
                    <div
                      key={i}
                      className="hb-row"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "62px 1fr 110px 150px",
                        gap: 10,
                        alignItems: "center",
                        padding: "11px 18px",
                        borderBottom: `1px solid ${LINE}`,
                        background: flag ? WARN_SOFT : "transparent",
                      }}
                    >
                      <div style={{ fontSize: 12, color: MUTED, fontFamily: MONO }}>
                        {fmtDate(r.date)}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.desc}
                      </div>
                      <div
                        className="hb-num"
                        style={{
                          textAlign: "right",
                          fontSize: 13,
                          fontWeight: 600,
                          color:
                            r.dir === "credit"
                              ? r.category === "business_income"
                                ? ACCENT
                                : INK
                              : MUTED,
                        }}
                      >
                        {r.dir === "credit" ? "" : "−"}
                        {fmtINR(r.amount)}
                      </div>
                      <div style={{ justifySelf: "end", width: "100%" }}>
                        {r.dir === "debit" ? (
                          <button
                            onClick={() => setDeductible(i, !r.deductible)}
                            className="hb-btn"
                            title="Toggle deductible business expense (affects the net basis)"
                            style={{
                              float: "right",
                              fontSize: 12,
                              cursor: "pointer",
                              borderRadius: 999,
                              padding: "3px 9px",
                              border: `1px solid ${r.deductible ? ACCENT : LINE}`,
                              background: r.deductible ? `${ACCENT}14` : "transparent",
                              color: r.deductible ? ACCENT : MUTED,
                            }}
                          >
                            {r.deductible ? "Business expense" : "Personal"}
                          </button>
                        ) : flag ? (
                          <select
                            value={r.category}
                            onChange={(e) => setCategory(i, e.target.value)}
                            style={{
                              width: "100%",
                              padding: "5px 6px",
                              borderRadius: 7,
                              border: `1px solid ${WARN}`,
                              fontSize: 12,
                              background: "#fff",
                              color: INK,
                            }}
                          >
                            {Object.entries(CATS).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            style={{
                              fontSize: 12,
                              color: c.color,
                              background: `${c.color}14`,
                              padding: "3px 9px",
                              borderRadius: 999,
                              float: "right",
                            }}
                          >
                            {c.label}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* analysis (local insights for all; AI narrative for Pro) */}
            <AnalysisPanel rows={rows} basis={basis} annualize={annualize} tier={tier} />

            {/* boundary */}
            <p style={{ marginTop: 16, fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
              This is an estimate to help you plan, not tax advice or a filed return. It assumes the
              new regime, no salaried standard deduction, and excludes capital gains and other heads.
              Confirm with a CA and pay through the income-tax portal. Advance tax applies when annual
              liability crosses ₹10,000; presumptive (44ADA) filers can pay the full amount by 15
              March.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
