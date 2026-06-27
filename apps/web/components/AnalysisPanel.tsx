"use client";

import { useMemo, useState } from "react";
import { Sparkles, AlertTriangle } from "lucide-react";
import type { Basis, TxnRow } from "@hisaab/tax";
import { computeInsights } from "@/lib/insights";
import type { Analysis } from "@/lib/schemas";
import type { Tier } from "@/lib/tier";
import { fmtINR } from "@/lib/format";
import { INK, SURFACE, ACCENT, WARN, WARN_SOFT, MUTED, LINE, MONO, DISPLAY } from "@/lib/theme";

function stabilityLabel(cv: number | null): { label: string; color: string } {
  if (cv == null) return { label: "—", color: MUTED };
  if (cv < 0.3) return { label: "Steady", color: ACCENT };
  if (cv < 0.6) return { label: "Some variation", color: WARN };
  return { label: "Variable", color: WARN };
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: MUTED,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div className="hb-num" style={{ fontSize: 16, fontWeight: 700, color: color ?? INK }}>
        {value}
      </div>
    </div>
  );
}

export function AnalysisPanel({
  rows,
  basis,
  annualize,
  tier,
}: {
  rows: TxnRow[];
  basis: Basis;
  annualize: boolean;
  tier: Tier;
}) {
  const insights = useMemo(() => computeInsights(rows), [rows]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const maxMonth = Math.max(1, ...insights.months.map((m) => m.business));
  const stab = stabilityLabel(insights.stability);

  async function runAnalysis() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, basis, annualize }),
      });
      const data = (await res.json().catch(() => ({}))) as { analysis?: Analysis; error?: string };
      if (!res.ok || !data.analysis) throw new Error(data.error || "Analysis failed.");
      setAnalysis(data.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        marginTop: 16,
        background: SURFACE,
        border: `1px solid ${LINE}`,
        borderRadius: 14,
        padding: 20,
      }}
    >
      <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 15 }}>Analysis</div>
      <p style={{ color: MUTED, fontSize: 13, marginTop: 4 }}>
        A read on your income — stability, who pays you, and where the money goes.
      </p>

      {/* quantitative metrics (both tiers, computed locally) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
          gap: 12,
          marginTop: 14,
        }}
      >
        <Metric label="Income stability" value={stab.label} color={stab.color} />
        <Metric
          label="Top-client concentration"
          value={`${Math.round(insights.concentrationPct)}%`}
          color={insights.concentrationPct >= 60 ? WARN : INK}
        />
        <Metric label="Total expenses (debited)" value={fmtINR(insights.expenseTotal)} />
        <Metric label="Income sources" value={String(insights.topSources.length)} />
      </div>

      {/* monthly business-income bars */}
      {insights.months.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: ".05em" }}>
            Monthly business income
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 80, marginTop: 10 }}>
            {insights.months.map((m) => (
              <div key={m.month} style={{ flex: 1, textAlign: "center" }}>
                <div
                  title={fmtINR(m.business)}
                  style={{
                    height: `${Math.max(4, (m.business / maxMonth) * 64)}px`,
                    background: ACCENT,
                    borderRadius: "4px 4px 0 0",
                  }}
                />
                <div style={{ fontSize: 10, color: MUTED, marginTop: 4, fontFamily: MONO }}>
                  {m.month.slice(5)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* top sources */}
      {insights.topSources.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: ".05em" }}>
            Top income sources
          </div>
          <div style={{ marginTop: 8 }}>
            {insights.topSources.map((s) => (
              <div
                key={s.name}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  padding: "6px 0",
                  borderBottom: `1px solid ${LINE}`,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name} <span style={{ color: MUTED }}>· {s.count}×</span>
                </span>
                <span className="hb-num" style={{ fontWeight: 600 }}>
                  {fmtINR(s.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI analysis (Pro) */}
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px dashed ${LINE}` }}>
        {tier === "pro" ? (
          analysis ? (
            <div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 14 }}>
                {analysis.headline}
              </div>
              <AdviceList title="Strengths" items={analysis.strengths} color={ACCENT} />
              <AdviceList title="Risks" items={analysis.risks} color={WARN} />
              <AdviceList title="Suggested actions" items={analysis.actions} color={INK} />
            </div>
          ) : (
            <>
              <button
                onClick={runAnalysis}
                disabled={loading}
                className="hb-btn"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: ACCENT,
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: loading ? "default" : "pointer",
                  opacity: loading ? 0.7 : 1,
                }}
              >
                <Sparkles size={16} /> {loading ? "Analysing…" : "Generate AI analysis (Pro)"}
              </button>
              {error && (
                <div
                  style={{
                    marginTop: 12,
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
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
                </div>
              )}
            </>
          )
        ) : (
          <div style={{ fontSize: 13, color: MUTED }}>
            <span style={{ color: ACCENT, fontWeight: 600 }}>Pro</span> adds a realtime AI read of
            these numbers — strengths, risks, and tailored next steps. Switch to Pro to enable it.
          </div>
        )}
      </div>
    </div>
  );
}

function AdviceList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: ".05em" }}>
        {title}
      </div>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        {items.map((it, i) => (
          <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: INK }}>
            <span style={{ color }}>•</span> {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
