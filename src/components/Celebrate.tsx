"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** Confetti and a message for the big moments (a pitch becomes a show, a song leaves Writing). `celebrate()` from anywhere; <CelebrateHost /> sits next to <ToastHost />. */
export interface Celebration { title: string; text?: string }
let current: (Celebration & { n: number }) | null = null;
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const dismiss = () => { current = null; emit(); };

export const CELEBRATE_MS = 4500;
export function celebrate(c: Celebration) { current = { ...c, n: ++seq }; emit(); }
/** A pitch just became one or more shows. */
export const celebrateBooking = (target: string, dates: string[]) =>
  celebrate({ title: "It's a show!", text: `${target}, ${dates.join(" and ")}` });
/** A song just left Writing: `label` is where it went ("Learning", "Playing", "Idea"). */
export const celebrateSong = (title: string, label: string) =>
  celebrate({ title: "Out of the writing room!", text: `${title} is ${label === "Idea" ? "an Idea" : `now ${label}`}` });

const COLORS = ["#3a46c4", "#d6336c", "#1f8a55", "#f2b705", "#ff7a3d", "#7c5cff"];

/** Two bursts from the bottom corners, then the pieces flutter down. Stops by itself; the canvas never takes clicks. */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext("2d");
    if (!cv || !g) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    cv.width = w * dpr; cv.height = h * dpr; g.scale(dpr, dpr);
    const count = Math.min(180, Math.round(w / 5));
    const parts = Array.from({ length: count }, (_, i) => {
      const left = i % 2 === 0;
      const angle = (left ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9;
      const speed = h * (0.016 + Math.random() * 0.014);
      return {
        x: left ? 0 : w, y: h, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        size: 6 + Math.random() * 6, rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.3,
        color: COLORS[i % COLORS.length], round: Math.random() < 0.3,
      };
    });
    let raf = 0;
    const start = performance.now();
    const frame = (t: number) => {
      g.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.vy += 0.25; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.rot += p.spin;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.color;
        if (p.round) { g.beginPath(); g.arc(0, 0, p.size / 2.5, 0, Math.PI * 2); g.fill(); }
        else g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * (0.4 + Math.abs(Math.cos(p.rot))));
        g.restore();
      }
      if (t - start < CELEBRATE_MS && parts.some((p) => p.y < h + 20)) raf = requestAnimationFrame(frame);
      else g.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="celebrate-canvas" aria-hidden="true" />;
}

export function CelebrateHost() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const c = current;
  useEffect(() => { if (!c) return; const h = setTimeout(dismiss, CELEBRATE_MS); return () => clearTimeout(h); }, [c]);
  const [still, setStill] = useState(false);
  useEffect(() => { setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  if (usePathname().endsWith("/print")) return null;
  if (!c) return null;
  return (
    <div className="celebrate" key={c.n}>
      {!still && <Confetti />}
      <button type="button" className="celebrate-card" role="status" aria-live="polite" onClick={dismiss} data-testid="celebration">
        <span className="celebrate-title" data-testid="celebration-title">{c.title}</span>
        {c.text && <span className="celebrate-text" data-testid="celebration-text">{c.text}</span>}
      </button>
    </div>
  );
}
