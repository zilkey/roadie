"use client";
import { formatCents } from "@/lib/money";

/** Small hand-drawn SVG charts; no chart library. Colors come from the theme tokens. */

const W = 320, H = 120, PT = 10, PB = 20;

const monthLabel = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" });

/** Income and spending side by side for each month. */
export function MonthBars({ data, testid }: { data: { key: string; in: number; out: number }[]; testid: string }) {
  if (!data.length) return <div className="card" data-testid={testid}><span className="lbl">By month</span><span className="s">No entries yet.</span></div>;
  const max = Math.max(...data.flatMap((d) => [d.in, d.out]), 1);
  const bw = Math.min(26, (W - 16) / data.length - 6);
  const slot = (W - 16) / data.length;
  const h = (v: number) => (v * (H - PT - PB)) / max;
  // Thin the month labels so they never overlap: label every k-th calendar month (k = smallest of 1,2,3,6,12 that fits).
  const GAP = 4, MONTH_W = 20, YEAR_W = 22;
  const multiYear = new Set(data.map((d) => d.key.slice(0, 4))).size > 1;
  const need = (multiYear ? YEAR_W : MONTH_W) + GAP;
  const k = [1, 2, 3, 6, 12].find((n) => n * slot >= need) ?? 12;
  const yearFits = k * slot >= YEAR_W + GAP;
  const labelFor = (key: string): string | null => {
    const mo = Number(key.slice(5, 7)) - 1;
    if (mo % k !== 0) return null;
    if (multiYear && mo === 0) return yearFits ? key.slice(0, 4) : `'${key.slice(2, 4)}`;
    return monthLabel(key);
  };
  return (
    <div className="card" data-testid={testid}>
      <div className="flex items-center justify-between"><span className="lbl">By month</span>
        <span className="s flex gap-3"><span><i className="inline-block size-2 rounded-sm align-middle" style={{ background: "var(--ok)" }} /> In</span><span><i className="inline-block size-2 rounded-sm align-middle" style={{ background: "var(--accent)" }} /> Out</span></span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Income and spending by month" className="w-full" style={{ height: "auto" }}>
        <line x1={8} x2={W - 8} y1={H - PB} y2={H - PB} stroke="var(--line)" />
        {data.map((d, i) => {
          const cx = 8 + slot * i + slot / 2;
          const label = labelFor(d.key);
          const anchor = cx - MONTH_W / 2 < 0 ? "start" : cx + MONTH_W / 2 > W ? "end" : "middle";
          const lx = anchor === "start" ? 2 : anchor === "end" ? W - 2 : cx;
          return (
            <g key={d.key} data-testid={`${testid}-${d.key}`}>
              <title>{new Date(d.key + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</title>
              <rect x={cx - bw / 2 - 1} width={bw / 2} y={H - PB - h(d.in)} height={h(d.in)} fill="var(--ok)" rx="2"><title>{`${d.key} in ${formatCents(d.in)}`}</title></rect>
              <rect x={cx + 1} width={bw / 2} y={H - PB - h(d.out)} height={h(d.out)} fill="var(--accent)" rx="2"><title>{`${d.key} out ${formatCents(d.out)}`}</title></rect>
              {label && <text x={lx} y={H - 6} fontSize="9" textAnchor={anchor} fill="var(--muted)">{label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Horizontal bars (by show / by category): income in green, spending in pink. */
export function HBars({ title, rows, testid, spent }: { title: string; rows: { key: string; label: string; in: number; out: number; sub?: string }[]; testid: string; /** Spending only: one pink bar and the amount spent, not the net. */ spent?: boolean }) {
  const max = Math.max(...rows.flatMap((r) => (spent ? [r.out] : [r.in, r.out])), 1);
  return (
    <div className="card content-start" data-testid={testid}>
      <span className="lbl">{title}</span>
      {rows.length === 0 && <span className="s">No entries yet.</span>}
      {rows.map((r) => (
        <div key={r.key} className="grid gap-0.5" data-testid={`${testid}-${r.key}`}>
          <div className="flex justify-between gap-2 text-sm"><span>{r.label}{r.sub && <span className="s"> · {r.sub}</span>}</span><span className="font-mono">{formatCents(spent ? r.out : r.in - r.out)}</span></div>
          <svg viewBox="0 0 100 7" preserveAspectRatio="none" className="h-2 w-full" role="img" aria-label={`${r.label}: in ${formatCents(r.in)}, out ${formatCents(r.out)}`}>
            {spent
              ? <rect x="0" y="2" width={(r.out / max) * 100} height="3" fill="var(--accent)" rx="1" />
              : <><rect x="0" y="0" width={(r.in / max) * 100} height="3" fill="var(--ok)" rx="1" /><rect x="0" y="4" width={(r.out / max) * 100} height="3" fill="var(--accent)" rx="1" /></>}
          </svg>
        </div>
      ))}
    </div>
  );
}
