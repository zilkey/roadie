/**
 * Pure stage plot logic, shared by the server commands, the editor and the renderer. Nothing here reads a clock, a DOM or the
 * database. Every function returns new objects and leaves its arguments alone.
 *
 * Coordinates: feet. x from the stage-right edge (the left of the drawing), y from the upstage edge (the top), growing toward
 * the audience at the bottom. A marker without x/y is "not placed": its circle waits in the strip above the stage.
 */
import type { PlotShape, StagePlotInput, StagePlotItem, StagePlotMonitor } from "@/schema/stagePlots";

type Kind = StagePlotMonitor["kind"];

/** Drawing geometry shared by the renderer and the editor (px per foot and margins around the stage, in SVG units). */
export const LAYOUT = { PX: 30, M: { l: 56, t: 44, r: 56, b: 76 } } as const;
/** Keep markers this far (feet) inside the stage edge. */
export const EDGE_FT = 0.3;
/** Input circles and mix markers are about this wide (feet) on the drawing; fanOut keeps their centers at least this far apart. */
export const MARKER_FT = 0.9;
export const MAX_INPUTS = 64;
export const MAX_MIXES = 24;
export const DEFAULT_STAGE = { widthFt: 24, depthFt: 16 };
/** Size presets from the story. */
export const STAGE_PRESETS = [{ widthFt: 16, depthFt: 12 }, { widthFt: 20, depthFt: 14 }, { widthFt: 24, depthFt: 16 }, { widthFt: 28, depthFt: 18 }];

/** A short random id with a prefix ("i4k2x9qa"). Pass your own generator to make results repeatable. */
export function newId(prefix = "p"): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const raw = c?.randomUUID ? c.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return prefix + raw.slice(0, 8);
}
export type IdMaker = (prefix: string) => string;

/** Feet -> SVG units and back, for the editor's pointer math and overlays drawn in the StagePlotSvg `children` slot. */
export const toSvg = (xFt: number, yFt: number) => ({ x: LAYOUT.M.l + xFt * LAYOUT.PX, y: LAYOUT.M.t + yFt * LAYOUT.PX });
export const fromSvg = (x: number, y: number) => ({ xFt: (x - LAYOUT.M.l) / LAYOUT.PX, yFt: (y - LAYOUT.M.t) / LAYOUT.PX });
export const viewBoxOf = (stage: PlotShape["stage"]) => ({
  w: stage.widthFt * LAYOUT.PX + LAYOUT.M.l + LAYOUT.M.r,
  h: stage.depthFt * LAYOUT.PX + LAYOUT.M.t + LAYOUT.M.b,
});

export const isPlaced = (m: { x?: number; y?: number }): m is { x: number; y: number } => typeof m.x === "number" && typeof m.y === "number";

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Round to 0.01 ft so stored positions stay tidy. */
const r2 = (v: number) => Math.round(v * 100) / 100;
/** A point pulled back onto the stage. A stage narrower than twice the margin pins to its middle. */
export function clampPoint(stage: PlotShape["stage"], x: number, y: number): { x: number; y: number } {
  const cx = (v: number, max: number) => (max <= 2 * EDGE_FT ? max / 2 : clampN(v, EDGE_FT, max - EDGE_FT));
  return { x: r2(cx(x, stage.widthFt)), y: r2(cx(y, stage.depthFt)) };
}

// ---------- counts ----------

/** True when shrinking to `n` inputs would drop circles that are placed or have anything filled in (the editor confirms first). */
export function dropsWork(plot: Pick<PlotShape, "inputs">, n: number): StagePlotInput[] {
  return plot.inputs.slice(Math.max(0, n)).filter((i) => isPlaced(i) || hasDetail(i));
}
const hasDetail = (i: StagePlotInput) => !!(i.source || i.gear || i.stand || i.phantom || i.musicianId || i.note);

/** Channels 1..n. Raising adds unplaced, empty inputs at the end; lowering drops the highest-numbered ones. */
export function setInputCount<P extends Pick<PlotShape, "inputs">>(plot: P, n: number, mk: IdMaker = newId): P {
  const count = Math.max(0, Math.min(MAX_INPUTS, Math.floor(n)));
  const inputs = plot.inputs.slice(0, count);
  while (inputs.length < count) inputs.push({ id: mk("i") });
  return { ...plot, inputs };
}
/** Mixes M1..Mn, the same way. New mixes are unplaced and of `kind`. */
export function setMixCount<P extends Pick<PlotShape, "monitors">>(plot: P, n: number, kind: Kind = "wedge", mk: IdMaker = newId): P {
  const count = Math.max(0, Math.min(MAX_MIXES, Math.floor(n)));
  const monitors = plot.monitors.slice(0, count);
  while (monitors.length < count) monitors.push({ id: mk("m"), kind });
  return { ...plot, monitors };
}

