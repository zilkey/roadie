"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlotShape } from "@/schema/stagePlots";
import { ICONS, TRAY, type IconType } from "@/lib/stagePlots/icons";
import { applyMoves, fromSvg, isPlaced, unplaced, viewBoxOf, type Move } from "@/lib/stagePlots/plot";
import { StagePlotSvg } from "./StagePlotSvg";

const SNAP = 0.5;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const MOVE_PX = 5;
const THING = "[data-input-id],[data-monitor-id],[data-item-id]";
const idOf = (el: Element) => el.getAttribute("data-input-id") ?? el.getAttribute("data-monitor-id") ?? el.getAttribute("data-item-id") ?? "";

type Src = { kind: "chip"; id: string } | { kind: "marker"; id: string } | { kind: "tray"; type: IconType } | { kind: "stage" };
interface Drag { src: Src; cx: number; cy: number; x: number; y: number; over: "stage" | "strip" | "none" }

export interface StageBoardProps {
  plot: PlotShape;
  admin: boolean;
  /** Ids to ring on the drawing (hovered or selected row, armed circle). */
  highlight: string[];
  /** The unplaced circle waiting for a tap on the stage. */
  armed: string | null;
  onArm(id: string | null): void;
  onSelect(id: string | null): void;
  /** ONE call per gesture. */
  onMove(moves: Move[]): void;
  onAddItems(items: { type: IconType; x: number; y: number }[]): void;
  onRemoveItems(ids: string[]): void;
}

const iconSvg = (type: IconType) => ICONS[type].svg;

