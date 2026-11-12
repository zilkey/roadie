"use client";
/**
 * A list's place, for coming back to it: how far down it was scrolled and how many "Load more" pages were open, per URL (path and
 * query, so each set of filters has its own), in memory for this tab. It's put back only on a back or forward step (the Back link
 * or the browser's), not when the list is opened afresh.
 */
import { useEffect, useRef } from "react";
import { takeSteppedBack } from "@/lib/navHistory";

const places = new Map<string, { y: number; pages: number }>();

const here = () => `${window.location.pathname}${window.location.search}`;

/**
 * Remember the list's scroll and `pages`, and on a step back to it open that many pages again and scroll there once `ready`
 * (its rows are on screen). `setPages` is called once, on the way back.
 */
export function useListMemory(pages: number, setPages: (n: number) => void, ready: boolean) {
  const target = useRef<{ y: number; pages: number } | null>(null);
  const pagesNow = useRef(pages);
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
  // Scroll once the pages it had are open and drawn.
  useEffect(() => {
    if (!ready || target.current === null || pages < target.current.pages) return;
    const { y } = target.current;
    target.current = null;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [ready, pages]);
}
