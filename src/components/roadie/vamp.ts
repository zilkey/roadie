"use client";
import { useEffect, useState } from "react";

/** Stage talk shown while Roadie is thinking (from the spec). */
export const VAMP_LINES = [
  "Vamping…", "Checking levels…", "Tuning…", "Counting off…", "Counting it in…", "Check, one, two, three…", "Finding my pick…",
  "Loading in…", "Loading out…", "Running the changes…", "Setting the levels…", "Taping down the setlist…", "Finding the key…",
  "Soundchecking…", "Waiting on the sound guy…", "Coiling cables…", "Changing strings…", "Restringing the high E…", "Looking for the capo…",
  "Warming up the tubes…", "Line checking…", "Plugging in…", "Untangling cables…", "Swapping a 9-volt…", "Tightening the snare…",
  "Taping down the cables…", "Asking for more vocals in the monitor…", "Retuning between songs…", "Finding the setlist…", "Setting up merch…",
  "Finding parking…", "Getting wristbands…", "Grabbing a drink ticket…", "Waiting on the opener…", "Counting the door…", "Running back to the van…",
];

export const VAMP_EVERY_MS = 3500;

function shuffled<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

/** The current waiting line: cycles in random order every few seconds; one static line with prefers-reduced-motion. */
export function useVamp(active: boolean): string {
  const [i, setI] = useState(0);
  const [order, setOrder] = useState(VAMP_LINES);
  useEffect(() => {
    if (!active) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setOrder(VAMP_LINES); setI(0); return; }
    const o = shuffled(VAMP_LINES);
    setOrder(o); setI(0);
    const t = setInterval(() => setI((n) => (n + 1) % o.length), VAMP_EVERY_MS);
    return () => clearInterval(t);
  }, [active]);
  return order[i];
}
