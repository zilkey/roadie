"use client";
import { fmtTime } from "@/lib/shows";
import type { ShowRow } from "../common";

type Times = ShowRow["times"];

/** Minutes into the show's day. Anything before 6 am is after midnight, so it sorts after the evening ("00:30" -> 1470). */
export function dayMinute(t: string): number {
  const [h, m] = t.split(":").map(Number);
  const min = h * 60 + m;
  return min < 6 * 60 ? min + 24 * 60 : min;
}

const PX_PER_HOUR = 48;
const MIN_BLOCK_PX = 22;
const hourLabel = (h: number) => { const hh = h % 24; return hh === 0 ? "Midnight" : hh === 12 ? "Noon" : `${hh % 12} ${hh < 12 ? "AM" : "PM"}`; };
const clock = (min: number) => { const m = min % (24 * 60); return fmtTime(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`); };

interface Block { key: string; label: string; start: number; end: number; set?: boolean }

/**
 * The show's day as a calendar column: load in, soundcheck and doors each run until the next one starts; the set is
 * its own block for its length (an hour when there's no length); show starts is a line. Hours from the first time to
 * the end of the set.
 */
export function DayPreview({ times: t }: { times: Times }) {
  const steps = ([["loadIn", "Load in"], ["soundcheck", "Soundcheck"], ["doors", "Doors"], ["set", "Set"]] as const)
    .filter(([k]) => t[k]).map(([k, label]) => ({ key: k as string, label, start: dayMinute(t[k]!) }))
    .sort((a, b) => a.start - b.start);
  if (!steps.length && !t.showStart) return null;
  const blocks: Block[] = steps.map((s, i) => {
    if (s.key === "set") return { ...s, end: s.start + Math.round((t.setLengthSec ?? 3600) / 60), set: true };
    const next = steps[i + 1]?.start;
    return { ...s, end: next && next > s.start ? next : s.start + 30 };
  });
  const showStart = t.showStart ? dayMinute(t.showStart) : null;
  const all = [...blocks.flatMap((b) => [b.start, b.end]), ...(showStart !== null ? [showStart] : [])];
  const from = Math.floor(Math.min(...all) / 60);
  const to = Math.max(from + 2, Math.ceil(Math.max(...all) / 60));
  const y = (min: number) => ((min - from * 60) / 60) * PX_PER_HOUR;
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return (
    <div className="day-preview" aria-label="The day at a glance" role="img" data-testid="where-preview" style={{ height: (to - from) * PX_PER_HOUR + 16 }}>
      {hours.map((h) => (
        <div key={h} className="day-hour" style={{ top: y(h * 60) + 8 }}>
          <span className="day-hour-label">{hourLabel(h)}</span>
        </div>
      ))}
      {blocks.map((b) => {
        const h = Math.max(MIN_BLOCK_PX, y(b.end) - y(b.start) - 2);
        const span = b.set && t.setLengthSec ? `${clock(b.start)} – ${clock(b.end)}` : clock(b.start);
        return (
          <div key={b.key} className={`day-block${b.set ? " set" : ""}${h >= 40 ? " tall" : ""}`} style={{ top: y(b.start) + 9, height: h }} data-testid={`where-preview-${b.key}`}>
            <b>{b.label}</b><span className="day-block-time">{h >= 40 ? span : ` · ${span}`}</span>
          </div>
        );
      })}
      {showStart !== null && (
        <div className="day-marker" style={{ top: y(showStart) + 8 }} data-testid="where-preview-showStart">
          <span>Show starts · {clock(showStart)}</span>
        </div>
      )}
    </div>
  );
}
