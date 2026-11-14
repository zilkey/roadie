"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** Confetti and a message for the big moments (a pitch becomes a show, a song leaves Writing). `celebrate()` from anywhere; <CelebrateHost /> sits next to <ToastHost />. */
/** big: fireworks and a lot more confetti, for longer (money arriving). */
export interface Celebration { title: string; text?: string; big?: boolean }
/** `title` empty: confetti only, no card (a ticked To Dos item). */
let current: (Celebration & { n: number }) | null = null;
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const dismiss = () => { current = null; emit(); };

export const CELEBRATE_MS = 4500;
export const BIG_CELEBRATE_MS = 7000;
export function celebrate(c: Celebration) { current = { ...c, n: ++seq }; emit(); }
/** A pitch just became one or more shows. */
export const celebrateBooking = (target: string, dates: string[]) =>
  celebrate({ title: "It's a show!", text: `${target}, ${dates.join(" and ")}` });
/** A song just left Writing: `label` is where it went ("Learning", "Playing"). */
export const celebrateSong = (title: string, label: string) =>
  celebrate({ title: "Out of the writing room!", text: `${title} is now ${label}` });
/** Money in was recorded: received now (fireworks), or owed to us (`received` false). `amount` is formatted ("$250.00"). */
export const celebrateMoneyIn = (amount: string, from: string, received = true) =>
  celebrate({ title: received ? "Money in!" : "Money on the way!", text: received ? `${amount} from ${from}` : `${from} owes us ${amount}`, big: received });
/** Just the confetti, no card: a To Dos item ticked done. Each call starts a fresh burst. */
export const confetti = () => celebrate({ title: "" });
/** A post just went up on Instagram. */
export const celebratePost = (title: string) => celebrate({ title: "Posted!", text: `${title} is on Instagram` });

const COLORS = ["#3a46c4", "#d6336c", "#1f8a55", "#f2b705", "#ff7a3d", "#7c5cff"];

interface Spark { x: number; y: number; vx: number; vy: number; life: number; color: string }
interface Rocket { x: number; y: number; vy: number; burstAt: number; at: number; color: string; done: boolean }

/**
 * Two bursts from the bottom corners, then the pieces flutter down. `big`: three times the confetti, a second wave from the
 * top, and fireworks (rockets that climb and burst into sparks). Stops by itself; the canvas never takes clicks.
 */
function Confetti({ big }: { big?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext("2d");
    if (!cv || !g) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    cv.width = w * dpr; cv.height = h * dpr; g.scale(dpr, dpr);
    const count = Math.min(180, Math.round(w / 5)) * (big ? 3 : 1);
    const parts = Array.from({ length: count }, (_, i) => {
      const left = i % 2 === 0;
      const angle = (left ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9;
      const speed = h * (0.016 + Math.random() * 0.014);
      // big: every third piece rains from the top instead
      if (big && i % 3 === 2) return {
        x: Math.random() * w, y: -20 - Math.random() * h * 0.6, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2,
        size: 6 + Math.random() * 6, rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.3, color: COLORS[i % COLORS.length], round: Math.random() < 0.3,
      };
      return {
        x: left ? 0 : w, y: h, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        size: 6 + Math.random() * 6, rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.3,
        color: COLORS[i % COLORS.length], round: Math.random() < 0.3,
      };
    });
    let raf = 0;
    const start = performance.now();
    const ms = big ? BIG_CELEBRATE_MS : CELEBRATE_MS;
    // Fireworks: a rocket every ~350ms for the first 4 seconds, each bursting into ~70 sparks near the top third.
    const rockets: Rocket[] = big ? Array.from({ length: 12 }, (_, i) => ({
      x: w * (0.12 + Math.random() * 0.76), y: h, vy: -(h * (0.017 + Math.random() * 0.006)), burstAt: h * (0.12 + Math.random() * 0.3),
      at: i * 350 + Math.random() * 150, color: COLORS[i % COLORS.length], done: false,
    })) : [];
    const sparks: Spark[] = [];
    const frame = (t: number) => {
      g.clearRect(0, 0, w, h);
      for (const r of rockets) {
        if (r.done || t - start < r.at) continue;
        r.y += r.vy; r.vy *= 0.99;
        g.fillStyle = r.color; g.beginPath(); g.arc(r.x, r.y, 2.5, 0, Math.PI * 2); g.fill();
        if (r.y <= r.burstAt || r.vy > -2) {
          r.done = true;
          for (let k = 0; k < 70; k++) {
            const a = (k / 70) * Math.PI * 2, v = 2 + Math.random() * 4.5;
            sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color: Math.random() < 0.25 ? "#ffffff" : r.color });
          }
        }
      }
      for (const p of sparks) {
        if (p.life <= 0) continue;
        p.vy += 0.06; p.vx *= 0.97; p.vy *= 0.97; p.x += p.vx; p.y += p.vy; p.life -= 0.012;
        g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, 2.2, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      for (const p of parts) {
        p.vy += 0.25; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.rot += p.spin;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.color;
        if (p.round) { g.beginPath(); g.arc(0, 0, p.size / 2.5, 0, Math.PI * 2); g.fill(); }
        else g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * (0.4 + Math.abs(Math.cos(p.rot))));
        g.restore();
      }
      const busy = parts.some((p) => p.y < h + 20) || rockets.some((r) => !r.done) || sparks.some((p) => p.life > 0);
      if (t - start < ms && busy) raf = requestAnimationFrame(frame);
      else g.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [big]);
  return <canvas ref={ref} className="celebrate-canvas" aria-hidden="true" data-testid="confetti" />;
}

export function CelebrateHost() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const c = current;
  useEffect(() => { if (!c) return; const h = setTimeout(dismiss, c.big ? BIG_CELEBRATE_MS : CELEBRATE_MS); return () => clearTimeout(h); }, [c]);
  const [still, setStill] = useState(false);
  useEffect(() => { setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  // A manual popover joins the top layer, so the confetti shows over an open modal dialog (Post it) too.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = box.current; if (c && el && typeof el.showPopover === "function" && !el.matches(":popover-open")) el.showPopover(); }, [c]);
  if (usePathname().endsWith("/print")) return null;
  if (!c) return null;
  return (
    <div className="celebrate" key={c.n} ref={box} popover="manual">
      {!still && <Confetti big={c.big} />}
      {c.title && <button type="button" className="celebrate-card" role="status" aria-live="polite" onClick={dismiss} data-testid="celebration">
        <span className="celebrate-title" data-testid="celebration-title">{c.title}</span>
        {c.text && <span className="celebrate-text" data-testid="celebration-text">{c.text}</span>}
      </button>}
    </div>
  );
}
