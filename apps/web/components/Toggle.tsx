import { ACCENT, INK, LINE } from "@/lib/theme";

export function Toggle({
  on,
  setOn,
  onLabel,
  offLabel,
}: {
  on: boolean;
  setOn: (v: boolean) => void;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <button
      onClick={() => setOn(!on)}
      className="hb-btn"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fff",
        border: `1px solid ${LINE}`,
        borderRadius: 8,
        padding: "6px 10px",
        cursor: "pointer",
        fontSize: 13,
        width: "100%",
      }}
    >
      <span
        style={{
          width: 32,
          height: 18,
          borderRadius: 999,
          background: on ? ACCENT : "#D7DAD5",
          position: "relative",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: on ? 16 : 2,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: "#fff",
            transition: "left .15s ease",
          }}
        />
      </span>
      <span style={{ color: INK }}>{on ? onLabel : offLabel}</span>
    </button>
  );
}