// ---------- placing ----------

function withoutXY<T extends { x?: number; y?: number }>(m: T): T {
  const { x: _x, y: _y, ...rest } = m;
  return rest as T;
}
function mapInput(plot: PlotShape, id: string, f: (i: StagePlotInput) => StagePlotInput): PlotShape {
  if (!plot.inputs.some((i) => i.id === id)) throw new Error(`No input ${id}`);
  return { ...plot, inputs: plot.inputs.map((i) => (i.id === id ? f(i) : i)) };
}
/** Put an input's circle on the stage (pulled inside the edges). */
export const placeInput = <P extends PlotShape>(plot: P, id: string, x: number, y: number): P =>
  mapInput(plot, id, (i) => ({ ...i, ...clampPoint(plot.stage, x, y) })) as P;
/** Send an input's circle back to the strip. Its row and details stay. */
export const unplaceInput = <P extends PlotShape>(plot: P, id: string): P => mapInput(plot, id, withoutXY) as P;
export const placeMonitor = <P extends PlotShape>(plot: P, id: string, x: number, y: number): P => {
  if (!plot.monitors.some((m) => m.id === id)) throw new Error(`No mix ${id}`);
  return { ...plot, monitors: plot.monitors.map((m) => (m.id === id ? { ...m, ...clampPoint(plot.stage, x, y) } : m)) } as P;
};
export const unplaceMonitor = <P extends PlotShape>(plot: P, id: string): P => {
  if (!plot.monitors.some((m) => m.id === id)) throw new Error(`No mix ${id}`);
  return { ...plot, monitors: plot.monitors.map((m) => (m.id === id ? withoutXY(m) : m)) } as P;
};

export interface Move { id: string; x: number | null; y?: number; rot?: number }
/**
 * One drag (or a group drag) across inputs, gear and mixes. x null = back to the strip (inputs and mixes only). Positions are
 * clamped to the stage. `rot` only applies to gear. Throws on an unknown id or a gear item sent to the strip.
 */
export function applyMoves<P extends PlotShape>(plot: P, moves: Move[]): P {
  const inputs = new Map(plot.inputs.map((i) => [i.id, i]));
  const items = new Map(plot.items.map((i) => [i.id, i]));
  const monitors = new Map(plot.monitors.map((m) => [m.id, m]));
  for (const mv of moves) {
    const place = (cur: { x?: number; y?: number }) => {
      if (mv.x === null) return withoutXY(cur);
      const y = mv.y ?? cur.y;
      if (y === undefined) throw new Error(`Give y as well as x for ${mv.id}`);
      return { ...cur, ...clampPoint(plot.stage, mv.x, y) };
    };
    if (inputs.has(mv.id)) inputs.set(mv.id, place(inputs.get(mv.id)!) as StagePlotInput);
    else if (monitors.has(mv.id)) monitors.set(mv.id, place(monitors.get(mv.id)!) as StagePlotMonitor);
    else if (items.has(mv.id)) {
      if (mv.x === null) throw new Error(`Gear ${mv.id} cannot go back to the strip: remove it instead`);
      const cur = items.get(mv.id)!;
      items.set(mv.id, { ...cur, ...clampPoint(plot.stage, mv.x, mv.y ?? cur.y), ...(mv.rot !== undefined ? { rot: mv.rot } : {}) });
    } else throw new Error(`Nothing with id ${mv.id}`);
  }
  return {
    ...plot,
    inputs: plot.inputs.map((i) => inputs.get(i.id)!),
    items: plot.items.map((i) => items.get(i.id)!),
    monitors: plot.monitors.map((m) => monitors.get(m.id)!),
  };
}

/** New channel order. `order` must name every input exactly once. Each input keeps its own position, so circles renumber in place. */
export function reorderInputs<P extends Pick<PlotShape, "inputs">>(plot: P, order: string[]): P {
  const byId = new Map(plot.inputs.map((i) => [i.id, i]));
  if (order.length !== plot.inputs.length || new Set(order).size !== order.length || order.some((id) => !byId.has(id)))
    throw new Error("order must list every input id exactly once");
  return { ...plot, inputs: order.map((id) => byId.get(id)!) };
}

