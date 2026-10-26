"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { artistHeaders } from "@/lib/commands";
import { clientAuth } from "@/lib/firebase-client";

/**
 * The inline audio player: a Play button on a file row expands it into a waveform that fills in as it plays.
 *
 * One <audio> element for the whole app, so starting one file stops the other. Play claims it inside the click (with a
 * moment of silence) because Safari only lets an element play later if it first played in a user gesture -- the real
 * bytes come after a fetch. Drive files come through /api/files/[id]/audio as the band account; a direct link to an
 * audio file is fetched as is, and when its host won't allow that it still plays, just without a waveform.
 */

export interface AudioFile { id: string; url: string; title: string; driveFileId?: string }

/** Bars in a waveform, whatever its width. */
const BARS = 160;
/** Peaks only need the shape, so decode at a low rate: an hour of audio is ~100 MB there instead of a GB. */
const PEAK_RATE = 4000;
/** Loaded files kept for replaying (the blob plus its peaks); older ones are let go. */
const KEEP = 3;
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

interface Loaded { src: string; peaks: number[] | null }
const loaded = new Map<string, Loaded>();

interface State { owner: string | null; playing: boolean; time: number; duration: number }
let state: State = { owner: null, playing: false, time: 0, duration: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const SERVER: State = { owner: null, playing: false, time: 0, duration: 0 };

let el: HTMLAudioElement | null = null;
function audio(): HTMLAudioElement {
  if (el) return el;
  el = new Audio();
  el.preload = "auto";
  const sync = () => { if (el!.src !== SILENCE) set({ playing: !el!.paused && !el!.ended, time: el!.currentTime, duration: Number.isFinite(el!.duration) ? el!.duration : 0 }); };
  for (const ev of ["play", "pause", "ended", "timeupdate", "durationchange", "loadedmetadata", "seeked"]) el.addEventListener(ev, sync);
  return el;
}

/** Take the element for `id` (call inside the click). Whatever was playing stops. */
export function claimAudio(id: string) {
  const a = audio();
  set({ owner: id, playing: false, time: 0, duration: 0 });
  const have = loaded.get(id);
  a.src = have?.src ?? SILENCE;
  void a.play().catch(() => { /* the panel shows Play again */ });
}

function release(id: string) {
  if (state.owner !== id || !el) return;
  el.pause();
  set({ owner: null, playing: false });
}

function remember(id: string, l: Loaded) {
  loaded.set(id, l);
  for (const [k, v] of loaded) {
    if (loaded.size <= KEEP) break;
    if (k === state.owner) continue;
    if (v.src.startsWith("blob:")) URL.revokeObjectURL(v.src);
    loaded.delete(k);
  }
}

async function fetchBytes(f: AudioFile, onPct: (n: number) => void): Promise<Blob> {
  let res: Response;
  if (f.driveFileId) {
    const user = clientAuth().currentUser;
    if (!user) throw new Error("Not signed in");
    res = await fetch(`/api/files/${encodeURIComponent(f.id)}/audio`, { headers: { authorization: `Bearer ${await user.getIdToken()}`, ...artistHeaders() } });
  } else res = await fetch(f.url);
  if (!res.ok) {
    const json = await res.json().catch(() => undefined);
    throw new Error(json?.error?.message ?? `Couldn't load it (HTTP ${res.status})`);
  }
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) return res.blob();
  const reader = res.body.getReader();
  const parts: BlobPart[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onPct(Math.min(99, Math.round((got / total) * 100)));
  }
  return new Blob(parts, { type: res.headers.get("content-type") ?? "" });
}

/** Loudest sample in each of BARS slices, scaled so the loudest bar is full height. Null when the browser can't decode it. */
async function peaksOf(blob: Blob): Promise<number[] | null> {
  try {
    const buf = await new OfflineAudioContext(1, PEAK_RATE, PEAK_RATE).decodeAudioData(await blob.arrayBuffer());
    const data = buf.getChannelData(0);
    const per = Math.max(1, Math.floor(data.length / BARS));
    const out: number[] = [];
    for (let b = 0; b < BARS; b++) {
      let max = 0;
      for (let i = b * per, end = Math.min(data.length, i + per); i < end; i++) { const v = Math.abs(data[i]); if (v > max) max = v; }
      out.push(max);
    }
    const top = Math.max(...out) || 1;
    return out.map((v) => v / top);
  } catch {
    return null;
  }
}

