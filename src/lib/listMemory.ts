"use client";
/**
 * A list's place, for coming back to it: how far down it was scrolled and how many "Load more" pages were open, per URL (path and
 * query, so each set of filters has its own), in memory for this tab. It's put back only on a back or forward step (the Back link
 * or the browser's), not when the list is opened afresh.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { steppedBack, steppedBackDone } from "@/lib/navHistory";

/** How long a step back waits for the page to grow tall enough to reach the list's place. */
const RESTORE_MAX_MS = 10_000;

/**
 * `<html data-list-restoring>` while a list is being put back (its pages reopening, then the scroll): what a test waits
 * out before it scrolls the list itself, or the late restore would undo that scroll.
 */
function restoring(on: boolean) {
  if (on) document.documentElement.dataset.listRestoring = "1";
  else delete document.documentElement.dataset.listRestoring;
}

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
  // Armed before the first paint (a layout effect): a list on screen with a restore still to come could be scrolled by
  // the person, or a test, and then put back under them. The mark follows the pending target, not the step: a remount
  // (React's development double mount) has already used the step but still has the restore to do.
  useLayoutEffect(() => {
    if (!target.current && steppedBack()) {
      const p = places.get(here());
      if (p) { target.current = p; if (p.pages !== pages) setPages(p.pages); }
      else steppedBackDone(); // nowhere to go back to on this list
    }
    if (target.current) restoring(true);
    const save = () => { places.set(here(), { y: window.scrollY, pages: pagesNow.current }); };
    window.addEventListener("scroll", save, { passive: true });
    return () => { window.removeEventListener("scroll", save); if (target.current) restoring(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (target.current === null) places.set(here(), { y: window.scrollY, pages });
  }, [pages]);
  // Scroll once the pages it had are open and drawn. The page can still be shorter than the place then (rows below the
  // list, chips and data settling, slower on a busy machine), and a scroll past its end stops short: keep the place until
  // the page has grown enough to reach it, as long as RESTORE_MAX_MS, and let go at once if the person scrolls or types.
  useEffect(() => {
    if (!ready || target.current === null || pages < target.current.pages) return;
    const { y } = target.current;
    target.current = null;
    steppedBackDone();
    const root = document.documentElement;
    const inputs = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    let frame = 0, done = false;
    const watch = new ResizeObserver(() => { frame = requestAnimationFrame(go); });
    const cap = setTimeout(() => stop(), RESTORE_MAX_MS);
    function stop() {
      if (done) return;
      done = true; restoring(false); cancelAnimationFrame(frame); clearTimeout(cap); watch.disconnect();
      for (const ev of inputs) window.removeEventListener(ev, stop);
    }
    function go() {
      if (done) return;
      window.scrollTo(0, y);
      if (Math.abs(window.scrollY - y) <= 1) stop(); // there: done (a page that later shrinks is clamped by the browser)
    }
    for (const ev of inputs) window.addEventListener(ev, stop, { passive: true });
    watch.observe(root);
    frame = requestAnimationFrame(go);
    cancel.current = stop;
  }, [ready, pages]);
  useEffect(() => () => cancel.current(), []);
}
