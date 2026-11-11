"use client";
import { bpmStrip } from "@/lib/music";
import type { SongRow } from "@/components/music/common";

const H = 40; // px, the tallest bar
const MIN_H = 8; // the slowest song still shows as a bar

/**
 * The set's tempos in order (#38): one bar per song, its height the song's BPM within the set's range, so you can see
 * where the set sags or never breathes. A song without a BPM is a dashed gap; a break is a thin rule.
 * Renders nothing until the set has a song.
 */
export function BpmStrip({ items, songs }: { items: { type?: string; songId?: string; title: string }[]; songs: SongRow[] }) {
  const { steps, min, max, missing } = bpmStrip(items, (id) => songs.find((s) => s.id === id)?.bpm);
  const songCount = steps.filter((s) => s.kind === "song").length;
  if (!songCount) return null;
  const height = (bpm: number) => (min == null || max == null || max === min ? H : MIN_H + ((bpm - min) / (max - min)) * (H - MIN_H));
  const range = min == null ? "No BPMs yet" : min === max ? `${min} bpm` : `${min}–${max} bpm`;
  return (
    <div className="grid gap-1" data-testid="bpm-strip">
      <div className="flex items-end gap-[3px]" style={{ height: H }} role="img"
        aria-label={`Tempo through the set: ${steps.map((s) => (s.kind === "break" ? s.title : `${s.title} ${s.bpm != null ? `${s.bpm} bpm` : "no BPM"}`)).join(", ")}`}>
        {steps.map((s, i) =>
          s.kind === "break" ? (
            <span key={i} className="mx-0.5 self-stretch" style={{ width: 1, background: "var(--line)" }} title={s.title} data-testid="bpm-break" />
          ) : s.bpm != null ? (
            <span key={i} className="min-w-[4px] flex-1 rounded-t-sm" style={{ height: height(s.bpm), background: "var(--accent)" }} title={`${s.title} · ${s.bpm} bpm`} data-testid="bpm-bar" data-bpm={s.bpm} />
          ) : (
            <span key={i} className="min-w-[4px] flex-1 rounded-t-sm" style={{ height: MIN_H, border: "1px dashed var(--muted)" }} title={`${s.title} · no BPM`} data-testid="bpm-bar" data-bpm="" />
          ),
        )}
      </div>
      <span className="s" data-testid="bpm-range">Tempo {range}{missing ? ` · ${missing} ${missing === 1 ? "song" : "songs"} without a BPM` : ""}</span>
    </div>
  );
}
