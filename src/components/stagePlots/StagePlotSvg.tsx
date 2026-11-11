import type { ReactNode } from "react";
import type { PlotShape } from "@/schema/stagePlots";
import { ICONS, SIZE } from "@/lib/stagePlots/icons";
import { LAYOUT, MARKER_FT, fanOut, gearInOrder, isPlaced, toSvg, viewBoxOf } from "@/lib/stagePlots/plot";

/**
 * The one stage plot drawing: the editor, the show-card thumbnail, the engineer page and the sheet/PDF all use it.
 * Presentational and hook-free, so renderToStaticMarkup can draw it on the server. Unplaced circles are not drawn (the editor's
 * strip shows them). Crowded circles are fanned apart at draw time (plot.ts fanOut); stored positions never change.
 *
 * Colors are plain attributes: on screen they read CSS variables with light fallbacks (--sp-floor, --sp-grid, --sp-edge, --sp-ink,
 * --sp-muted, --sp-soft, --sp-accent, --sp-accent-ink, --sp-mix, --sp-icon-fill); with forPaper they are literal black on white,
 * which svg-to-pdfkit can read. Icon markup is rewritten so no `var()` or `currentColor` is left in paper mode.
 *
 * Hooks for the editor: every thing carries data-item-id (gear), data-input-id (+ data-ch) or data-monitor-id (+ data-mix). The
 * viewBox is in "SVG units" (LAYOUT.PX per foot, plus margins); use toSvg/fromSvg from plot.ts to convert. `children` render
 * last, on top, in those same units.
 */
export interface StagePlotSvgProps {
  plot: PlotShape;
  /** Black on white, no focus targets or hit areas: for the sheet and the PDF. */
  forPaper?: boolean;
  /** Ids (gear, input or mix) to ring, e.g. the hovered or selected row. */
  highlight?: string | string[];
  className?: string;
  /** An overlay drawn on top, in viewBox units. */
  children?: ReactNode;
}

const FONT = "Figtree, Arial, sans-serif";
const MONO = "ui-monospace, Menlo, monospace";

function themeOf(paper: boolean) {
  return paper
    ? { floor: "#FFFFFF", grid: "#EEEEEE", grid5: "#DDDDDD", edge: "#111111", ink: "#111111", muted: "#555555", soft: "#F1F1F1", accent: "#111111", accentInk: "#FFFFFF", mixFill: "#FFFFFF", mixInk: "#111111", mixStroke: "#111111", iconFill: "#FFFFFF", ring: "#111111" }
    : { floor: "var(--sp-floor, #F7F8FC)", grid: "var(--sp-grid, #E2E6F0)", grid5: "var(--sp-grid5, #CBD1E3)", edge: "var(--sp-edge, #1B2140)", ink: "var(--sp-ink, #1B2140)", muted: "var(--sp-muted, #5B6385)", soft: "var(--sp-soft, #ECEFF8)", accent: "var(--sp-accent, #3B4BDB)", accentInk: "var(--sp-accent-ink, #FFFFFF)", mixFill: "var(--sp-mix, #B07A00)", mixInk: "var(--sp-mix-ink, #FFFFFF)", mixStroke: "var(--sp-mix, #B07A00)", iconFill: "var(--sp-icon-fill, #FFFFFF)", ring: "var(--sp-accent, #3B4BDB)" };
}

const short = (s: string, n = 16) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const round = (v: number) => Math.round(v * 100) / 100;