export const fmtTime = (s: number) => {
  const t = Math.max(0, Math.floor(s)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

/** The row's Play / Hide button. Opening plays; hiding stops. */
export function PlayToggle({ file, open, onOpen }: { file: AudioFile; open: boolean; onOpen: (open: boolean) => void }) {
  return (
    <button type="button" className="btn ghost sm" aria-expanded={open} data-testid="file-play"
      onClick={() => { if (open) { release(file.id); onOpen(false); } else { claimAudio(file.id); onOpen(true); } }}>
      {open ? "Hide" : "Play"}
    </button>
  );
}

/** The expanded part of the row: play/pause, the waveform with progress, and the time. */
export function AudioPanel({ file }: { file: AudioFile }) {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER);
  const mine = s.owner === file.id;
  const [ready, setReady] = useState<Loaded | null>(() => loaded.get(file.id) ?? null);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (ready) return;
    let gone = false;
    (async () => {
      let l: Loaded;
      try {
        const blob = await fetchBytes(file, (n) => { if (!gone) setPct(n); });
        l = { src: URL.createObjectURL(blob), peaks: await peaksOf(blob) };
      } catch (e) {
        // A link whose host won't let the page read it can still play straight from the link, just with no waveform.
        if (file.driveFileId) { if (!gone) setError(e instanceof Error ? e.message : "Couldn't load it"); return; }
        l = { src: file.url, peaks: null };
      }
      remember(file.id, l);
      if (gone) return;
      setReady(l);
      if (state.owner === file.id) { const a = audio(); a.src = l.src; void a.play().catch(() => {}); }
    })();
    return () => { gone = true; };
  }, [file, ready]);

  // Smooth progress while playing; timeupdate alone moves in quarter-second steps.
  useEffect(() => {
    if (!mine || !s.playing) return;
    let raf = 0;
    const tick = () => { setNow(audio().currentTime); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mine, s.playing]);

  // Leaving the page (or closing the row) stops it. Checked a tick later, so Strict Mode's unmount-and-remount doesn't.
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; setTimeout(() => { if (!live.current) release(file.id); }); };
  }, [file.id]);

  const duration = mine ? s.duration : 0;
  const time = mine ? (s.playing ? now : s.time) : 0;
  const frac = duration ? Math.min(1, time / duration) : 0;
  const playing = mine && s.playing;

  function toggle() {
    if (!ready) return;
    const a = audio();
    if (!mine) { claimAudio(file.id); return; }
    if (a.paused) void a.play().catch(() => {}); else a.pause();
  }
  function seekTo(f: number) {
    if (!ready || !duration) return;
    const a = audio();
    a.currentTime = Math.max(0, Math.min(duration, f * duration));
    setNow(a.currentTime);
    set({ time: a.currentTime });
  }
  const bar = useRef<HTMLDivElement>(null);
  const seekAt = (e: PointerEvent) => {
    const r = bar.current?.getBoundingClientRect();
    if (r && r.width) seekTo((e.clientX - r.left) / r.width);
  };
  const keys = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0;
    if (step && duration) { e.preventDefault(); seekTo((time + step) / duration); }
    else if (e.key === " ") { e.preventDefault(); toggle(); }
  };

  if (error) return <div className="ap" data-testid="audio-panel"><span className="sg-warn" data-testid="audio-error">{error}</span></div>;
  return (
    <div className="ap" data-testid="audio-panel" data-state={!ready ? "loading" : playing ? "playing" : "paused"}>
      <button type="button" className="ap-btn" onClick={toggle} disabled={!ready} aria-label={playing ? `Pause ${file.title}` : `Play ${file.title}`} data-testid="audio-toggle">
        {playing
          ? <svg viewBox="0 0 16 16" aria-hidden><rect x="3" y="2" width="3.5" height="12" rx="1" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" /></svg>
          : <svg viewBox="0 0 16 16" aria-hidden><path d="M4 2.2v11.6a.7.7 0 0 0 1.06.6l9.2-5.8a.7.7 0 0 0 0-1.2l-9.2-5.8A.7.7 0 0 0 4 2.2Z" /></svg>}
      </button>
      <div ref={bar} className="ap-wave" role="slider" tabIndex={ready ? 0 : -1} aria-label={`Position in ${file.title}`}
        aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} aria-valuetext={`${fmtTime(time)} of ${fmtTime(duration)}`}
        onPointerDown={(e) => { if (!ready) return; e.currentTarget.setPointerCapture(e.pointerId); seekAt(e); }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e); }}
        onKeyDown={keys} data-testid="audio-wave">
        {!ready ? <span className="ap-loading" data-testid="audio-loading">Loading… {pct ? `${pct}%` : ""}</span>
          : ready.peaks ? <Wave peaks={ready.peaks} frac={frac} />
          : <div className="ap-line"><div style={{ width: `${frac * 100}%` }} /></div>}
      </div>
      <span className="ap-time" data-testid="audio-time">{fmtTime(time)}{duration ? ` / ${fmtTime(duration)}` : ""}</span>
    </div>
  );
}

function Wave({ peaks, frac }: { peaks: number[]; frac: number }) {
  const n = peaks.length;
  const clip = useId();
  const bars = peaks.map((p, i) => { const h = Math.max(4, p * 100); return <rect key={i} x={i + 0.15} y={(100 - h) / 2} width={0.7} height={h} rx={0.3} />; });
  return (
    <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="ap-svg" aria-hidden>
      <defs><clipPath id={clip}><rect x={0} y={0} width={frac * n} height={100} /></clipPath></defs>
      <g className="ap-rest">{bars}</g>
      <g className="ap-done" clipPath={`url(#${clip})`}>{bars}</g>
    </svg>
  );
}