/** Pull everything back onto the stage, e.g. after the stage shrank. Unplaced markers stay unplaced. */
export function clampToStage<P extends PlotShape>(plot: P): P {
  const fix = <T extends { x?: number; y?: number }>(m: T): T => (isPlaced(m) ? { ...m, ...clampPoint(plot.stage, m.x, m.y) } : m);
  return { ...plot, inputs: plot.inputs.map(fix), items: plot.items.map(fix), monitors: plot.monitors.map(fix) };
}

// ---------- reading ----------

/** The circles still in the strip, with their channel (1-based) and mix numbers. */
export function unplaced(plot: Pick<PlotShape, "inputs" | "monitors">) {
  return {
    inputs: plot.inputs.map((input, i) => ({ n: i + 1, input })).filter((r) => !isPlaced(r.input)),
    mixes: plot.monitors.map((monitor, i) => ({ n: i + 1, monitor })).filter((r) => !isPlaced(r.monitor)),
  };
}
export const powerDrops = (plot: Pick<PlotShape, "items">) => plot.items.filter((i) => i.type === "power").length;

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export interface PlotSummary { inputs: number; placed: number; unplaced: number; mixes: number; powerDrops: number; text: string }
/** "11 inputs, 3 mixes, 3 power drops" */
export function summary(plot: Pick<PlotShape, "inputs" | "items" | "monitors">): PlotSummary {
  const inputs = plot.inputs.length, placed = plot.inputs.filter(isPlaced).length, mixes = plot.monitors.length, drops = powerDrops(plot);
  return {
    inputs, placed, unplaced: inputs - placed, mixes, powerDrops: drops,
    text: `${plural(inputs, "input")}, ${plural(mixes, "mix", "mixes")}, ${plural(drops, "power drop")}`,
  };
}

/** Numbers as the sheet shows them: 3 -> "3", [1,2,3,4] -> "1–4", [1,2,5] -> "1·2·5". */
export const range = (a: number[]): string =>
  a.length === 1 ? String(a[0]) : a[a.length - 1] - a[0] === a.length - 1 ? `${a[0]}–${a[a.length - 1]}` : a.join("·");

// ---------- crowded circles ----------

export interface FanPoint { id: string; x: number; y: number }
/**
 * Nudge points apart so no two centers are closer than `minDist` feet. Pure and deterministic: same points in, same points out.
 * Only points that would overlap move; a point with no close neighbor comes back exactly as it went in. Applied when drawing
 * (StagePlotSvg), never to stored positions. Points keep their order. Not clamped to the stage: a fanned circle may sit just past
 * an edge, which is fine on paper.
 */
export function fanOut(points: FanPoint[], minDist = MARKER_FT): FanPoint[] {
  const p = points.map((q) => ({ ...q }));
  const n = p.length;
  const moved = new Array<boolean>(n).fill(false);
  for (let iter = 0; iter < 60; iter++) {
    let touched = false;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        let dx = p[b].x - p[a].x, dy = p[b].y - p[a].y;
        let d = Math.hypot(dx, dy);
        if (d >= minDist - 1e-9) continue;
        if (d < 1e-6) { // same spot: spread along a deterministic angle per pair
          const ang = (a * 7 + b * 13) * 2.399963; // golden angle
          dx = Math.cos(ang); dy = Math.sin(ang); d = 1;
        }
        const push = (minDist - Math.hypot(p[b].x - p[a].x, p[b].y - p[a].y)) / 2 + 1e-3;
        const ux = dx / d, uy = dy / d;
        p[a].x -= ux * push; p[a].y -= uy * push;
        p[b].x += ux * push; p[b].y += uy * push;
        moved[a] = moved[b] = true; touched = true;
      }
    }
    if (!touched) break;
  }
  return p.map((q, i) => (moved[i] ? q : points[i]));
}

/** Gear in drawing order: risers first (under everything), then the rest as stored. Unplaced gear does not exist (x, y are required). */
export const gearInOrder = (items: StagePlotItem[]): StagePlotItem[] =>
  [...items.filter((i) => i.type === "riser"), ...items.filter((i) => i.type !== "riser")];
