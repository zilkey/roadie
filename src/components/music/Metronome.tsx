"use client";
import { useEffect, useSyncExternalStore } from "react";
import { hitsOn, playableBpm, secondsPerBeat, type Drum } from "@/lib/metronome";

/*
 * One metronome for the whole app: starting a song's stops whichever was playing. It schedules drum samples on the
 * Web Audio clock a little ahead of time (a timer only tops up the queue), so the beat stays steady even when the
 * page is busy. Samples: a Drumdrops acoustic kit (Splice), trimmed to public/sounds/metronome-*.wav.
 */
const SAMPLES: Record<Drum, string> = { kick: "/sounds/metronome-kick.wav", hat: "/sounds/metronome-hat.wav" };
const GAIN: Record<Drum, number> = { kick: 0.9, hat: 0.55 };
const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;

let ctx: AudioContext | null = null;
let buffers: Promise<Record<Drum, AudioBuffer>> | null = null;
let playing: { key: string; timer?: ReturnType<typeof setInterval> } | null = null;
const mounted = new Map<string, number>(); // buttons on screen per key, so leaving the page stops the beat
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load(ac: AudioContext) {
  buffers ??= Promise.all((Object.keys(SAMPLES) as Drum[]).map(async (d) => {
    const res = await fetch(SAMPLES[d]);
    return [d, await ac.decodeAudioData(await res.arrayBuffer())] as const;
  })).then((pairs) => Object.fromEntries(pairs) as Record<Drum, AudioBuffer>);
  return buffers;
}

export function stopMetronome() {
  if (!playing) return;
  clearInterval(playing.timer);
  playing = null;
  emit();
}

async function start(key: string, bpm: number) {
  stopMetronome();
  ctx ??= new AudioContext();
  const ac = ctx;
  const claim: NonNullable<typeof playing> = { key }; // lit at once, so a second click while the samples load stops it
  playing = claim;
  emit();
  void ac.resume();
  let drums: Record<Drum, AudioBuffer>;
  try { drums = await load(ac); } catch { buffers = null; if (playing === claim) stopMetronome(); return; }
  if (playing !== claim) return; // stopped (or another song started) while the samples loaded
  const step = secondsPerBeat(bpm);
  let beat = 0;
  let next = ac.currentTime + 0.05;
  const fill = () => {
    while (next < ac.currentTime + LOOKAHEAD_S) {
      for (const d of hitsOn(beat)) {
        const src = ac.createBufferSource();
        const g = ac.createGain();
        g.gain.value = GAIN[d];
        src.buffer = drums[d];
        src.connect(g).connect(ac.destination);
        src.start(next);
      }
      beat += 1;
      next += step;
    }
  };
  fill();
  claim.timer = setInterval(fill, TICK_MS);
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const current = () => playing?.key ?? null;

/**
 * The metronome button for a song: tap to play its BPM (hi-hat on every beat, kick on the one), tap again to stop.
 * Shows nothing when the song has no usable BPM. `id` is the song's id; two buttons for the same song light together.
 */
export function Metronome({ id, bpm, title }: { id: string; bpm: number | null | undefined; title?: string }) {
  const tempo = playableBpm(bpm);
  const key = `${id}@${tempo}`;
  const on = useSyncExternalStore(subscribe, current, () => null) === key;

  useEffect(() => {
    if (tempo == null) return;
    mounted.set(key, (mounted.get(key) ?? 0) + 1);
    return () => {
      const left = (mounted.get(key) ?? 1) - 1;
      if (left > 0) mounted.set(key, left); else mounted.delete(key);
      // Moving between two pages that both show this song's button keeps the beat; leaving them stops it.
      setTimeout(() => { if (!mounted.has(key) && playing?.key === key) stopMetronome(); }, 400);
    };
  }, [key, tempo]);

  if (tempo == null) return null;
  const label = `${on ? "Stop" : "Play"} metronome${title ? ` for ${title}` : ""} at ${tempo} bpm`;
  return (
    <button type="button" className={on ? "metronome on" : "metronome"} aria-pressed={on} aria-label={label} title={label}
      data-testid="metronome" data-bpm={tempo}
      style={{ "--beat": `${secondsPerBeat(tempo)}s` } as React.CSSProperties}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (on) stopMetronome(); else void start(key, tempo); }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 3h6l4 18H5L9 3z" />
        <path d="M6.5 16h11" />
        <path className="metronome-arm" d="M12 16V5" />
      </svg>
    </button>
  );
}
