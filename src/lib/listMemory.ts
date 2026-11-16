"use client";
/**
 * A list's place, for coming back to it: how far down it was scrolled and how many "Load more" pages were open, per URL (path and
 * query, so each set of filters has its own), in memory for this tab. It's put back only on a back or forward step (the Back link
 * or the browser's), not when the list is opened afresh.
 */
import { useEffect, useRef } from "react";
import { takeSteppedBack } from "@/lib/navHistory";

/** How long a step back keeps putting the list back in place while the page is still being drawn. */
const RESTORE_MS = 1500, RESTORE_MAX_MS = 5000;

const places = new Map<string, { y: number; pages: number }>();

const here = () => `${window.location.pathname}${window.location.search}`;

/**
 * Remember the list's scroll and `pages`, and on a step back to it open that many pages again and scroll there once `ready`
 * (its rows are on screen). `setPages` is called once, on the way back.
 */
export function useListMemory(pages: number, setPages: (n: number) => void, ready: boolean) {
  const target = useRef<{ y: number; pages: number } | null>(null);
  const pagesNow = useRef(pages);
  const cancel = useRef(() => {});
  pagesNow.current = pages;
  useEffect(() => {
    // Read the step on mount: this runs before the Shell's path effect, in the same commit.
    const p = takeSteppedBack() ? places.get(here()) : undefined;
    if (p) { target.current = p; if (p.pages !== pages) setPages(p.pages); }
    const save = () => { places.set(here(), { y: window.scrollY, pages: pagesNow.current }); };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (target.current === null) places.set(here(), { y: window.scrollY, pages });
  }, [pages]);
  // Scroll once the pages it had are open and drawn. The page can still be growing then (rows below the list, chips
  // and images settling), and a scroll past its current end stops short: keep trying for a moment until it reaches the
  // place or the page stops growing, and stop at once if the person scrolls or types themselves.
  useEffect(() => {
    if (!ready || target.current === null || pages < target.current.pages) return;
    const { y } = target.current;
    target.current = null;
    const start = performance.now();
    let frame = 0, until = start + RESTORE_MS, lastHeight = -1, done = false;
    const inputs = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    const stop = () => {
      if (done) return;
      done = true; cancelAnimationFrame(frame);
      for (const ev of inputs) window.removeEventListener(ev, stop);
    };
    for (const ev of inputs) window.addEventListener(ev, stop, { passive: true });
    const go = () => {
      if (done) return;
      window.scrollTo(0, y);
      const height = document.documentElement.scrollHeight;
      // Still growing: give it a little longer, never past RESTORE_MAX_MS.
      if (height !== lastHeight) { lastHeight = height; until = Math.min(start + RESTORE_MAX_MS, Math.max(until, performance.now() + 300)); }
      if (Math.abs(window.scrollY - y) > 1 && performance.now() < until) frame = requestAnimationFrame(go);
      else stop();
    };
    frame = requestAnimationFrame(go);
    cancel.current = stop;
  }, [ready, pages]);
  useEffect(() => () => cancel.current(), []);
}