/** The strip of unplaced circles, the stage, and the gear tray. All dragging is pointer events; the stage (not the page) takes touch-action: none. */
export function StageBoard(props: StageBoardProps) {
  const { plot, admin, highlight, armed } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const live = useRef(props); live.current = props;
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);

  const feetAt = useCallback((cx: number, cy: number) => {
    const svg = wrap.current?.querySelector("svg");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const vb = viewBoxOf(live.current.plot.stage);
    const f = fromSvg(((cx - r.left) * vb.w) / r.width, ((cy - r.top) * vb.h) / r.height);
    const inside = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    return { x: f.xFt, y: f.yFt, inside };
  }, []);
  const overStrip = (cx: number, cy: number) => {
    const r = strip.current?.getBoundingClientRect();
    return !!r && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  };

  const waiting = unplaced(plot);
  const waitingIds = [...waiting.inputs.map((r) => r.input.id), ...waiting.mixes.map((r) => r.monitor.id)];
  /** After a drop, the next unplaced circle gets armed. */
  const armNext = (placed: string) => {
    const rest = waitingIds.filter((x) => x !== placed);
    const at = waitingIds.indexOf(placed);
    props.onArm(rest.find((_, i) => i >= at) ?? rest[0] ?? null);
  };

  function begin(e: React.PointerEvent, src: Src) {
    if (!admin || (e.pointerType === "mouse" && e.button !== 0)) return;
    const sx = e.clientX, sy = e.clientY;
    const start = feetAt(sx, sy);
    const L = () => live.current;
    const origin = src.kind === "marker" ? thingPos(L().plot, src.id) : null;
    let moved = false;
    const where = (cx: number, cy: number): Drag => {
      const f = feetAt(cx, cy);
      const strip = overStrip(cx, cy);
      let x = f?.x ?? 0, y = f?.y ?? 0;
      if (src.kind === "marker" && origin && start && f) { x = origin.x + (f.x - start.x); y = origin.y + (f.y - start.y); }
      return { src, cx, cy, x: snap(x), y: snap(y), over: strip ? "strip" : f?.inside ? "stage" : "none" };
    };
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < MOVE_PX) return;
      if (src.kind === "stage") return;
      moved = true;
      setDrag(where(ev.clientX, ev.clientY));
    };
    const finish = (ev: PointerEvent | null) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      setDrag(null);
      return ev;
    };
    const onCancel = () => { finish(null); };
    const onUp = (ev: PointerEvent) => {
      finish(ev);
      const p = L();
      if (!moved) {
        if (src.kind === "stage") {
          const f = feetAt(ev.clientX, ev.clientY);
          if (p.armed && f?.inside) {
            const id = p.armed;
            p.onMove([{ id, x: snap(f.x), y: snap(f.y) }]);
            armNext(id);
          } else p.onSelect(null);
        } else if (src.kind === "tray") {
          const s = p.plot.stage;
          p.onAddItems([{ type: src.type, x: snap(s.widthFt / 2), y: snap(s.depthFt / 2) }]);
        }
        return;
      }
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      const d = where(ev.clientX, ev.clientY);
      if (src.kind === "chip") {
        if (d.over === "stage") { p.onMove([{ id: src.id, x: d.x, y: d.y }]); if (p.armed === src.id) p.onArm(null); }
      } else if (src.kind === "marker") {
        if (d.over === "strip" && !isGear(p.plot, src.id)) p.onMove([{ id: src.id, x: null }]);
        else p.onMove([{ id: src.id, x: d.x, y: d.y }]);
      } else if (src.kind === "tray") {
        if (d.over === "stage") p.onAddItems([{ type: src.type, x: d.x, y: d.y }]);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  function onStageDown(e: React.PointerEvent) {
    const t = (e.target as Element).closest(THING);
    if (t) { props.onSelect(idOf(t)); begin(e, { kind: "marker", id: idOf(t) }); } else begin(e, { kind: "stage" });
  }

  function onStageKey(e: React.KeyboardEvent) {
    const t = (e.target as Element).closest(THING);
    if (!t || !admin) return;
    const id = idOf(t);
    const p = plot;
    const thing = [...p.inputs, ...p.monitors, ...p.items].find((x) => x.id === id);
    if (!thing) return;
    const gear = p.items.find((x) => x.id === id);
    const at = isPlaced(thing) ? thing : null;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-SNAP, 0], ArrowRight: [SNAP, 0], ArrowUp: [0, -SNAP], ArrowDown: [0, SNAP] };
    if (arrows[e.key] && at) {
      e.preventDefault();
      props.onMove([{ id, x: snap(at.x + arrows[e.key][0]), y: snap(at.y + arrows[e.key][1]) }]);
    } else if ((e.key === "r" || e.key === "R") && gear && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      props.onMove([{ id, x: gear.x, y: gear.y, rot: (gear.rot + 45) % 360 }]);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (gear) props.onRemoveItems([id]); else props.onMove([{ id, x: null }]);
    }
  }

  // Escape lets go of an armed circle.
  useEffect(() => {
    if (!armed) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") live.current.onArm(null); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [armed]);

  // What the drawing shows while a gesture is under way.
  let shown = plot;
  if (drag) {
    try {
      if (drag.src.kind === "chip" && drag.over === "stage") shown = applyMoves(plot, [{ id: drag.src.id, x: drag.x, y: drag.y }]);
      else if (drag.src.kind === "marker") shown = drag.over === "strip" && !isGear(plot, drag.src.id) ? applyMoves(plot, [{ id: drag.src.id, x: null }]) : applyMoves(plot, [{ id: drag.src.id, x: drag.x, y: drag.y }]);
      else if (drag.src.kind === "tray" && drag.over === "stage") shown = { ...plot, items: [...plot.items, { id: "tray-preview", type: drag.src.type, x: drag.x, y: drag.y, rot: 0 }] };
    } catch { shown = plot; }
  }
  const draggingChip = drag?.src.kind === "chip" ? drag.src.id : null;
  const ghost = drag && drag.over !== "stage" && drag.src.kind !== "marker";

  const chipClick = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (suppressClick.current) return;
    props.onArm(armed === id ? null : id);
  };
  const empty = waitingIds.length === 0;

  return (
    <div className="grid gap-2" data-testid="stage-board">
      {admin && (
        <div ref={strip} data-testid="plot-strip" data-drop={drag?.over === "strip" ? "on" : undefined}
          className={`sticky top-0 z-10 flex min-h-14 flex-wrap items-center gap-2 rounded-xl border bg-surface px-3 py-2 md:static ${drag?.over === "strip" ? "border-accent bg-accent-soft" : "border-line"}`}>
          <span className="s font-semibold">{armed ? "Tap the stage to drop it" : empty ? "Every circle is on the stage" : "To place"}</span>
          {waiting.inputs.map(({ n, input }) => (
            <button key={input.id} type="button" data-testid="strip-chip" data-ch={n} data-chip-id={input.id} aria-pressed={armed === input.id} aria-label={`Place input ${n}`}
              onPointerDown={(e) => begin(e, { kind: "chip", id: input.id })} onClick={chipClick(input.id)}
              style={{ touchAction: "none", opacity: draggingChip === input.id ? 0.35 : 1 }}
              className={`grid size-9 cursor-grab place-items-center rounded-full bg-accent font-mono text-sm font-bold text-on-accent select-none ${armed === input.id ? "ring-4 ring-accent/40 outline-2 outline-offset-2 outline-accent" : ""}`}>{n}</button>
          ))}
          {waiting.mixes.map(({ n, monitor }) => (
            <button key={monitor.id} type="button" data-testid="strip-chip" data-mix={n} data-chip-id={monitor.id} aria-pressed={armed === monitor.id} aria-label={`Place mix ${n}`}
              onPointerDown={(e) => begin(e, { kind: "chip", id: monitor.id })} onClick={chipClick(monitor.id)}
              style={{ touchAction: "none", opacity: draggingChip === monitor.id ? 0.35 : 1, background: "var(--sp-mix, #B07A00)", color: "#fff" }}
              className={`grid h-8 min-w-10 cursor-grab place-items-center rounded-md px-1 text-sm font-bold select-none ${armed === monitor.id ? "ring-4 ring-accent/40 outline-2 outline-offset-2 outline-accent" : ""}`}>{`M${n}`}</button>
          ))}
        </div>
      )}

      <div ref={wrap} data-testid="plot-stage" role="group" aria-label="Stage" tabIndex={-1}
        onPointerDown={admin ? onStageDown : undefined} onKeyDown={onStageKey}
        onFocus={(e) => { const t = (e.target as Element).closest?.(THING); if (t) props.onSelect(idOf(t)); }}
        style={{ touchAction: admin ? "none" : undefined, userSelect: "none", WebkitUserSelect: "none", cursor: armed ? "crosshair" : undefined }}
        className="overflow-hidden rounded-xl border border-line bg-surface">
        <StagePlotSvg plot={shown} highlight={highlight} className="block w-full" />
      </div>
      {admin && <p className="s">Drag circles and gear to place them. Snaps to ½ ft. With one focused, arrow keys nudge it, R turns gear 45°, Delete removes gear or sends a circle back.</p>}

      {admin && (
        <div className="grid gap-1" data-testid="gear-tray">
          <span className="s font-semibold">Gear · drag onto the stage, or tap to add</span>
          <div className="flex flex-wrap gap-2" style={{ ["--ic-fill" as string]: "var(--surface)" }}>
            {TRAY.map((type) => (
              <button key={type} type="button" data-testid={`tray-${type}`} title={ICONS[type].name} aria-label={`Add ${ICONS[type].name}`}
                onPointerDown={(e) => begin(e, { kind: "tray", type })}
                onClick={(e) => { if (e.detail === 0) { const s = plot.stage; props.onAddItems([{ type, x: snap(s.widthFt / 2), y: snap(s.depthFt / 2) }]); } }}
                style={{ touchAction: "none" }}
                className="grid size-12 cursor-grab place-items-center rounded-lg border border-line bg-surface text-ink select-none hover:border-accent">
                <svg viewBox="-26 -26 52 52" width={36} height={36} aria-hidden dangerouslySetInnerHTML={{ __html: iconSvg(type) }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {ghost && drag && (
        <div aria-hidden className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2" style={{ left: drag.cx, top: drag.cy, ["--ic-fill" as string]: "var(--surface)" }}>
          {drag.src.kind === "tray"
            ? <svg viewBox="-26 -26 52 52" width={44} height={44} className="text-ink opacity-80" dangerouslySetInnerHTML={{ __html: iconSvg(drag.src.type) }} />
            : <span className="grid size-9 place-items-center rounded-full bg-accent font-mono text-sm font-bold text-on-accent opacity-80">{chipLabel(plot, drag.src.kind === "chip" ? drag.src.id : "")}</span>}
        </div>
      )}
    </div>
  );
}

const isGear = (p: PlotShape, id: string) => p.items.some((i) => i.id === id);
function thingPos(p: PlotShape, id: string): { x: number; y: number } | null {
  const t = [...p.inputs, ...p.monitors, ...p.items].find((x) => x.id === id);
  return t && isPlaced(t) ? { x: t.x, y: t.y } : null;
}
function chipLabel(p: PlotShape, id: string): string {
  const i = p.inputs.findIndex((x) => x.id === id);
  if (i >= 0) return String(i + 1);
  const m = p.monitors.findIndex((x) => x.id === id);
  return m >= 0 ? `M${m + 1}` : "";
}