export function StagePlotSvg({ plot, forPaper = false, highlight, className, children }: StagePlotSvgProps) {
  const t = themeOf(forPaper);
  const { PX, M } = LAYOUT;
  const w = plot.stage.widthFt, d = plot.stage.depthFt, W = w * PX, H = d * PX;
  const vb = viewBoxOf(plot.stage);
  const hi = new Set(typeof highlight === "string" ? [highlight] : highlight ?? []);

  // Circles and mix markers share the fan-out so a mix never hides a channel number.
  type Mk = { kind: "input" | "mix"; id: string; n: number; x: number; y: number; label?: string };
  const markers: Mk[] = [
    ...plot.inputs.flatMap((i, k) => (isPlaced(i) ? [{ kind: "input" as const, id: i.id, n: k + 1, x: i.x, y: i.y, label: i.source }] : [])),
    ...plot.monitors.flatMap((m, k) => (isPlaced(m) ? [{ kind: "mix" as const, id: m.id, n: k + 1, x: m.x, y: m.y }] : [])),
  ];
  const fanned = fanOut(markers.map((m) => ({ id: m.id, x: m.x, y: m.y })), MARKER_FT);

  const lines: ReactNode[] = [];
  for (let x = 1; x < w; x++) lines.push(<line key={`vx${x}`} x1={M.l + x * PX} x2={M.l + x * PX} y1={M.t} y2={M.t + H} stroke={x % 5 === 0 ? t.grid5 : t.grid} strokeWidth={x % 5 === 0 ? 1.2 : 1} />);
  for (let y = 1; y < d; y++) lines.push(<line key={`hy${y}`} x1={M.l} x2={M.l + W} y1={M.t + y * PX} y2={M.t + y * PX} stroke={y % 5 === 0 ? t.grid5 : t.grid} strokeWidth={y % 5 === 0 ? 1.2 : 1} />);

  const gear = gearInOrder(plot.items).map((it) => {
    const icon = ICONS[it.type];
    if (!icon) return null;
    const size = SIZE[it.type], s = (size * PX) / 48, hr = (size * PX) / 2;
    const { x: cx, y: cy } = toSvg(it.x, it.y);
    const markup = icon.svg.replace(/var\(--ic-fill\)/g, t.iconFill).replace(/currentColor/g, t.ink);
    const label = `${icon.name}${it.label ? ` · ${it.label}` : ""}`;
    return (
      <g key={it.id} data-item-id={it.id} data-type={it.type} {...(forPaper ? {} : { tabIndex: 0, role: "button", "aria-label": label })}>
        <g transform={`translate(${round(cx)},${round(cy)})`}>
          {hi.has(it.id) && <rect x={-hr - 4} y={-hr - 4} width={2 * hr + 8} height={2 * hr + 8} rx={6} fill="none" stroke={t.ring} strokeWidth={2} strokeDasharray="5 4" />}
          {!forPaper && <rect x={-hr} y={-hr} width={2 * hr} height={2 * hr} fill="#000" fillOpacity={0} />}
          <g transform={`rotate(${it.rot}) scale(${round(s)})`} dangerouslySetInnerHTML={{ __html: markup }} />
        </g>
        {it.label && <text x={round(cx)} y={round(cy + hr + 12)} textAnchor="middle" fill={t.muted} fontFamily={FONT} fontSize={11}>{short(it.label, 22)}</text>}
      </g>
    );
  });

  const markerEls = markers.map((m, i) => {
    const f = fanned[i];
    const home = toSvg(m.x, m.y), at = toSvg(f.x, f.y);
    const displaced = Math.abs(f.x - m.x) > 1e-6 || Math.abs(f.y - m.y) > 1e-6;
    const lit = hi.has(m.id);
    const onRight = f.x > w * 0.75;
    const common = forPaper ? {} : { tabIndex: 0, role: "button" };
    const ax = round(at.x), ay = round(at.y);
    const leader = displaced && (
      <g key={`l-${m.id}`} data-leader-for={m.id}>
        <line x1={round(home.x)} y1={round(home.y)} x2={ax} y2={ay} stroke={t.muted} strokeWidth={1} />
        <circle cx={round(home.x)} cy={round(home.y)} r={2} fill={t.muted} />
      </g>
    );
    if (m.kind === "input") {
      const num = String(m.n);
      return [
        leader,
        <g key={m.id} data-input-id={m.id} data-ch={m.n} {...common} {...(forPaper ? {} : { "aria-label": `Input ${m.n}${m.label ? ` ${m.label}` : ""}` })}>
          {lit && <circle cx={ax} cy={ay} r={16} fill="none" stroke={t.ring} strokeWidth={2} strokeDasharray="5 4" />}
          <circle cx={ax} cy={ay} r={11} fill={t.accent} />
          <text x={ax} y={ay} textAnchor="middle" dominantBaseline="central" fill={t.accentInk} fontFamily={MONO} fontWeight={700} fontSize={num.length > 2 ? 9 : 12}>{num}</text>
          {m.label && (
            <text x={onRight ? ax - 16 : ax + 16} y={ay} textAnchor={onRight ? "end" : "start"} dominantBaseline="central" fill={t.ink} fontFamily={FONT} fontWeight={600} fontSize={11.5}>{short(m.label)}</text>
          )}
        </g>,
      ];
    }
    return [
      leader,
      <g key={m.id} data-monitor-id={m.id} data-mix={m.n} {...common} {...(forPaper ? {} : { "aria-label": `Mix ${m.n}` })}>
        {lit && <rect x={ax - 18} y={ay - 15} width={36} height={30} rx={6} fill="none" stroke={t.ring} strokeWidth={2} strokeDasharray="5 4" />}
        <rect x={ax - 14} y={ay - 10} width={28} height={20} rx={4} fill={t.mixFill} stroke={t.mixStroke} strokeWidth={1.5} />
        <text x={ax} y={ay} textAnchor="middle" dominantBaseline="central" fill={t.mixInk} fontFamily={FONT} fontWeight={700} fontSize={11}>{`M${m.n}`}</text>
      </g>,
    ];
  });

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${vb.w} ${vb.h}`} width={vb.w} height={vb.h}
      className={className} role="img" aria-label={`Stage plot${plot.name ? `: ${plot.name}` : ""}, ${w} by ${d} feet`}
      style={{ maxWidth: "100%", height: "auto" }} data-stage-plot=""
    >
      <rect x={M.l} y={M.t} width={W} height={H} rx={2} fill={t.floor} stroke={t.edge} strokeWidth={3} />
      {lines}
      <text x={M.l + W / 2} y={M.t - 16} textAnchor="middle" fill={t.muted} fontFamily={FONT} fontWeight={600} fontSize={12} letterSpacing="1">UPSTAGE</text>
      <text x={M.l - 14} y={M.t + H / 2} textAnchor="middle" transform={`rotate(-90 ${M.l - 14} ${M.t + H / 2})`} fill={t.muted} fontFamily={FONT} fontWeight={600} fontSize={12} letterSpacing="1">STAGE RIGHT</text>
      <text x={M.l + W + 14} y={M.t + H / 2} textAnchor="middle" transform={`rotate(90 ${M.l + W + 14} ${M.t + H / 2})`} fill={t.muted} fontFamily={FONT} fontWeight={600} fontSize={12} letterSpacing="1">STAGE LEFT</text>
      <text x={M.l + W} y={M.t - 16} textAnchor="end" fill={t.muted} fontFamily={MONO} fontSize={11}>{`${w} × ${d} ft · grid 1 ft`}</text>
      <rect x={M.l} y={M.t + H + 22} width={W} height={28} rx={6} fill={t.soft} />
      <text x={M.l + W / 2} y={M.t + H + 40} textAnchor="middle" fill={t.muted} fontFamily={FONT} fontWeight={700} fontSize={13} letterSpacing="4">AUDIENCE</text>
      <g data-layer="gear">{gear}</g>
      <g data-layer="markers">{markerEls}</g>
      {children}
    </svg>
  );
}
