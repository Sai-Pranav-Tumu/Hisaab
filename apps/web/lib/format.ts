export const fmtINR = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
