"use client";
import { formatCents } from "@/lib/money";

/** Small hand-drawn SVG charts; no chart library. Colors come from the theme tokens. */

export interface Point { x: string; y: number }

const W = 320, H = 120, PL = 8, PR = 8, PT = 10, PB = 20;

export function LineChart({ title, points, testid, fmt = (n: number) => n.toLocaleString("en-US") }: { title: string; points: Point[]; testid: string; fmt?(n: number): string }) {
  const pts = [...points].sort((a, b) => (a.x < b.x ? -1 : 1));
  if (!pts.length) return <div className="card" data-testid={testid}><span className="lbl">{title}</span><span className="s">No numbers yet.</span></div>;
  const ys = pts.map((p) => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const sx = (i: number) => (pts.length === 1 ? W / 2 : PL + (i * (W - PL - PR)) / (pts.length - 1));
  const sy = (v: number) => PT + ((hi - v) * (H - PT - PB)) / (hi - lo);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1], first = pts[0];
  return (
    <div className="card" data-testid={testid} data-points={pts.length}>
      <div className="flex items-baseline justify-between gap-2"><span className="lbl">{title}</span><b className="font-mono" data-testid={`${testid}-latest`}>{fmt(last.y)}</b></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${fmt(first.y)} on ${first.x} to ${fmt(last.y)} on ${last.x}`} className="w-full" style={{ height: "auto" }}>
        {[0, 0.5, 1].map((t) => <line key={t} x1={PL} x2={W - PR} y1={PT + t * (H - PT - PB)} y2={PT + t * (H - PT - PB)} stroke="var(--line)" strokeWidth="1" />)}
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" data-testid={`${testid}-line`} />
        {pts.map((p, i) => (pts.length <= 40 || i === pts.length - 1) && <circle key={p.x} cx={sx(i)} cy={sy(p.y)} r={i === pts.length - 1 ? 3.5 : 2} fill="var(--accent)"><title>{`${p.x}: ${fmt(p.y)}`}</title></circle>)}
        <text x={PL} y={H - 5} fontSize="9" fill="var(--muted)">{first.x}</text>
        <text x={W - PR} y={H - 5} fontSize="9" fill="var(--muted)" textAnchor="end">{last.x}</text>
        <text x={W - PR} y={PT - 1} fontSize="9" fill="var(--muted)" textAnchor="end">{fmt(Math.round(hi - pad))}</text>
      </svg>
    </div>
  );
}

const monthLabel = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" });

/** Income and spending side by side for each month. */
export function MonthBars({ data, testid }: { data: { key: string; in: number; out: number }[]; testid: string }) {
  if (!data.length) return <div className="card" data-testid={testid}><span className="lbl">By month</span><span className="s">No entries yet.</span></div>;
  const max = Math.max(...data.flatMap((d) => [d.in, d.out]), 1);
  const bw = Math.min(26, (W - 16) / data.length - 6);
  const slot = (W - 16) / data.length;
  const h = (v: number) => (v * (H - PT - PB)) / max;
  return (
    <div className="card" data-testid={testid}>
      <div className="flex items-center justify-between"><span className="lbl">By month</span>
        <span className="s flex gap-3"><span><i className="inline-block size-2 rounded-sm align-middle" style={{ background: "var(--ok)" }} /> In</span><span><i className="inline-block size-2 rounded-sm align-middle" style={{ background: "var(--accent)" }} /> Out</span></span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Income and spending by month" className="w-full" style={{ height: "auto" }}>
        <line x1={8} x2={W - 8} y1={H - PB} y2={H - PB} stroke="var(--line)" />
        {data.map((d, i) => {
          const cx = 8 + slot * i + slot / 2;
          return (
            <g key={d.key} data-testid={`${testid}-${d.key}`}>
              <rect x={cx - bw / 2 - 1} width={bw / 2} y={H - PB - h(d.in)} height={h(d.in)} fill="var(--ok)" rx="2"><title>{`${d.key} in ${formatCents(d.in)}`}</title></rect>
              <rect x={cx + 1} width={bw / 2} y={H - PB - h(d.out)} height={h(d.out)} fill="var(--accent)" rx="2"><title>{`${d.key} out ${formatCents(d.out)}`}</title></rect>
              <text x={cx} y={H - 6} fontSize="9" textAnchor="middle" fill="var(--muted)">{monthLabel(d.key)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Horizontal bars (by show / by category): income in green, spending in pink. */
export function HBars({ title, rows, testid }: { title: string; rows: { key: string; label: string; in: number; out: number; sub?: string }[]; testid: string }) {
  const max = Math.max(...rows.flatMap((r) => [r.in, r.out]), 1);
  return (
    <div className="card" data-testid={testid}>
      <span className="lbl">{title}</span>
      {rows.length === 0 && <span className="s">No entries yet.</span>}
      {rows.map((r) => (
        <div key={r.key} className="grid gap-0.5" data-testid={`${testid}-${r.key}`}>
          <div className="flex justify-between gap-2 text-sm"><span>{r.label}{r.sub && <span className="s"> · {r.sub}</span>}</span><span className="font-mono">{formatCents(r.in - r.out)}</span></div>
          <svg viewBox="0 0 100 7" preserveAspectRatio="none" className="h-2 w-full" role="img" aria-label={`${r.label}: in ${formatCents(r.in)}, out ${formatCents(r.out)}`}>
            <rect x="0" y="0" width={(r.in / max) * 100} height="3" fill="var(--ok)" rx="1" />
            <rect x="0" y="4" width={(r.out / max) * 100} height="3" fill="var(--accent)" rx="1" />
          </svg>
        </div>
      ))}
    </div>
  );
}
