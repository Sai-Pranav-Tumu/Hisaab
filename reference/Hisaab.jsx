import React, { useState, useMemo, useRef } from "react";
import { Upload, FileText, Sparkles, AlertTriangle, RotateCcw } from "lucide-react";

/* ------------------------------------------------------------------ *
 * Hisaab — advance-tax clarity for freelancers (FY 2026-27, new regime)
 * Upload a statement (or load sample) -> Claude separates real
 * business income from noise -> estimates quarterly advance tax.
 * ------------------------------------------------------------------ */

const INK = "#16191F";
const PAPER = "#F4F5F2";
const SURFACE = "#FFFFFF";
const ACCENT = "#0E7C66"; // deep teal — money / clarity
const ACCENT_SOFT = "#E3F0EC";
const WARN = "#B86A12"; // amber — review / overdue
const WARN_SOFT = "#FaeEDD";
const MUTED = "#6B7280";
const LINE = "#E2E4E0";

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const DISPLAY = "'Space Grotesk', system-ui, sans-serif";
const BODY = "'Inter', system-ui, sans-serif";

const CATS = {
  business_income: { label: "Business income", color: ACCENT, counts: true },
  transfer_in: { label: "Transfer", color: "#7A6FF0" },
  refund: { label: "Refund", color: "#C2761A" },
  interest: { label: "Interest", color: "#3B82B8" },
  expense: { label: "Expense", color: "#9AA0A6" },
  other: { label: "Other", color: "#9AA0A6" },
};

// --- Sample: an Apr–Jun 2026 freelance designer/dev statement ---------
const SAMPLE = [
  { date: "2026-04-03", desc: "NEFT CR ACME TECH PVT LTD INV-204", amount: 185000, dir: "credit" },
  { date: "2026-04-08", desc: "UPI/MOM/transfer for stuff", amount: 10000, dir: "credit" },
  { date: "2026-04-11", desc: "Rent UPI landlord Ramesh", amount: 18000, dir: "debit" },
  { date: "2026-04-15", desc: "IMPS Pixel Labs monthly retainer", amount: 120000, dir: "credit" },
  { date: "2026-04-19", desc: "AWS cloud charges INR", amount: 2300, dir: "debit" },
  { date: "2026-04-22", desc: "REFUND Amazon order cancelled", amount: 1499, dir: "credit" },
  { date: "2026-05-02", desc: "FOREIGN INWARD REMIT UPWORK ESCROW", amount: 95000, dir: "credit" },
  { date: "2026-05-06", desc: "UPI/designco@okhdfc logo project", amount: 60000, dir: "credit" },
  { date: "2026-05-09", desc: "Swiggy order", amount: 540, dir: "debit" },
  { date: "2026-05-14", desc: "Interest credit savings a/c", amount: 842, dir: "credit" },
  { date: "2026-05-18", desc: "NEFT CR Brightwave Media Pvt Ltd", amount: 110000, dir: "credit" },
  { date: "2026-05-21", desc: "Figma annual subscription USD", amount: 9100, dir: "debit" },
  { date: "2026-05-27", desc: "UPI/rohan split dinner", amount: 600, dir: "credit" },
  { date: "2026-06-04", desc: "UPI client Rohan website final", amount: 80000, dir: "credit" },
  { date: "2026-06-09", desc: "Electricity bill TSSPDCL", amount: 1400, dir: "debit" },
  { date: "2026-06-13", desc: "IMPS Stellar Apps milestone 2", amount: 50000, dir: "credit" },
  { date: "2026-06-17", desc: "Adobe Creative Cloud", amount: 4230, dir: "debit" },
  { date: "2026-06-20", desc: "Cashback Cred", amount: 200, dir: "credit" },
];

// fallback categories if the AI call can't run (so the demo never dead-ends)
const SAMPLE_FALLBACK = [
  "business_income","transfer_in","expense","business_income","expense","refund",
  "business_income","business_income","expense","interest","business_income","expense",
  "transfer_in","business_income","expense","business_income","expense","other",
];

const fmtINR = (n) =>
  "₹" + Math.round(n).toLocaleString("en-IN");

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

