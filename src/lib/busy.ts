"use client";
import { useEffect, useSyncExternalStore } from "react";

/**
 * One shared counter of things the person is waiting on: a page navigation, a listener's first snapshot, a command call.
 * The top loading bar shows while it is above zero. Background refreshes (a listener updating live data) never touch it.
 */
let count = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Start waiting. Returns the function that stops (safe to call more than once). */
export function beginBusy(): () => void {
  count++; emit();
  let done = false;
  return () => { if (done) return; done = true; count = Math.max(0, count - 1); emit(); };
}

export const useIsBusy = () =>
  useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => count > 0, () => false);

/** Busy while `waiting` is true (a first load). Flipping to false, or unmounting, ends it. */
export function useBusyWhile(waiting: boolean) {
  useEffect(() => {
    if (!waiting) return;
    return beginBusy();
  }, [waiting]);
}