// --- Tax engine: FY 2026-27 new regime (slabs unchanged from 2025-26) -
function computeAnnualTax(taxable) {
  const slabs = [
    [400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15],
    [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30],
  ];
  let tax = 0, prev = 0;
  for (const [cap, rate] of slabs) {
    if (taxable > prev) tax += (Math.min(taxable, cap) - prev) * rate;
    prev = cap;
    if (taxable <= cap) break;
  }
  // Section 87A: taxable up to 12L -> full rebate (effectively zero)
  if (taxable <= 1200000) tax = 0;
  else tax = Math.min(tax, taxable - 1200000); // marginal relief above 12L
  const cess = tax * 0.04;
  return tax + cess;
}

const DUE_DATES = [
  { label: "15 Jun", iso: "2026-06-15", cum: 0.15 },
  { label: "15 Sep", iso: "2026-09-15", cum: 0.45 },
  { label: "15 Dec", iso: "2026-12-15", cum: 0.75 },
  { label: "15 Mar", iso: "2027-03-15", cum: 1.0 },
];

async function classifyBatch(rows) {
  const lines = rows
    .map((r, i) => `${i}: "${r.desc}" | ${r.dir} | ₹${r.amount}`)
    .join("\n");
  const sys =
    "You categorize Indian bank transactions for a freelancer's tax estimate. " +
    "Categories: business_income (payment received for freelance/professional/consulting " +
    "work — client invoices, retainers, platform payouts like Upwork/Fiverr, foreign inward " +
    "remittance for services), transfer_in (money from family/friends/self), refund, interest, " +
    "expense (any money going out), other. Only credits can be income. " +
    "Return ONLY a JSON array, no prose, no markdown fences. " +
    'Each item: {"i":<index>,"category":"<cat>","confidence":<0..1>}.';
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: `${sys}\n\nTransactions:\n${lines}` }],
    }),
  });
  const data = await res.json();
  const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

export default function Hisaab() {
  const [rows, setRows] = useState([]);       // {date,desc,amount,dir,category,confidence}
  const [phase, setPhase] = useState("idle"); // idle | working | done | error
  const [note, setNote] = useState("");
  const [basis, setBasis] = useState("presumptive"); // presumptive | net
  const [annualize, setAnnualize] = useState(true);
  const fileRef = useRef(null);

  async function run(raw, fallback) {
    setPhase("working");
    setNote("");
    try {
      // batch ≤ 8 to stay within token budget
      const out = [];
      for (let b = 0; b < raw.length; b += 8) {
        const chunk = raw.slice(b, b + 8);
        const cls = await classifyBatch(chunk);
        chunk.forEach((r, j) => {
          const hit = cls.find((c) => c.i === j) || {};
          out.push({
            ...r,
            category: hit.category && CATS[hit.category] ? hit.category : "other",
            confidence: typeof hit.confidence === "number" ? hit.confidence : 0.5,
          });
        });
      }
      setRows(out);
      setPhase("done");
    } catch (e) {
      if (fallback) {
        setRows(raw.map((r, i) => ({ ...r, category: fallback[i] || "other", confidence: 0.9 })));
        setNote("Couldn't reach the classifier — showing the sample with built-in categories so you can still see the math.");
        setPhase("done");
      } else {
        setNote("Couldn't read that file. Bank-statement PDFs vary a lot; try the sample to see the flow, or a text-based (non-scanned, non-password) PDF.");
        setPhase("error");
      }
    }
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhase("working");
    setNote("");
    try {
      const b64 = await new Promise((res, rej) => {
        const rd = new FileReader();
        rd.onload = () => res(rd.result.split(",")[1]);
        rd.onerror = () => rej(new Error("read"));
        rd.readAsDataURL(f);
      });
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
              { type: "text", text:
                "Extract up to 18 transactions from this bank statement. Return ONLY a JSON array, " +
                'no prose, no fences. Each item: {"date":"YYYY-MM-DD","desc":"<text>",' +
                '"amount":<number>,"dir":"credit"|"debit"}.' },
            ],
          }],
        }),
      });
      const data = await r.json();
      const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      await run(parsed, null);
    } catch (err) {
      setNote("Couldn't read that file. Bank-statement PDFs vary a lot; try the sample, or a text-based (non-scanned, non-password) PDF.");
      setPhase("error");
    }
  }

  function setCategory(idx, cat) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, category: cat, confidence: 1 } : r)));
  }

  function reset() {
    setRows([]); setPhase("idle"); setNote("");
  }

  // --- derived figures ------------------------------------------------
  const calc = useMemo(() => {
    if (rows.length === 0) return null;
    const credits = rows.filter((r) => r.dir === "credit");
    const totalCredits = credits.reduce((s, r) => s + r.amount, 0);
    const receipts = rows
      .filter((r) => r.dir === "credit" && r.category === "business_income")
      .reduce((s, r) => s + r.amount, 0);
    const noise = totalCredits - receipts;

    const dates = rows.map((r) => +new Date(r.date)).filter(Boolean);
    const spanDays = dates.length > 1
      ? Math.max(1, (Math.max(...dates) - Math.min(...dates)) / 86400000) : 30;
    const factor = annualize ? Math.min(12, 365 / spanDays) : 1;
    const annualReceipts = receipts * factor;

    const taxable = basis === "presumptive" ? annualReceipts * 0.5 : annualReceipts * 0.65;
    const annualTax = computeAnnualTax(taxable);
    const applies = annualTax > 10000;

    const today = new Date("2026-06-27");
    const schedule = DUE_DATES.map((d) => {
      const due = d.cum * annualTax;
      const dt = new Date(d.iso);
      return { ...d, due, status: dt < today ? "past" : "upcoming", dt };
    });
    const next = schedule.find((s) => s.status === "upcoming") || schedule[schedule.length - 1];
    const overdue = schedule.filter((s) => s.status === "past" && applies);

    return {
      totalCredits, receipts, noise, factor, spanDays, annualReceipts,
      taxable, annualTax, applies, schedule, next, overdue,
      lowConf: rows.filter((r) => r.confidence < 0.75 && r.dir === "credit").length,
    };
  }, [rows, basis, annualize]);

  return (
    <div style={{ background: PAPER, color: INK, fontFamily: BODY, minHeight: "100%", borderRadius: 16 }}>
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
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 30, letterSpacing: "-.02em" }}>
              Hisaab
            </div>
            <div style={{ color: MUTED, fontSize: 14, marginTop: 2 }}>
              Know what you owe, before the taxman does.
            </div>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED, border: `1px solid ${LINE}`, borderRadius: 999, padding: "4px 10px" }}>
            FY 2026-27 · new regime
          </div>
        </div>

        {/* intake */}
        {phase === "idle" || phase === "error" ? (
          <div style={{ marginTop: 22, background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 14, padding: 22 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 17 }}>
              Start with one bank statement
            </div>
            <p style={{ color: MUTED, fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
              Your income lives in a pile of UPI and bank credits — mixed with refunds, interest, and
              money from family. Hisaab pulls out the part that's actually taxable and works out your
              advance tax for the year.
            </p>

            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <button
                className="hb-btn"
                onClick={() => fileRef.current?.click()}
                style={{ display: "flex", alignItems: "center", gap: 8, background: SURFACE, color: INK,
                  border: `1px solid ${LINE}`, borderRadius: 10, padding: "11px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                <Upload size={16} /> Upload statement (PDF)
              </button>
              <input ref={fileRef} type="file" accept="application/pdf" onChange={onFile} style={{ display: "none" }} />
              <button
                className="hb-btn"
                onClick={() => run(SAMPLE, SAMPLE_FALLBACK)}
                style={{ display: "flex", alignItems: "center", gap: 8, background: ACCENT, color: "#fff",
                  border: "none", borderRadius: 10, padding: "11px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                  boxShadow: "0 1px 0 rgba(0,0,0,.04)" }}>
                <Sparkles size={16} /> Try it with sample data
              </button>
            </div>

            {note && (
              <div style={{ marginTop: 14, display: "flex", gap: 8, color: WARN, background: WARN_SOFT,
                border: `1px solid ${WARN}33`, borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {note}
              </div>
            )}
            <div style={{ marginTop: 14, fontSize: 12, color: MUTED }}>
              Nothing is stored — the statement is read once to classify transactions.
            </div>
          </div>
        ) : null}

        {/* working */}
        {phase === "working" && (
          <div style={{ marginTop: 22, background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 14, padding: 30, textAlign: "center" }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 600 }}>Reading the statement…</div>
            <div style={{ color: MUTED, fontSize: 13, marginTop: 6 }}>Separating real income from the noise.</div>
          </div>
        )}

        {/* result */}
        {phase === "done" && calc && (
          <>
            {note && (
              <div style={{ marginTop: 16, display: "flex", gap: 8, color: WARN, background: WARN_SOFT,
                border: `1px solid ${WARN}33`, borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {note}
              </div>
            )}

            {/* HERO — the number + the quarterly timeline (the signature) */}
            <div style={{ marginTop: 18, background: INK, color: "#fff", borderRadius: 16, padding: "26px 24px" }}>
              {calc.applies ? (
                <>
                  <div style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "#9CA6B0" }}>
                    Next advance-tax instalment · due {calc.next.label} {calc.next.iso.startsWith("2027") ? "'27" : "'26"}
                  </div>
                  <div className="hb-num" style={{ fontSize: 52, fontWeight: 700, marginTop: 6, lineHeight: 1 }}>
                    {fmtINR(calc.next.due - (calc.overdue.length ? 0 : 0))}
                  </div>
                  <div style={{ color: "#9CA6B0", fontSize: 13, marginTop: 8 }}>
                    cumulative {Math.round(calc.next.cum * 100)}% of an estimated{" "}
                    <span className="hb-num" style={{ color: "#fff" }}>{fmtINR(calc.annualTax)}</span> for the year
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "#9CA6B0" }}>
                    Estimated advance tax
                  </div>
                  <div className="hb-num" style={{ fontSize: 52, fontWeight: 700, marginTop: 6, lineHeight: 1 }}>₹0</div>
                  <div style={{ color: "#9CA6B0", fontSize: 13, marginTop: 8 }}>
                    Your estimated income keeps you under the ₹12L rebate — no advance tax due. Keep an eye on it as receipts grow.
                  </div>
                </>
              )}

              {/* quarter timeline */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 20 }}>
                {calc.schedule.map((s) => {
                  const isNext = calc.applies && s.label === calc.next.label;
                  const missed = calc.applies && s.status === "past";
                  return (
                    <div key={s.label} style={{
                      borderRadius: 10, padding: "10px 10px 11px",
                      background: isNext ? ACCENT : "rgba(255,255,255,.06)",
                      border: missed ? `1px solid ${WARN}` : "1px solid transparent" }}>
                      <div style={{ fontSize: 11, color: isNext ? "#EAF7F2" : "#9CA6B0", display: "flex", justifyContent: "space-between" }}>
                        <span>{s.label}</span><span>{Math.round(s.cum * 100)}%</span>
                      </div>
                      <div className="hb-num" style={{ fontSize: 14, fontWeight: 700, marginTop: 4, color: "#fff" }}>
                        {calc.applies ? fmtINR(s.due) : "—"}
                      </div>
                      {missed && <div style={{ fontSize: 10, color: WARN, marginTop: 2 }}>missed · 234C interest</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* income clarity */}
            <div style={{ marginTop: 16, background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 14, padding: 20 }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 15 }}>What's actually taxable</div>
              <p style={{ color: MUTED, fontSize: 13, marginTop: 4 }}>
                Out of <span className="hb-num">{fmtINR(calc.totalCredits)}</span> credited, only the freelance income counts.
              </p>
              <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", marginTop: 14, border: `1px solid ${LINE}` }}>
                <div style={{ width: `${(calc.receipts / calc.totalCredits) * 100}%`, background: ACCENT }} />
                <div style={{ width: `${(calc.noise / calc.totalCredits) * 100}%`, background: "#D7DAD5" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
                <span><span style={{ color: ACCENT, fontWeight: 600 }}>● </span>Business income <span className="hb-num">{fmtINR(calc.receipts)}</span></span>
                <span style={{ color: MUTED }}><span style={{ color: "#C2C6C0" }}>● </span>Ignored (transfers, refunds, interest) <span className="hb-num">{fmtINR(calc.noise)}</span></span>
              </div>

              {/* assumptions */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginTop: 18, paddingTop: 16, borderTop: `1px dashed ${LINE}` }}>
                <Field label="Annualise from this period">
                  <Toggle on={annualize} setOn={setAnnualize}
                    onLabel={`×${calc.factor.toFixed(1)} (${Math.round(calc.spanDays)}d)`} offLabel="as-is" />
                </Field>
                <Field label="Income basis">
                  <select value={basis} onChange={(e) => setBasis(e.target.value)}
                    style={{ width: "100%", padding: "7px 8px", borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 13, background: "#fff" }}>
                    <option value="presumptive">Presumptive 44ADA — tax on 50%</option>
                    <option value="net">Net basis — assume 65% profit</option>
                  </select>
                </Field>
                <Field label="Est. annual receipts">
                  <div className="hb-num" style={{ fontSize: 15, fontWeight: 700, paddingTop: 6 }}>{fmtINR(calc.annualReceipts)}</div>
                </Field>
                <Field label="Taxable income">
                  <div className="hb-num" style={{ fontSize: 15, fontWeight: 700, paddingTop: 6 }}>{fmtINR(calc.taxable)}</div>
                </Field>
              </div>
            </div>

            {/* transactions */}
            <div style={{ marginTop: 16, background: SURFACE, border: `1px solid ${LINE}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${LINE}` }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 15 }}>
                  Transactions
                  {calc.lowConf > 0 && (
                    <span style={{ color: WARN, fontSize: 12, fontWeight: 500, marginLeft: 8 }}>
                      · {calc.lowConf} need a quick look
                    </span>
                  )}
                </div>
                <button onClick={reset} className="hb-btn"
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: MUTED, background: "none", border: `1px solid ${LINE}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>
                  <RotateCcw size={13} /> Start over
                </button>
              </div>
              <div>
                {rows.map((r, i) => {
                  const c = CATS[r.category] || CATS.other;
                  const flag = r.confidence < 0.75 && r.dir === "credit";
                  return (
                    <div key={i} className="hb-row" style={{
                      display: "grid", gridTemplateColumns: "62px 1fr 110px 150px", gap: 10, alignItems: "center",
                      padding: "11px 18px", borderBottom: `1px solid ${LINE}`, background: flag ? WARN_SOFT : "transparent" }}>
                      <div style={{ fontSize: 12, color: MUTED, fontFamily: MONO }}>{fmtDate(r.date)}</div>
                      <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.desc}</div>
                      <div className="hb-num" style={{ textAlign: "right", fontSize: 13, fontWeight: 600,
                        color: r.dir === "credit" ? (r.category === "business_income" ? ACCENT : INK) : MUTED }}>
                        {r.dir === "credit" ? "" : "−"}{fmtINR(r.amount)}
                      </div>
                      <div style={{ justifySelf: "end", width: "100%" }}>
                        {flag ? (
                          <select value={r.category} onChange={(e) => setCategory(i, e.target.value)}
                            style={{ width: "100%", padding: "5px 6px", borderRadius: 7, border: `1px solid ${WARN}`, fontSize: 12, background: "#fff", color: INK }}>
                            {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select>
                        ) : (
                          <span style={{ fontSize: 12, color: c.color, background: `${c.color}14`, padding: "3px 9px", borderRadius: 999, float: "right" }}>
                            {c.label}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* boundary */}
            <p style={{ marginTop: 16, fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
              This is an estimate to help you plan, not tax advice or a filed return. It assumes the new
              regime, no salaried standard deduction, and excludes capital gains and other heads. Confirm
              with a CA and pay through the income-tax portal. Advance tax applies when annual liability
              crosses ₹10,000; presumptive (44ADA) filers can pay the full amount by 15 March.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function Toggle({ on, setOn, onLabel, offLabel }) {
  return (
    <button onClick={() => setOn(!on)} className="hb-btn"
      style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: `1px solid ${LINE}`,
        borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 13, width: "100%" }}>
      <span style={{ width: 32, height: 18, borderRadius: 999, background: on ? ACCENT : "#D7DAD5", position: "relative", flexShrink: 0 }}>
        <span style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 14, height: 14, borderRadius: 999, background: "#fff", transition: "left .15s ease" }} />
      </span>
      <span style={{ color: INK }}>{on ? onLabel : offLabel}</span>
    </button>
  );
}
